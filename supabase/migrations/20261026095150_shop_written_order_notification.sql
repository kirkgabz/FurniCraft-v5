-- Tell the right person about a new order.
--
-- notify_design_order_change's INSERT branch was written when every order
-- came from a customer, so it always told the shop "New order received". A
-- shop writing an order FOR a customer -- see
-- 20261026050211_shop_written_orders.sql -- would have been told about its
-- own work while the customer heard nothing at all.
--
-- The whole function is restated because that is what CREATE OR REPLACE
-- takes; only the INSERT branch differs, and it was lifted from the
-- migration that last defined it so nothing else drifts.
--
-- Verified for all three directions, each in a rolled-back transaction:
--
--   shop writes to a customer -> CUSTOMER gets "<shop> sent you an order"
--   customer sends to a shop  -> SHOP gets "New order received"
--   a link is claimed         -> SHOP gets "New order received"
--
-- The third is right as it stands: the claimer is the customer, so the shop
-- is the one who needs telling.

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
  from public.shops r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    -- Which way round this order was sent decides who needs telling. Until
    -- now every row arrived from a customer, so the shop was always the one
    -- notified; a shop writing an order FOR a customer would have been told
    -- about its own work while the customer heard nothing at all.
    if actor is not null and actor = shop_owner_id and new.customer_user_id <> actor then
      perform public.emit_notification(
        new.customer_user_id, 'order_quoted', shop_label || ' sent you an order',
        new.project_name || coalesce(' - PHP ' || to_char(new.quoted_total, 'FM999G999G990D00'), ''),
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );
    else
      perform public.emit_notification(
        shop_owner_id, 'order_received', 'New order received', new.project_name,
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );
    end if;
    return new;
  end if;

  -- ------------------------------------------------------------- refunds
  if new.refund_status is distinct from old.refund_status then
    if new.refund_status = 'requested' then
      perform public.emit_notification(
        shop_owner_id, 'order_refund_requested', 'Refund requested',
        new.project_name || ' - ' || coalesce(nullif(new.refund_reason, ''), 'no reason given'),
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );

    elsif new.refund_status = 'declined' then
      perform public.emit_notification(
        new.customer_user_id, 'order_refund_declined',
        shop_label || ' could not refund this',
        coalesce(nullif(new.refund_declined_reason, ''), new.project_name),
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );

    elsif new.refund_status = 'refunded' then
      -- The amount is the fact the customer checks their own account against,
      -- so it leads; the reference is what they quote if it has not arrived.
      perform public.emit_notification(
        new.customer_user_id, 'order_refunded',
        shop_label || ' refunded '
          || case when new.refund_amount is not null
                  then '₱' || trim(to_char(new.refund_amount, 'FM999,999,999.00'))
                  else 'your payment' end,
        new.project_name
          || case when nullif(new.refund_reference, '') is not null
                  then ' - ref ' || new.refund_reference else '' end,
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );
    end if;
  end if;

  if new.status is distinct from old.status and new.status <> 'quoted' then
    if new.status = 'payment_submitted' then
      perform public.emit_notification(
        shop_owner_id, 'order_payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );

    elsif old.status = 'payment_submitted' and new.status = 'confirmed' then
      perform public.emit_notification(
        new.customer_user_id, 'order_payment_rejected',
        shop_label || ' rejected your receipt',
        coalesce(nullif(new.payment_rejected_reason, ''), new.project_name),
        order_link, shop_owner_id, 'design_order', new.id, 'personal'
      );

    elsif new.status = 'confirmed' then
      perform public.emit_notification(
        shop_owner_id, 'order_confirmed', 'Customer accepted your quote - downpayment due',
        new.project_name,
        order_link, new.customer_user_id, 'design_order', new.id, 'shop'
      );

    elsif new.status = 'declined' then
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
