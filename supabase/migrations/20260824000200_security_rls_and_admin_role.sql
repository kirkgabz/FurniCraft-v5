-- Run this in the Supabase SQL editor AFTER deploying the matching application
-- code. It closes the data exposure on user_profiles and shop_owner_requests and
-- introduces a real admin role.
--
-- Before this migration, both tables were readable by anyone holding the
-- publishable key -- which ships inside the browser bundle -- so shop applicant
-- emails, and every user's name, phone and address, were effectively public.
-- Approval status was writable the same way, meaning any signed-in user could
-- approve their own shop by calling the REST API directly.
--
-- IMPORTANT: after running this, grant yourself admin (last section), or nobody
-- will be able to review shop applications.

-- ---------------------------------------------------------------- admin role
alter table public.user_profiles
  add column if not exists is_admin boolean not null default false;

-- SECURITY DEFINER so it can read user_profiles without re-entering that table's
-- own row-level policies, which would recurse. Kept STABLE so it is evaluated
-- once per statement rather than per row.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.user_profiles where id = auth.uid()), false);
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------- user_profiles
alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
  for select using (id = auth.uid() or public.is_admin());

-- Admins are included because approving a shop upserts the applicant's profile
-- to flip them to a shop owner, which inserts when no profile row exists yet.
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own" on public.user_profiles
  for insert with check (id = auth.uid() or public.is_admin());

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own" on public.user_profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- The app shows who it is talking to -- a customer's name on an order, a peer's
-- name in a conversation -- so names cannot be private to their owner without
-- every label collapsing to "Customer". This view exposes *only* id and name,
-- and deliberately runs with the definer's rights so it can read past the row
-- policy above; phone, address and admin status stay restricted to the owner.
create or replace view public.user_display_names as
  select id, full_name from public.user_profiles;

revoke all on public.user_display_names from anon;
grant select on public.user_display_names to authenticated;

-- ------------------------------------------------------- shop_owner_requests
alter table public.shop_owner_requests enable row level security;

drop policy if exists "shop_owner_requests_select_own" on public.shop_owner_requests;
create policy "shop_owner_requests_select_own" on public.shop_owner_requests
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "shop_owner_requests_insert_own" on public.shop_owner_requests;
create policy "shop_owner_requests_insert_own" on public.shop_owner_requests
  for insert with check (user_id = auth.uid());

-- Replaces the previous owner-update policy. Owners may still maintain their
-- storefront; approval state is protected by the trigger below rather than by
-- the policy, because row-level security cannot restrict individual columns.
drop policy if exists "shop_owner_requests_update_own" on public.shop_owner_requests;
create policy "shop_owner_requests_update_own" on public.shop_owner_requests
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- Approval is not the applicant's to grant. Any change to status or ownership
-- by a non-admin is rejected outright rather than silently ignored.
create or replace function public.guard_shop_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only an administrator may change a shop application''s status.';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'A shop application cannot be reassigned to another user.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_shop_request_status on public.shop_owner_requests;
create trigger guard_shop_request_status
  before update on public.shop_owner_requests
  for each row execute function public.guard_shop_request_status();

-- Customers browse approved shops. This projection is what they read: no
-- applicant email, no BIR/ID document paths, no rejected or pending rows.
create or replace view public.shops_public as
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
    hours
  from public.shop_owner_requests
  where status = 'approved';

revoke all on public.shops_public from anon;
grant select on public.shops_public to authenticated;

-- ------------------------------------------------------------------ storage
-- Seller documents are BIR registrations and government IDs, stored under a
-- per-user folder ("{user_id}/filename"). Only the uploader and admins may read.
drop policy if exists "seller_documents_own" on storage.objects;
create policy "seller_documents_own" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'seller-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'seller-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "seller_documents_admin_read" on storage.objects;
create policy "seller_documents_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'seller-documents' and public.is_admin());

-- ------------------------------------------------- anonymous access clean-up
-- RLS already denies these to anon (auth.uid() is null matches no policy);
-- revoking the grants as well means a future permissive policy cannot
-- accidentally re-expose them.
revoke all on public.user_profiles from anon;
revoke all on public.shop_owner_requests from anon;

-- --------------------------------------------------------- GRANT YOURSELF ADMIN
-- Replace the address below with the account that should administer the site,
-- then run it. Without this, /admin is inaccessible to everyone.
--
--   update public.user_profiles
--     set is_admin = true
--     where id = (select id from auth.users where email = 'you@example.com');
