-- shop_owner_requests started as literally "a pending request to become a
-- shop owner" (status: pending/approved/rejected), but every feature added
-- since has landed on this same table: cover image, gallery, hours, payment
-- QR/instructions, policies, social links, map link, is_active. Every other
-- table that has a shop points at it by shop_id -- design_orders,
-- design_templates, shop_messages, shop_reviews, conversation_read_state,
-- user_profiles.selected_shop_id -- and shops_public sits on top of it. The
-- concept everyone actually uses is "a shop"; the name should say that.
--
-- A plain rename is safe here: Postgres tracks views, RLS policies, triggers,
-- and foreign keys by the table's OID, not its name, so all of those keep
-- working across the rename with no further changes on the database side.
-- The status/rejection_reason columns stay -- a shop's approval workflow is
-- still a real thing, just not the table's whole identity anymore.

alter table public.shop_owner_requests rename to shops;

-- ------------------------------------------------------------------ check
--   select * from public.shops limit 1;
--   select * from public.shops_public limit 1; -- view still resolves
--   select conname from pg_constraint where conrelid = 'public.design_orders'::regclass and conname like '%shop_id%';
--   -- still shows design_orders_shop_id_fkey, still valid
