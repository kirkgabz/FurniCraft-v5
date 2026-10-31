-- A shop can write an order for a customer who has messaged it.
--
-- Orders have only ever travelled one way: a customer designs a piece and
-- sends it to a workshop. A shop with a walk-in standing in front of it, or
-- one that has agreed a piece in chat, had nowhere to put that -- it could
-- only ask the customer to go and build the design themselves.
--
-- Two things make the other direction work.
--
-- The insert policy. design_orders_insert_customer requires
-- customer_user_id = auth.uid(), which is exactly right for an order someone
-- sends themselves and exactly wrong for one sent to them. The new policy
-- below lets the shop owner insert instead, and fences it in three ways:
--
--   * the shop must be theirs, and open, through shop_accepts_orders;
--   * the row must start at 'quoted' with a total and a downpayment, so the
--     customer's first move is to accept or decline something concrete
--     rather than wait for the shop to quote itself;
--   * the customer must already have messaged that shop. That is the
--     consent: a workshop can price what someone asked about, and cannot
--     push an order at a stranger. The EXISTS reads shop_messages under the
--     caller's own policies, which a shop owner passes for its own shop.
--
-- The notification, which lives in
-- 20261026095150_shop_written_order_notification.sql: the INSERT branch of
-- notify_design_order_change told the shop "New order received" on every
-- insert, which for a shop-written order means telling them about their own
-- work and leaving the customer with nothing.
--
-- The state machine itself needs no change: guard_design_order_columns is a
-- BEFORE UPDATE trigger, so it governs where an order may go, not where it
-- may start, and 'quoted' is already a state the customer can act on.

drop policy if exists "design_orders_insert_shop_owner" on public.design_orders;
create policy "design_orders_insert_shop_owner" on public.design_orders
  for insert to authenticated with check (
    customer_user_id <> ( select auth.uid() )
    and quoted_by = ( select auth.uid() )
    and status = 'quoted'
    and quoted_total is not null
    and downpayment_percent is not null
    and exists (
      select 1 from public.shops s
      where s.id = design_orders.shop_id and s.user_id = ( select auth.uid() )
    )
    and public.shop_accepts_orders(shop_id)
    and exists (
      select 1 from public.shop_messages m
      where m.shop_id = design_orders.shop_id
        and (m.sender_user_id = design_orders.customer_user_id
             or m.target_user_id = design_orders.customer_user_id)
    )
  );
-- ------------------------------------------------------------------ check
-- As a shop owner, for a customer who has messaged the shop:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the shop owner>","role":"authenticated"}';
--   insert into public.design_orders
--     (shop_id, customer_user_id, project_name, status, quoted_total,
--      downpayment_percent, quoted_by, quoted_at)
--   values ('<their shop>', '<a customer who messaged them>', 'probe',
--           'quoted', 5000, 50, '<the shop owner>', now());
--   rollback;
--
-- and the same must be refused (42501) for a customer who has never messaged
-- them, for another shop's id, and without a total.
