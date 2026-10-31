-- Where else a shop can be found: Facebook, Instagram, TikTok, a website.
--
-- For a lot of Philippine furniture makers the Facebook page *is* the shop --
-- it has the back catalogue, the reviews and the years of history that a new
-- FurniCraft storefront does not. Refusing to link out does not keep those
-- customers here; it just makes the storefront look thinner than the business.
--
-- Shape: an array of {label, url}, not a column per platform. A fixed set of
-- columns is a guess about which networks matter, and it is wrong within a year
-- -- Viber and Shopee are as likely as Instagram here. The label carries the
-- name and the client picks an icon by recognising the host.

alter table public.shop_owner_requests
  add column if not exists social_links jsonb not null default '[]'::jsonb;

comment on column public.shop_owner_requests.social_links is
  'Array of {label, url} the shop wants customers to be able to follow off-site.';

-- ------------------------------------------------------------------ the guard
-- These are rendered as anchors on a page other people load, so the scheme is
-- not the client's to decide. `javascript:` in an href is script execution on
-- the viewer's session, and a row-level policy cannot restrict a column's
-- *contents* -- only a trigger can.
--
-- Everything here is checked again in the UI, which is where a friendly message
-- belongs. This is the half that holds against a direct REST call.
create or replace function public.guard_shop_social_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  link_url text;
  link_label text;
begin
  if new.social_links is null then
    new.social_links := '[]'::jsonb;
    return new;
  end if;

  if jsonb_typeof(new.social_links) <> 'array' then
    raise exception 'social_links must be an array of {label, url} objects.';
  end if;

  if jsonb_array_length(new.social_links) > 8 then
    raise exception 'A shop may list at most 8 links.';
  end if;

  for entry in select * from jsonb_array_elements(new.social_links)
  loop
    if jsonb_typeof(entry) <> 'object' then
      raise exception 'Each link must be an object with a label and a url.';
    end if;

    link_url := entry->>'url';
    link_label := entry->>'label';

    if link_url is null or length(btrim(link_url)) = 0 then
      raise exception 'A link needs a url.';
    end if;

    -- http and https only. Anchored and case-insensitive, so neither
    -- "JavaScript:" nor " javascript:" slips past.
    if btrim(link_url) !~* '^https?://[^[:space:]]+$' then
      raise exception 'Link % must start with http:// or https://', link_url;
    end if;

    if length(link_url) > 500 then
      raise exception 'That link is too long.';
    end if;

    if link_label is not null and length(link_label) > 60 then
      raise exception 'A link label may be at most 60 characters.';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.guard_shop_social_links() from public, anon, authenticated;

drop trigger if exists guard_shop_social_links on public.shop_owner_requests;
create trigger guard_shop_social_links
  before insert or update on public.shop_owner_requests
  for each row execute function public.guard_shop_social_links();

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
    social_links
  from public.shop_owner_requests
  where status = 'approved';

revoke all on public.shops_public from anon, authenticated;
grant select on public.shops_public to authenticated;

-- ------------------------------------------------------------------ check
-- As the shop's own owner, each of these must be refused:
--   update public.shop_owner_requests
--     set social_links = '[{"label":"x","url":"javascript:alert(1)"}]'::jsonb where id = '<your shop>';
--   update public.shop_owner_requests
--     set social_links = '[{"label":"x","url":"/relative"}]'::jsonb where id = '<your shop>';
--   update public.shop_owner_requests set social_links = '"nope"'::jsonb where id = '<your shop>';
-- And this must be accepted:
--   update public.shop_owner_requests
--     set social_links = '[{"label":"Facebook","url":"https://facebook.com/example"}]'::jsonb
--     where id = '<your shop>';
