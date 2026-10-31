-- Receipt rejection, decline reasons, and message deep links.
--
-- Three fixes that all live in the same two triggers.

-- ------------------------------------------------------------ decline reason
-- Both sides may decline an order, and neither could say why. `payment_rejected_reason`
-- already exists and answers a different question ("this receipt is wrong"), so
-- this is a separate column rather than a reuse of that one.
alter table public.design_orders
  add column if not exists decline_reason text;

comment on column public.design_orders.decline_reason is
  'Why the order was declined, written by whichever party declined it. Set only on the transition into declined.';

-- --------------------------------------------------------------- the guard
-- Two changes against the previous definition:
--
-- 1. A shop rejecting a receipt may now clear the proof that came with it.
--    The status move itself (payment_submitted -> confirmed) was already
--    allowed; only the column writes were refused, so the button failed every
--    time it was pressed. Clearing is not cosmetic: the customer-side check
--    below only requires that payment_receipt_url is non-empty, so leaving a
--    rejected receipt attached would let the customer move straight back to
--    payment_submitted without uploading anything new. The permission is
--    therefore scoped to exactly that transition, and to those three columns.
--
-- 2. decline_reason may only be written on the move into declined, by whoever
--    is making that move. Afterwards it is frozen: 'declined' is terminal for
--    status, but the terminal check only guards status, so without this a
--    party could rewrite the other's stated reason after the fact.
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
  moved boolean := new.status is distinct from old.status;
  rejecting_receipt boolean;
begin
  -- No end-user session: a migration or the SQL editor.
  if acting_user is null or public.is_admin() then
    return new;
  end if;

  is_customer := old.customer_user_id = acting_user;
  is_shop_owner := exists (
    select 1 from public.shop_owner_requests r
    where r.id = old.shop_id and r.user_id = acting_user
  );

  if not (is_customer or is_shop_owner) then
    raise exception 'Only the customer or the shop may change this order.';
  end if;

  -- Neither party may rewrite who the order belongs to.
  if new.shop_id is distinct from old.shop_id
     or new.customer_user_id is distinct from old.customer_user_id
  then
    raise exception 'An order cannot be reassigned.';
  end if;

  -- Terminal states are terminal.
  if old.status in ('completed', 'declined') and moved then
    raise exception 'A % order cannot change state.', old.status;
  end if;

  -- A reason belongs to the act of declining, and cannot be revised later.
  if new.decline_reason is distinct from old.decline_reason
     and not (moved and new.status = 'declined')
  then
    raise exception 'A decline reason can only be given while declining the order.';
  end if;

  if is_shop_owner then
    rejecting_receipt := moved
      and old.status = 'payment_submitted'
      and new.status = 'confirmed';

    -- The shop prices the work and drives production. It may not answer for
    -- the customer, nor claim the customer paid. The one exception is handing
    -- a rejected receipt back: that clears the proof, and may only clear it.
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

    if moved and not (
         (old.status = 'pending_quote'     and new.status in ('quoted', 'declined'))
      or (old.status = 'quoted'            and new.status = 'declined')
      -- Rejecting a receipt returns the order to the customer to pay again.
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
  then
    raise exception 'A customer may only answer a quote or submit a payment receipt.';
  end if;

  if moved and not (
       -- Cancelling, while nothing has been paid.
       (old.status = 'pending_quote' and new.status = 'declined')
    or (old.status = 'quoted'        and new.status in ('confirmed', 'declined'))
    or (old.status = 'confirmed'     and new.status in ('payment_submitted', 'declined'))
  ) then
    raise exception 'A customer cannot move an order from % to %.', old.status, new.status;
  end if;

  -- Claiming payment requires actually attaching something.
  if new.status = 'payment_submitted' and coalesce(new.payment_receipt_url, '') = '' then
    raise exception 'A payment receipt is required before an order can be marked paid.';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------- deep links
-- A message notification used to land on '/protected' with nothing else: the
-- dashboard root, on whatever section happened to be showing, with no idea
-- which conversation had been notified about. The link now names the section
-- and the other party, so opening a notification opens that thread.
--
-- The recipient decides the shape: a shop owner reads their inbox keyed by
-- customer, a customer reads theirs keyed by shop.
create or replace function public.notify_shop_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  recipient uuid;
  shop_owner_id uuid;
  deep_link text;
begin
  select r.user_id into shop_owner_id
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  recipient := coalesce(new.target_user_id, shop_owner_id);

  deep_link := case
    when recipient = shop_owner_id
      then '/protected/shop?section=messages&customer=' || coalesce(new.sender_user_id::text, '')
    else '/protected?section=messages&shop=' || new.shop_id::text
  end;

  perform public.emit_notification(
    recipient, 'message_received', 'New message',
    left(coalesce(new.text, ''), 140),
    deep_link, new.sender_user_id, 'shop_message', new.id,
    case when recipient = shop_owner_id then 'shop' else 'personal' end
  );

  return new;
exception
  when others then
    raise warning 'notify_shop_message failed for message %: %', new.id, sqlerrm;
    return new;
end;
$function$;
