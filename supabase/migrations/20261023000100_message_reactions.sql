-- One persisted reaction per participant per message. Reading a shop's public
-- profile does not make someone a participant in its private conversations.
create table if not exists public.shop_message_reactions (
  message_id uuid not null references public.shop_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '😆', '😮', '😢', '😡', '👍')),
  primary key (message_id, user_id)
);
create index if not exists shop_message_reactions_user_idx on public.shop_message_reactions(user_id);
alter table public.shop_message_reactions enable row level security;
revoke all on public.shop_message_reactions from anon, authenticated;
grant select, insert, update, delete on public.shop_message_reactions to authenticated;

create policy "message_reactions_read_participants" on public.shop_message_reactions
for select to authenticated using (
  exists (
    select 1 from public.shop_messages m
    where m.id = message_id and m.kind in ('text', 'image')
      and (m.sender_user_id = (select auth.uid()) or m.target_user_id = (select auth.uid())
        or exists (select 1 from public.shops s where s.id = m.shop_id and s.user_id = (select auth.uid())))
  )
);
create policy "message_reactions_insert_own" on public.shop_message_reactions
for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.shop_messages m
    where m.id = message_id and m.kind in ('text', 'image')
      and (m.sender_user_id = (select auth.uid()) or m.target_user_id = (select auth.uid())
        or exists (select 1 from public.shops s where s.id = m.shop_id and s.user_id = (select auth.uid())))
  )
);
create policy "message_reactions_update_own" on public.shop_message_reactions
for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.shop_messages m
    where m.id = message_id and m.kind in ('text', 'image')
      and (m.sender_user_id = (select auth.uid()) or m.target_user_id = (select auth.uid())
        or exists (select 1 from public.shops s where s.id = m.shop_id and s.user_id = (select auth.uid())))
  )
);
create policy "message_reactions_delete_own" on public.shop_message_reactions
for delete to authenticated using (user_id = (select auth.uid()));
