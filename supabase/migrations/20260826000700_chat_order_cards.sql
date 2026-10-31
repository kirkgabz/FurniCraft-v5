-- Order events in the chat, and the privacy fix that has to come first.
--
-- ---------------------------------------------------------------- the leak
-- shop_messages was readable by anyone with an account:
--
--   create policy "Authenticated users can read shop messages"
--     for select using (auth.uid() is not null);
--
-- Measured on the live data: a user who is party to 42 of the 69 messages could
-- read all 69 -- 27 private conversations between other customers and their
-- shops. That is bad on its own, and this migration is about to put order
-- prices and payment status into the same table, so it is fixed first.
--
-- A conversation is a (shop, customer) pair. You may read a message if you sent
-- it, it was addressed to you, or you own the shop it belongs to.
--
-- Nine existing rows are shop messages with no target_user_id. They become
-- invisible to customers, which is what the UI already does with them -- the
-- client filters out anything not addressed to the current user (see the
-- realtime handler in furnicraft-dashboard.tsx). No visible behaviour changes.

drop policy if exists "Authenticated users can read shop messages" on public.shop_messages;
drop policy if exists "shop_messages_select_participants" on public.shop_messages;
create policy "shop_messages_select_participants" on public.shop_messages
  for select to authenticated
  using (
    sender_user_id = auth.uid()
    or target_user_id = auth.uid()
    or exists (
      select 1 from public.shop_owner_requests r
      where r.id = shop_id and r.user_id = auth.uid()
    )
    or public.is_admin()
  );

-- ------------------------------------------------------------- order cards
-- A message is either something a person typed or an event the system
-- recorded. `kind` distinguishes them; `payload` carries the event's details.
alter table public.shop_messages
  add column if not exists kind text not null default 'text',
  add column if not exists payload jsonb,
  add column if not exists order_id uuid references public.design_orders(id) on delete cascade;

alter table public.shop_messages
  drop constraint if exists shop_messages_kind_check;
alter table public.shop_messages
  add constraint shop_messages_kind_check check (kind in ('text', 'order_event'));

-- An order event must actually name an order, and a typed message must not
-- pretend to be one.
alter table public.shop_messages
  drop constraint if exists shop_messages_event_has_order;
alter table public.shop_messages
  add constraint shop_messages_event_has_order
  check ((kind = 'order_event') = (order_id is not null));

create index if not exists shop_messages_order_idx on public.shop_messages (order_id);

-- People type text, not events. Without this a customer could post a card
-- claiming their order was paid.
drop policy if exists "Users can insert their own messages" on public.shop_messages;
drop policy if exists "shop_messages_insert_own_text" on public.shop_messages;
create policy "shop_messages_insert_own_text" on public.shop_messages
  for insert to authenticated
  with check (sender_user_id = auth.uid() and kind = 'text');

-- ------------------------------------------------------- emitting the cards
-- The payload is a snapshot: what was true at that moment. A quote message
-- should still read PHP 20,000 after the order is re-quoted, because that is
-- what the conversation said at the time.
--
-- The 3D preview is deliberately not copied in. preview_url holds a base64 data
-- URL that can run to hundreds of kilobytes; duplicating it into every event
-- would bloat the message table and go stale. The card reads it from the order,
-- which both parties to the conversation can already see.
create or replace function public.emit_order_event_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  actor uuid := auth.uid();
  recipient uuid;
  event_label text;
begin
  select r.user_id into shop_owner_id
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    event_label := 'order_placed';
  elsif new.status is distinct from old.status then
    event_label := 'order_' || new.status;
  elsif new.quoted_total is distinct from old.quoted_total then
    event_label := 'order_requoted';
  else
    return new;
  end if;

  -- A migration or maintenance script is not a conversation event.
  if actor is null then
    return new;
  end if;

  recipient := case when actor = new.customer_user_id then shop_owner_id else new.customer_user_id end;

  insert into public.shop_messages (
    shop_id, sender_user_id, target_user_id, sender_role, text, kind, payload, order_id
  )
  values (
    new.shop_id,
    actor,
    recipient,
    case when actor = new.customer_user_id then 'customer' else 'shop_owner' end,
    -- Plain-text fallback, so a client that does not render cards still shows
    -- something meaningful rather than an empty bubble.
    new.project_name || ' - ' || replace(event_label, 'order_', ''),
    'order_event',
    jsonb_build_object(
      'event', event_label,
      'order_id', new.id,
      'project_name', new.project_name,
      'furniture_type', new.furniture_type,
      'status', new.status,
      'quoted_total', new.quoted_total,
      'downpayment_percent', new.downpayment_percent,
      'downpayment_amount', new.downpayment_amount
    ),
    new.id
  );

  return new;
exception
  when others then
    -- A missing chat card must never roll back the order change itself.
    raise warning 'emit_order_event_message failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.emit_order_event_message() from public, anon, authenticated;

drop trigger if exists emit_order_event_message on public.design_orders;
create trigger emit_order_event_message
  after insert or update on public.design_orders
  for each row execute function public.emit_order_event_message();

-- ------------------------------------------------------------------ check
--   select kind, count(*) from public.shop_messages group by 1;
-- And a user should no longer read messages they are not party to:
--   set local role authenticated; -- as some user
--   select count(*) from public.shop_messages;
