-- Account suspensions: an admin can suspend any account -- customer or shop
-- owner -- for 30, 60 or 90 days, or permanently.
--
-- Its own table rather than a column on user_profiles: users may update their
-- own profile row, and Postgres policies cannot protect single columns, so a
-- suspension stored there could be cleared by the person suspended. Here only
-- an admin can write; the account itself may only read its own row (the app
-- reads it to show the "account suspended" page).
--
-- One row per account. suspended_until null means permanent. Lifting a
-- suspension deletes the row; an expired row simply stops counting.
--
-- Run this in the Supabase SQL editor.

create table if not exists public.account_suspensions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended_until timestamptz,
  reason text not null check (length(btrim(reason)) > 0),
  -- The ticket that led to it, when there was one.
  report_id uuid references public.reports (id) on delete set null,
  suspended_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.account_suspensions enable row level security;

drop policy if exists "account_suspensions_admin" on public.account_suspensions;
create policy "account_suspensions_admin" on public.account_suspensions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "account_suspensions_read_own" on public.account_suspensions;
create policy "account_suspensions_read_own" on public.account_suspensions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Whether an account is suspended right now. Security definer so policies on
-- other tables can ask without the caller needing to read this table.
create or replace function public.is_account_suspended(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.account_suspensions s
     where s.user_id = uid
       and (s.suspended_until is null or s.suspended_until > now())
  );
$$;

revoke all on function public.is_account_suspended(uuid) from public;
grant execute on function public.is_account_suspended(uuid) to authenticated, anon;

-- ------------------------------------------------------------- enforcement
-- The app sends a suspended account to the "account suspended" page, but the
-- database is what actually stops it acting: these restrictive policies are
-- ANDed with every existing policy, so a suspended account cannot place or
-- change orders, chat with shops, review, publish templates or edit a shop,
-- however it calls the API. Reading is untouched.

do $$
declare
  t text;
begin
  foreach t in array array['design_orders', 'order_offers', 'shop_messages', 'shop_reviews', 'design_templates', 'shops']
  loop
    execute format('drop policy if exists "not_suspended_insert" on public.%I', t);
    execute format(
      'create policy "not_suspended_insert" on public.%I as restrictive for insert to authenticated with check (not public.is_account_suspended((select auth.uid())))',
      t
    );
    execute format('drop policy if exists "not_suspended_update" on public.%I', t);
    execute format(
      'create policy "not_suspended_update" on public.%I as restrictive for update to authenticated using (not public.is_account_suspended((select auth.uid())))',
      t
    );
    execute format('drop policy if exists "not_suspended_delete" on public.%I', t);
    execute format(
      'create policy "not_suspended_delete" on public.%I as restrictive for delete to authenticated using (not public.is_account_suspended((select auth.uid())))',
      t
    );
  end loop;
end $$;

-- A suspended shop owner's shop leaves the customer-facing list while the
-- suspension lasts and comes back by itself when it ends. Same definition as
-- 20261020000100_shop_quick_answers (checked against the live view), with the
-- one extra condition at the end.
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
    ) as is_pro,
    quick_answers
   from shops
  where status = 'approved'::text and is_active and suspended_at is null
    and not public.is_account_suspended(user_id);

-- ------------------------------------------------------------------ check
-- As an admin:
--   insert into public.account_suspensions (user_id, suspended_until, reason)
--   values ('<a test account>', now() + interval '30 days', 'Test');
-- That account then sees the suspension page, and its shop (if any) is gone
-- from public.shops_public. Delete the row to lift it.
