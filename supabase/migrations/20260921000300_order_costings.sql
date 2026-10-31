-- A shop's private cost sheet for one order.
--
-- Why this is its own table
-- -------------------------
-- The obvious place is a jsonb column on design_orders. It must not go there.
-- `design_orders_select_customer` lets a customer read their own order row in
-- full, so a costing column on that table would hand every customer the shop's
-- timber cost, its labour rate and the margin it is taking on their piece, in
-- the same query the order page already makes. Nothing in the app would show
-- it and it would be one request away the whole time.
--
-- So: a separate table whose only policies are the shop owner's. No customer
-- policy and no admin policy, deliberately -- an admin investigating a refund
-- needs the quoted total and what was paid, both of which are on design_orders
-- and already readable. What a shop pays its supplier is not part of that
-- dispute, and a table nobody else can read cannot leak through a screen
-- somebody adds later without noticing.
--
-- What is stored, and what is not
-- ------------------------------
-- The lines the owner typed, and nothing computed from them. Totals, profit
-- and margin are worked out where they are shown, so they cannot go stale
-- against the lines they claim to summarise, and the quoted total stays the
-- one on design_orders rather than a second copy here that could disagree
-- with what the customer was actually sent.
--
-- Safe to re-run.

create table if not exists public.order_costings (
  -- One sheet per order, so the order id is the key. A shop reopening an
  -- order gets the sheet it left rather than a second blank one.
  order_id uuid primary key references public.design_orders(id) on delete cascade,
  -- Carried so the policies below are a single join. Kept honest by the
  -- trigger further down rather than trusted from the client.
  shop_id uuid not null references public.shops(id) on delete cascade,
  /*
   * [{ id, label, qty, unitCost }]. Free-form labels: a rattan weaver and a
   * hardwood joiner do not have the same cost headings, and a fixed set of
   * columns would have them filing everything under "Other".
   */
  lines jsonb not null default '[]'::jsonb,
  -- The markup the owner was working to when they last saved, so reopening
  -- the sheet shows the same suggested price rather than a default.
  markup_percent numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.order_costings is
  'A shop''s private working-out of what one order costs it. Readable only by the shop that owns the order -- never by the customer, and never by an admin.';

alter table public.order_costings enable row level security;

-- ------------------------------------------------------------- the owner only
--
-- Written out per command rather than as `for all`, so each one can be read on
-- its own and none of them quietly covers more than it says.

drop policy if exists "order_costings_select_shop" on public.order_costings;
create policy "order_costings_select_shop" on public.order_costings
  for select to authenticated
  using (
    exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid())
  );

drop policy if exists "order_costings_insert_shop" on public.order_costings;
create policy "order_costings_insert_shop" on public.order_costings
  for insert to authenticated
  with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid())
  );

drop policy if exists "order_costings_update_shop" on public.order_costings;
create policy "order_costings_update_shop" on public.order_costings
  for update to authenticated
  using (
    exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid())
  );

drop policy if exists "order_costings_delete_shop" on public.order_costings;
create policy "order_costings_delete_shop" on public.order_costings
  for delete to authenticated
  using (
    exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid())
  );

-- ------------------------------------------------- shop_id cannot be borrowed
--
-- The policies above trust shop_id, and the client supplies it. Without this a
-- shop owner could insert a sheet against somebody else's order by passing
-- their own shop_id with a stranger's order_id -- the check would pass, and the
-- row would sit on an order they have nothing to do with. So the server
-- derives it from the order instead of taking the client's word.
create or replace function public.order_costing_shop_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_shop uuid;
begin
  select o.shop_id into owning_shop from public.design_orders o where o.id = new.order_id;
  if owning_shop is null then
    raise exception 'No such order.';
  end if;
  new.shop_id := owning_shop;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_costing_shop_matches on public.order_costings;
create trigger order_costing_shop_matches
  before insert or update on public.order_costings
  for each row execute function public.order_costing_shop_matches();

create index if not exists order_costings_shop_idx on public.order_costings (shop_id);

-- ------------------------------------------------------------------ check
--   select polname, cmd from pg_policies where tablename = 'order_costings';
--   -- expect four rows, all of them order_costings_*_shop
--
-- As the customer on an order, this must return nothing:
--   select * from public.order_costings where order_id = '<their order>';
--
-- And the trigger should refuse to be lied to -- inserting with someone
-- else's shop_id stores the order's real shop, not the one passed in.
