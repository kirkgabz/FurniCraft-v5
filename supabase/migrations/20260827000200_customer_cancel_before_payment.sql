-- A customer may cancel their own order until money is involved.
--
-- Today they can only decline a quote. An order sitting at pending_quote with
-- no reply, or one they accepted last night and thought better of this morning,
-- has no exit at all -- the customer has to message the shop and ask them to
-- decline it, which makes the shop do the customer's admin and leaves the order
-- sitting in the shop's "needs response" queue in the meantime.
--
-- The boundary is payment, not politeness. Up to and including `confirmed`
-- nothing has been paid and nothing has been built, so cancelling costs the
-- shop only the time spent quoting. From payment_submitted onward a real
-- transfer may have happened and a cancellation is a refund conversation
-- between two people, not a state a customer can assert on their own.
--
-- `declined` stays the single stopped state rather than adding `cancelled`
-- beside it: they mean the same thing to every reader of this table -- stopped,
-- terminal, not built -- and a second terminal status would have to be taught
-- to the status vocabulary, both dashboards, the stepper, the notification
-- triggers and every existing query. Who stopped it is already recorded in
-- customer_response.

create or replace function public.guard_design_order_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_user uuid := auth.uid();
  is_shop_owner boolean;
  is_customer boolean;
  moved boolean := new.status is distinct from old.status;
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

  if is_shop_owner then
    -- The shop prices the work and drives production. It may not answer for
    -- the customer, nor claim the customer paid.
    if new.customer_response is distinct from old.customer_response
       or new.customer_responded_at is distinct from old.customer_responded_at
       or new.payment_receipt_url is distinct from old.payment_receipt_url
       or new.payment_reference is distinct from old.payment_reference
       or new.payment_submitted_at is distinct from old.payment_submitted_at
    then
      raise exception 'Only the customer may respond to a quote or submit a receipt.';
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
$$;

revoke all on function public.guard_design_order_columns() from public, anon, authenticated;

-- ------------------------------------------------------------------ check
-- As the order's own customer:
--   pending_quote -> declined      accepted
--   confirmed     -> declined      accepted
--   payment_submitted -> declined  refused  (money may have moved)
--   in_production     -> declined  refused
