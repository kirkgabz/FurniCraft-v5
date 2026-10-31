-- Lets a customer read the payment details of a shop they are actually buying
-- from, and nobody else.
--
-- Why not the obvious options
-- --------------------------
-- Adding the columns to shops_public would show every signed-in user which
-- GCash number each business collects into, just for browsing the directory.
-- Adding a SELECT policy on shop_owner_requests for "customers with an order"
-- would expose the whole row -- applicant email, BIR document paths, approval
-- state -- to get at four columns.
--
-- So: a function that returns only the four payment fields, and only when the
-- caller has an order with that shop. It is SECURITY DEFINER because it has to
-- read past the row policy on shop_owner_requests, and it is deliberately the
-- narrowest thing that can do that.
--
-- The QR image itself is a separate check: the storage policy in
-- 20260826000300_payment_storage.sql already restricts reading that object to a
-- customer with an order, so both halves agree.

create or replace function public.shop_payment_details(p_shop_id uuid)
returns table (
  payment_qr_url text,
  payment_instructions text,
  payment_account_name text,
  payment_account_number text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- No order with this shop, no payment details.
  if not exists (
    select 1 from public.design_orders o
    where o.shop_id = p_shop_id
      and o.customer_user_id = auth.uid()
  ) then
    return;
  end if;

  return query
    select r.payment_qr_url, r.payment_instructions, r.payment_account_name, r.payment_account_number
    from public.shop_owner_requests r
    where r.id = p_shop_id;
end;
$$;

revoke all on function public.shop_payment_details(uuid) from public, anon;
grant execute on function public.shop_payment_details(uuid) to authenticated;

-- ------------------------------------------------------------------ check
-- As a customer with an order, returns one row:
--   select * from public.shop_payment_details('<their shop>');
-- As anyone else, returns none.
