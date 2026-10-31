-- How a shop prices: its formula, set once.
--
-- The cost sheet knew one way to turn cost into a price -- a markup
-- percentage, typed on every order. Shops do not all work like that. Sir Mark
-- adds up materials, labour and miscellaneous and doubles it; another doubles
-- materials and charges labour at cost. The formula is now one of three
-- (components/orders/pricing.ts):
--
--   {"method": "markup",    "percent": 35}
--   {"method": "multiply",  "factor": 2}
--   {"method": "per_group", "factors": {"Materials": 2, "Labour": 1.5}, "otherFactor": 1}
--
-- set here per shop, and overridable on a single order in
-- order_costings.formula. breakdown_view is what "Use as quote" lists for the
-- customer: one line per group, or every cost line.
--
-- Private, like order_costings and for the same reason (see
-- 20260921000300_order_costings.sql): a multiplier is the shop's margin. Owner
-- policies only -- no customer, no admin, and not in shops_public.
--
-- Safe to re-run.

create table if not exists public.shop_pricing (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  formula jsonb not null
    constraint shop_pricing_formula_shape
    check (jsonb_typeof(formula) = 'object' and formula ->> 'method' in ('markup', 'multiply', 'per_group')),
  breakdown_view text not null default 'groups'
    constraint shop_pricing_breakdown_view
    check (breakdown_view in ('groups', 'lines')),
  updated_at timestamptz not null default now()
);

comment on table public.shop_pricing is
  'A shop''s pricing formula and how its quote breakdowns are listed. Readable only by the shop''s owner.';

alter table public.shop_pricing enable row level security;

drop policy if exists "shop_pricing_select_owner" on public.shop_pricing;
create policy "shop_pricing_select_owner" on public.shop_pricing
  for select to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid()));

drop policy if exists "shop_pricing_insert_owner" on public.shop_pricing;
create policy "shop_pricing_insert_owner" on public.shop_pricing
  for insert to authenticated
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid()));

drop policy if exists "shop_pricing_update_owner" on public.shop_pricing;
create policy "shop_pricing_update_owner" on public.shop_pricing
  for update to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.shops s where s.id = shop_id and s.user_id = auth.uid()));

-- One order priced differently from the shop's usual way. Null: the shop's
-- formula applies (or, on a sheet saved before formulas, its markup_percent).
alter table public.order_costings
  add column if not exists formula jsonb;

alter table public.order_costings
  drop constraint if exists order_costings_formula_shape;
alter table public.order_costings
  add constraint order_costings_formula_shape
  check (formula is null or (jsonb_typeof(formula) = 'object' and formula ->> 'method' in ('markup', 'multiply', 'per_group')));
