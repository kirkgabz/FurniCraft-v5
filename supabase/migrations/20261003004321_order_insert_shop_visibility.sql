-- Customers can send orders again.
--
-- What was broken
-- ---------------
-- design_orders_insert_customer, as 20260830000300_shop_deactivation.sql left
-- it, read:
--
--     customer_user_id = auth.uid()
--     and exists (
--       select 1 from public.shops r
--       where r.id = shop_id and r.status = 'approved' and r.is_active
--     )
--
-- The intent was right: an order may only be sent to a furniture shop that is
-- approved and still trading. The mistake is that a policy expression runs as
-- the querying role, so that EXISTS is itself filtered by the policies on
-- public.shops -- and the only SELECT policy there is
-- shop_owner_requests_select_own, "user_id = auth.uid() or is_admin()".
--
-- A customer therefore sees zero rows in public.shops, the EXISTS is false for
-- every furniture shop including a perfectly open one, and the insert is refused
-- with 42501. Verified against this project: signed in as an ordinary
-- customer, `select count(*) from public.shops` returns 0 while
-- `select count(*) from public.shops_public` returns 5. The browser only ever
-- showed "Something went wrong sending your order", because
-- components/order-summary-page.tsx logs the Postgres error and shows a
-- generic line.
--
-- The customer could not have avoided this. The shop picker lists
-- public.shops_public, which is exactly the approved and active set, so every
-- furniture shop offered was one the insert would then reject.
--
-- The fix
-- -------
-- A SECURITY DEFINER function answers the one question the policy needs, the
-- same shape as is_admin() above it: it runs as its owner, so it can see the
-- shops table, and it returns a boolean rather than any row. Opening
-- public.shops to customers instead was the alternative and is not acceptable
-- -- that table carries email, bir_document_url, valid_id_url and
-- payment_account_number, none of which belong to anyone but the owner and
-- the admins.
create or replace function public.shop_accepts_orders(shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shops r
    where r.id = shop and r.status = 'approved' and r.is_active
  );
$$;

-- Revoked from anon as well as public: Supabase grants EXECUTE on everything
-- in `public` to anon and authenticated, and those are separate ACL entries
-- that a revoke from public does not touch -- the lesson of
-- 20260825000400_lock_down_definer_functions.sql. `authenticated` keeps it
-- because the policy expression runs as the querying role.
revoke all on function public.shop_accepts_orders(uuid) from public, anon;
grant execute on function public.shop_accepts_orders(uuid) to authenticated;

drop policy if exists "design_orders_insert_customer" on public.design_orders;
create policy "design_orders_insert_customer" on public.design_orders
  for insert with check (
    customer_user_id = auth.uid()
    and public.shop_accepts_orders(shop_id)
  );

-- ------------------------------------------------------------------ check
-- As an ordinary customer, sending to an approved and active furniture shop should
-- now succeed, and sending to a rejected or deactivated one should still be
-- refused:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a customer>","role":"authenticated"}';
--   insert into public.design_orders
--     (shop_id, customer_user_id, project_name, budget_min, budget_max, status)
--   values ('<an approved shop>', '<the same customer>', 'probe', 1000, 2000, 'pending_quote');
--   -- and the same against a rejected shop, which must raise 42501
--   rollback;
