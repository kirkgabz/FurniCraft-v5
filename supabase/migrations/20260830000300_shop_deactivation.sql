-- Lets a shop owner take their storefront off the customer-facing directory
-- without deleting anything. Existing orders, templates, and reviews are
-- untouched; the shop just stops appearing in shops_public and can't be
-- ordered from again until reactivated.

alter table public.shop_owner_requests
  add column if not exists is_active boolean not null default true;

-- Recreated in full: create or replace view cannot change the WHERE clause's
-- effect on existing rows in a way that matters here, but this keeps the
-- view definition in one readable place rather than an ALTER buried after it.
drop view if exists public.shops_public;
create view public.shops_public as
  select
    id,
    user_id,
    shop_name,
    description,
    address,
    tagline,
    cover_image_url,
    gallery,
    phone,
    hours,
    policies,
    social_links,
    map_url
  from public.shop_owner_requests
  where status = 'approved' and is_active;

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- A deactivated shop can still see and respond to its existing conversations
-- and orders (that's a live commitment, not new business) but cannot be
-- ordered from again while inactive.
drop policy if exists "design_orders_insert_customer" on public.design_orders;
create policy "design_orders_insert_customer" on public.design_orders
  for insert with check (
    customer_user_id = auth.uid()
    and exists (
      select 1 from public.shop_owner_requests r
      where r.id = shop_id and r.status = 'approved' and r.is_active
    )
  );

-- ------------------------------------------------------------------ check
--   update public.shop_owner_requests set is_active = false where id = '<a shop>';
--   select * from public.shops_public where id = '<that shop>'; -- no rows
-- As a customer, inserting a design_order against that shop_id should fail
-- with a row-level security policy violation.
