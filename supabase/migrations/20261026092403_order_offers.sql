-- An order a shop has written but nobody owns yet.
--
-- A shop can already write an order straight to a customer it has been
-- messaging (design_orders_insert_shop_owner). This is the other half: an
-- offer with no customer at all, shared as a link, which becomes a real
-- order when whoever opens it signs in and takes it.
--
-- A separate table rather than a nullable customer on design_orders. Every
-- policy, trigger and constraint on that table assumes an order has a
-- customer -- the state-machine guard reads old.customer_user_id, the
-- notifications address it, the storage policies key receipts on it -- and
-- loosening that for a row which is not yet an order would mean auditing all
-- of them for a case none of them were written for.
create table if not exists public.order_offers (
  id uuid primary key default gen_random_uuid(),
  -- What the link carries. Random rather than the row id, so a link can be
  -- thrown away without the offer being guessable from the one before it.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  project_name text not null,
  furniture_type text,
  cad_state jsonb,
  preview_url text,
  -- Generated models live in storage; the public page hands out a short
  -- signed URL rather than the path itself.
  model_path text,
  quoted_total numeric not null check (quoted_total >= 0),
  downpayment_percent numeric not null
    check (downpayment_percent >= 5 and downpayment_percent <= 100),
  notes text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  claimed_order_id uuid references public.design_orders(id) on delete set null,
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz,
  -- Claimed is all three or none of them; half a claim would leave a link
  -- that is neither usable nor accounted for.
  constraint order_offers_claim_whole check (
    (claimed_order_id is null and claimed_by is null and claimed_at is null)
    or (claimed_order_id is not null and claimed_by is not null and claimed_at is not null)
  )
);

create index if not exists order_offers_shop_idx on public.order_offers (shop_id, created_at desc);
create index if not exists order_offers_claimed_order_idx on public.order_offers (claimed_order_id);
create index if not exists order_offers_claimed_by_idx on public.order_offers (claimed_by);

alter table public.order_offers enable row level security;

-- Only the shop that wrote it. The public page does not read this table as
-- the visitor: it reads with the secret key on the server and applies the
-- customer-facing rules itself, the same way app/t/[templateId] does for a
-- shared template.
drop policy if exists "order_offers_select_shop" on public.order_offers;
create policy "order_offers_select_shop" on public.order_offers
  for select using (
    exists (
      select 1 from public.shops s
      where s.id = order_offers.shop_id and s.user_id = ( select auth.uid() )
    )
  );

drop policy if exists "order_offers_insert_shop" on public.order_offers;
create policy "order_offers_insert_shop" on public.order_offers
  for insert with check (
    created_by = ( select auth.uid() )
    and claimed_order_id is null
    and exists (
      select 1 from public.shops s
      where s.id = order_offers.shop_id and s.user_id = ( select auth.uid() )
    )
    and public.shop_accepts_orders(shop_id)
  );

-- Revoking a link is a delete, and only while it is still unclaimed: an
-- offer already taken stays as the record of what was agreed. There is no
-- update policy at all, which is why claiming is claim_order_offer's job --
-- nobody gets to edit the price after the fact.
drop policy if exists "order_offers_delete_shop" on public.order_offers;
create policy "order_offers_delete_shop" on public.order_offers
  for delete using (
    claimed_order_id is null
    and exists (
      select 1 from public.shops s
      where s.id = order_offers.shop_id and s.user_id = ( select auth.uid() )
    )
  );
