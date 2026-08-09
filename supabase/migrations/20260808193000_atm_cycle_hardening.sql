-- ATM cycle hardening (run after 20260808191000 / 20260808192000). Safe to re-run.
--
-- Fixes:
-- 1) Concurrent record_replenish could insert two cash_loads for one inquiry
--    (no row lock; update of replenished_at is not checked).
-- 2) Admin force-load with zero inquiry history inserted orphans that
--    _current_atm_balance() never counted (balance hard-coded to capital).
-- 3) Admin amount override on an open inquiry was not tagged admin-override.
-- 4) schema/91000 drift: SELECT FROM _open_inquiry() + FOUND; use direct lock.
-- 5) _current_atm_balance executable without staff check.

-- Keep earliest load per inquiry; detach any duplicate inquiry_id links
with ranked as (
  select
    id,
    row_number() over (partition by inquiry_id order by recorded_at asc, id asc) as rn
  from public.cash_loads
  where inquiry_id is not null
)
update public.cash_loads c
set inquiry_id = null,
    reference = coalesce(
      nullif(trim(c.reference), ''),
      'detached-duplicate-load'
    )
from ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists cash_loads_one_per_inquiry_uidx
  on public.cash_loads (inquiry_id)
  where inquiry_id is not null;

create or replace function public._current_atm_balance()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_open public.atm_inquiries%rowtype;
  v_last public.atm_inquiries%rowtype;
  v_loaded numeric;
  v_orphan numeric;
begin
  perform public._assert_staff();

  select * into v_open
  from public.atm_inquiries
  where replenished_at is null
  order by recorded_at desc
  limit 1;

  if found then
    return v_open.cash_left;
  end if;

  select * into v_last
  from public.atm_inquiries
  where replenished_at is not null
  order by recorded_at desc
  limit 1;

  if found then
    select coalesce(sum(amount), 0) into v_loaded
    from public.cash_loads
    where inquiry_id = v_last.id;

    select coalesce(sum(amount), 0) into v_orphan
    from public.cash_loads
    where inquiry_id is null
      and recorded_at > v_last.recorded_at
      and (
        reference = 'admin-override'
        or reference like 'admin-override:%'
      );

    return round(v_last.cash_left + v_loaded + v_orphan, 2);
  end if;

  -- No inquiry history: ATM assumed at station capital.
  -- Do not count legacy / orphan loads (they are invisible to opening math).
  return round(coalesce(public._station_capital(), 0), 2);
end;
$$;

drop function if exists public.record_replenish(text, double precision, double precision, double precision, text);
drop function if exists public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean);

create or replace function public.record_replenish(
  p_atm_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision default null,
  p_reference text default null,
  p_amount numeric default null,
  p_force boolean default false
)
returns public.cash_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inq public.atm_inquiries%rowtype;
  v_amount numeric(14, 2);
  v_atm_path text;
  v_ref text;
  v_admin boolean;
  v_row public.cash_loads%rowtype;
  v_has_open boolean;
  v_closed integer;
  v_has_history boolean;
  v_override boolean := false;
