-- Lets an admin see every order, and find the refunds that have stalled.
--
-- Until now an admin could read exactly the orders somebody had complained
-- about (design_orders_select_admin_reported, 20260914000100). That is the
-- wrong way round for the one table carrying money: a customer writing in
-- about an order stuck in production for two months has usually NOT filed a
-- report, and the admin had no way to look their order up at all.
--
-- READ ONLY, deliberately. No admin update policy is added here and none
-- should be. A refund is money moving directly between a customer and a shop
-- -- FurniCraft never holds it (see 20260831000200_order_refunds.sql) -- so an
-- admin who could set refund_status = 'refunded' would be recording a payment
-- nobody made, in the one place both parties would later point at. The admin
-- can see that a refund has sat in 'requested' for three weeks and chase the
-- shop; only the shop can say it has actually paid.
--
-- Safe to re-run: every statement is guarded.

-- ----------------------------------------------------------------- reading
drop policy if exists "design_orders_select_admin" on public.design_orders;
create policy "design_orders_select_admin" on public.design_orders
  for select to authenticated
  using (public.is_admin());

-- Superseded by the policy above, which covers every order rather than only
-- reported ones. Dropped rather than left in place: policies are OR'd, so a
-- narrower one alongside a wider one can never change the outcome, and a rule
-- that cannot change an outcome is one nobody can test or reason about.
drop policy if exists "design_orders_select_admin_reported" on public.design_orders;

-- ---------------------------------------------------------------- the list
-- The existing indexes are all shop- or customer-scoped -- (shop_id, created_at),
-- (customer_user_id, created_at), (shop_id, refund_status). An admin queries
-- across every shop at once, which none of those serve.

-- The default view: newest orders first, platform-wide.
create index if not exists design_orders_created_idx
  on public.design_orders (created_at desc);

-- The refund queue: every outstanding refund on the platform, oldest first,
-- because the oldest is the one that has been waiting longest. Partial, so it
-- indexes only the handful of rows that have a refund at all rather than the
-- whole table.
create index if not exists design_orders_refund_open_idx
  on public.design_orders (refund_requested_at)
  where refund_status is not null;

-- ------------------------------------------------------------------ check
--   select polname, cmd from pg_policies where tablename = 'design_orders';
--   -- expect design_orders_select_admin, and NO design_orders_select_admin_reported
--   select refund_status, count(*) from public.design_orders group by 1;
-- As a non-admin, selecting another account's order should still return nothing.
