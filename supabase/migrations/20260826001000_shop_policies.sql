-- Shop policies: the terms a shop wants a customer to have read before ordering.
--
-- Deposits, lead times, what happens to a custom piece if the customer changes
-- their mind -- these were being typed into chat one customer at a time, which
-- is both work and a weak record. A shop states them once on its storefront,
-- and the customer sees them before they send a design.
--
-- Free text rather than a set of structured fields. Every furniture shop's terms are
-- different, and guessing at the schema of "a policy" would either be wrong or
-- turn into a form nobody finishes. The UI renders it as paragraphs.

alter table public.shop_owner_requests
  add column if not exists policies text;

comment on column public.shop_owner_requests.policies is
  'Shop-authored terms shown on the storefront: deposits, lead times, cancellations, warranty.';

-- A cap, so one shop cannot push a megabyte of text into every customer's
-- shop list. Generous enough that a real policy never hits it.
alter table public.shop_owner_requests
  drop constraint if exists shop_owner_requests_policies_length;
alter table public.shop_owner_requests
  add constraint shop_owner_requests_policies_length
  check (policies is null or char_length(policies) <= 4000);

-- ---------------------------------------------------------------- the view
-- shops_public is what every customer-facing read goes through; the base table
-- is restricted to its owner and to admins. Recreated in full rather than
-- patched, because `create or replace view` cannot add a column in the middle
-- and the column order here is the one the app selects by name anyway.
--
-- Still a definer view for the same reason as before -- it exists to read past
-- RLS so customers can see approved shops -- and still SELECT-only, which
-- 20260825000300 enforced by revoking writes.
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
    policies
  from public.shop_owner_requests
  where status = 'approved';

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- ------------------------------------------------------------------ check
-- The column is writable only by the shop's own owner, through the existing
-- update policy on shop_owner_requests. As a different signed-in user:
--   update public.shop_owner_requests set policies = 'mine now' where id = '<someone else>';
--   -- expect: 0 rows
--
-- And the cap:
--   update public.shop_owner_requests set policies = repeat('x', 4001) where id = '<your shop>';
--   -- expect: 23514 shop_owner_requests_policies_length
