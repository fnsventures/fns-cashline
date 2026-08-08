-- Admin override for ATM load: editable amount + load without night inquiry
-- Run after 20260808182000_atm_inquiry_cycle_fix.sql

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
      and recorded_at > v_last.recorded_at;

    return round(v_last.cash_left + v_loaded + v_orphan, 2);
  end if;

  -- No inquiry history: assume ATM is at station capital.
  -- Do not sum legacy null-inquiry cash_loads (old bank-draw era).
  return round(coalesce(public._station_capital(), 0), 2);
end;
$$;

create or replace function public._atm_opening_balance()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last public.atm_inquiries%rowtype;
  v_capital numeric;
begin
  select * into v_last
  from public.atm_inquiries
  order by recorded_at desc
  limit 1;

  if not found then
    v_capital := public._station_capital();
    if v_capital <= 0 then
      raise exception 'Set total capital on Users before recording an ATM inquiry.';
    end if;
    return public._current_atm_balance();
  end if;

  if v_last.replenished_at is null then
    raise exception 'Previous night inquiry is still open. Complete morning ATM load first.';
  end if;

  -- Next night opening = current known ATM balance after last cycle (+ any admin loads)
  return public._current_atm_balance();
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
  v_current numeric(14, 2);
  v_capital numeric;
  v_row public.cash_loads%rowtype;
  v_has_open boolean;
begin
  perform public._assert_staff();
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);
  v_admin := public.is_admin();
  v_atm_path := public._validate_receipt_path(p_atm_receipt_path);
  v_ref := nullif(trim(coalesce(p_reference, '')), '');

  select * into v_inq
  from public.atm_inquiries
  where replenished_at is null
  order by recorded_at desc
  limit 1;
  v_has_open := found;

  if not v_has_open then
    if not (p_force and v_admin) then
      raise exception 'No open night inquiry. Record ATM inquiry first.';
    end if;
    if p_amount is null then
      raise exception 'Admin load without inquiry requires an amount.';
    end if;
    v_amount := public._validate_amount(p_amount);

    v_current := public._current_atm_balance();
    v_capital := public._station_capital();
    if v_capital > 0 and v_current + v_amount > v_capital + 0.009 then
      raise exception 'ATM balance would become ₹% which exceeds total capital ₹%',
        round(v_current + v_amount, 2), v_capital;
    end if;

    insert into public.cash_loads (
      load_date, amount, mode, reference, atm_receipt_path, recorded_at,
      latitude, longitude, geo_accuracy_m, created_by, inquiry_id
    )
    values (
      public._ist_today(), v_amount, 'bank_cc',
      case
        when v_ref is null then 'admin-override'
        else 'admin-override: ' || v_ref
      end,
      v_atm_path, now(),
      p_latitude, p_longitude, p_geo_accuracy_m, auth.uid(), null
    )
    returning * into v_row;

    return v_row;
  end if;

  -- Open night inquiry path
  if p_amount is not null then
    if not v_admin then
      raise exception 'Only admins can override the ATM load amount.';
    end if;
    v_amount := public._validate_amount(p_amount);
  else
    v_amount := v_inq.dispensed;
  end if;

  if v_amount <= 0.009 then
    update public.atm_inquiries
    set replenished_at = now()
    where id = v_inq.id
      and replenished_at is null;
    return null;
  end if;

  v_capital := public._station_capital();
  if v_capital > 0 and v_inq.cash_left + v_amount > v_capital + 0.009 then
    raise exception 'ATM balance would become ₹% which exceeds total capital ₹%',
      round(v_inq.cash_left + v_amount, 2), v_capital;
  end if;

  insert into public.cash_loads (
    load_date, amount, mode, reference, atm_receipt_path, recorded_at,
    latitude, longitude, geo_accuracy_m, created_by, inquiry_id
  )
  values (
    public._ist_today(), v_amount, 'bank_cc', v_ref, v_atm_path, now(),
    p_latitude, p_longitude, p_geo_accuracy_m, auth.uid(), v_inq.id
  )
  returning * into v_row;

  update public.atm_inquiries
  set replenished_at = now()
  where id = v_inq.id
    and replenished_at is null;

  return v_row;
end;
$$;

revoke all on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) from public;
grant execute on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) to authenticated;
