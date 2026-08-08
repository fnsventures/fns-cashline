-- Drop bank-draw from replenish: night inquiry + ATM load only
-- Safe to run even if 20260808180000 already applied with the dual-receipt version

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
  v_inq public.atm_inquiries;
  v_amount numeric(14, 2);
  v_atm_path text;
  v_ref text;
begin
  perform public._assert_staff();
  perform public._validate_geo(p_latitude, p_longitude, p_geo_accuracy_m);

  select * into v_inq from public._open_inquiry();
  if v_inq.id is null then
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

revoke all on function public.record_replenish(text, double precision, double precision, double precision, text) from public;
grant execute on function public.record_replenish(text, double precision, double precision, double precision, text) to authenticated;

-- Stop using legacy bank-draw RPC from the app
revoke execute on function public.record_bank_draw(numeric, text, double precision, double precision, double precision, text) from authenticated, anon, public;
