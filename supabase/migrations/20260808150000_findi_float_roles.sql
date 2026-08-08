-- Staging / upgrade migration: FINDI float model + roles
-- Run in Supabase SQL Editor on projects that already applied the old schema.

-- Roles: allow operator
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('admin', 'operator'));

-- Helpers
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

-- Provision RPC
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

-- User policies
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

-- Capital + FINDI branding in settings
update public.atm_settings
set
  config = jsonb_set(
    jsonb_set(
      jsonb_set(
        config,
        '{station,displayName}',
        '"FINDI"'::jsonb,
        true
      ),
      '{station,franchisePartner}',
      '"FINDI"'::jsonb,
      true
    ),
    '{station,totalCapital}',
    coalesce(config -> 'station' -> 'totalCapital', '200000'::jsonb),
    true
  ),
  updated_at = now()
where id = 1;

-- Settings RLS: staff read, admin write
drop policy if exists "atm_settings_admin_all" on public.atm_settings;
drop policy if exists "atm_settings_select_staff" on public.atm_settings;
drop policy if exists "atm_settings_write_admin" on public.atm_settings;

create policy "atm_settings_select_staff"
  on public.atm_settings for select
  using (public.is_staff());

create policy "atm_settings_write_admin"
  on public.atm_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- Rename settlements → withdrawals (if old table still present)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'cash_settlements'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'cash_withdrawals'
  ) then
    alter table public.cash_settlements rename to cash_withdrawals;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cash_withdrawals'
      and column_name = 'settlement_date'
  ) then
    alter table public.cash_withdrawals rename column settlement_date to withdrawal_date;
  end if;
end $$;

-- Ensure withdrawals table exists (fresh partial upgrades)
create table if not exists public.cash_withdrawals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

drop index if exists cash_settlements_date_idx;
create index if not exists cash_withdrawals_date_idx on public.cash_withdrawals (withdrawal_date desc);

alter table public.cash_withdrawals enable row level security;

drop policy if exists "cash_settlements_admin_all" on public.cash_withdrawals;
drop policy if exists "cash_withdrawals_staff_all" on public.cash_withdrawals;
create policy "cash_withdrawals_staff_all"
  on public.cash_withdrawals for all
  using (public.is_staff())
  with check (public.is_staff());

-- Loads: staff
drop policy if exists "cash_loads_admin_all" on public.cash_loads;
drop policy if exists "cash_loads_staff_all" on public.cash_loads;
create policy "cash_loads_staff_all"
  on public.cash_loads for all
  using (public.is_staff())
  with check (public.is_staff());

-- Commission stays admin-only
drop policy if exists "commission_settlements_admin_all" on public.commission_settlements;
create policy "commission_settlements_admin_all"
  on public.commission_settlements for all
  using (public.is_admin())
  with check (public.is_admin());

-- Float summary view
drop view if exists public.v_atm_summary;
create view public.v_atm_summary
with (security_invoker = true)
as
select
  coalesce((select sum(amount) from public.cash_loads), 0)::numeric(14, 2) as total_loaded,
  coalesce((select sum(amount) from public.cash_withdrawals), 0)::numeric(14, 2) as total_withdrawn,
  (
    coalesce((select sum(amount) from public.cash_loads), 0)
    - coalesce((select sum(amount) from public.cash_withdrawals), 0)
  )::numeric(14, 2) as in_machine,
  coalesce(
    (
      select (config -> 'station' ->> 'totalCapital')::numeric
      from public.atm_settings
      where id = 1
    ),
    0
  )::numeric(14, 2) as total_capital,
  greatest(
    0,
    coalesce(
      (
        select (config -> 'station' ->> 'totalCapital')::numeric
        from public.atm_settings
        where id = 1
      ),
      0
    )
    - (
      coalesce((select sum(amount) from public.cash_loads), 0)
      - coalesce((select sum(amount) from public.cash_withdrawals), 0)
    )
  )::numeric(14, 2) as need_to_deposit,
  coalesce((select sum(net_commission) from public.commission_settlements), 0)::numeric(14, 2) as total_commission_net,
  coalesce((select sum(transaction_count) from public.commission_settlements), 0)::integer as total_transactions;

grant select on public.v_atm_summary to authenticated;
