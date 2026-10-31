-- In-app notifications: table, policies, realtime, and the triggers that emit them.
--
-- Design
-- ------
-- Rows are written only by SECURITY DEFINER triggers, never by clients. There
-- is deliberately no INSERT policy and no INSERT grant: if a customer could
-- write to this table they could forge "Downpayment received" against their own
-- order, and the bell is meant to be trustworthy.
--
-- Users can read their own notifications and mark them read. Marking read is
-- the *only* update allowed -- row-level policies cannot restrict columns, so a
-- guard trigger enforces that, the same pattern as
-- 20260824000300_guard_admin_flag.sql.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who sees it.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Machine-readable kind, so the UI can pick an icon without parsing text.
  type text not null,
  title text not null,
  body text,
  -- Where clicking it should go, e.g. '/protected?section=orders'.
  link text,
  -- Who caused it, for the avatar. Null for system events.
  actor_user_id uuid references auth.users(id) on delete set null,
  -- What it is about, so a notification can be found again or de-duplicated.
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- The bell asks two questions: "how many unread?" and "the latest 20". Both are
-- per user and ordered by time, which is what these cover.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert or delete policy: emitted by triggers, removed by retention only.
revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;

-- Only read_at may be changed, and only from unread to read. Without this the
-- update policy above would let someone rewrite the title and body of their own
-- notifications, which is not dangerous but is not what "mark as read" means.
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.type is distinct from old.type
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.link is distinct from old.link
     or new.actor_user_id is distinct from old.actor_user_id
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Only the read state of a notification may be changed.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_notification_update() from public, anon, authenticated;

drop trigger if exists guard_notification_update on public.notifications;
create trigger guard_notification_update
  before update on public.notifications
  for each row execute function public.guard_notification_update();

-- ----------------------------------------------------------------- emitting
-- One place that writes notifications. SECURITY DEFINER so triggers can insert
-- past the table's own policies, and execute is revoked from clients so it
-- cannot be called as an RPC -- see 20260825000400_lock_down_definer_functions.
create or replace function public.emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_actor_user_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never notify someone about their own action; the bell is for things that
  -- happened to you, not things you did.
  if p_user_id is null or p_user_id = p_actor_user_id then
    return;
  end if;

  insert into public.notifications (
    user_id, type, title, body, link, actor_user_id, entity_type, entity_id
  )
  values (
    p_user_id, p_type, p_title, p_body, p_link, p_actor_user_id, p_entity_type, p_entity_id
  );
end;
$$;

revoke all on function public.emit_notification(uuid, text, text, text, text, uuid, text, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------- order status events
-- Fires on any status change. It is written against whatever status values the
-- column holds, so it works with today's pending/accepted/declined/completed
-- and keeps working when the quote state machine lands.
create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  -- A new order: tell the shop owner.
  if tg_op = 'INSERT' then
    perform public.emit_notification(
      shop_owner_id,
      'order_received',
      'New order received',
      new.project_name,
      '/protected/shop',
      new.customer_user_id,
      'design_order',
      new.id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_notification(
      new.customer_user_id,
      'order_' || new.status,
      case new.status
        when 'accepted'  then shop_label || ' accepted your order'
        when 'declined'  then shop_label || ' declined your order'
        when 'completed' then shop_label || ' completed your order'
        else 'Your order is now ' || new.status
      end,
      new.project_name,
      '/protected',
      shop_owner_id,
      'design_order',
      new.id
    );
  end if;

  return new;
exception
  when others then
    -- A missing notification must never roll back the order change itself.
    raise warning 'notify_design_order_change failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_change() from public, anon, authenticated;

drop trigger if exists notify_design_order_change on public.design_orders;
create trigger notify_design_order_change
  after insert or update on public.design_orders
  for each row execute function public.notify_design_order_change();

-- ------------------------------------------------------------ message events
create or replace function public.notify_shop_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  shop_label text;
begin
  -- Messages carry an explicit target for customer threads; for a message sent
  -- to the shop, the recipient is whoever owns it.
  recipient := new.target_user_id;

  select coalesce(r.shop_name, 'a shop') into shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if recipient is null then
    select r.user_id into recipient
    from public.shop_owner_requests r
    where r.id = new.shop_id;
  end if;

  perform public.emit_notification(
    recipient,
    'message_received',
    'New message',
    left(coalesce(new.text, ''), 140),
    '/protected',
    new.sender_user_id,
    'shop_message',
    new.id
  );

  return new;
exception
  when others then
    raise warning 'notify_shop_message failed for message %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_shop_message() from public, anon, authenticated;

drop trigger if exists notify_shop_message on public.shop_messages;
create trigger notify_shop_message
  after insert on public.shop_messages
  for each row execute function public.notify_shop_message();

-- ---------------------------------------------------------------- realtime
-- The bell subscribes with postgres_changes, which requires the table to be in
-- this publication. Only shop_messages was published before.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- ------------------------------------------------------------------ check
--   select type, count(*) from public.notifications group by 1 order by 2 desc;
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime';
