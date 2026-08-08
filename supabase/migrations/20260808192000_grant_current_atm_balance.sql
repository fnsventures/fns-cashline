-- Fix: v_atm_summary (security_invoker) calls _current_atm_balance()
-- Authenticated users need EXECUTE or dashboard/cash/reports fail with
-- "permission denied for function _current_atm_balance"

revoke all on function public._current_atm_balance() from public, anon;
grant execute on function public._current_atm_balance() to authenticated;
