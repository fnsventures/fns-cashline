-- Split bank draw vs ATM load; drop customer-withdraw from ops desk.
-- Auto time + geolocation columns. Run in SQL Editor on staging/prod.

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
create policy "bank_draws_staff_all"
  on public.bank_draws for all
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- ATM loads: timestamp + geo (receipt required going forward in app)
-- ---------------------------------------------------------------------------
alter table public.cash_loads
  add column if not exists recorded_at timestamptz;

update public.cash_loads
set recorded_at = coalesce(recorded_at, created_at, load_date::timestamptz)
where recorded_at is null;

alter table public.cash_loads
  alter column recorded_at set default now();

alter table public.cash_loads
  alter column recorded_at set not null;

alter table public.cash_loads
  add column if not exists latitude double precision;

alter table public.cash_loads
  add column if not exists longitude double precision;

alter table public.cash_loads
  add column if not exists geo_accuracy_m double precision;

create index if not exists cash_loads_recorded_at_idx
  on public.cash_loads (recorded_at desc);

-- Migrate combined rows that had bank_draw_amount into bank_draws (once)
insert into public.bank_draws (
  amount, reference, notes, receipt_path, recorded_at, created_by, created_at
)
select
  coalesce(bank_draw_amount, amount),
  reference,
  notes,
  coalesce(bank_receipt_path, atm_receipt_path, 'migrated/missing'),
  coalesce(created_at, now()),
  created_by,
  coalesce(created_at, now())
from public.cash_loads
where bank_draw_amount is not null
  and not exists (
    select 1 from public.bank_draws b
    where b.created_at = cash_loads.created_at
      and b.amount = coalesce(cash_loads.bank_draw_amount, cash_loads.amount)
  );

-- ---------------------------------------------------------------------------
-- Summary: bank vs ATM (no customer-withdraw ops)
-- ---------------------------------------------------------------------------
drop view if exists public.v_atm_summary;
create view public.v_atm_summary
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
