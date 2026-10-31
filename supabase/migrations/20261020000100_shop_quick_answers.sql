-- The shop's own answers to the chat's quick questions.
--
-- A customer's chat offers a fixed set of quick questions (lib/shop-assistant.ts,
-- QUICK_QUESTIONS). Tapping one shows the shop's written answer straight away,
-- so each shop writes them in the storefront editor, which requires all of them.
--
-- Stored as one JSON object keyed by question id, e.g. {"hours": "Mon-Sat 9-6"},
-- so adding a question later needs no migration. Every existing shop starts with
-- '{}' (no answers): the chat tells the customer the shop has not answered yet.
-- Adding a NOT NULL column with a constant default rewrites no rows.

alter table public.shops
  add column if not exists quick_answers jsonb not null default '{}'::jsonb;

alter table public.shops
  drop constraint if exists shops_quick_answers_shape;
alter table public.shops
  add constraint shops_quick_answers_shape
  check (jsonb_typeof(quick_answers) = 'object' and length(quick_answers::text) <= 20000);

comment on column public.shops.quick_answers is
  'Shop-written answers to the chat quick questions, keyed by question id (see QUICK_QUESTIONS).';

-- Customers read shops through shops_public, so the view gains the column at
-- the end. CREATE OR REPLACE keeps every existing column, grant and filter as
-- they were (definition as of 20261017000100_shops_public_is_pro).
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
    accepting_orders,
    exists (
      select 1
        from public.shop_subscriptions sub
       where sub.shop_id = shops.id
         and sub.tier = 'pro'
         and sub.period_end > now()
    ) as is_pro,
    quick_answers
   from shops
  where status = 'approved'::text and is_active and suspended_at is null;

-- ------------------------------------------------------------------ check
-- As any signed-in user:
--   select id, shop_name, quick_answers from public.shops_public;
-- Every shop listed before this migration is still listed, each with
-- quick_answers = {} until its owner saves the storefront.
