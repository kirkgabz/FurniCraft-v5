-- A logo for each shop.
--
-- Shops were told apart only by their name and a cover photo, and on the
-- small surfaces where a shop appears most (the Shops list, the chat list, a
-- template's "by ..." line) the cover crops to a meaningless square. A logo
-- reads at 40px. Empty for every shop at first: the pages draw the shop's
-- initials in its place until one is uploaded.
--
-- Stored like the cover photo: a downscaled data URL written by the
-- storefront editor (256px, see LOGO_IMAGE_OPTIONS). The check keeps a
-- runaway upload from bloating every row that reads shops_public.

alter table public.shops
  add column if not exists logo_url text;

alter table public.shops
  drop constraint if exists shops_logo_url_size;
alter table public.shops
  add constraint shops_logo_url_size check (logo_url is null or length(logo_url) <= 200000);

comment on column public.shops.logo_url is
  'Shop logo as a downscaled image data URL (256px). Null: pages show the shop''s initials.';

-- The public view gains the column at the end; CREATE OR REPLACE keeps the
-- existing columns, grants and filter exactly as they were.
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
    logo_url
   from shops
  where status = 'approved'::text and is_active;
