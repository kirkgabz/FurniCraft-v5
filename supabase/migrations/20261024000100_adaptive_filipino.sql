-- Translations are private derivative copies, never replacements for evidence.
create table public.filipino_translations (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  translated_text text not null check (length(translated_text) between 1 and 18000),
  primary key (user_id, source_hash)
);
alter table public.filipino_translations enable row level security;
grant select, insert, update, delete on public.filipino_translations to authenticated;
create policy "Own translations" on public.filipino_translations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Atomic, shared across server instances. No client may edit quota counters.
create table public.translation_quotas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests integer not null
);
alter table public.translation_quotas enable row level security;
revoke all on public.translation_quotas from anon, authenticated;
create function public.take_translation_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.translation_quotas as q (user_id, window_start, requests)
  values (auth.uid(), now(), 1)
  on conflict (user_id) do update set
    requests = case when q.window_start < now() - interval '1 day' then 1 else q.requests + 1 end,
    window_start = case when q.window_start < now() - interval '1 day' then now() else q.window_start end
  where q.window_start < now() - interval '1 day' or q.requests < 200
  returning requests into n;
  return n is not null;
end;
$$;
revoke all on function public.take_translation_quota() from public, anon;
grant execute on function public.take_translation_quota() to authenticated;
