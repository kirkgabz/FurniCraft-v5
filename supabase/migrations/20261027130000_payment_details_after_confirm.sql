-- A shop's payment details reach a customer only after they accept a quote.
--
-- Until now "has an order with this shop" was enough: a customer could send a
-- design, wait for any quote, and read the shop's GCash number, account name and
-- QR before agreeing to anything -- or without ever meaning to buy. The details
-- are only needed to pay the downpayment, and there is no downpayment until the
-- quote is confirmed.
--
-- So both halves now ask for an accepted order: one that has reached
-- 'confirmed' or any step after it. A declined order does not count; there is
-- nothing to pay on it.
--
--   shop_payment_details()          the account name, number and instructions
--   shop_payment_qr_read_customer   the QR image in storage
--
-- Hiding the card in the app alone would not do this: the function and the
-- storage object are callable directly with the customer's own session.
--
-- Run this in the Supabase SQL editor.

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
  -- No accepted quote with this shop, no payment details.
  if not exists (
    select 1 from public.design_orders o
    where o.shop_id = p_shop_id
      and o.customer_user_id = auth.uid()
      and o.status in ('confirmed', 'payment_submitted', 'in_production', 'completed')
  ) then
    return;
  end if;

  return query
    select s.payment_qr_url, s.payment_instructions, s.payment_account_name, s.payment_account_number
    from public.shops s
    where s.id = p_shop_id;
end;
$$;

revoke all on function public.shop_payment_details(uuid) from public, anon;
grant execute on function public.shop_payment_details(uuid) to authenticated;

drop policy if exists "shop_payment_qr_read_customer" on storage.objects;
create policy "shop_payment_qr_read_customer" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shop-payment-qr'
    and exists (
      select 1 from public.design_orders o
      where o.shop_id::text = (storage.foldername(name))[1]
        and o.customer_user_id = auth.uid()
        and o.status in ('confirmed', 'payment_submitted', 'in_production', 'completed')
    )
  );

-- ------------------------------------------------------------------ check
-- As a customer whose only order with a shop is 'quoted':
--   select * from public.shop_payment_details('<that shop>');   -- no rows
-- After confirming that quote, the same call returns one row.
