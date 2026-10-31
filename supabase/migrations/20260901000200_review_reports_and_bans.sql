-- Lets a shop owner report an abusive review, and gives admins a way to act
-- on it: remove the review, or ban the reviewer from posting new ones.
--
-- Reporting reuses the existing generic `reports` table (see
-- 20260825000800_reports.sql) rather than a new one -- the queue, the
-- reporter-sees-own-reports policy, and the "only an admin may moderate"
-- trigger all already do exactly what this needs. Only the target_type list
-- has to grow.

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('shop_message', 'shop', 'design_order', 'shop_review'));

-- The ban itself. A flag on the profile rather than a separate table: a
-- customer either can or can't post reviews right now, there is no history to
-- keep beyond what the resolved report already records.
alter table public.user_profiles
  add column if not exists reviews_banned boolean not null default false;

-- Enforced at the database, same as the completed-order rule next to it --
-- a banned customer's client could otherwise call the REST API directly and
-- post anyway. Upsert exercises insert on a first review and update on an
-- edit, so both policies need the check.
drop policy if exists "shop_reviews_insert_customer" on public.shop_reviews;
create policy "shop_reviews_insert_customer" on public.shop_reviews
  for insert to authenticated
  with check (
    customer_user_id = auth.uid()
    and not exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.reviews_banned
    )
    and exists (
      select 1 from public.design_orders o
      where o.shop_id = shop_reviews.shop_id
        and o.customer_user_id = auth.uid()
        and o.status = 'completed'
    )
  );

drop policy if exists "shop_reviews_update_own" on public.shop_reviews;
create policy "shop_reviews_update_own" on public.shop_reviews
  for update to authenticated
  using (customer_user_id = auth.uid())
  with check (
    customer_user_id = auth.uid()
    and not exists (
      select 1 from public.user_profiles p
      where p.id = auth.uid() and p.reviews_banned
    )
  );

-- ------------------------------------------------------------------ check
--   insert into public.reports (reporter_user_id, target_type, target_id, reason)
--   values (auth.uid(), 'shop_review', '<a review id>', 'Abusive language');
--   update public.user_profiles set reviews_banned = true where id = '<a customer>';
-- That customer's next insert/update against shop_reviews should then fail
-- with a row-level security policy violation.
