-- A shop may cancel an order whose downpayment was never paid.
--
-- Once a customer accepts a quote the order sits at `confirmed` until they pay
-- and upload a receipt. If they never do, the shop had no way out: `confirmed`
-- was missing from the shop's transitions, so the order stayed in its queue
-- for good, holding a slot the shop had quoted against. The customer could
-- already cancel at this point (20260827000200_customer_cancel_before_payment);
-- this gives the shop the same exit, still before any money is involved.
--
-- The only change from the previous definition is the shop transition list:
-- `confirmed -> declined` is now allowed. The decline reason rule already
-- requires a reason to travel with the move, and the notification and chat
-- card triggers already describe a shop-made decline to the customer.

create or replace function public.guard_design_order_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  acting_user uuid := auth.uid();
  is_shop_owner boolean;
  is_customer boolean;
  acting_as_shop boolean;
  moved boolean := new.status is distinct from old.status;
  rejecting_receipt boolean;
  refund_moved boolean := new.refund_status is distinct from old.refund_status;
begin
  if acting_user is null or public.is_admin() then
    return new;
  end if;

  is_customer := old.customer_user_id = acting_user;
  is_shop_owner := exists (
    select 1 from public.shops r
    where r.id = old.shop_id and r.user_id = acting_user
  );

  if not (is_customer or is_shop_owner) then
    raise exception 'Only the customer or the shop may change this order.';
  end if;

  if new.shop_id is distinct from old.shop_id
     or new.customer_user_id is distinct from old.customer_user_id
  then
    raise exception 'An order cannot be reassigned.';
  end if;

  -- Terminal states are terminal -- but a refund may still be settled on one.
  -- An order completed last month and refunded this week is the ordinary shape
  -- of a return, and refusing to record it would not make it untrue.
  if old.status in ('completed', 'declined') and moved then
    raise exception 'A % order cannot change state.', old.status;
  end if;

  if new.decline_reason is distinct from old.decline_reason
     and not (moved and new.status = 'declined')
  then
    raise exception 'A decline reason can only be given while declining the order.';
  end if;

  if is_shop_owner and is_customer then
    acting_as_shop := not (
         new.customer_response is distinct from old.customer_response
      or new.customer_responded_at is distinct from old.customer_responded_at
      or (new.payment_receipt_url is distinct from old.payment_receipt_url and new.payment_receipt_url is not null)
      or (refund_moved and new.refund_status = 'requested')
    );
  else
    acting_as_shop := is_shop_owner;
  end if;

  if acting_as_shop then
    rejecting_receipt := moved
      and old.status = 'payment_submitted'
      and new.status = 'confirmed';

    if new.customer_response is distinct from old.customer_response
       or new.customer_responded_at is distinct from old.customer_responded_at
    then
      raise exception 'Only the customer may respond to a quote.';
    end if;

    if not rejecting_receipt then
      if new.payment_receipt_url is distinct from old.payment_receipt_url
         or new.payment_reference is distinct from old.payment_reference
         or new.payment_submitted_at is distinct from old.payment_submitted_at
      then
        raise exception 'Only the customer may submit a receipt.';
      end if;
    else
      if new.payment_receipt_url is not null
         or new.payment_reference is not null
         or new.payment_submitted_at is not null
      then
        raise exception 'Rejecting a receipt clears it; it cannot be replaced by the shop.';
      end if;
    end if;

    -- ---- refunds: the shop answers, and only answers ----
    if new.refund_reason is distinct from old.refund_reason
       or new.refund_requested_at is distinct from old.refund_requested_at
    then
      raise exception 'Only the customer may ask for a refund.';
    end if;

    if refund_moved and not (old.refund_status = 'requested' and new.refund_status in ('declined', 'refunded')) then
      raise exception 'A shop may only answer a refund request, not create or reopen one.';
    end if;

    if new.refund_declined_reason is distinct from old.refund_declined_reason
       and not (refund_moved and new.refund_status = 'declined')
    then
      raise exception 'A refund refusal reason can only be given while refusing.';
    end if;

    if (new.refund_reference is distinct from old.refund_reference
        or new.refund_amount is distinct from old.refund_amount)
       and not (refund_moved and new.refund_status = 'refunded')
    then
      raise exception 'Refund details can only be recorded while marking it refunded.';
    end if;

    if moved and not (
         (old.status = 'pending_quote'     and new.status in ('quoted', 'declined'))
      or (old.status = 'quoted'            and new.status = 'declined')
      -- Accepted, but the downpayment never came.
      or (old.status = 'confirmed'         and new.status = 'declined')
      or (old.status = 'payment_submitted' and new.status in ('in_production', 'confirmed', 'declined'))
      or (old.status = 'in_production'     and new.status = 'completed')
    ) then
      raise exception 'A shop cannot move an order from % to %.', old.status, new.status;
    end if;

    return new;
  end if;

  -- Customer. Everything describing the work and its price belongs to the shop.
  if new.quoted_total is distinct from old.quoted_total
     or new.downpayment_percent is distinct from old.downpayment_percent
     or new.quoted_at is distinct from old.quoted_at
     or new.quoted_by is distinct from old.quoted_by
     or new.estimated_price is distinct from old.estimated_price
     or new.payment_approved_at is distinct from old.payment_approved_at
     or new.payment_approved_by is distinct from old.payment_approved_by
     or new.production_started_at is distinct from old.production_started_at
     or new.completed_at is distinct from old.completed_at
     or new.payment_rejected_reason is distinct from old.payment_rejected_reason
     or new.refund_declined_reason is distinct from old.refund_declined_reason
     or new.refund_decided_at is distinct from old.refund_decided_at
     or new.refund_decided_by is distinct from old.refund_decided_by
     or new.refund_reference is distinct from old.refund_reference
     or new.refund_amount is distinct from old.refund_amount
  then
    raise exception 'A customer may only answer a quote, submit a receipt, or ask for a refund.';
  end if;

  -- ---- refunds: the customer asks, and only asks ----
  if refund_moved then
    if new.refund_status <> 'requested' then
      raise exception 'A customer may only ask for a refund; the shop answers it.';
    end if;
    if old.status not in ('payment_submitted', 'in_production', 'completed') then
      raise exception 'A refund can only be asked for once a payment has been submitted.';
    end if;
    if old.refund_status in ('requested', 'refunded') then
      raise exception 'This order already has a refund %.',
        case old.refund_status when 'requested' then 'request awaiting the shop' else 'that has been paid' end;
    end if;
  end if;

  if new.refund_reason is distinct from old.refund_reason
     and not (refund_moved and new.refund_status = 'requested')
  then
    raise exception 'A refund reason can only be given while asking for one.';
  end if;

  if moved and not (
       (old.status = 'pending_quote' and new.status = 'declined')
    or (old.status = 'quoted'        and new.status in ('confirmed', 'declined'))
    or (old.status = 'confirmed'     and new.status in ('payment_submitted', 'declined'))
  ) then
    raise exception 'A customer cannot move an order from % to %.', old.status, new.status;
  end if;

  return new;
end;
$function$;
