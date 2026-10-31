-- A shop's price range, and a customer's budget held to it.
--
-- A shop states the lowest and highest price it builds for (Storefront
-- settings). Customers see it on the shop's page, and at checkout a budget
-- that does not reach into that range at all -- every figure below the shop's
-- lowest, or above its highest -- is sent back with a notice to adjust it.
-- A budget that overlaps the range is fine: the shop quotes within it.
--
-- Optional for the shop: a shop with no range set takes any budget, as
-- before. Both numbers or neither.
--
-- Run this in the Supabase SQL editor.

alter table public.shops
  add column if not exists price_range_min numeric(12, 2),
  add column if not exists price_range_max numeric(12, 2);

alter table public.shops drop constraint if exists shops_price_range_check;
alter table public.shops add constraint shops_price_range_check check (
  (price_range_min is null and price_range_max is null)
  or (price_range_min > 0 and price_range_max >= price_range_min)
);

comment on column public.shops.price_range_min is 'Lowest price the shop builds for, in pesos. Optional; set with price_range_max.';
comment on column public.shops.price_range_max is 'Highest price the shop builds for, in pesos. Optional; set with price_range_min.';

-- Customers read shops through shops_public; the two columns are added at the
-- end, everything else exactly as it was.
create or replace view public.shops_public as
 select id,
    user_id,
    shop_name,
    description,
    address,
    tagline,
    cover_image_url,
    gallery,
    phone,
    hours,
    policies,
    social_links,
    map_url,
    allowed_materials,
    logo_url,
    accepting_orders,
    (exists ( select 1
           from shop_subscriptions sub
          where sub.shop_id = shops.id and sub.tier = 'pro'::text and sub.period_end > now())) as is_pro,
    quick_answers,
    price_range_min,
    price_range_max
   from shops
  where status = 'approved'::text and is_active and suspended_at is null and not is_account_suspended(user_id);

grant select on public.shops_public to authenticated;

-- The same rule the checkout applies, held by the database: a new order's
-- budget must reach into the shop's range when the shop has one.
create or replace function public.guard_order_budget_in_shop_range()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  low numeric;
  high numeric;
begin
  if new.budget_min is null or new.budget_max is null then
    return new;
  end if;

  select price_range_min, price_range_max into low, high
  from public.shops where id = new.shop_id;

  if low is null or high is null then
    return new;
  end if;

  if new.budget_max < low or new.budget_min > high then
    raise exception 'Your budget does not match this shop''s price range (₱% to ₱%). Adjust your budget range and send again.',
      to_char(low, 'FM999,999,990'), to_char(high, 'FM999,999,990');
  end if;

  return new;
end;
$$;

revoke all on function public.guard_order_budget_in_shop_range() from public, anon, authenticated;

drop trigger if exists guard_order_budget_in_shop_range on public.design_orders;
create trigger guard_order_budget_in_shop_range
  before insert on public.design_orders
  for each row execute function public.guard_order_budget_in_shop_range();

-- ------------------------------------------------------------------ check
--   select shop_name, price_range_min, price_range_max from public.shops_public;
--   -- every shop: null, null until it sets a range
