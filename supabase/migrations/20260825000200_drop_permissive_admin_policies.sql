-- Removes six policies that granted every signed-in user full access.
--
-- What was wrong
-- --------------
-- user_profiles and shop_owner_requests each carried three policies named
-- *_select_admin, *_insert_admin and *_update_admin whose expressions were
-- simply `true`, applied to the `public` role:
--
--     create policy "user_profiles_select_admin" on public.user_profiles
--       for select using (true);
--     create policy "user_profiles_update_admin" on public.user_profiles
--       for update using (true) with check (true);
--
-- The names say "admin" but nothing in them checks for one. Postgres OR's
-- permissive policies together, so these did not narrow anything -- they
-- widened everything. Alongside the *_own policies added in
-- 20260824000200_security_rls_and_admin_role.sql, the effective rule was:
--
--     (id = auth.uid() OR is_admin())  OR  true   ==   true
--
-- Any authenticated user could therefore read every user's full name, phone
-- number and address, read every shop application including applicants' email
-- addresses and document paths, and update any row in either table. Creating an
-- account is free, so this was reachable by anyone.
--
-- It was missed when RLS was added because that work verified the *anonymous*
-- path only: `anon` is blocked by the REVOKE in the same migration, so an
-- unauthenticated request correctly returned 42501 and the check passed. The
-- hole was one sign-up away.
--
-- The guard triggers meant this was not full privilege escalation --
-- guard_user_profile_admin_flag still refused to let a non-admin set is_admin,
-- and guard_shop_request_status still refused to let an applicant approve
-- themselves -- but every other column was readable and writable.
--
-- Nothing is lost by dropping them: the *_own policies already carry
-- `or public.is_admin()`, so genuine administrators keep full access.

drop policy if exists "user_profiles_select_admin" on public.user_profiles;
drop policy if exists "user_profiles_insert_admin" on public.user_profiles;
drop policy if exists "user_profiles_update_admin" on public.user_profiles;

drop policy if exists "shop_owner_requests_select_admin" on public.shop_owner_requests;
drop policy if exists "shop_owner_requests_insert_admin" on public.shop_owner_requests;
drop policy if exists "shop_owner_requests_update_admin" on public.shop_owner_requests;

-- These three predate the *_own policies and say the same thing without the
-- admin clause, so they only add noise to the policy list.
drop policy if exists "Users can view own profile" on public.user_profiles;
drop policy if exists "Users can insert own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;

-- ------------------------------------------------------------------ check
-- Should return no rows. Any policy whose expression is literally `true` is a
-- table-wide grant to whichever role it targets, regardless of its name.
--
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and (qual = 'true' or with_check = 'true');
