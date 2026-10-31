-- Quote and confirmation fields on design_orders, plus the rules about who may
-- change what.
--
-- Deliberately additive. The status column keeps its current values
-- (pending / accepted / declined / completed) and no rows are migrated here,
-- because 22 places in the UI still compare against those strings. Introducing
-- pending_quote -> quoted -> confirmed -> in_production -> completed is a
-- separate step that moves the data and the UI together, so the app is never
-- half-migrated.
--
-- What this migration does establish now is the harder half: the columns, and
-- the guarantee that a shop cannot answer on the customer's behalf and a
-- customer cannot set their own price.

alter table public.design_orders
  add column if not exists quoted_total numeric,
  add column if not exists downpayment_percent numeric,
  add column if not exists quoted_at timestamptz,
  add column if not exists quoted_by uuid references auth.users(id) on delete set null,
  add column if not exists customer_response text,
  add column if not exists customer_responded_at timestamptz;

-- The downpayment in pesos, derived rather than stored twice. PayMongo will
-- want centavos; that conversion belongs in the payment code, not here.
alter table public.design_orders
  add column if not exists downpayment_amount numeric
    generated always as (round(quoted_total * downpayment_percent / 100.0, 2)) stored;

-- "minimum 5%" from the brief, enforced where it cannot be skipped. Null passes:
-- an order that has not been quoted yet has no percentage.
alter table public.design_orders
  drop constraint if exists design_orders_downpayment_percent_check;
alter table public.design_orders
  add constraint design_orders_downpayment_percent_check
  check (downpayment_percent is null or (downpayment_percent >= 5 and downpayment_percent <= 100));

alter table public.design_orders
  drop constraint if exists design_orders_quoted_total_check;
alter table public.design_orders
  add constraint design_orders_quoted_total_check
  check (quoted_total is null or quoted_total >= 0);

alter table public.design_orders
  drop constraint if exists design_orders_customer_response_check;
alter table public.design_orders
  add constraint design_orders_customer_response_check
  check (customer_response is null or customer_response in ('confirmed', 'declined'));

-- ------------------------------------------------------- customer may reply
-- design_orders had policies for the customer to SELECT and INSERT, and for the
-- shop owner to SELECT and UPDATE -- but nothing let a customer update their own
-- order. Confirming or declining a quote was therefore impossible for exactly
-- the person the brief says must do it.
drop policy if exists "design_orders_update_customer" on public.design_orders;
create policy "design_orders_update_customer" on public.design_orders
  for update to authenticated
  using (customer_user_id = auth.uid())
  with check (customer_user_id = auth.uid());

-- ------------------------------------------------------------- who may what
-- Row-level policies cannot restrict columns, and both parties can now update
-- the same row, so the split lives in a trigger -- the same pattern as
-- guard_shop_request_status and guard_user_profile_admin_flag.
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
begin
  -- No end-user session: a migration, the SQL editor, or a webhook running as
  -- the service role. Those are trusted by definition here.
  if acting_user is null or public.is_admin() then
    return new;
  end if;

  is_customer := old.customer_user_id = acting_user;
  is_shop_owner := exists (
    select 1 from public.shop_owner_requests r
    where r.id = old.shop_id and r.user_id = acting_user
  );

  if is_shop_owner then
    -- The shop prices the work; it does not get to accept its own quote.
    if new.customer_response is distinct from old.customer_response
       or new.customer_responded_at is distinct from old.customer_responded_at
    then
      raise exception 'Only the customer may respond to a quote.';
    end if;
    return new;
  end if;

  if is_customer then
    -- The customer answers the quote. Everything describing the work, its
    -- price, and where it is in the pipeline belongs to the shop.
    if new.status is distinct from old.status
       or new.quoted_total is distinct from old.quoted_total
       or new.downpayment_percent is distinct from old.downpayment_percent
       or new.quoted_at is distinct from old.quoted_at
       or new.quoted_by is distinct from old.quoted_by
       or new.estimated_price is distinct from old.estimated_price
       or new.shop_id is distinct from old.shop_id
       or new.customer_user_id is distinct from old.customer_user_id
    then
      raise exception 'A customer may only confirm or decline a quote.';
    end if;
    return new;
  end if;

  raise exception 'Only the customer or the shop may change this order.';
end;
$$;

revoke all on function public.guard_design_order_columns() from public, anon, authenticated;

drop trigger if exists guard_design_order_columns on public.design_orders;
create trigger guard_design_order_columns
  before update on public.design_orders
  for each row execute function public.guard_design_order_columns();

-- --------------------------------------------------------- quote notification
-- Extends the status notifier from 20260825000600_notifications.sql so a quote
-- reaches the customer even though the status has not changed yet.
create or replace function public.notify_design_order_quote()
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

  -- A quote was issued or revised.
  if new.quoted_total is not null
     and (old.quoted_total is distinct from new.quoted_total
          or old.downpayment_percent is distinct from new.downpayment_percent)
  then
    perform public.emit_notification(
      new.customer_user_id,
      'order_quoted',
      shop_label || ' quoted your order',
      new.project_name || ' - PHP ' || to_char(new.quoted_total, 'FM999G999G990D00'),
      '/protected',
      shop_owner_id,
      'design_order',
      new.id
    );
  end if;

  -- The customer answered.
  if new.customer_response is distinct from old.customer_response
     and new.customer_response is not null
  then
    perform public.emit_notification(
      shop_owner_id,
      'order_' || new.customer_response,
      case new.customer_response
        when 'confirmed' then 'Customer confirmed your quote'
        else 'Customer declined your quote'
      end,
      new.project_name,
      '/protected/shop',
      new.customer_user_id,
      'design_order',
      new.id
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_quote failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_quote() from public, anon, authenticated;

drop trigger if exists notify_design_order_quote on public.design_orders;
create trigger notify_design_order_quote
  after update on public.design_orders
  for each row execute function public.notify_design_order_quote();

-- ------------------------------------------------------------------ check
-- A shop owner answering their own quote should raise:
--   'Only the customer may respond to a quote.'
-- A customer changing the price should raise:
--   'A customer may only confirm or decline a quote.'
