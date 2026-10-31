-- Order events and notifications stopped working when the table was renamed.
--
-- 20260831000100 renamed shop_owner_requests to shops. Policies and views
-- followed it automatically, because Postgres records those dependencies by
-- OID. plpgsql function bodies do not: they are stored as text and resolved
-- when they run. Five functions went on naming a table that no longer existed
-- and began failing at runtime, with nothing failing loudly enough to notice:
--
--   emit_order_event_message     order cards in chat
--   notify_design_order_change   order notifications
--   notify_design_order_quote    quote notifications
--   notify_shop_message          chat message notifications
--   shop_payment_details         (matched only in a comment; unaffected)
--
-- The silence was by design and that is what made it dangerous.
-- emit_order_event_message ends in `exception when others` so that a missing
-- chat card can never roll back the order change it describes -- correct on its
-- own terms, and it meant order events simply stopped appearing in chat with no
-- error surfacing anywhere. The notify functions swallow errors for the same
-- reason.
--
-- Measured, not assumed. Driving a real pending_quote -> quoted transition as
-- the shop owner, inside a transaction that then aborted:
--
--   before this migration   cards for that order 1 -> 1   (no card written)
--   after                   cards for that order 1 -> 2   notifications +2
--
-- Each function is rebuilt from its own current definition rather than from the
-- migration that created it, so any later revision is preserved and the only
-- thing that changes is the table name.
--
-- The wider lesson, which cost two incidents in one day: renaming a table does
-- not rename it inside function bodies. After any rename, grep pg_get_functiondef
-- for the old name.

do $$
declare
  f record;
  fixed text;
  repaired text := '';
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%public.shop_owner_requests%'
    order by p.proname
  loop
    fixed := replace(pg_get_functiondef(f.oid), 'public.shop_owner_requests', 'public.shops');
    execute fixed;
    repaired := repaired || ' ' || f.proname;
  end loop;

  raise notice 'repointed at public.shops:%', repaired;
end $$;

-- ------------------------------------------------------------------- check
--   select p.proname
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and pg_get_functiondef(p.oid) like '%public.shop_owner_requests%';
--   -- expect: no rows
