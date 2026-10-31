-- A profile picture for both customers and shop owners. Stored inline as a
-- data URI, the same way an order/template preview already is -- an avatar is
-- small, cropped to a fixed square client-side before it ever reaches here,
-- and shown constantly (sidebars, chat, order cards), which is exactly the
-- case this app already uses inline images for rather than a storage bucket
-- with signed URLs.
alter table public.user_profiles
  add column if not exists avatar_url text;
