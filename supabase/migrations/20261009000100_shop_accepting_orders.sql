-- Whether a shop is taking new commissions right now.
--
-- Distinct from is_active, which is the hard switch: a deactivated shop
-- leaves shops_public entirely, so it cannot be browsed, read about or
-- messaged. That is the wrong tool for a furniture shop that is simply booked out
-- for the next two months -- its only options were to disappear or to keep
-- taking orders it cannot start, and the second is how a customer ends up
-- waiting without being told.
--
-- accepting_orders is the soft switch. The shop stays listed, keeps its
-- reviews and its published pieces, and can still be messaged; what closes is
-- the "Choose this shop" button. Defaults to true, so every existing shop is
-- open on the day this lands and nobody has to go and switch themselves on.

alter table public.shops
  add column if not exists accepting_orders boolean not null default true;

comment on column public.shops.accepting_orders is
  'Soft availability: false = listed and messageable, but not taking new orders. See is_active for the hard switch that unlists the shop.';

-- The public view gains the column at the end; CREATE OR REPLACE keeps the
-- existing columns, grants and filter exactly as they were. Deliberately NOT
-- added to the WHERE clause: a paused shop must still be readable, which is
-- the whole difference between this flag and is_active.
create or replace view public.shops_public as
 select id,
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
    map_url,
    allowed_materials,
    logo_url,
    accepting_orders
   from shops
  where status = 'approved'::text and is_active;
