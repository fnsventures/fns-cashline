-- Single self-contained fix: night inquiry + morning ATM load cycle
-- Run this whole file once in Supabase SQL Editor ONLY if you have not yet
-- applied later migrations (83000+).
--
-- DO NOT re-run after 20260808183000 / 90000 / 91000 / 93000 — this file
-- replaces opening-balance and summary helpers with older logic and will
-- regress production. Prefer schema.sql (fresh) or ordered migrations.

-- ---------------------------------------------------------------------------
-- 1) Table first (must exist before any function returns this type)
-- ---------------------------------------------------------------------------
create table if not exists public.atm_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_date date not null,
  opening_balance numeric(14, 2) not null check (opening_balance >= 0),
  cash_left numeric(14, 2) not null check (cash_left >= 0),
  dispensed numeric(14, 2) not null check (dispensed >= 0),
  receipt_path text not null,
  reference text,
  notes text,
  recorded_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  geo_accuracy_m double precision,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  replenished_at timestamptz,
  check (cash_left <= opening_balance)
);

create unique index if not exists atm_inquiries_inquiry_date_uidx
  on public.atm_inquiries (inquiry_date);

-- At most one open (unreplenished) inquiry
create unique index if not exists atm_inquiries_one_open_uidx
  on public.atm_inquiries ((true))
  where replenished_at is null;

create index if not exists atm_inquiries_recorded_at_idx
  on public.atm_inquiries (recorded_at desc);

alter table public.atm_inquiries enable row level security;

drop policy if exists "atm_inquiries_select_staff" on public.atm_inquiries;
create policy "atm_inquiries_select_staff"
  on public.atm_inquiries for select
  using (public.is_staff());

drop policy if exists "atm_inquiries_delete_admin" on public.atm_inquiries;
create policy "atm_inquiries_delete_admin"
  on public.atm_inquiries for delete
  using (public.is_admin());

-- Link cash_loads (required). bank_draws only if that table still exists.
alter table public.cash_loads
  add column if not exists inquiry_id uuid;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'bank_draws'
  ) then
    alter table public.bank_draws add column if not exists inquiry_id uuid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cash_loads_inquiry_id_fkey'
  ) then
    alter table public.cash_loads
      add constraint cash_loads_inquiry_id_fkey
      foreign key (inquiry_id) references public.atm_inquiries (id);
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'bank_draws'
  ) and not exists (
    select 1 from pg_constraint where conname = 'bank_draws_inquiry_id_fkey'
  ) then
    alter table public.bank_draws
      add constraint bank_draws_inquiry_id_fkey
      foreign key (inquiry_id) references public.atm_inquiries (id);
  end if;
end $$;

create index if not exists cash_loads_inquiry_id_idx on public.cash_loads (inquiry_id);

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------
create or replace function public._ist_today()
returns date
language sql
stable
as $$
  select (timezone('Asia/Kolkata', now()))::date;
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
    return v_capital;
  end if;

  if v_last.replenished_at is null then
    raise exception 'Previous night inquiry is still open. Complete morning ATM load first.';
  end if;

  return v_last.opening_balance;
end;
$$;

create or replace function public._open_inquiry()
returns public.atm_inquiries
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.atm_inquiries
  where replenished_at is null
  order by recorded_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3) Summary view (drop first — column order/names changed)
