-- Reports become tickets: a category to file them under, and the context the
-- admin queue needs to show what a ticket is actually about.
--
-- Additive only. `category` is nullable with NO backfill, because every report
-- written before this one was a review report and can be read as such from its
-- target_type -- see categoryOf() in lib/report-topics.ts, which falls back to
-- exactly that. Backfilling would have meant rewriting rows to say something
-- the app can already work out, which is a worse trade than a nullable column.
--
-- Safe to re-run: every statement is guarded.

-- ------------------------------------------------------------- the category
alter table public.reports add column if not exists category text;

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check
  check (
    category is null
    or category in ('chat', 'payment', 'refund', 'order', 'review', 'shop')
  );

-- The queue's own query: one category's open tickets, newest first.
create index if not exists reports_category_created_idx
  on public.reports (category, created_at desc);

-- -------------------------------------------------------------- the context
-- A payment or refund ticket points at a design_order, and the admin has to
-- be able to read that order to judge it. Admins can already read reports;
-- without this they would see a complaint about an order they cannot open.
--
-- Deliberately narrow: not "an admin may read every order", but "an admin may
-- read an order somebody has actually reported". The exists() clause is the
-- whole point of the policy.
drop policy if exists "design_orders_select_admin_reported" on public.design_orders;
create policy "design_orders_select_admin_reported" on public.design_orders
  for select to authenticated
  using (
    public.is_admin()
    and exists (
      select 1 from public.reports r
      where r.target_type = 'design_order'
        and r.target_id = design_orders.id
    )
  );

-- ------------------------------------------------------------------- check
--   select category, count(*) from public.reports group by 1;
--   -- old rows read as null and are categorised from target_type in the app
--   select polname from pg_policies where tablename = 'design_orders';
