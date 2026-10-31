-- Three tap-to-answer prompts under "Tell us more (optional)", the same
-- pattern an app-store review uses below its free-text box. Each is its own
-- nullable column rather than a jsonb blob: there are exactly three of them,
-- fixed in meaning, and a column is what makes "how many said no to X" a plain
-- aggregate query instead of a jsonb-unpacking one.
--
-- All three stay optional forever -- a review needs only a star rating (see
-- shop_reviews.rating), never these.

alter table public.shop_reviews
  add column if not exists as_described text
    check (as_described in ('yes', 'no', 'unsure')),
  add column if not exists communication_clear text
    check (communication_clear in ('yes', 'no', 'unsure')),
  add column if not exists would_recommend text
    check (would_recommend in ('yes', 'no', 'unsure'));
