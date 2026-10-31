-- Makes the two public views read-only.
--
-- What was wrong
-- --------------
-- user_display_names and shops_public exist so the app can show a peer's name
-- or a shop's storefront without exposing the restricted columns beside them.
-- They deliberately run with the definer's rights, which is what lets them read
-- past the row policies on user_profiles and shop_owner_requests.
--
-- Both are simple single-table selects, which makes them *auto-updatable* in
-- Postgres, and `authenticated` held INSERT, UPDATE and DELETE on them --
-- Supabase grants those by default to new objects in the public schema, and
-- 20260824000200_security_rls_and_admin_role.sql granted SELECT without
-- revoking the rest first.
--
-- Reading past RLS is the point of these views. Writing past it is not. The
-- combination meant any signed-in user could do this:
--
--     update public.user_display_names set full_name = '...' where id = <anyone>;
--     update public.shops_public   set shop_name = '...' where id = <any shop>;
--
-- and the write would land on the underlying table with the row policies
-- bypassed, because a definer-rights view does not apply them.
--
-- The guard triggers still covered the two columns that matter most -- a
-- non-admin could not flip is_admin or approve their own shop application --
-- but names, addresses, phone numbers and storefront details were all
-- rewritable by anyone with an account.
--
-- The fix is to grant exactly what the app uses: SELECT, nothing else.

revoke all on public.user_display_names from anon, authenticated;
grant select on public.user_display_names to authenticated;

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- Future views in this schema inherit Supabase's default grants too, so the
-- same trap is waiting for the next one. Prefer granting select explicitly
-- after a revoke, as above, rather than assuming the default is read-only.

-- ------------------------------------------------------------------ check
-- Should list SELECT and nothing else for authenticated, and no rows for anon:
--
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('user_display_names', 'shops_public')
--     and grantee in ('anon', 'authenticated')
--   order by table_name, grantee, privilege_type;
