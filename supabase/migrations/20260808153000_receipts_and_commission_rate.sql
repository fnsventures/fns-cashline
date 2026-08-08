-- Receipts + bank CC refill workflow + direct commission fields
-- Run in Supabase SQL Editor after 20260808150000_findi_float_roles.sql

-- ---------------------------------------------------------------------------
-- Cash loads: bank draw from CC + dual receipt photos
-- ---------------------------------------------------------------------------
alter table public.cash_loads
  add column if not exists bank_draw_amount numeric(14, 2)
    check (bank_draw_amount is null or bank_draw_amount > 0);

alter table public.cash_loads
  add column if not exists atm_receipt_path text;

alter table public.cash_loads
  add column if not exists bank_receipt_path text;

comment on column public.cash_loads.bank_draw_amount is
  'Cash taken from bank CC / account to refill the ATM';
comment on column public.cash_loads.atm_receipt_path is
  'Storage path: receipt of cash loaded into ATM';
comment on column public.cash_loads.bank_receipt_path is
  'Storage path: receipt of cash withdrawn from bank';

-- Optional FiNDi / ATM journal slip on customer withdrawals
alter table public.cash_withdrawals
  add column if not exists report_receipt_path text;

comment on column public.cash_withdrawals.report_receipt_path is
  'Optional storage path: FiNDi / ATM report for customer withdrawals';

-- Allow bank_cc as load mode
alter table public.cash_loads drop constraint if exists cash_loads_mode_check;
alter table public.cash_loads
  add constraint cash_loads_mode_check
  check (mode in ('bank_cc', 'bank_transfer', 'cash', 'other'));

update public.cash_loads set mode = 'bank_cc' where mode = 'bank_transfer';

-- ---------------------------------------------------------------------------
-- Commission: rate-based direct calculation helpers (existing columns reused)
-- rate stored in notes JSON is awkward — add columns
-- ---------------------------------------------------------------------------
alter table public.commission_settlements
  add column if not exists rate_per_txn numeric(14, 4)
    check (rate_per_txn is null or rate_per_txn >= 0);

comment on column public.commission_settlements.rate_per_txn is
  'Admin-entered ₹ per transaction; net = txns × rate (TDS optional)';

-- ---------------------------------------------------------------------------
-- Storage bucket for receipt photos (private; signed URLs in app)
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
