do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'customer_designs'
  ) then
    alter publication supabase_realtime add table public.customer_designs;
  end if;
end;
$$;
