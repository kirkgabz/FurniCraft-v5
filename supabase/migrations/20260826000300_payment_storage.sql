-- Storage for the direct-payment flow: a shop's QR image, and a customer's
-- downpayment receipt.
--
-- Both buckets are private and read through signed URLs, the same as
-- seller-documents. A receipt is a financial document and a QR reveals which
-- GCash or bank account a business collects into; neither belongs on a public
-- URL that never expires.
--
-- Paths
-- -----
--   shop-payment-qr   {shop_id}/qr_{timestamp}.{ext}
--   payment-receipts  {order_id}/receipt_{timestamp}.{ext}
--
-- The first path segment is the row the object belongs to, which is what the
-- policies below key on -- the same shape as seller-documents keying on
-- {user_id}. Putting the order id in the path is what lets the shop read a file
-- the customer uploaded without giving it a blanket grant over the bucket.

insert into storage.buckets (id, name, public)
values ('shop-payment-qr', 'shop-payment-qr', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------------ the QR
-- Owned by the shop: only its owner may write it.
drop policy if exists "shop_payment_qr_write_owner" on storage.objects;
create policy "shop_payment_qr_write_owner" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'shop-payment-qr'
    and exists (
      select 1 from public.shop_owner_requests r
      where r.id::text = (storage.foldername(name))[1]
        and r.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'shop-payment-qr'
    and exists (
      select 1 from public.shop_owner_requests r
      where r.id::text = (storage.foldername(name))[1]
        and r.user_id = auth.uid()
    )
  );

-- Readable by a customer who has an order with that shop. Deliberately not
-- "any signed-in user": the QR is shown at the point of paying, not browsed.
drop policy if exists "shop_payment_qr_read_customer" on storage.objects;
create policy "shop_payment_qr_read_customer" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shop-payment-qr'
    and exists (
      select 1 from public.design_orders o
      where o.shop_id::text = (storage.foldername(name))[1]
        and o.customer_user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------- the receipt
-- Written by the customer whose order it is, and only while that order is
-- theirs. The order id in the path is checked against the row, so a customer
-- cannot drop a file into someone else's order folder.
drop policy if exists "payment_receipts_write_customer" on storage.objects;
create policy "payment_receipts_write_customer" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'payment-receipts'
    and exists (
      select 1 from public.design_orders o
      where o.id::text = (storage.foldername(name))[1]
        and o.customer_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'payment-receipts'
    and exists (
      select 1 from public.design_orders o
      where o.id::text = (storage.foldername(name))[1]
        and o.customer_user_id = auth.uid()
    )
  );

-- Read by the shop that has to verify it against its own banking app.
drop policy if exists "payment_receipts_read_shop" on storage.objects;
create policy "payment_receipts_read_shop" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and exists (
      select 1 from public.design_orders o
      join public.shop_owner_requests r on r.id = o.shop_id
      where o.id::text = (storage.foldername(name))[1]
        and r.user_id = auth.uid()
    )
  );

-- Admins can see both, for moderating a payment dispute.
drop policy if exists "payment_objects_read_admin" on storage.objects;
create policy "payment_objects_read_admin" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('shop-payment-qr', 'payment-receipts')
    and public.is_admin()
  );

-- ------------------------------------------------------------------ check
--   select id, public from storage.buckets order by id;
-- A customer uploading into another customer's order folder should be refused
-- by payment_receipts_write_customer.
