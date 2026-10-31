-- Lets a shop say which finishes it actually stocks, once, for everything it
-- sells -- rather than ticking the same list again on every template.
--
-- Why this is not the same as design_templates.allowed_materials
-- --------------------------------------------------------------
-- That column answers "what will you build THIS piece in", which is a
-- statement about one design: a shop may offer a chair in six timbers and the
-- matching table in two because the table needs wider boards. This column
-- answers the question underneath it -- "what do you work in at all" -- and a
-- shop that does not cut stone should not have to remember to untick stone on
-- every template it ever publishes.
--
-- The two are combined where a design is opened, not here. Null means no
-- restriction, which is every shop that existed before this column did, and
-- is the answer most shops want.
--
-- Safe to re-run.

alter table public.shops
  add column if not exists allowed_materials text[];

comment on column public.shops.allowed_materials is
  'Finish ids this shop will build in at all; null means no restriction. Combined with design_templates.allowed_materials when a customer opens a design.';

-- ---------------------------------------------------------- the public view
--
-- Customers have to read it: the studio narrows its finish list to what the
-- shop stocks before anybody picks, and it cannot do that from a column only
-- the owner can see.
--
-- Recreated in full rather than altered, keeping the definition in one
-- readable place -- the same way 20260830000300 did when is_active arrived.
-- Every other column is carried forward unchanged; the only new one is at the
-- end, so a `select *` reader sees the same shape with one addition.
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
    map_url,
    allowed_materials
  from public.shops
  where status = 'approved' and is_active;

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- ------------------------------------------------------------------ check
--   select column_name from information_schema.columns
--    where table_name = 'shops_public' and column_name = 'allowed_materials';
--
-- And as a signed-in customer, a shop that has set a list should come back
-- with it:
--   select shop_name, allowed_materials from public.shops_public limit 5;
--
-- Nothing is written by this migration: every existing shop keeps a null
-- allowed_materials, which means unrestricted -- exactly how they behave now.
