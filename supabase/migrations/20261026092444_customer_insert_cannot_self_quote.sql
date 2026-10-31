-- A customer may start an order, not price it.
--
-- design_orders_insert_customer checked only who was inserting and which shop
-- they were inserting against. It never looked at the status or the money, so
-- a customer could insert a row already at 'quoted' with quoted_total = 1 and
-- quoted_by set to themselves, then confirm it and owe a five-centavo
-- downpayment. Verified against this project before the change: that exact
-- insert was accepted, and is refused now.
--
-- The state machine did not catch it because guard_design_order_columns is a
-- BEFORE UPDATE trigger -- it governs where an order may go, never where it
-- may start.
--
-- A customer-sent order is always a request for a price, so the only status
-- it may be born in is 'pending_quote', with every quote and response column
-- still empty. That is exactly what components/order-summary-page.tsx sends,
-- so nothing legitimate changes.
--
-- The two ways an order may legitimately be born already priced both keep the
-- figures out of the browser's hands: a shop writing one directly goes through
-- design_orders_insert_shop_owner, and a shared link goes through
-- claim_order_offer, which runs as its owner and copies the figures from the
-- offer row.
drop policy if exists "design_orders_insert_customer" on public.design_orders;
create policy "design_orders_insert_customer" on public.design_orders
  for insert with check (
    customer_user_id = ( select auth.uid() )
    and status = 'pending_quote'
    and quoted_total is null
    and downpayment_percent is null
    and quoted_by is null
    and quoted_at is null
    and customer_response is null
    and payment_receipt_url is null
    and public.shop_accepts_orders(shop_id)
  );

-- ------------------------------------------------------------------ check
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a customer>","role":"authenticated"}';
--   -- must raise 42501:
--   insert into public.design_orders
--     (shop_id, customer_user_id, project_name, status, quoted_total,
--      downpayment_percent, quoted_by, quoted_at)
--   values ('<a shop>', '<the same customer>', 'probe', 'quoted', 1, 5,
--           '<the same customer>', now());
--   rollback;
