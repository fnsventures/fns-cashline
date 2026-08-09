-- Foolproof ops: server time, required geo, amount caps, immutable rows, RPC-only writes.
-- Run after 20260808160000_bank_draw_atm_load_geo.sql

-- ---------------------------------------------------------------------------
-- Settings: optional station geofence (meters)
-- ---------------------------------------------------------------------------
update public.atm_settings
set config = jsonb_set(
  config,
  '{station,geo}',
  coalesce(
    config -> 'station' -> 'geo',
    jsonb_build_object(
      'latitude', null,
      'longitude', null,
      'radiusM', 3000,
      'requireLocation', true
    )
  ),
  true
)
where id = 1;

-- ---------------------------------------------------------------------------
-- Immutable cash tables: staff can read; only admin can delete; no client insert/update
-- ---------------------------------------------------------------------------
drop policy if exists "bank_draws_staff_all" on public.bank_draws;
drop policy if exists "bank_draws_select_staff" on public.bank_draws;
drop policy if exists "bank_draws_delete_admin" on public.bank_draws;

create policy "bank_draws_select_staff"
  on public.bank_draws for select
  using (public.is_staff());

create policy "bank_draws_delete_admin"
  on public.bank_draws for delete
  using (public.is_admin());

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
-- Validation helpers
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
