-- A rejected receipt (payment_submitted -> confirmed) was indistinguishable
-- from the customer's own quote acceptance (quoted -> confirmed): both wrote
-- event_label / notification type 'order_confirmed'. The chat card read
-- "Quote accepted -- downpayment due" for what was actually a rejection, the
-- reason the shop typed never reached the notification bell at all, and the
-- shop was never told when a customer accepted a quote or cancelled an order
-- -- only the customer-facing half of each of those was wired up.

-- ---------------------------------------------------------- the chat card
create or replace function public.emit_order_event_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    -- old/new checked here, not in a DECLARE default -- OLD does not exist on
    -- an INSERT row, so this must stay inside the branch that only runs for
    -- UPDATE.
    event_label := case
      when old.status = 'payment_submitted' and new.status = 'confirmed' then 'order_payment_rejected'
      else 'order_' || new.status
    end;
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
    -- something meaningful rather than an empty bubble. A decline or a
    -- rejected receipt says why in the fallback too, for the same reason.
    new.project_name || ' - ' || replace(event_label, 'order_', '')
      || case
           when new.status = 'declined' and coalesce(new.decline_reason, '') <> ''
             then ': ' || new.decline_reason
           when event_label = 'order_payment_rejected' and coalesce(new.payment_rejected_reason, '') <> ''
             then ': ' || new.payment_rejected_reason
           else ''
         end,
    'order_event',
    jsonb_build_object(
      'event', event_label,
      'order_id', new.id,
      'project_name', new.project_name,
      'furniture_type', new.furniture_type,
      'status', new.status,
      'quoted_total', new.quoted_total,
      'downpayment_percent', new.downpayment_percent,
      'downpayment_amount', new.downpayment_amount,
      'decline_reason', new.decline_reason,
      'payment_rejected_reason', new.payment_rejected_reason,
      -- Who ended it, so the card can say "you declined" rather than a bare
      -- "declined" to the person who did it.
      'declined_by', case when new.status = 'declined'
        then case when actor = new.customer_user_id then 'customer' else 'shop_owner' end
        else null end
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
$function$;

-- ---------------------------------------------------------- the bell
create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  shop_owner_id uuid;
  shop_label text;
  order_link text := '/protected/orders/' || new.id::text;
  actor uuid := auth.uid();
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
        shop_owner_id, 'order_payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );

    elsif old.status = 'payment_submitted' and new.status = 'confirmed' then
      -- Rejecting a receipt is not "downpayment due" again -- it is a specific
      -- refusal with a reason, and that reason is what tells the customer what
      -- to fix before they try a second time.
      perform public.emit_notification(
        new.customer_user_id, 'order_payment_rejected',
        shop_label || ' rejected your receipt',
        coalesce(nullif(new.payment_rejected_reason, ''), new.project_name),
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );

    elsif new.status = 'confirmed' then
      -- The only other way to reach 'confirmed' is the customer accepting a
      -- quote, so this is always their action -- tell the shop, not them.
      perform public.emit_notification(
        shop_owner_id, 'order_confirmed', 'Customer accepted your quote - downpayment due',
        new.project_name,
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );

    elsif new.status = 'declined' then
      -- Either side can end an order here, so whoever did not act is who
      -- needs telling -- and with the reason the other party actually gave,
      -- not just the bare word "declined".
      if actor = new.customer_user_id then
        perform public.emit_notification(
          shop_owner_id, 'order_declined', 'Customer declined the order',
          coalesce(nullif(new.decline_reason, ''), new.project_name),
          order_link, new.customer_user_id, 'design_order', new.id, 'shop'
        );
      else
        perform public.emit_notification(
          new.customer_user_id, 'order_declined', shop_label || ' declined your order',
          coalesce(nullif(new.decline_reason, ''), new.project_name),
          order_link, shop_owner_id, 'design_order', new.id, 'personal'
        );
      end if;

    else
      perform public.emit_notification(
        new.customer_user_id,
        'order_' || new.status,
        case new.status
          when 'in_production' then shop_label || ' confirmed your payment'
          when 'completed'     then shop_label || ' completed your order'
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
$function$;