-- ---------------------------------------------------------------------------
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
latest as (
  select *
  from public.atm_inquiries
  order by recorded_at desc
  limit 1
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
  coalesce(
    (select cash_left from open_inq),
    (select opening_balance from latest where replenished_at is not null),
    c.total_capital
  )::numeric(14, 2) as cash_in_atm,
  coalesce((select dispensed from open_inq), 0)::numeric(14, 2) as pending_replenish,
  coalesce((select cash_left from open_inq), null)::numeric(14, 2) as open_cash_left,
  coalesce((select opening_balance from open_inq), null)::numeric(14, 2) as open_opening_balance,
  coalesce((select dispensed from open_inq), null)::numeric(14, 2) as open_dispensed,
  (select id from open_inq) as open_inquiry_id,
  (select inquiry_date from open_inq) as open_inquiry_date,
  coalesce((select sum(dispensed) from public.atm_inquiries), 0)::numeric(14, 2) as total_dispensed,
  coalesce(
    (
      select sum(amount) from public.bank_draws
    ),
    0
  )::numeric(14, 2) as total_bank_drawn,
  coalesce((select sum(amount) from public.cash_loads), 0)::numeric(14, 2) as total_loaded,
  coalesce((select dispensed from open_inq), 0)::numeric(14, 2) as pending_to_load,
  coalesce((select sum(net_commission) from public.commission_settlements), 0)::numeric(14, 2) as total_commission_net,
  coalesce((select sum(transaction_count) from public.commission_settlements), 0)::integer as total_transactions
from capital c;

grant select on public.v_atm_summary to authenticated;
grant select on public.atm_inquiries to authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPCs
-- ---------------------------------------------------------------------------
create or replace function public.record_atm_inquiry(
  p_cash_left numeric,
  p_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision default null,
  p_reference text default null
)
returns public.atm_inquiries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left numeric(14, 2);
  v_opening numeric(14, 2);
  v_dispensed numeric(14, 2);
  v_path text;
  v_date date;
  v_row public.atm_inquiries%rowtype;
begin
  perform public._assert_staff();
  v_path := public._validate_receipt_path(p_receipt_path);
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);

  if p_cash_left is null or p_cash_left < 0 then
    raise exception 'Cash left in ATM must be zero or more';
  end if;
  v_left := round(p_cash_left, 2);

  v_opening := public._atm_opening_balance();
  if v_left > v_opening + 0.009 then
    raise exception 'Cash left ₹% cannot exceed opening balance ₹%', v_left, v_opening;
  end if;

  v_dispensed := round(v_opening - v_left, 2);
  v_date := public._ist_today();

  if exists (select 1 from public.atm_inquiries where inquiry_date = v_date) then
    raise exception 'ATM inquiry for % already recorded', v_date;
  end if;

  insert into public.atm_inquiries (
    inquiry_date,
    opening_balance,
    cash_left,
    dispensed,
    receipt_path,
    reference,
    recorded_at,
    latitude,
    longitude,
    geo_accuracy_m,
    created_by,
    replenished_at
  )
  values (
    v_date,
    v_opening,
    v_left,
    v_dispensed,
    v_path,
    nullif(trim(coalesce(p_reference, '')), ''),
    now(),
    p_latitude,
    p_longitude,
    p_geo_accuracy_m,
    auth.uid(),
    case when v_dispensed <= 0.009 then now() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Drop old dual-receipt signature if present
drop function if exists public.record_replenish(text, text, double precision, double precision, double precision, text);

create or replace function public.record_replenish(
  p_atm_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision default null,
  p_reference text default null
)
returns public.atm_inquiries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inq public.atm_inquiries%rowtype;
  v_amount numeric(14, 2);
  v_atm_path text;
  v_ref text;
begin
  perform public._assert_staff();
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);

  select * into v_inq
  from public.atm_inquiries
  where replenished_at is null
  order by recorded_at desc
  limit 1;

  if not found then
    raise exception 'No open night inquiry. Record ATM inquiry first.';
  end if;

  v_amount := v_inq.dispensed;
  if v_amount <= 0.009 then
    update public.atm_inquiries
    set replenished_at = now()
    where id = v_inq.id
      and replenished_at is null
    returning * into v_inq;
    return v_inq;
  end if;

  v_atm_path := public._validate_receipt_path(p_atm_receipt_path);
  v_ref := nullif(trim(coalesce(p_reference, '')), '');

  insert into public.cash_loads (
    load_date,
    amount,
    mode,
    reference,
    atm_receipt_path,
    recorded_at,
    latitude,
    longitude,
    geo_accuracy_m,
    created_by,
    inquiry_id
  )
  values (
    public._ist_today(),
    v_amount,
    'bank_cc',
    v_ref,
    v_atm_path,
    now(),
    p_latitude,
    p_longitude,
    p_geo_accuracy_m,
    auth.uid(),
    v_inq.id
  );

  update public.atm_inquiries
  set replenished_at = now()
  where id = v_inq.id
    and replenished_at is null
  returning * into v_inq;

  return v_inq;
end;
$$;

revoke all on function public.record_atm_inquiry(numeric, text, double precision, double precision, double precision, text) from public;
revoke all on function public.record_replenish(text, double precision, double precision, double precision, text) from public;
grant execute on function public.record_atm_inquiry(numeric, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.record_replenish(text, double precision, double precision, double precision, text) to authenticated;

revoke insert, update on public.atm_inquiries from authenticated, anon;
grant select on public.atm_inquiries to authenticated;
grant delete on public.atm_inquiries to authenticated;

-- Optional: disable legacy bank-draw RPC (ignore if function missing)
do $$
begin
  revoke execute on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text)
    from authenticated, anon, public;
exception
  when undefined_function then null;
end $$;
