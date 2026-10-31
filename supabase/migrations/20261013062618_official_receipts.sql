-- Official receipts: the customer's details for one, and the shop's copy of it.
--
-- In the shops this platform serves, the last step before work starts is the
-- owner asking for the customer's name and TIN to write on the Official
-- Receipt. That receipt is the shop's own document, written under its own BIR
-- registration -- a booklet printed with an Authority to Print, or the shop's
-- registered system. FurniCraft is not accredited to issue it and does not try
-- to. It carries the two halves of the exchange instead:
--
--   design_orders.billing_*    what the customer wants written on the receipt.
--                              Written by the customer only, and fixed once
--                              the shop has issued a receipt with it.
--   order_official_receipts    a photo or PDF of each receipt the shop issued
--                              (a downpayment and a balance are often two),
--                              attached once the payment has been approved.
--
-- A TIN is a government-issued number peculiar to one person, which the Data
-- Privacy Act treats as sensitive personal information. It is optional, it
-- sits on the order row that only the customer, that order's shop and an
-- admin can read, and the app loads it only on the card that shows it -- not
-- in order lists.
--
-- Safe to re-run.

-- ---------------------------------------------------------------- details
alter table public.design_orders
  add column if not exists billing_name text,
  add column if not exists billing_tin text,
  add column if not exists billing_address text;

comment on column public.design_orders.billing_name is
  'The name the customer wants on the shop''s official receipt. Customer-written; fixed once a receipt is issued.';
comment on column public.design_orders.billing_tin is
  'Optional TIN for the official receipt, as 000-000-000 with an optional 3- or 5-digit branch code. Sensitive personal information.';
comment on column public.design_orders.billing_address is
  'Optional address for the official receipt.';

alter table public.design_orders drop constraint if exists design_orders_billing_name_valid;
alter table public.design_orders add constraint design_orders_billing_name_valid
  check (billing_name is null or length(btrim(billing_name)) between 1 and 120);

alter table public.design_orders drop constraint if exists design_orders_billing_tin_valid;
alter table public.design_orders add constraint design_orders_billing_tin_valid
  check (billing_tin is null or billing_tin ~ '^[0-9]{3}-[0-9]{3}-[0-9]{3}(-[0-9]{3}|-[0-9]{5})?$');

alter table public.design_orders drop constraint if exists design_orders_billing_address_valid;
alter table public.design_orders add constraint design_orders_billing_address_valid
  check (billing_address is null or length(btrim(billing_address)) between 1 and 300);

-- A TIN or an address with no name to go with it is not a receipt's details.
alter table public.design_orders drop constraint if exists design_orders_billing_needs_name;
alter table public.design_orders add constraint design_orders_billing_needs_name
  check (billing_name is not null or (billing_tin is null and billing_address is null));

-- ---------------------------------------------------------------- receipts
create table if not exists public.order_official_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.design_orders(id) on delete cascade,
  -- official-receipts/{order_id}/or_{timestamp}.{ext}
  file_path text not null,
  -- The number printed on the receipt, so either side can quote it.
  receipt_number text,
  -- What it was issued for. Optional: the photo is the record.
  amount numeric(12, 2),
  issued_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint order_official_receipts_path_in_order
    check (split_part(file_path, '/', 1) = order_id::text
           and length(file_path) <= 300
           and position('..' in file_path) = 0),
  constraint order_official_receipts_number_valid
    check (receipt_number is null or length(btrim(receipt_number)) between 1 and 40),
  constraint order_official_receipts_amount_valid
    check (amount is null or amount > 0)
);

comment on table public.order_official_receipts is
  'Copies of the official receipts a shop issued for an order, under its own BIR registration. FurniCraft delivers them; it does not issue them.';

create index if not exists order_official_receipts_order_idx
  on public.order_official_receipts (order_id, created_at);

alter table public.order_official_receipts enable row level security;

-- Read by the two parties to the order, and an admin settling a dispute.
drop policy if exists "order_official_receipts_select" on public.order_official_receipts;
create policy "order_official_receipts_select" on public.order_official_receipts
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.design_orders o
      where o.id = order_official_receipts.order_id
        and (
          o.customer_user_id = auth.uid()
          or exists (select 1 from public.shops s where s.id = o.shop_id and s.user_id = auth.uid())
        )
    )
  );

-- Attached by the order's shop, once it has approved the payment. Ten is far
-- more than a downpayment and a balance need, and stops a runaway client.
drop policy if exists "order_official_receipts_insert_shop" on public.order_official_receipts;
create policy "order_official_receipts_insert_shop" on public.order_official_receipts
  for insert to authenticated
  with check (
    issued_by = auth.uid()
    and exists (
      select 1 from public.design_orders o
      join public.shops s on s.id = o.shop_id
      where o.id = order_official_receipts.order_id
        and s.user_id = auth.uid()
        and o.status in ('in_production', 'completed')
    )
    and (
      select count(*) from public.order_official_receipts r
      where r.order_id = order_official_receipts.order_id
    ) < 10
  );

