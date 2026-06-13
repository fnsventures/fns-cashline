-- FNS Cashline — F & S Ventures cash franchise tracker
-- Apply in Supabase SQL Editor (full script)

-- Extensions
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Users (linked to auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'admin' check (role in ('admin')),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users_select_own"
  on public.users for select
  using (auth.uid() = id);

create policy "users_select_admin"
  on public.users for select
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

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
      'displayName', 'FNS Cashline',
      'location', 'Bishnupriya Fuels Petrol Pump, Padmanavpur',
      'franchisePartner', '',
      'machineId', '',
      'commissionPerTxn', 0,
      'minFloat', 0
    )
  )
)
on conflict (id) do nothing;

alter table public.atm_settings enable row level security;

create policy "atm_settings_admin_all"
  on public.atm_settings for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Cash loads (money you put into the ATM)
-- ---------------------------------------------------------------------------
create table if not exists public.cash_loads (
  id uuid primary key default gen_random_uuid(),
  load_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  mode text not null default 'bank_transfer'
    check (mode in ('bank_transfer', 'cash', 'other')),
  reference text,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists cash_loads_load_date_idx on public.cash_loads (load_date desc);

alter table public.cash_loads enable row level security;

create policy "cash_loads_admin_all"
  on public.cash_loads for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Cash settlements (unused cash swept back by partner)
-- ---------------------------------------------------------------------------
create table if not exists public.cash_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  notes text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists cash_settlements_date_idx on public.cash_settlements (settlement_date desc);

alter table public.cash_settlements enable row level security;

create policy "cash_settlements_admin_all"
  on public.cash_settlements for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Commission settlements (monthly / periodic from franchise partner)
-- ---------------------------------------------------------------------------
create table if not exists public.commission_settlements (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  transaction_count integer not null default 0 check (transaction_count >= 0),
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

create policy "commission_settlements_admin_all"
  on public.commission_settlements for all
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Summary view
-- ---------------------------------------------------------------------------
create or replace view public.v_atm_summary as
select
  coalesce((select sum(amount) from public.cash_loads), 0)::numeric(14, 2) as total_loaded,
  coalesce((select sum(amount) from public.cash_settlements), 0)::numeric(14, 2) as total_settled,
  (
    coalesce((select sum(amount) from public.cash_loads), 0)
    - coalesce((select sum(amount) from public.cash_settlements), 0)
  )::numeric(14, 2) as cash_deployed,
  coalesce((select sum(net_commission) from public.commission_settlements), 0)::numeric(14, 2) as total_commission_net,
  coalesce((select sum(transaction_count) from public.commission_settlements), 0)::integer as total_transactions;

-- ---------------------------------------------------------------------------
-- Helper: current user role
-- ---------------------------------------------------------------------------
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

grant execute on function public.get_my_role() to authenticated;
