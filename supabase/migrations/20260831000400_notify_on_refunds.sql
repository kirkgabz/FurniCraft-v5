-- A refund request nobody is told about is a refund request nobody answers.
--
-- 20260831000200 added the refund track as columns beside `status` rather than
-- as a status of its own, which was the right shape: a refund is a second
-- conversation about an order, not a stage of it. But every notification in
-- this trigger keys off `status`, so a refund moved nothing and told no one.
-- The shop learned of a request only by opening the order it hung off, and the
-- customer learned of the answer the same way. Both sides were waiting on a
-- screen neither had a reason to open.
--
-- Three transitions matter, and in each the person told is the one who did not
-- act. The customer asks, so the shop is told; the shop answers, so the
-- customer is told.
--
-- The body carries the reason or the reference rather than just the project
-- name. "Refund declined" on its own sends the reader back to the order to find
-- out why, which is exactly the trip the notification exists to save.
--
-- Verified against a real order, as both parties, in a transaction that then
-- aborted:
--
--   customer asks    -> shop notified      "Refund requested"
--                       body: project - the customer's reason        audience shop
--   shop refuses     -> customer notified  "<shop> could not refund this"
--                       body: the refusal reason                     audience personal
--   shop refunds     -> customer notified  "<shop> refunded PHP 43,000.00"
--                       body: project - ref GC-8021-4477             audience personal
--   no stray recipients
--
-- Everything below the refund block is carried over from the function's own
-- current definition, not from the migration that first wrote it, so later
-- revisions survive. The `exception when others` tail is likewise unchanged:
-- failing to write a notification must never roll back the refund it describes.

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
    perform public.emit_notification(
      shop_owner_id, 'order_received', 'New order received', new.project_name,
      order_link, new.customer_user_id, 'design_order', new.id, 'shop'
    );
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
