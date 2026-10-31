-- The official-receipt trigger functions are triggers, not API calls.
--
-- Postgres grants EXECUTE on new functions to PUBLIC, which put both on the
-- REST API as /rpc endpoints that anon and signed-in users could reach. As
-- with the functions in 20260825000400_lock_down_definer_functions, revoke it;
-- triggers do not need the caller to hold EXECUTE.
--
-- Safe to re-run.

revoke execute on function public.emit_official_receipt_event() from public, anon, authenticated;
revoke execute on function public.guard_official_receipt_count() from public, anon, authenticated;
