-- design_orders was never added to the realtime publication, so every
-- postgres_changes subscription against it -- the customer dashboard, the shop
-- dashboard, and the single-order detail view -- would connect successfully
-- and then receive nothing, forever. RLS on the table already limits each
-- subscriber to their own rows the same way it limits a direct select.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'design_orders'
  ) then
    alter publication supabase_realtime add table public.design_orders;
  end if;
end;
$$;
