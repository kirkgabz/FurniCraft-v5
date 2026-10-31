-- Whether a shop is on FurniCraft Pro, readable by customers.
--
-- The shop page shows a "Pro" badge beside the shop's name. Customers cannot
-- read shop_subscriptions (its select policy is the owning shop and admins
-- only), and they should not: the row carries usage counters and dates that
-- are the shop's business. What they are shown is one yes/no, so that is all
-- this exposes.
--
-- Derived, never stored. Pro is `tier = 'pro'` with a period that has not
-- ended (see 20260910000100, which keeps no status column for the same
-- reason): a stored flag would need something to clear it the moment a
-- period lapses, and would show a lapsed shop as Pro for however late that
-- was. Computed here, the badge goes when the period does.
--
-- shops_public runs as its owner (no security_invoker), so the subquery reads
-- shop_subscriptions past its row policy -- that is what lets a customer see
-- the yes/no without being able to read the row behind it.
--
-- The view is otherwise the live definition exactly, including the
-- `suspended_at is null` filter, which the live database has and no earlier
-- migration in this repository adds. CREATE OR REPLACE appends the column
-- and keeps every existing column, grant and filter as they were.

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
    ) as is_pro
   from shops
  where status = 'approved'::text and is_active and suspended_at is null;

-- ------------------------------------------------------------------ check
-- As any signed-in user:
--   select id, shop_name, is_pro from public.shops_public;
-- is_pro is true exactly for shops whose shop_subscriptions row has
-- tier = 'pro' and period_end in the future, and every shop listed before
-- this migration is still listed.
