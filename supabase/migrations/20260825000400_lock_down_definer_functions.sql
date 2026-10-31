-- Stops the SECURITY DEFINER functions from being exposed as REST endpoints.
--
-- What the linter found
-- --------------------
-- Supabase publishes every function in the `public` schema at
-- /rest/v1/rpc/<name>, and grants EXECUTE to anon and authenticated by default.
-- That applied to all four of ours:
--
--     is_admin | anon=X/postgres | authenticated=X/postgres | ...
--
-- 20260824000200_security_rls_and_admin_role.sql tried to prevent this with
--
--     revoke all on function public.is_admin() from public;
--
-- but that only drops the PUBLIC grant. Supabase's grants to `anon` and
-- `authenticated` are separate entries in the ACL and survived it, so the
-- revoke did nothing useful and is_admin stayed callable by anyone.
--
-- How much this mattered
-- ----------------------
-- Less than it looks, which is why this is a tidy-up rather than an incident:
--
--   * The three trigger functions cannot be called this way at all. Postgres
--     refuses to invoke a trigger function directly -- calling
--     /rest/v1/rpc/handle_new_user returns an error, verified against this
--     project -- because it has no NEW record to work on.
--   * is_admin() reads auth.uid(), so an anonymous caller just gets false.
--
-- The exposure was still real surface with no purpose, and the linter is right
-- to flag it.
--
-- What stays
-- ----------
-- `authenticated` keeps EXECUTE on is_admin(), and that is required: the RLS
-- policies call it, and a policy expression runs as the querying role. Revoking
-- it would break every *_own policy that grants admins wider access.
--
-- Trigger functions need no EXECUTE grant to fire. Postgres checks that
-- privilege when the trigger is created, not each time it runs, so revoking
-- here does not affect sign-up or the guards.

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_user_profile_admin_flag() from public, anon, authenticated;
revoke all on function public.guard_shop_request_status() from public, anon, authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------------ check
-- is_admin should still be callable by a signed-in user:
--
--   set local role authenticated;
--   select public.is_admin();   -- false, but it runs
--
-- and the others should no longer appear in `supabase db advisors --type security`.