begin
  perform public._assert_staff();
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);
  v_admin := public.is_admin();
  v_atm_path := public._validate_receipt_path(p_atm_receipt_path);
  v_ref := nullif(trim(coalesce(p_reference, '')), '');

  -- Lock open inquiry row so concurrent loads cannot double-credit.
  select * into v_inq
  from public.atm_inquiries
  where id = (
    select id
    from public.atm_inquiries
    where replenished_at is null
    order by recorded_at desc
    limit 1
  )
  for update;
  v_has_open := found;

  if not v_has_open then
    if not (p_force and v_admin) then
      raise exception 'No open night inquiry. Record ATM inquiry first.';
    end if;

    select exists (select 1 from public.atm_inquiries) into v_has_history;
    if not v_has_history then
      raise exception
        'No inquiry history yet. Record a night inquiry first (ATM is assumed at total capital; force-load would not be tracked).';
    end if;

    if p_amount is null then
      raise exception 'Admin load without inquiry requires an amount.';
    end if;
    v_amount := public._validate_amount(p_amount);
    perform public._assert_atm_capital_room(public._current_atm_balance(), v_amount);

    insert into public.cash_loads (
      load_date, amount, mode, reference, atm_receipt_path, recorded_at,
      latitude, longitude, geo_accuracy_m, created_by, inquiry_id
    )
    values (
      public._ist_today(), v_amount, 'bank_cc',
      public._admin_load_reference(v_ref),
      v_atm_path, now(),
      p_latitude, p_longitude, p_geo_accuracy_m, auth.uid(), null
    )
    returning * into v_row;

    return v_row;
  end if;

  if exists (select 1 from public.cash_loads where inquiry_id = v_inq.id) then
    raise exception 'ATM load already recorded for this night inquiry.';
  end if;

  if p_amount is not null then
    if not v_admin then
      raise exception 'Only admins can override the ATM load amount.';
    end if;
    v_amount := public._validate_amount(p_amount);
    v_override := abs(v_amount - v_inq.dispensed) > 0.009;
  else
    v_amount := v_inq.dispensed;
  end if;

  if v_amount <= 0.009 then
    update public.atm_inquiries
    set replenished_at = now()
    where id = v_inq.id
      and replenished_at is null;
    get diagnostics v_closed = row_count;
    if v_closed = 0 then
      raise exception 'Night inquiry was already closed.';
    end if;
    return null;
  end if;

  perform public._assert_atm_capital_room(v_inq.cash_left, v_amount);

  insert into public.cash_loads (
    load_date, amount, mode, reference, atm_receipt_path, recorded_at,
    latitude, longitude, geo_accuracy_m, created_by, inquiry_id
  )
  values (
    public._ist_today(),
    v_amount,
    'bank_cc',
    case
      when v_override then public._admin_load_reference(v_ref)
      else v_ref
    end,
    v_atm_path,
    now(),
    p_latitude,
    p_longitude,
    p_geo_accuracy_m,
    auth.uid(),
    v_inq.id
  )
  returning * into v_row;

  update public.atm_inquiries
  set replenished_at = now()
  where id = v_inq.id
    and replenished_at is null;
  get diagnostics v_closed = row_count;
  if v_closed = 0 then
    raise exception 'Night inquiry was already closed.';
  end if;

  return v_row;
end;
$$;

drop view if exists public.v_atm_summary;

create view public.v_atm_summary
with (security_invoker = true)
as
with capital as (
  select coalesce(
    (
      select (config -> 'station' ->> 'totalCapital')::numeric
      from public.atm_settings
      where id = 1
    ),
    0
  )::numeric(14, 2) as total_capital
),
open_inq as (
  select *
  from public.atm_inquiries
  where replenished_at is null
  order by recorded_at desc
  limit 1
)
select
  c.total_capital,
  public._current_atm_balance()::numeric(14, 2) as cash_in_atm,
  coalesce((select dispensed from open_inq), 0)::numeric(14, 2) as pending_replenish,
  coalesce((select cash_left from open_inq), null)::numeric(14, 2) as open_cash_left,
  coalesce((select opening_balance from open_inq), null)::numeric(14, 2) as open_opening_balance,
  coalesce((select dispensed from open_inq), null)::numeric(14, 2) as open_dispensed,
  (select id from open_inq) as open_inquiry_id,
  (select inquiry_date from open_inq) as open_inquiry_date,
  coalesce((select sum(dispensed) from public.atm_inquiries), 0)::numeric(14, 2) as total_dispensed,
  coalesce((select sum(amount) from public.bank_draws), 0)::numeric(14, 2) as total_bank_drawn,
  coalesce((select sum(amount) from public.cash_loads), 0)::numeric(14, 2) as total_loaded,
  coalesce((select dispensed from open_inq), 0)::numeric(14, 2) as pending_to_load,
  coalesce((select sum(net_commission) from public.commission_settlements), 0)::numeric(14, 2) as total_commission_net,
  coalesce((select sum(transaction_count) from public.commission_settlements), 0)::integer as total_transactions
from capital c;

grant select on public.v_atm_summary to authenticated;

revoke all on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) from public;
grant execute on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) to authenticated;

revoke all on function public._current_atm_balance() from public, anon;
grant execute on function public._current_atm_balance() to authenticated;

revoke all on function public._assert_atm_capital_room(numeric, numeric) from public, anon, authenticated;
revoke all on function public._admin_load_reference(text) from public, anon, authenticated;
revoke all on function public._atm_opening_balance() from public, anon, authenticated;

do $$
begin
  revoke all on function public._insert_cash_load(numeric, text, double precision, double precision, double precision, text, uuid)
    from public, anon, authenticated;
exception when undefined_function then null;
end $$;

do $$
begin
  revoke all on function public._open_inquiry() from public, anon, authenticated;
exception when undefined_function then null;
end $$;
