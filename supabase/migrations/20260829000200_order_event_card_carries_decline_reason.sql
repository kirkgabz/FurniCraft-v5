-- The order card in the chat is where both parties actually see a decline, and
-- its payload carried everything except the one thing that explains it: the
-- card read "Order declined" and stopped there. The reason is written in the
-- same UPDATE that moves the status, so `new` already holds it here.
--
-- `declined_by` rides along so the card can attribute it. Either party can end
-- an order, and "Shop's reason" against your own words reads as someone else
-- speaking.
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
    -- something meaningful rather than an empty bubble. A declined order says
    -- why in the fallback too, for the same reason.
    new.project_name || ' - ' || replace(event_label, 'order_', '')
      || case
           when new.status = 'declined' and coalesce(new.decline_reason, '') <> ''
             then ': ' || new.decline_reason
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
