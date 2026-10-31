-- Shop reviews: 1-5 stars and a comment, only from customers who actually
-- bought something.
--
-- The "must have a completed order" rule is enforced in the INSERT policy, not
-- in the UI. A review is a public claim about a business, so the check has to
-- hold against someone calling the REST API directly with the publishable key.

create table if not exists public.shop_reviews (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shop_owner_requests(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One review per customer per shop; editing replaces it rather than stacking.
  unique (shop_id, customer_user_id)
);

create index if not exists shop_reviews_shop_idx
  on public.shop_reviews (shop_id, created_at desc);

alter table public.shop_reviews enable row level security;

-- Reviews are visible to any signed-in user: that is the point of them. anon
-- gets nothing, consistent with every other table here.
drop policy if exists "shop_reviews_select_authenticated" on public.shop_reviews;
create policy "shop_reviews_select_authenticated" on public.shop_reviews
  for select to authenticated using (true);

-- The rule from the brief, in the database: you may only review a shop you have
-- a completed order with. `exists` runs as the calling user, so it is subject to
-- design_orders' own policies -- which is fine, because the customer can always
-- see their own orders.
drop policy if exists "shop_reviews_insert_customer" on public.shop_reviews;
create policy "shop_reviews_insert_customer" on public.shop_reviews
  for insert to authenticated
  with check (
    customer_user_id = auth.uid()
    and exists (
      select 1 from public.design_orders o
      where o.shop_id = shop_reviews.shop_id
        and o.customer_user_id = auth.uid()
        and o.status = 'completed'
    )
  );

drop policy if exists "shop_reviews_update_own" on public.shop_reviews;
create policy "shop_reviews_update_own" on public.shop_reviews
  for update to authenticated
  using (customer_user_id = auth.uid())
  with check (customer_user_id = auth.uid());

drop policy if exists "shop_reviews_delete_own" on public.shop_reviews;
create policy "shop_reviews_delete_own" on public.shop_reviews
  for delete to authenticated
  using (customer_user_id = auth.uid() or public.is_admin());

revoke all on public.shop_reviews from anon, authenticated;
grant select, insert, update, delete on public.shop_reviews to authenticated;

-- Keeps updated_at honest without the client having to remember.
create or replace function public.touch_shop_review()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_shop_review on public.shop_reviews;
create trigger touch_shop_review
  before update on public.shop_reviews
  for each row execute function public.touch_shop_review();

-- --------------------------------------------------------------- aggregate
-- Average and count per shop, for the star line on a shop card.
--
-- security_invoker is on deliberately. The two existing views
-- (user_display_names, shops_public) run with definer rights because they have
-- to read past RLS; this one does not -- shop_reviews is readable by every
-- signed-in user already. Leaving it as a definer view would add a third
-- `security_definer_view` finding to the linter for no reason.
create or replace view public.shop_ratings
with (security_invoker = on) as
  select
    shop_id,
    round(avg(rating)::numeric, 2) as average_rating,
    count(*)::int as review_count
  from public.shop_reviews
  group by shop_id;

revoke all on public.shop_ratings from anon, authenticated;
grant select on public.shop_ratings to authenticated;

-- ------------------------------------------------------------------ check
-- Should refuse, for a shop you have no completed order with:
--   insert into public.shop_reviews (shop_id, customer_user_id, rating)
--   values ('<some shop>', auth.uid(), 5);
