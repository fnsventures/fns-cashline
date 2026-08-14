-- FNS Cashline / FINDI — ATM float tracker at Bishnupriya Fuels
-- Apply in Supabase SQL Editor (fresh project) or use migrations/ for upgrades.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users (linked to auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'operator' check (role in ('admin', 'operator')),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_my_role() = 'admin';
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_my_role() in ('admin', 'operator');
$$;

grant execute on function public.get_my_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
  on public.users for select
  using (auth.uid() = id);

drop policy if exists "users_select_admin" on public.users;
create policy "users_select_admin"
  on public.users for select
  using (public.is_admin());

drop policy if exists "users_update_admin" on public.users;
create policy "users_update_admin"
  on public.users for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Provision app user from existing Auth account (admin only)
-- ---------------------------------------------------------------------------
create or replace function public.provision_user(
  p_email text,
  p_role text default 'operator',
  p_display_name text default null
)
returns public.users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_id uuid;
  v_email text;
  v_row public.users;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  v_email := lower(trim(p_email));
  if v_email = '' then
    raise exception 'Email is required';
  end if;

  if p_role not in ('admin', 'operator') then
    raise exception 'Role must be admin or operator';
  end if;

  select id into v_auth_id
  from auth.users
  where lower(trim(email)) = v_email
  limit 1;

  if v_auth_id is null then
    raise exception 'No Auth user for %. Create the login in Supabase Authentication first.', v_email;
  end if;

  insert into public.users (id, email, role, display_name)
  values (
    v_auth_id,
    v_email,
    p_role,
    nullif(trim(coalesce(p_display_name, '')), '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = excluded.role,
    display_name = coalesce(excluded.display_name, public.users.display_name)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.provision_user(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- ATM settings (single-row JSON config)
-- ---------------------------------------------------------------------------
create table if not exists public.atm_settings (
  id smallint primary key default 1 check (id = 1),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.atm_settings (id, config)
values (
  1,
  jsonb_build_object(
    'station', jsonb_build_object(
      'displayName', 'FINDI',
      'location', 'Bishnupriya Fuels Petrol Pump, Padmanavpur',
      'franchisePartner', 'FINDI',
      'machineId', '',
      'totalCapital', 200000,
      'commissionPerTxn', 0,
      'minFloat', 0,
      'geo', jsonb_build_object(
        'latitude', null,
        'longitude', null,
        'radiusM', 3000,
        'requireLocation', true
      )
    )
  )
)
on conflict (id) do nothing;

alter table public.atm_settings enable row level security;

drop policy if exists "atm_settings_select_staff" on public.atm_settings;
create policy "atm_settings_select_staff"
  on public.atm_settings for select
  using (public.is_staff());

drop policy if exists "atm_settings_admin_all" on public.atm_settings;
drop policy if exists "atm_settings_write_admin" on public.atm_settings;
create policy "atm_settings_write_admin"
  on public.atm_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bank draws (cash taken from bank CC)
-- ---------------------------------------------------------------------------
create table if not exists public.bank_draws (
  id uuid primary key default gen_random_uuid(),
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  notes text,
  receipt_path text not null,
  recorded_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  geo_accuracy_m double precision,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists bank_draws_recorded_at_idx
  on public.bank_draws (recorded_at desc);

alter table public.bank_draws enable row level security;

drop policy if exists "bank_draws_staff_all" on public.bank_draws;
drop policy if exists "bank_draws_select_staff" on public.bank_draws;
drop policy if exists "bank_draws_delete_admin" on public.bank_draws;
create policy "bank_draws_select_staff"
  on public.bank_draws for select
  using (public.is_staff());
create policy "bank_draws_delete_admin"
  on public.bank_draws for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Cash loads (money loaded into the ATM)
-- ---------------------------------------------------------------------------
create table if not exists public.cash_loads (
  id uuid primary key default gen_random_uuid(),
  load_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  mode text not null default 'bank_cc'
    check (mode in ('bank_cc', 'bank_transfer', 'cash', 'other')),
  reference text,
  notes text,
  atm_receipt_path text,
  recorded_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  geo_accuracy_m double precision,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists cash_loads_load_date_idx on public.cash_loads (load_date desc);
create index if not exists cash_loads_recorded_at_idx on public.cash_loads (recorded_at desc);

alter table public.cash_loads enable row level security;

drop policy if exists "cash_loads_admin_all" on public.cash_loads;
drop policy if exists "cash_loads_staff_all" on public.cash_loads;
drop policy if exists "cash_loads_select_staff" on public.cash_loads;
drop policy if exists "cash_loads_delete_admin" on public.cash_loads;
create policy "cash_loads_select_staff"
  on public.cash_loads for select
  using (public.is_staff());
create policy "cash_loads_delete_admin"
  on public.cash_loads for delete
  using (public.is_admin());

alter table public.bank_draws
  add column if not exists inquiry_id uuid;

alter table public.cash_loads
  add column if not exists inquiry_id uuid;

-- ---------------------------------------------------------------------------
-- Night ATM inquiries (cash left → customer dispensed)
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
  check (cash_left <= opening_balance),
  check (dispensed = round(opening_balance - cash_left, 2))
);

create unique index if not exists atm_inquiries_inquiry_date_uidx
  on public.atm_inquiries (inquiry_date);

create unique index if not exists atm_inquiries_one_open_uidx
  on public.atm_inquiries ((1))
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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bank_draws_inquiry_id_fkey'
  ) then
    alter table public.bank_draws
      add constraint bank_draws_inquiry_id_fkey
      foreign key (inquiry_id) references public.atm_inquiries (id);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'cash_loads_inquiry_id_fkey'
  ) then
    alter table public.cash_loads
      add constraint cash_loads_inquiry_id_fkey
      foreign key (inquiry_id) references public.atm_inquiries (id);
  end if;
end $$;

create index if not exists bank_draws_inquiry_id_idx on public.bank_draws (inquiry_id);
create index if not exists cash_loads_inquiry_id_idx on public.cash_loads (inquiry_id);

-- At most one ATM load row per night inquiry (blocks concurrent double-credit)
create unique index if not exists cash_loads_one_per_inquiry_uidx
  on public.cash_loads (inquiry_id)
  where inquiry_id is not null;

-- ---------------------------------------------------------------------------
-- Commission settlements (admin-only)
-- ---------------------------------------------------------------------------
create table if not exists public.commission_settlements (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  transaction_count integer not null default 0 check (transaction_count >= 0),
  rate_per_txn numeric(14, 4) check (rate_per_txn is null or rate_per_txn >= 0),
  gross_commission numeric(14, 2) not null default 0 check (gross_commission >= 0),
  tds numeric(14, 2) not null default 0 check (tds >= 0),
  net_commission numeric(14, 2) not null default 0 check (net_commission >= 0),
  paid_on date,
  reference text,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists commission_settlements_period_idx
  on public.commission_settlements (period_start desc);

alter table public.commission_settlements enable row level security;

drop policy if exists "commission_settlements_admin_all" on public.commission_settlements;
create policy "commission_settlements_admin_all"
  on public.commission_settlements for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Summary view (defined after cycle helpers — see v_atm_summary below)
-- ---------------------------------------------------------------------------
grant select on public.atm_inquiries to authenticated;

-- ---------------------------------------------------------------------------
-- Receipt photo storage (private bucket)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts_staff_select" on storage.objects;
create policy "receipts_staff_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_staff());

drop policy if exists "receipts_staff_insert" on storage.objects;
create policy "receipts_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_staff()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "receipts_staff_update" on storage.objects;
create policy "receipts_staff_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and public.is_staff())
  with check (bucket_id = 'receipts' and public.is_staff());

drop policy if exists "receipts_staff_delete" on storage.objects;
create policy "receipts_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------------
-- Foolproof write RPCs (see migrations/20260808170000_foolproof_ops_rpc.sql)
-- ---------------------------------------------------------------------------
create or replace function public._assert_staff()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.is_staff() then
    raise exception 'Not authorized';
  end if;
end;
$$;

create or replace function public._station_capital()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (config -> 'station' ->> 'totalCapital')::numeric from public.atm_settings where id = 1),
    0
  );
$$;

create or replace function public._pending_to_load()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce((select sum(amount) from public.bank_draws), 0)
    - coalesce((select sum(amount) from public.cash_loads), 0)
  );
$$;

create or replace function public._haversine_m(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select 6371000::double precision * 2 * asin(
    sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
      + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    )
  );
$$;

create or replace function public._validate_amount(p_amount numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amount numeric(14, 2);
  v_capital numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  v_amount := round(p_amount, 2);
  if v_amount <> p_amount then
    -- allow values that already round cleanly
    null;
  end if;
  v_capital := public._station_capital();
  if v_capital > 0 and v_amount > v_capital then
    raise exception 'Amount ₹% exceeds total capital ₹%', v_amount, v_capital;
  end if;
  if v_amount > 10000000 then
    raise exception 'Amount is unrealistically large';
  end if;
  return v_amount;
end;
$$;

create or replace function public._validate_receipt_path(p_path text)
returns text
language plpgsql
immutable
as $$
begin
  if p_path is null or length(trim(p_path)) < 8 then
    raise exception 'Receipt photo is required';
  end if;
  if p_path like 'migrated/%' then
    raise exception 'Invalid receipt path';
  end if;
  return trim(p_path);
end;
$$;

create or replace function public._validate_geo(
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_geo jsonb;
  v_require boolean;
  v_center_lat double precision;
  v_center_lng double precision;
  v_radius double precision;
  v_dist double precision;
begin
  select config -> 'station' -> 'geo'
  into v_geo
  from public.atm_settings
  where id = 1;

  v_require := coalesce((v_geo ->> 'requireLocation')::boolean, true);

  if p_latitude is null or p_longitude is null then
    if v_require then
      raise exception 'Location is required. Enable GPS and try again.';
    end if;
    return;
  end if;

  if p_latitude = 0 and p_longitude = 0 then
    raise exception 'Invalid location (0,0)';
  end if;

  -- India bounding box (rejects overseas spoofing)
  if p_latitude < 6.5 or p_latitude > 37.5 or p_longitude < 67.5 or p_longitude > 97.5 then
    raise exception 'Location outside India is not allowed';
  end if;

  if p_geo_accuracy_m is not null and p_geo_accuracy_m > 5000 then
    raise exception 'GPS accuracy too poor (±%s m). Move outdoors and retry.', round(p_geo_accuracy_m);
  end if;

  v_center_lat := nullif(v_geo ->> 'latitude', '')::double precision;
  v_center_lng := nullif(v_geo ->> 'longitude', '')::double precision;
  v_radius := coalesce(nullif(v_geo ->> 'radiusM', '')::double precision, 3000);

  if v_center_lat is not null and v_center_lng is not null then
    v_dist := public._haversine_m(v_center_lat, v_center_lng, p_latitude, p_longitude);
    if v_dist > v_radius then
      raise exception 'Location is % m from station (allowed % m). Record must be made on site.',
        round(v_dist), round(v_radius);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: bank draw (server timestamp; no client clock)
-- ---------------------------------------------------------------------------
create or replace function public.record_bank_draw(
  p_amount numeric,
  p_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision default null,
  p_reference text default null
)
returns public.bank_draws
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(14, 2);
  v_path text;
  v_row public.bank_draws;
begin
  perform public._assert_staff();
  v_amount := public._validate_amount(p_amount);
  v_path := public._validate_receipt_path(p_receipt_path);
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);

  insert into public.bank_draws (
    amount,
    reference,
    receipt_path,
    recorded_at,
    latitude,
    longitude,
    geo_accuracy_m,
    created_by
  )
  values (
    v_amount,
    nullif(trim(coalesce(p_reference, '')), ''),
    v_path,
    now(),
    p_latitude,
    p_longitude,
    p_geo_accuracy_m,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: ATM load (cannot exceed pending bank cash for operators)
-- ---------------------------------------------------------------------------
create or replace function public.record_atm_load(
  p_amount numeric,
  p_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision default null,
  p_reference text default null,
  p_force boolean default false
)
returns public.cash_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(14, 2);
  v_path text;
  v_pending numeric;
  v_row public.cash_loads;
begin
  perform public._assert_staff();
  v_amount := public._validate_amount(p_amount);
  v_path := public._validate_receipt_path(p_receipt_path);
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);

  v_pending := public._pending_to_load();
  if v_amount > v_pending + 0.009 then
    if not (p_force and public.is_admin()) then
      raise exception 'ATM load ₹% exceeds pending bank cash ₹%. Draw from bank first.',
        v_amount, v_pending;
    end if;
  end if;

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
    created_by
  )
  values (
    (timezone('Asia/Kolkata', now()))::date,
    v_amount,
    'bank_cc',
    nullif(trim(coalesce(p_reference, '')), ''),
    v_path,
    now(),
    p_latitude,
    p_longitude,
    p_geo_accuracy_m,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Legacy bank-draw workflow: keep functions for historical DBs, do not grant execute
revoke all on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text) from public;
revoke all on function public.record_atm_load(numeric, text, double precision, double precision, double precision, text, boolean) from public;
revoke all on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text) from authenticated, anon;
revoke all on function public.record_atm_load(numeric, text, double precision, double precision, double precision, text, boolean) from authenticated, anon;

-- Block privilege escalation via direct grants if present
revoke insert, update on public.bank_draws from authenticated, anon;
revoke insert, update on public.cash_loads from authenticated, anon;
grant select on public.bank_draws to authenticated;
grant select on public.cash_loads to authenticated;
grant delete on public.bank_draws to authenticated;
grant delete on public.cash_loads to authenticated;

-- ---------------------------------------------------------------------------
-- Inquiry cycle helpers + RPCs (canonical as of atm_cycle_hardening)
-- ---------------------------------------------------------------------------
create or replace function public._ist_today()
returns date
language sql
stable
as $$
  select (timezone('Asia/Kolkata', now()))::date;
$$;

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

  -- No inquiry history yet: ATM is assumed at station capital.
  -- Ignore legacy null-inquiry loads (pre-cycle / bank-draw era).
  return round(coalesce(public._station_capital(), 0), 2);
end;
$$;

create or replace function public._assert_atm_capital_room(p_current numeric, p_amount numeric)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_capital numeric;
begin
  v_capital := public._station_capital();
  if v_capital > 0 and coalesce(p_current, 0) + coalesce(p_amount, 0) > v_capital + 0.009 then
    raise exception 'ATM balance would become ₹% which exceeds total capital ₹%',
      round(coalesce(p_current, 0) + coalesce(p_amount, 0), 2), v_capital;
  end if;
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

  return public._current_atm_balance();
end;
$$;

drop function if exists public._open_inquiry();

create or replace function public._admin_load_reference(p_reference text)
returns text
language sql
immutable
as $$
  select case
    when nullif(trim(coalesce(p_reference, '')), '') is null then 'admin-override'
    else 'admin-override: ' || trim(p_reference)
  end;
$$;

create or replace function public._open_inquiry()
returns setof public.atm_inquiries
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

create or replace function public._insert_cash_load(
  p_amount numeric,
  p_atm_receipt_path text,
  p_latitude double precision,
  p_longitude double precision,
  p_geo_accuracy_m double precision,
  p_reference text,
  p_inquiry_id uuid
)
returns public.cash_loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cash_loads%rowtype;
begin
  insert into public.cash_loads (
    load_date, amount, mode, reference, atm_receipt_path, recorded_at,
    latitude, longitude, geo_accuracy_m, created_by, inquiry_id
  )
  values (
    public._ist_today(), p_amount, 'bank_cc', p_reference, p_atm_receipt_path, now(),
    p_latitude, p_longitude, p_geo_accuracy_m, auth.uid(), p_inquiry_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

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
  v_row public.atm_inquiries;
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

  -- Lock open inquiry so concurrent loads cannot double-credit.
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

    return public._insert_cash_load(
      v_amount, v_atm_path, p_latitude, p_longitude, p_geo_accuracy_m,
      public._admin_load_reference(v_ref),
      null
    );
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

  v_row := public._insert_cash_load(
    v_amount, v_atm_path, p_latitude, p_longitude, p_geo_accuracy_m,
    case
      when v_override then public._admin_load_reference(v_ref)
      else v_ref
    end,
    v_inq.id
  );

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

create or replace function public.admin_delete_cash_load(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.cash_loads%rowtype;
  v_inq public.atm_inquiries%rowtype;
  v_inquiry_id uuid;
  v_reopened boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_id is null then
    raise exception 'ATM load id is required.';
  end if;

  -- Resolve link first; lock inquiry before load to match admin_delete_atm_inquiry.
  select inquiry_id into v_inquiry_id
  from public.cash_loads
  where id = p_id;

  if not found then
    raise exception 'ATM load not found.';
  end if;

  if v_inquiry_id is not null then
    select * into v_inq
    from public.atm_inquiries
    where id = v_inquiry_id
    for update;

    if not found then
      raise exception 'Linked night inquiry not found.';
    end if;

    if exists (
      select 1
      from public.atm_inquiries newer
      where newer.recorded_at > v_inq.recorded_at
         or (newer.recorded_at = v_inq.recorded_at and newer.id > v_inq.id)
    ) then
      raise exception
        'Cannot delete this ATM load while a newer night inquiry exists. Delete the latest night inquiry first.';
    end if;
  end if;

  select * into v_load
  from public.cash_loads
  where id = p_id
  for update;

  if not found then
    raise exception 'ATM load not found.';
  end if;

  if v_load.inquiry_id is distinct from v_inquiry_id then
    raise exception 'ATM load changed during delete. Retry.';
  end if;

  if v_inquiry_id is not null then
    update public.atm_inquiries
    set replenished_at = null
    where id = v_inq.id
      and replenished_at is not null;

    v_reopened := found;
  end if;

  delete from public.cash_loads where id = v_load.id;

  return jsonb_build_object(
    'id', v_load.id,
    'atm_receipt_path', v_load.atm_receipt_path,
    'inquiry_id', v_load.inquiry_id,
    'reopened_inquiry', v_reopened
  );
end;
$$;

create or replace function public.admin_delete_atm_inquiry(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inq public.atm_inquiries%rowtype;
  v_load public.cash_loads%rowtype;
  v_load_path text := null;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_id is null then
    raise exception 'Night inquiry id is required.';
  end if;

  select * into v_inq
  from public.atm_inquiries
  where id = p_id
  for update;

  if not found then
    raise exception 'Night inquiry not found.';
  end if;

  if exists (
    select 1
    from public.atm_inquiries newer
    where newer.recorded_at > v_inq.recorded_at
       or (newer.recorded_at = v_inq.recorded_at and newer.id > v_inq.id)
  ) then
    raise exception
      'Cannot delete this night inquiry while a newer one exists. Delete the latest night inquiry first.';
  end if;

  select * into v_load
  from public.cash_loads
  where inquiry_id = v_inq.id
  for update;

  if found then
    v_load_path := v_load.atm_receipt_path;
    delete from public.cash_loads where id = v_load.id;
  end if;

  -- Legacy bank_draws may still reference the inquiry.
  update public.bank_draws
  set inquiry_id = null
  where inquiry_id = v_inq.id;

  delete from public.atm_inquiries where id = v_inq.id;

  return jsonb_build_object(
    'id', v_inq.id,
    'receipt_path', v_inq.receipt_path,
    'atm_receipt_path', v_load_path
  );
end;
$$;

revoke all on function public.record_atm_inquiry(numeric, text, double precision, double precision, double precision, text) from public;
revoke all on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) from public;
revoke all on function public.admin_delete_cash_load(uuid) from public;
revoke all on function public.admin_delete_atm_inquiry(uuid) from public;
grant execute on function public.record_atm_inquiry(numeric, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.record_replenish(text, double precision, double precision, double precision, text, numeric, boolean) to authenticated;
grant execute on function public.admin_delete_cash_load(uuid) to authenticated;
grant execute on function public.admin_delete_atm_inquiry(uuid) to authenticated;

revoke all on function public._insert_cash_load(numeric, text, double precision, double precision, double precision, text, uuid) from public, anon, authenticated;
revoke all on function public._assert_atm_capital_room(numeric, numeric) from public, anon, authenticated;
revoke all on function public._admin_load_reference(text) from public, anon, authenticated;
revoke all on function public._atm_opening_balance() from public, anon, authenticated;
revoke all on function public._open_inquiry() from public, anon, authenticated;

-- Needed by v_atm_summary (security_invoker); read-only security definer helper
revoke all on function public._current_atm_balance() from public, anon;
grant execute on function public._current_atm_balance() to authenticated;

revoke insert, update on public.atm_inquiries from authenticated, anon;
grant select on public.atm_inquiries to authenticated;
grant delete on public.atm_inquiries to authenticated;
