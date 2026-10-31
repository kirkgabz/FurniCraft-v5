-- Run this in the Supabase SQL editor for this project before using the
-- "select a shop" / "shop templates" / "create order" features.

-- 1. Persist which shop a customer has selected, so it survives reloads
--    and is visible to the furniture designer when it checks before
--    letting a customer send a design in as an order.
alter table public.user_profiles
  add column if not exists selected_shop_id uuid references public.shop_owner_requests(id) on delete set null;

-- 2. Design templates a shop owner publishes for customers who have
--    selected their shop.
create table if not exists public.design_templates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_owner_requests(id) on delete cascade,
  title text not null,
  description text,
  tag text,
  cad_state jsonb,
  preview_url text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.design_templates enable row level security;

drop policy if exists "design_templates_select_all" on public.design_templates;
create policy "design_templates_select_all" on public.design_templates
  for select using (auth.uid() is not null);

drop policy if exists "design_templates_insert_owner" on public.design_templates;
create policy "design_templates_insert_owner" on public.design_templates
  for insert with check (
    exists (
      select 1 from public.shop_owner_requests r
      where r.id = shop_id and r.user_id = auth.uid() and r.status = 'approved'
    )
  );

drop policy if exists "design_templates_update_owner" on public.design_templates;
create policy "design_templates_update_owner" on public.design_templates
  for update using (
    exists (select 1 from public.shop_owner_requests r where r.id = shop_id and r.user_id = auth.uid())
  );

drop policy if exists "design_templates_delete_owner" on public.design_templates;
create policy "design_templates_delete_owner" on public.design_templates
  for delete using (
    exists (select 1 from public.shop_owner_requests r where r.id = shop_id and r.user_id = auth.uid())
  );

-- 3. Orders a customer sends to their selected shop from the designer.
create table if not exists public.design_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_owner_requests(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id),
  project_name text not null,
  furniture_type text,
  estimated_price numeric,
  cad_state jsonb,
  preview_url text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.design_orders enable row level security;

drop policy if exists "design_orders_select_customer" on public.design_orders;
create policy "design_orders_select_customer" on public.design_orders
  for select using (customer_user_id = auth.uid());

drop policy if exists "design_orders_select_shop_owner" on public.design_orders;
create policy "design_orders_select_shop_owner" on public.design_orders
  for select using (
    exists (select 1 from public.shop_owner_requests r where r.id = shop_id and r.user_id = auth.uid())
  );

drop policy if exists "design_orders_insert_customer" on public.design_orders;
create policy "design_orders_insert_customer" on public.design_orders
  for insert with check (customer_user_id = auth.uid());

drop policy if exists "design_orders_update_shop_owner" on public.design_orders;
create policy "design_orders_update_shop_owner" on public.design_orders
  for update using (
    exists (select 1 from public.shop_owner_requests r where r.id = shop_id and r.user_id = auth.uid())
  );
