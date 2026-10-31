-- A quote's breakdown: what the customer is shown the price is made of.
--
-- Shops sent one figure. A customer had nothing to weigh it against, and "what
-- is that for?" in the chat is where quotes stalled. This stores the lines the
-- shop chooses to show -- "Narra hardwood ₱6,500", "Labour ₱3,800" -- next to
-- the total, on design_orders, which the customer can read.
--
-- Not the cost sheet. order_costings holds what the shop PAYS and stays
-- readable by the shop alone (see 20260921000300_order_costings.sql); these
-- are its PRICES. The app's "Use as quote" prices the cost lines at the shop's
-- markup on the way across, and the shop sees every line before it is sent.
--
-- Optional: null is a quote that is just a total, which every quote sent before
-- this is. When there are lines they must add up to quoted_total exactly, so
-- the breakdown and the figure the downpayment is worked out from can never
-- disagree.
--
-- Safe to re-run.

alter table public.design_orders
  add column if not exists quote_lines jsonb;

comment on column public.design_orders.quote_lines is
  'The shop''s customer-facing breakdown of quoted_total: [{label, amount}], adding up to it exactly. Null for a quote sent as a single figure.';

-- 1 to 20 lines, each a name of 1-80 characters and a non-zero amount (a
-- discount is negative), summing to the total. Immutable and in SQL so the
-- check constraint can call it.
create or replace function public.quote_lines_valid(lines jsonb, total numeric)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select lines is null or (
    jsonb_typeof(lines) = 'array'
    and jsonb_array_length(lines) between 1 and 20
    and total is not null
    and not exists (
      select 1
      from jsonb_array_elements(lines) as line
      where jsonb_typeof(line) <> 'object'
         or jsonb_typeof(line -> 'label') is distinct from 'string'
         or length(btrim(line ->> 'label')) not between 1 and 80
         or jsonb_typeof(line -> 'amount') is distinct from 'number'
         or (line ->> 'amount')::numeric = 0
    )
    and (select sum((line ->> 'amount')::numeric) from jsonb_array_elements(lines) as line) = total
  );
$$;

alter table public.design_orders
  drop constraint if exists design_orders_quote_lines_valid;
alter table public.design_orders
  add constraint design_orders_quote_lines_valid
  check (public.quote_lines_valid(quote_lines, quoted_total));

-- ---------------------------------------------------------- who may write it
-- As 20261005013313_shop_cancel_unpaid_order left it, plus two rules: the shop
-- writes a breakdown only while quoting, and the customer never does.
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

    -- The breakdown is part of a quote: written while one is being sent or
    -- revised, and fixed once the customer has answered it.
    if new.quote_lines is distinct from old.quote_lines
       and not (old.status in ('pending_quote', 'quoted') and new.status = 'quoted')
    then
      raise exception 'A quote breakdown can only be changed while quoting.';
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
     or new.quote_lines is distinct from old.quote_lines
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

-- ------------------------------------------------------ the conversation card
-- As the live definition stood, plus: the card carries the breakdown it was
-- sent with, and a revision that changes only the breakdown posts a "quote
-- revised" card like a change of total does.
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
  from public.shops r
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
  elsif new.quoted_total is distinct from old.quoted_total
     or new.quote_lines is distinct from old.quote_lines then
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
      'quote_lines', new.quote_lines,
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
