-- Where the shop actually is, as a link the owner controls.
--
-- The address column is prose -- "Tinuigiban Heights, PPC" -- which is enough to
-- read and not enough to travel to. Geocoding it would be a guess, and a wrong
-- pin on a furniture shop that takes deposits is worse than no pin at all. So the
-- owner pastes the link from Google Maps for their own place, which is the one
-- source that is certain to be right.
--
-- Deliberately a link rather than a lat/lng pair: the owner already has the URL
-- in their address bar, and storing coordinates would mean asking a furniture
-- maker for a decimal degree.

alter table public.shop_owner_requests
  add column if not exists map_url text;

comment on column public.shop_owner_requests.map_url is
  'Owner-provided map link for the shop address, opened from the storefront.';

-- Rendered as an anchor on a page other people load, so the scheme is not the
-- client''s to choose: javascript: in an href is script execution on the
-- viewer''s session. A CHECK is enough here because this is a plain column --
-- social_links needed a trigger only because a jsonb array cannot be
-- constrained this way.
alter table public.shop_owner_requests
  drop constraint if exists shop_owner_requests_map_url_scheme;
alter table public.shop_owner_requests
  add constraint shop_owner_requests_map_url_scheme
  check (
    map_url is null
    or (map_url ~* '^https?://[^[:space:]]+$' and char_length(map_url) <= 800)
  );

-- ---------------------------------------------------------------- the view
-- Recreated in full: `create or replace view` cannot add a column, and every
-- customer-facing read goes through here rather than the base table.
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
  where status = 'approved';

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- ------------------------------------------------------------------ check
-- As the shop's own owner, each of these must be refused:
--   update public.shop_owner_requests set map_url = 'javascript:alert(1)' where id = '<your shop>';
--   update public.shop_owner_requests set map_url = 'maps.app.goo.gl/x' where id = '<your shop>';
-- And this must be accepted:
--   update public.shop_owner_requests set map_url = 'https://maps.app.goo.gl/x' where id = '<your shop>';
