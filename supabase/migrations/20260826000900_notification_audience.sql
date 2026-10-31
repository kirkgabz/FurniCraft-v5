-- Marks each notification as reaching someone personally or in their role as a
-- shop owner.
--
-- A shop owner is also a customer, so their bell mixes the two: "your order is
-- in production" (theirs) sits next to "new order received" (their shop's).
-- Nothing in the row distinguished them, and the reader had to infer it from
-- the wording.
--
-- The triggers already know -- they choose the recipient precisely because of
-- which side of the transaction that person is on -- so the answer is recorded
-- at write time rather than guessed in the client.

alter table public.notifications
  add column if not exists audience text not null default 'personal';

alter table public.notifications
  drop constraint if exists notifications_audience_check;
alter table public.notifications
  add constraint notifications_audience_check check (audience in ('personal', 'shop'));

-- Guard the new column alongside the others: it describes the event, so it is
-- not the reader's to edit.
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
     or new.audience is distinct from old.audience
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

create or replace function public.emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_actor_user_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_audience text default 'personal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if p_user_id is null or p_user_id = p_actor_user_id then
    return;
  end if;

  insert into public.notifications (
    user_id, type, title, body, link, actor_user_id, entity_type, entity_id, audience
  )
  values (
    p_user_id, p_type, p_title, p_body, p_link, p_actor_user_id, p_entity_type, p_entity_id,
    case when p_audience = 'shop' then 'shop' else 'personal' end
  );
end;
$$;

revoke all on function public.emit_notification(uuid, text, text, text, text, uuid, text, uuid, text)
  from public, anon, authenticated;

-- The eight-argument version is still bound by the older triggers until they are
-- replaced below; drop it afterwards so only one signature exists.
create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
  order_link text := '/protected/orders/' || new.id::text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    perform public.emit_notification(
      shop_owner_id, 'order_received', 'New order received', new.project_name,
      order_link, new.customer_user_id, 'design_order', new.id, 'shop'
    );
    return new;
  end if;

  if new.status is distinct from old.status and new.status <> 'quoted' then
    if new.status = 'payment_submitted' then
      perform public.emit_notification(
        shop_owner_id, 'payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );
    else
      perform public.emit_notification(
        new.customer_user_id,
        'order_' || new.status,
        case new.status
          when 'declined'      then shop_label || ' declined your order'
          when 'in_production' then shop_label || ' confirmed your payment'
          when 'completed'     then shop_label || ' completed your order'
          when 'confirmed'     then 'Downpayment due for your order'
          else 'Your order is now ' || replace(new.status, '_', ' ')
        end,
        new.project_name,
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_change failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

create or replace function public.notify_design_order_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
  order_link text := '/protected/orders/' || new.id::text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if new.quoted_total is not null
     and (old.quoted_total is distinct from new.quoted_total
          or old.downpayment_percent is distinct from new.downpayment_percent)
  then
    perform public.emit_notification(
      new.customer_user_id, 'order_quoted', shop_label || ' quoted your order',
      new.project_name || ' - PHP ' || to_char(new.quoted_total, 'FM999G999G990D00'),
      order_link, shop_owner_id, 'design_order', new.id, 'personal'
    );
  end if;

  if new.customer_response is distinct from old.customer_response
     and new.customer_response is not null
  then
    perform public.emit_notification(
      shop_owner_id, 'order_' || new.customer_response,
      case new.customer_response
        when 'confirmed' then 'Customer confirmed your quote'
        else 'Customer declined your quote'
      end,
      new.project_name, order_link, new.customer_user_id, 'design_order', new.id, 'shop'
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_quote failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- A message to the shop's own account is shop business; anything else is personal.
create or replace function public.notify_shop_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  shop_owner_id uuid;
begin
  select r.user_id into shop_owner_id
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  recipient := coalesce(new.target_user_id, shop_owner_id);

  perform public.emit_notification(
    recipient, 'message_received', 'New message',
    left(coalesce(new.text, ''), 140),
    '/protected', new.sender_user_id, 'shop_message', new.id,
    case when recipient = shop_owner_id then 'shop' else 'personal' end
  );

  return new;
exception
  when others then
    raise warning 'notify_shop_message failed for message %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_change() from public, anon, authenticated;
revoke all on function public.notify_design_order_quote() from public, anon, authenticated;
revoke all on function public.notify_shop_message() from public, anon, authenticated;

-- Nothing calls the eight-argument form any more.
drop function if exists public.emit_notification(uuid, text, text, text, text, uuid, text, uuid);

-- ------------------------------------------------- label what already exists
-- Existing rows default to 'personal'. Anything sent to the owner of the shop
-- the order belongs to was shop business.
update public.notifications n
set audience = 'shop'
from public.design_orders o
join public.shop_owner_requests r on r.id = o.shop_id
where n.entity_type = 'design_order'
  and n.entity_id = o.id
  and n.user_id = r.user_id;

-- ------------------------------------------------------------------ check
--   select audience, count(*) from public.notifications group by 1;
