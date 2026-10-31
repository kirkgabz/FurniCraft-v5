-- Run this in the Supabase SQL editor after the design-templates-and-orders
-- migration. Adds the storefront fields a shop owner fills in and customers
-- browse: a cover photo, a photo gallery, and the contact details shown on the
-- shop detail card.

alter table public.shop_owner_requests
  add column if not exists tagline text,
  add column if not exists cover_image_url text,
  add column if not exists gallery jsonb not null default '[]'::jsonb,
  add column if not exists phone text,
  add column if not exists hours text;

-- Gallery entries are objects: [{ "url": "...", "caption": "..." }, ...].
-- Images are stored as downscaled data URLs, matching how design_orders already
-- stores reference_images. If a shop ever needs many large photos, move these to
-- Supabase Storage and keep only the public URL here -- the column type does not
-- need to change for that.

-- Let an approved shop owner maintain their own storefront row.
--
-- NOTE: this policy is intentionally scoped to the owner's own row. It does not
-- attempt to restrict *which columns* they may write, because Postgres row-level
-- security cannot express that. Approval state therefore still needs to be
-- protected at the application layer -- see the security note in the project
-- README before relying on `status` as a trust boundary.
drop policy if exists "shop_owner_requests_update_own" on public.shop_owner_requests;
create policy "shop_owner_requests_update_own" on public.shop_owner_requests
  for update using (user_id = auth.uid());
