-- Lets an admin delete a shop outright.
--
-- READ THE CASCADE BEFORE USING IT.
--
-- Every one of these carries `on delete cascade` on shop_id, so removing one
-- row here removes all of them:
--
--   design_orders          every order ever placed with the shop
--   design_templates       every template it published
--   shop_reviews           every review customers left it
--   shop_messages          every conversation it had with a customer
--   shop_subscriptions     its Pro standing
--   subscription_payments  what it paid, and the proof it paid
--   shop_generations       its photo-to-3D usage
--
-- The first of those is the part worth stopping on: a customer's order is
-- their receipt. Deleting a shop destroys the record that a customer paid a
-- deposit, what was agreed, and what the shop said in the chat -- for every
-- customer it ever traded with, none of whom asked for their own history to
-- be erased. It cannot be undone and there is no backup of it in the app.
--
-- `shops.is_active = false` already exists and does the reversible version:
-- the shop disappears from the customer-facing directory (shops_public
-- filters on it) while every record of what it did stays intact. That is the
-- right tool for a shop behaving badly. This one is for a shop that should
-- never have existed -- a test account, a duplicate, an outright fake -- where
-- there is no real history to protect.
--
-- Admins only, and deliberately no policy for anyone else: a shop owner
-- cannot delete their own shop from under their customers' orders.
--
-- Safe to re-run.

drop policy if exists "shops_delete_admin" on public.shops;
create policy "shops_delete_admin" on public.shops
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------ check
--   select polname, cmd from pg_policies where tablename = 'shops';
--   -- expect shops_delete_admin with cmd = DELETE
--
-- Before deleting anything, count what would go with it:
--   select
--     (select count(*) from public.design_orders   where shop_id = '<shop>') as orders,
--     (select count(*) from public.shop_reviews    where shop_id = '<shop>') as reviews,
--     (select count(*) from public.design_templates where shop_id = '<shop>') as templates;
