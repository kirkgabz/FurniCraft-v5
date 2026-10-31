-- The Pro subscription costs ₱599 a month, not ₱499.
--
-- The Cost-Benefit Analysis (Chapter 3) tested ₱299, ₱499, ₱599 and ₱799
-- against the platform's costs. At ₱499 the full cost of ownership is covered
-- at 14 subscribed shops under ordinary use, but if every shop used its
-- fifteen generations and three retries to the limit, no number of shops a
-- single Meshy Ultra plan can serve would cover it. At ₱599 the full cost is
-- covered at 12 shops under ordinary use and at 21 under that heaviest use,
-- for about ₱30 per custom order at a furniture shop taking twenty a month.
--
-- The price is an admin setting (Admin > Subscriptions), so only the
-- untouched default is moved: a price an admin has already chosen stays.
--
-- Safe to re-run.

alter table public.platform_settings
  alter column pro_price_php set default 599;

update public.platform_settings
  set pro_price_php = 599, updated_at = now()
  where pro_price_php = 499;
