-- NOTE: written against public.shops. An earlier revision of this file said
-- shop_owner_requests, which 20260831000100 renamed. plpgsql bodies are not
-- resolved until they run, so that version created cleanly and then failed on
-- every non-admin order update. Check table names in function bodies against
-- the current schema, not against the migration you copied from.

-- Refunds: the conversation that starts after money has already moved.
--
-- A customer can cancel an order right up to paying for it (20260827000200).
-- After that the exit disappears, and the migration that drew that line said
-- why: "from payment_submitted onward a real transfer may have happened and a
-- cancellation is a refund conversation between two people". This is that
-- conversation, given somewhere to live.
--
-- What FurniCraft can and cannot do here
-- --------------------------------------
-- Money never passes through FurniCraft. Payment is a QR transfer straight
-- from the customer to the shop's own GCash or bank account, which is why
-- `payment_submitted` exists as a state at all -- the platform can only record
-- what two people tell it about a transfer it never saw.
--
-- A refund is the same thing in reverse, and the platform's honest role is the
-- same: record the request, record the shop's answer, record the reference for
-- the money going back. Nothing here moves a peso, and nothing here should ever
-- be built into something that appears to. A customer who believes the platform
-- guarantees their money back has been misled by us.
--
-- Deliberately not a status
-- -------------------------
-- `status` is left alone. 20260827000200 argued against a second terminal
-- status and the argument still holds: the vocabulary is read by both
-- dashboards, the stepper, every notification trigger and every query, and a
-- new value has to be taught to all of them. A refund is also not a lifecycle
-- stage -- it runs alongside one. An order can be in production while a refund
-- is being discussed, and the two facts are both true.
--
--   refund_status: null -> requested -> refunded
--                                    \-> declined -> (may be requested again)

alter table public.design_orders
  add column if not exists refund_status text,
  add column if not exists refund_reason text,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refund_declined_reason text,
  add column if not exists refund_decided_at timestamptz,
  add column if not exists refund_decided_by uuid references auth.users(id) on delete set null,
  add column if not exists refund_reference text,
  add column if not exists refund_amount numeric(12, 2);

comment on column public.design_orders.refund_status is
  'null | requested | declined | refunded. Runs alongside status, never replaces it.';
comment on column public.design_orders.refund_reason is
  'The customer''s reason for asking. Given once, with the request.';
comment on column public.design_orders.refund_declined_reason is
  'The shop''s reason for refusing. Given once, with the refusal.';
comment on column public.design_orders.refund_reference is
  'The shop''s transfer reference for money sent back. FurniCraft never holds or moves it.';

alter table public.design_orders
  drop constraint if exists design_orders_refund_status_check;
alter table public.design_orders
  add constraint design_orders_refund_status_check
  check (refund_status is null or refund_status in ('requested', 'declined', 'refunded'));

-- A refunded amount is a real figure or absent; it is never negative, and never
-- larger than what was quoted.
alter table public.design_orders
  drop constraint if exists design_orders_refund_amount_check;
alter table public.design_orders
  add constraint design_orders_refund_amount_check
  check (
    refund_amount is null
    or (refund_amount >= 0 and (quoted_total is null or refund_amount <= quoted_total))
  );

-- Reasons are bounded, like every other free-text field a stranger can write.
alter table public.design_orders
  drop constraint if exists design_orders_refund_reason_length;
alter table public.design_orders
  add constraint design_orders_refund_reason_length
  check (
    (refund_reason is null or char_length(refund_reason) <= 2000)
    and (refund_declined_reason is null or char_length(refund_declined_reason) <= 2000)
  );

-- The shop's queue is "orders wanting an answer", and a refund request is one.
create index if not exists design_orders_refund_status_idx
  on public.design_orders (shop_id, refund_status)
  where refund_status is not null;

-- ------------------------------------------------------------------ the guard
-- Extends 20260829000500 rather than replacing its reasoning: each party may
-- state only its own facts. The customer asks and says why; the shop answers
-- and records what it sent. Neither may write the other's half, because the
-- whole value of this record is that it is two accounts of the same event.
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
  -- No end-user session: a migration or the SQL editor.
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

  -- Neither party may rewrite who the order belongs to.
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
      or (refund_moved and new.refund_status = 'requested')
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

    -- ---- refunds: the shop answers, and only answers ----
    if new.refund_reason is distinct from old.refund_reason
       or new.refund_requested_at is distinct from old.refund_requested_at
    then
      raise exception 'Only the customer may ask for a refund.';
    end if;

    if refund_moved and not (old.refund_status = 'requested' and new.refund_status in ('declined', 'refunded')) then
      raise exception 'A shop may only answer a refund request, not create or reopen one.';
    end if;

    -- A refusal carries its reason, and a payment carries its reference. Each
    -- is written with the act and cannot be revised afterwards to say something
    -- other than what was said at the time.
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
     -- The shop's half of a refund: its answer, its reference, its figure.
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
    -- Before payment there is nothing to refund: cancelling is the exit, and it
    -- already exists. Asking here would turn a cancellation into a claim that
    -- money changed hands.
    if old.status not in ('payment_submitted', 'in_production', 'completed') then
      raise exception 'A refund can only be asked for once a payment has been submitted.';
    end if;
    -- A request already answered with money is settled. A refusal may be
    -- appealed; a completed refund may not be asked for twice.
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

-- ------------------------------------------------------------------- checks
-- As the customer, on an order that has not been paid for:
--   update public.design_orders set refund_status = 'requested', refund_reason = 'x'
--     where id = '<a pending_quote order>';
--   -- expect: 'A refund can only be asked for once a payment has been submitted.'
--
-- As the customer, trying to answer their own request:
--   update public.design_orders set refund_status = 'refunded' where id = '<own order>';
--   -- expect: 'A customer may only ask for a refund; the shop answers it.'
--
-- As the shop, trying to raise one on the customer's behalf:
--   update public.design_orders set refund_status = 'requested' where id = '<their order>';
--   -- expect: 'A shop may only answer a refund request, not create or reopen one.'
--
-- As the shop, refunding more than was quoted:
--   update public.design_orders set refund_status = 'refunded', refund_amount = 999999 where ...;
--   -- expect: 23514 design_orders_refund_amount_check
