-- Structural gaps found by auditing the live schema. No data was wrong -- every
-- consistency check returned zero rows -- but nothing was stopping it from
-- going wrong, and several of the rules the app relies on existed only in
-- TypeScript.
--
-- Four groups: missing foreign keys, missing indexes, missing value
-- constraints, and state invariants that the transition guard does not cover.

-- ------------------------------------------------------- 1. foreign keys
-- Three columns clearly reference another table and were never declared as
-- doing so. Verified orphan-free before adding, so these are enforceable now.
--
-- shop_owner_requests.user_id: cascading matches user_profiles.id, which
-- already cascades from auth.users. Deleting an account should not leave an
-- application behind pointing at nobody.
alter table public.shop_owner_requests
  drop constraint if exists shop_owner_requests_user_id_fkey;
alter table public.shop_owner_requests
  add constraint shop_owner_requests_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Messages and read-state belong to a shop; if the shop goes, so do they.
-- design_orders.shop_id already cascades this way.
alter table public.shop_messages
  drop constraint if exists shop_messages_shop_id_fkey;
alter table public.shop_messages
  add constraint shop_messages_shop_id_fkey
  foreign key (shop_id) references public.shop_owner_requests(id) on delete cascade;

alter table public.conversation_read_state
  drop constraint if exists conversation_read_state_shop_id_fkey;
alter table public.conversation_read_state
  add constraint conversation_read_state_shop_id_fkey
  foreign key (shop_id) references public.shop_owner_requests(id) on delete cascade;

-- ----------------------------------------------------------- 2. indexes
-- Postgres does not index foreign keys automatically, and twelve of ours had
-- none. This matters more than usual here because the RLS policies join on
-- them: every read of design_orders runs
--
--   exists (select 1 from shop_owner_requests r where r.id = shop_id and r.user_id = auth.uid())
--
-- per row, and both sides of that were unindexed. It also makes deleting a shop
-- or a user scan every referencing table.
create index if not exists design_orders_shop_idx on public.design_orders (shop_id, created_at desc);
create index if not exists design_orders_customer_idx on public.design_orders (customer_user_id, created_at desc);
create index if not exists design_orders_status_idx on public.design_orders (status);
create index if not exists design_orders_quoted_by_idx on public.design_orders (quoted_by);
create index if not exists design_orders_payment_approved_by_idx on public.design_orders (payment_approved_by);

create index if not exists design_templates_shop_idx on public.design_templates (shop_id, created_at desc);
create index if not exists design_templates_created_by_idx on public.design_templates (created_by);

create index if not exists shop_messages_shop_idx on public.shop_messages (shop_id, created_at desc);
create index if not exists shop_messages_sender_idx on public.shop_messages (sender_user_id);
create index if not exists shop_messages_target_idx on public.shop_messages (target_user_id);

create index if not exists shop_owner_requests_user_idx on public.shop_owner_requests (user_id);
create index if not exists shop_owner_requests_status_idx on public.shop_owner_requests (status);

create index if not exists shop_reviews_customer_idx on public.shop_reviews (customer_user_id);
create index if not exists notifications_actor_idx on public.notifications (actor_user_id);
create index if not exists reports_resolved_by_idx on public.reports (resolved_by);
create index if not exists user_profiles_selected_shop_idx on public.user_profiles (selected_shop_id);

-- -------------------------------------------------- 3. value constraints
-- shop_owner_requests.status drives the admin queue, the shops_public view and
-- the approval guard, and accepted any string at all. Current values are
-- pending / approved / rejected.
alter table public.shop_owner_requests
  drop constraint if exists shop_owner_requests_status_check;
alter table public.shop_owner_requests
  add constraint shop_owner_requests_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- role and shop_owner encode the same fact in two columns, kept in step by hand
-- in the sign-up form and the admin panel. They agree today; this makes it
-- impossible for them to drift, which would show a customer a shop dashboard or
-- hide one from an owner.
alter table public.user_profiles
  drop constraint if exists user_profiles_role_matches_flag;
alter table public.user_profiles
  add constraint user_profiles_role_matches_flag
  check ((role = 'shop_owner') = shop_owner);

-- ------------------------------------------------- 4. state invariants
-- guard_design_order_columns governs *movement* between states. Nothing
-- governed what a row must contain once it is there, so a quoted order with no
-- price, or one in production that was never paid for, was representable.
--
-- Written as one constraint per rule so a violation names the rule it broke.
alter table public.design_orders
  drop constraint if exists design_orders_quoted_has_price;
alter table public.design_orders
  add constraint design_orders_quoted_has_price
  check (
    status not in ('quoted', 'confirmed', 'payment_submitted', 'in_production', 'completed')
    or (quoted_total is not null and downpayment_percent is not null)
  );

alter table public.design_orders
  drop constraint if exists design_orders_confirmed_has_response;
alter table public.design_orders
  add constraint design_orders_confirmed_has_response
  check (
    status not in ('confirmed', 'payment_submitted', 'in_production', 'completed')
    or customer_response = 'confirmed'
  );

alter table public.design_orders
  drop constraint if exists design_orders_submitted_has_receipt;
alter table public.design_orders
  add constraint design_orders_submitted_has_receipt
  check (status <> 'payment_submitted' or coalesce(payment_receipt_url, '') <> '');

alter table public.design_orders
  drop constraint if exists design_orders_production_was_approved;
alter table public.design_orders
  add constraint design_orders_production_was_approved
  check (
    status not in ('in_production', 'completed')
    or (payment_approved_at is not null and payment_approved_by is not null)
  );

-- ------------------------------------------------------------------ check
-- All of these should return zero:
--
--   select count(*) from public.design_orders
--   where (status in ('quoted','confirmed','payment_submitted','in_production','completed') and quoted_total is null)
--      or (status in ('confirmed','payment_submitted','in_production','completed') and customer_response is distinct from 'confirmed')
--      or (status = 'payment_submitted' and coalesce(payment_receipt_url,'') = '')
--      or (status in ('in_production','completed') and payment_approved_at is null);
--
--   select count(*) from public.user_profiles where (role = 'shop_owner') <> shop_owner;