-- Removed by the shop that attached it -- a wrong photo has to be fixable. The
-- chat card that announced it stays, as every card does.
drop policy if exists "order_official_receipts_delete_shop" on public.order_official_receipts;
create policy "order_official_receipts_delete_shop" on public.order_official_receipts
  for delete to authenticated
  using (
    exists (
      select 1 from public.design_orders o
      join public.shops s on s.id = o.shop_id
      where o.id = order_official_receipts.order_id
        and s.user_id = auth.uid()
    )
  );

-- No update policy: a corrected receipt is removed and attached again.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_official_receipts'
  ) then
    alter publication supabase_realtime add table public.order_official_receipts;
  end if;
end;
$$;

-- ------------------------------------------------------------------ files
-- Private, read through signed URLs like the payment receipts: a receipt
-- carries a name, a TIN and an address.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('official-receipts', 'official-receipts', false, 5242880, array['image/*', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "official_receipts_insert_shop" on storage.objects;
create policy "official_receipts_insert_shop" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'official-receipts'
    and exists (
      select 1 from public.design_orders o
      join public.shops s on s.id = o.shop_id
      where o.id::text = (storage.foldername(name))[1]
        and s.user_id = auth.uid()
        and o.status in ('in_production', 'completed')
    )
  );

drop policy if exists "official_receipts_delete_shop" on storage.objects;
create policy "official_receipts_delete_shop" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'official-receipts'
    and exists (
      select 1 from public.design_orders o
      join public.shops s on s.id = o.shop_id
      where o.id::text = (storage.foldername(name))[1]
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "official_receipts_read" on storage.objects;
create policy "official_receipts_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'official-receipts'
    and (
      public.is_admin()
      or exists (
        select 1 from public.design_orders o
        where o.id::text = (storage.foldername(name))[1]
          and (
            o.customer_user_id = auth.uid()
            or exists (select 1 from public.shops s where s.id = o.shop_id and s.user_id = auth.uid())
          )
      )
    )
  );

-- ---------------------------------------------------------- who may write it
-- As 20261012012059_quote_breakdown left it, plus: the receipt details are the
-- customer's to give, and fixed once the shop has written a receipt with them.
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
  billing_moved boolean := new.billing_name is distinct from old.billing_name
    or new.billing_tin is distinct from old.billing_tin
    or new.billing_address is distinct from old.billing_address;
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
      or billing_moved
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

    -- The shop writes the receipt; what goes on it is the customer's word.
    if billing_moved then
      raise exception 'Only the customer may give the details for their receipt.';
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

  -- ---- receipt details: the customer's, until a receipt carries them ----
  if billing_moved then
    if old.status = 'declined' then
      raise exception 'This order was declined, so there is no receipt to write.';
    end if;
    if exists (select 1 from public.order_official_receipts r where r.order_id = old.id) then
      raise exception 'The shop has already written your receipt with these details. Message them if something on it is wrong.';
    end if;
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

-- ------------------------------------------------- the card and the notice
-- A receipt attached is posted into the conversation as an order card, and the
-- customer is told, the same way every other order event reaches them.
create or replace function public.emit_official_receipt_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  ord public.design_orders%rowtype;
  shop_owner_id uuid;
  shop_label text;
  number_note text := case
    when coalesce(new.receipt_number, '') <> '' then ' no. ' || new.receipt_number
    else ''
  end;
begin
  -- A migration or maintenance script is not a conversation event.
  if actor is null then
    return new;
  end if;

  select * into ord from public.design_orders where id = new.order_id;
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shops r
  where r.id = ord.shop_id;

  insert into public.shop_messages (
    shop_id, sender_user_id, target_user_id, sender_role, text, kind, payload, order_id
  )
  values (
    ord.shop_id,
    actor,
    ord.customer_user_id,
    'shop_owner',
    ord.project_name || ' - official receipt' || number_note,
    'order_event',
    jsonb_build_object(
      'event', 'order_receipt_issued',
      'order_id', ord.id,
      'project_name', ord.project_name,
      'furniture_type', ord.furniture_type,
      'status', ord.status,
      'receipt_number', new.receipt_number,
      'receipt_amount', new.amount
    ),
    ord.id
  );

  perform public.emit_notification(
    ord.customer_user_id, 'order_receipt_issued',
    shop_label || ' sent your official receipt',
    ord.project_name || number_note,
    '/protected/orders/' || ord.id::text, actor, 'design_order', ord.id, 'personal'
  );

  return new;
exception
  when others then
    -- A missing card must never undo the receipt itself.
    raise warning 'emit_official_receipt_event failed for receipt %: %', new.id, sqlerrm;
    return new;
end;
$function$;

drop trigger if exists emit_official_receipt_event on public.order_official_receipts;
create trigger emit_official_receipt_event
  after insert on public.order_official_receipts
  for each row execute function public.emit_official_receipt_event();
