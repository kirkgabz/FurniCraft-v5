-- A direct line to FurniCraft support: a per-account thread the account
-- holder and an admin both post into. Modeled on shop_messages (the same
-- two-role, one-thread-per-relationship shape) rather than a ticket table
-- with subjects/statuses, because this is meant to feel like messaging
-- support, not filing a ticket.

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_role text not null default 'user' check (sender_role in ('user', 'admin')),
  text text not null check (char_length(text) > 0 and char_length(text) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_messages_user_created_idx
  on public.support_messages (user_id, created_at asc);

alter table public.support_messages enable row level security;

drop policy if exists "support_messages_select_own_or_admin" on public.support_messages;
create policy "support_messages_select_own_or_admin" on public.support_messages
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- A user may only ever post into their own thread as themselves; an admin
-- may post into anyone's thread, but only as 'admin' -- an admin cannot
-- ghost-write a message that looks like it came from the account holder.
drop policy if exists "support_messages_insert_own_or_admin" on public.support_messages;
create policy "support_messages_insert_own_or_admin" on public.support_messages
  for insert to authenticated
  with check (
    (sender_role = 'user' and user_id = auth.uid())
    or (sender_role = 'admin' and public.is_admin())
  );

revoke all on public.support_messages from anon, authenticated;
grant select, insert on public.support_messages to authenticated;

-- Tell the account holder when support replies -- they may not be looking at
-- Settings when it happens.
create or replace function public.notify_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sender_role = 'admin' then
    perform public.emit_notification(
      new.user_id,
      'support_reply',
      'FurniCraft support replied',
      left(new.text, 200),
      '/protected?section=settings',
      null,
      'support_message',
      new.id
    );
  end if;
  return new;
exception
  when others then
    raise warning 'notify_support_reply failed for message %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_support_reply() from public, anon, authenticated;

drop trigger if exists notify_support_reply on public.support_messages;
create trigger notify_support_reply
  after insert on public.support_messages
  for each row execute function public.notify_support_reply();

-- ------------------------------------------------------------------ check
-- As a signed-in user: insert (sender_role='user', user_id=own id) succeeds;
-- insert with a different user_id, or sender_role='admin', is rejected.
-- As an admin: insert with sender_role='admin' and any user_id succeeds.
