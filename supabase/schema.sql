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
-- Summary view (bank draw vs ATM load)
-- ---------------------------------------------------------------------------
create or replace view public.v_atm_summary
with (security_invoker = true)
as
select
  coalesce((select sum(amount) from public.bank_draws), 0)::numeric(14, 2) as total_bank_drawn,
  coalesce((select sum(amount) from public.cash_loads), 0)::numeric(14, 2) as total_loaded,
  greatest(
    0,
    coalesce((select sum(amount) from public.bank_draws), 0)
    - coalesce((select sum(amount) from public.cash_loads), 0)
  )::numeric(14, 2) as pending_to_load,
  coalesce(
    (
      select (config -> 'station' ->> 'totalCapital')::numeric
      from public.atm_settings
      where id = 1
    ),
    0
  )::numeric(14, 2) as total_capital,
  coalesce((select sum(net_commission) from public.commission_settlements), 0)::numeric(14, 2) as total_commission_net,
  coalesce((select sum(transaction_count) from public.commission_settlements), 0)::integer as total_transactions;

grant select on public.v_atm_summary to authenticated;

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
  select 6371000d * 2 * asin(
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

revoke all on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text) from public;
revoke all on function public.record_atm_load(numeric, text, double precision, double precision, double precision, text, boolean) from public;

grant execute on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.record_atm_load(numeric, text, double precision, double precision, double precision, text, boolean) to authenticated;

-- Block privilege escalation via direct grants if present
revoke insert, update on public.bank_draws from authenticated, anon;
revoke insert, update on public.cash_loads from authenticated, anon;
grant select on public.bank_draws to authenticated;
grant select on public.cash_loads to authenticated;
grant delete on public.bank_draws to authenticated;
grant delete on public.cash_loads to authenticated;
