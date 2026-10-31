-- Two things the security advisor caught in the objects added by the previous
-- five migrations.
--
-- 1. touch_shop_review() had no `set search_path`, so it resolves unqualified
--    names against whatever search_path the caller has. It is not SECURITY
--    DEFINER, so this is not the classic privilege-escalation shape, but there
--    is no reason to leave a trigger function's name resolution up to the
--    caller.
--
-- 2. shop_reviews_select_authenticated was written as `using (true)`.
--    That is correct -- a review is meant to be readable by every signed-in
--    user -- but it is indistinguishable from the six accidental `true`
--    policies removed in 20260825000200_drop_permissive_admin_policies.sql, and
--    it broke this audit, which the README recommends running after any schema
--    change:
--
--      select count(*) from pg_policies
--      where schemaname = 'public' and (qual = 'true' or with_check = 'true');
--
--    Rewriting it as an explicit "you are signed in" test keeps that query
--    meaningful as a tripwire, and says out loud what the policy intends. The
--    `to authenticated` clause already restricted the role; this makes the
--    expression agree with it.

create or replace function public.touch_shop_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop policy if exists "shop_reviews_select_authenticated" on public.shop_reviews;
create policy "shop_reviews_select_authenticated" on public.shop_reviews
  for select to authenticated
  using (auth.uid() is not null);

-- ------------------------------------------------------------------ check
-- Both should hold after this migration:
--
--   select count(*) from pg_policies
--   where schemaname = 'public' and (qual = 'true' or with_check = 'true');   -- 0
--
--   npx supabase db advisors --linked --type security
--     -> no function_search_path_mutable finding
