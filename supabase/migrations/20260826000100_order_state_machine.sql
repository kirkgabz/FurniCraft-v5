-- The order lifecycle, and the rules about who may move it.
--
--   pending_quote -> quoted -> confirmed -> payment_submitted -> in_production -> completed
--                 \_________ declined ______________/
--
-- payment_submitted is a real state, not an afterthought: payment is a QR
-- transfer straight to the shop, so there is a period where the customer says
-- they have paid and the shop has not yet checked its own GCash or bank app.
-- Nothing automated can close that gap, so the schema models it.
--
-- Migrating today's values
-- -----------------------
--   pending   -> pending_quote   (the shop still owes a price)
--   accepted  -> pending_quote   (see below)
--   declined  -> declined
--   completed -> completed
--
-- `accepted` meant "the shop agreed to build this" under a flow with no quote
-- step. Those orders still need pricing, so they go back to the shop's queue
-- rather than being given a quote nobody issued. Two orders are affected.

alter table public.design_orders
  add column if not exists payment_receipt_url text,
  add column if not exists payment_reference text,
  add column if not exists payment_submitted_at timestamptz,
  add column if not exists payment_approved_at timestamptz,
  add column if not exists payment_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_rejected_reason text,
  add column if not exists production_started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Where the shop tells the customer how to pay. Kept on the shop row rather
-- than on each order, because it is a property of the business.
alter table public.shop_owner_requests
  add column if not exists payment_qr_url text,
  add column if not exists payment_instructions text,
  add column if not exists payment_account_name text,
  add column if not exists payment_account_number text;

comment on column public.shop_owner_requests.payment_qr_url is
  'QR Ph / GCash QR image for direct payment. Money never passes through FurniCraft.';

-- ------------------------------------------------------------ the values
update public.design_orders set status = 'pending_quote'
  where status in ('pending', 'accepted');

alter table public.design_orders
  drop constraint if exists design_orders_status_check;
alter table public.design_orders
  add constraint design_orders_status_check check (status in (
    'pending_quote', 'quoted', 'confirmed',
    'payment_submitted', 'in_production', 'completed', 'declined'
  ));

alter table public.design_orders alter column status set default 'pending_quote';

-- ------------------------------------------------------- who may move what
-- Replaces the column guard from 20260825000900. That one said a customer may
-- never touch status, which was right when the customer had nothing to do but
-- answer. Now the customer also confirms a quote and submits a receipt, so the
-- rule becomes a transition table rather than a column blacklist.
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
       (old.status = 'quoted'    and new.status in ('confirmed', 'declined'))
    or (old.status = 'confirmed' and new.status = 'payment_submitted')
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

-- ------------------------------------------------------- notification text
-- Rewritten for the new states; the old CASE named accepted/declined/completed.
create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    perform public.emit_notification(
      shop_owner_id, 'order_received', 'New order received', new.project_name,
      '/protected/shop', new.customer_user_id, 'design_order', new.id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    -- A receipt is the shop's cue to check its own GCash or bank app.
    if new.status = 'payment_submitted' then
      perform public.emit_notification(
        shop_owner_id, 'payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        '/protected/shop', new.customer_user_id, 'design_order', new.id
      );
    else
      perform public.emit_notification(
        new.customer_user_id,
        'order_' || new.status,
        case new.status
          when 'declined'      then shop_label || ' declined your order'
          when 'in_production'  then shop_label || ' confirmed your payment'
          when 'completed'      then shop_label || ' completed your order'
          when 'confirmed'      then 'Downpayment due for your order'
          else 'Your order is now ' || replace(new.status, '_', ' ')
        end,
        new.project_name,
        '/protected', shop_owner_id, 'design_order', new.id
      );
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_change failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_change() from public, anon, authenticated;

-- ------------------------------------------------------------------ check
--   select status, count(*) from public.design_orders group by 1 order by 2 desc;
-- A shop attempting pending_quote -> in_production should raise:
--   'A shop cannot move an order from pending_quote to in_production.'
