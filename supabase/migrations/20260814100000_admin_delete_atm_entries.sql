-- Admin delete for night inquiries and ATM loads (cycle-aware).
-- Safe to re-run.
-- Deletes only work on the tip of the inquiry chain so balance history stays consistent.

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

revoke all on function public.admin_delete_cash_load(uuid) from public;
revoke all on function public.admin_delete_atm_inquiry(uuid) from public;
grant execute on function public.admin_delete_cash_load(uuid) to authenticated;
grant execute on function public.admin_delete_atm_inquiry(uuid) to authenticated;
