-- Evaluate auth.uid() once per statement, not once per row.
--
-- Postgres treats auth.uid() as a volatile-looking call inside a policy and
-- re-runs it for every row it tests. Wrapping it in a scalar subquery --
-- (select auth.uid()) -- lets the planner hoist it into an InitPlan that runs
-- once. Supabase's own linter flags the unwrapped form (lint 0003,
-- auth_rls_initplan) and this is the documented remedy:
-- https://supabase.com/docs/guides/database/postgres/row-level-security
--
-- Nothing about who may see or change what changes here. Every policy is
-- recreated with the same command, the same roles, the same permissive or
-- restrictive flag and the same expression; only the call is wrapped. It
-- mattered little at the size this project is now -- 11 users, 29 orders --
-- and would matter a great deal at a thousand of each, which is the point of
-- doing it while the policy set is small enough to check.
--
-- Driven off the catalog rather than written out by hand: 52 policies across
-- 15 tables, and a hand-transcribed WHERE clause is exactly the kind of edit
-- that silently widens access. The rewrite is also idempotent -- an already
-- wrapped call is unwrapped first -- so running this twice is a no-op.
--
-- is_admin() is deliberately left alone. The linter does not flag it, it is
-- already STABLE, and leaving it untouched keeps this change to one shape.
--
-- storage.objects is left alone too: those policies belong to
-- supabase_storage_admin, the linter does not flag them, and they are better
-- changed from the storage settings than from a migration.
do $$
declare
  policy_row record;
  statement text;
  wrapped_using text;
  wrapped_check text;
begin
  for policy_row in
    select
      c.relname as tbl,
      p.polname,
      p.polcmd,
      p.polpermissive,
      coalesce(
        (select string_agg(quote_ident(x.rolname), ', ') from pg_roles x where x.oid = any(p.polroles)),
        'public'
      ) as roles,
      pg_get_expr(p.polqual, p.polrelid) as using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
        || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%auth.uid()%'
  loop
    -- Unwrap first, then wrap, so a second run changes nothing. The
    -- unwrap pattern is the form Postgres stores, not the form written
    -- here: it re-prints a scalar subquery with its column alias, so
    -- (select auth.uid()) comes back as ( SELECT auth.uid() AS uid).
    -- Matching the written form instead would double-wrap on a re-run.
    wrapped_using := replace(
      replace(policy_row.using_expr, '( SELECT auth.uid() AS uid)', 'auth.uid()'),
      'auth.uid()', '( select auth.uid() )');
    wrapped_check := replace(
      replace(policy_row.check_expr, '( SELECT auth.uid() AS uid)', 'auth.uid()'),
      'auth.uid()', '( select auth.uid() )');

    execute format('drop policy %I on public.%I', policy_row.polname, policy_row.tbl);

    statement := format(
      'create policy %I on public.%I%s for %s to %s',
      policy_row.polname,
      policy_row.tbl,
      case when policy_row.polpermissive then '' else ' as restrictive' end,
      case policy_row.polcmd
        when 'r' then 'select' when 'a' then 'insert'
        when 'w' then 'update' when 'd' then 'delete' else 'all' end,
      policy_row.roles);

    if wrapped_using is not null then
      statement := statement || ' using (' || wrapped_using || ')';
    end if;
    if wrapped_check is not null then
      statement := statement || ' with check (' || wrapped_check || ')';
    end if;

    execute statement;
  end loop;
end $$;

-- ------------------------------------------------------------------ check
--   select count(*) from pg_policy p
--   join pg_class c on c.oid = p.polrelid
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public'
--     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
--       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%auth.uid()%'
--     and replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '')
--       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
--       '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%';
-- -- expects 0, and `supabase db advisors` should no longer report 0003.
