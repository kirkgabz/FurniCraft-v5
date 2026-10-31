-- An account that owns a shop and also orders from it (testing a storefront,
-- or a maker buying their own piece) is both is_customer and is_shop_owner on
-- that one row. The guard checked is_shop_owner first and returned from that
-- branch unconditionally, so such an account could never act as the customer
-- on its own order again after the initial quote request: accepting a quote,
-- submitting a payment receipt, and cancelling all write customer_response or
-- payment_receipt_url, which the shop branch raises on as "Only the customer
-- may submit a receipt" / "...respond to a quote" -- correct for a genuine
-- third party, wrong for the same person acting as themself.
--
-- Which role they are acting in has to come from the write itself. A shop
-- action never touches customer_response/customer_responded_at, and never
-- sets payment_receipt_url to a non-null value (rejecting a receipt clears it
-- to null; only a customer's submission ever writes a real one) -- so those
-- three columns are an unambiguous signal, checked only when both roles apply
-- to the same person. Every other account still resolves exactly as before.
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

  if is_shop_owner and is_customer then
    acting_as_shop := not (
         new.customer_response is distinct from old.customer_response
      or new.customer_responded_at is distinct from old.customer_responded_at
      or (new.payment_receipt_url is distinct from old.payment_receipt_url and new.payment_receipt_url is not null)
    );
  else
    acting_as_shop := is_shop_owner;
  end if;

  if acting_as_shop then
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
       (old.status = 'pending_quote' and new.status = 'declined')
    or (old.status = 'quoted'        and new.status in ('confirmed', 'declined'))
    or (old.status = 'confirmed'     and new.status in ('payment_submitted', 'declined'))
  ) then
    raise exception 'A customer cannot move an order from % to %.', old.status, new.status;
  end if;

  if new.status = 'payment_submitted' and coalesce(new.payment_receipt_url, '') = '' then
    raise exception 'A payment receipt is required before an order can be marked paid.';
  end if;

  return new;
end;
$function$;
