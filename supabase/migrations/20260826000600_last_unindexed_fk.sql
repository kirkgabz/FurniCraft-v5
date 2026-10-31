-- The one foreign key 20260826000500 did not cover.
--
-- conversation_read_state.shop_id is the second column of the unique key
-- (user_id, shop_id, peer_user_id), so that index cannot serve a lookup by
-- shop alone -- Postgres can only use a composite index from its leading
-- column. It went unnoticed because the table technically had an index
-- containing the column.
--
-- It matters for the cascade added in the same migration: deleting a shop now
-- has to find its read-state rows, and without this that is a sequential scan.

create index if not exists conversation_read_state_shop_idx
  on public.conversation_read_state (shop_id);

-- ------------------------------------------------------------------ check
-- Should return no rows:
--
--   select cl.relname || '.' || a.attname
--   from pg_constraint con
--   join pg_class cl on cl.oid = con.conrelid
--   join pg_namespace n on n.oid = cl.relnamespace
--   join unnest(con.conkey) k(attnum) on true
--   join pg_attribute a on a.attrelid = cl.oid and a.attnum = k.attnum
--   where n.nspname = 'public' and con.contype = 'f'
--     and not exists (
--       select 1 from pg_index i
--       where i.indrelid = cl.oid and a.attnum = i.indkey[0]
--     );
