-- Pro subscriptions, end to end: the price, where shops pay, one claim at a
-- time, renewals that extend rather than restart, and an admin grant.
--
-- 20260910000100 built the ledger and the verdict functions but gave them
-- nothing to work with: no price was set anywhere, nothing told a shop where
-- to pay, and approving a renewal restarted the period from the day of
-- approval -- so a shop that paid a week early lost that week.

-- ------------------------------------------------------ platform settings
-- One row. The price and the QR the platform is paid through are things an
-- admin changes, not constants a deploy has to ship.

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  pro_price_php numeric(10, 2) not null default 499 check (pro_price_php > 0),
  -- Object path in the platform-assets bucket. Null until an admin uploads
  -- one, and the upgrade card says so rather than showing a broken image.
  payment_qr_path text,
  payment_account_name text,
  payment_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- Every signed-in shop needs the price and the QR to pay at all.
drop policy if exists "platform_settings_read" on public.platform_settings;
create policy "platform_settings_read" on public.platform_settings
  for select to authenticated using (true);

drop policy if exists "platform_settings_admin_update" on public.platform_settings;
create policy "platform_settings_admin_update" on public.platform_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, delete on public.platform_settings from anon, authenticated;
grant select, update on public.platform_settings to authenticated;

-- Private, like every other bucket here: read through short-lived links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('platform-assets', 'platform-assets', false, 5242880)
on conflict (id) do nothing;

drop policy if exists "platform_assets_read" on storage.objects;
create policy "platform_assets_read" on storage.objects
  for select to authenticated using (bucket_id = 'platform-assets');

drop policy if exists "platform_assets_admin_write" on storage.objects;
create policy "platform_assets_admin_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'platform-assets' and public.is_admin())
  with check (bucket_id = 'platform-assets' and public.is_admin());

-- ------------------------------------------------------- what a shop owes
-- The platform's price, not whatever the browser sent. A shop files the
-- claim; the amount on it is filled in here. Admin grants go through
-- grant_pro and record their own (zero) amount.

create or replace function public.price_subscription_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.amount is null or not public.is_admin() then
    select s.pro_price_php into new.amount from public.platform_settings s where s.id;
  end if;
  return new;
end;
$$;

revoke all on function public.price_subscription_payment() from public, anon, authenticated;

drop trigger if exists subscription_payments_price on public.subscription_payments;
create trigger subscription_payments_price
  before insert on public.subscription_payments
  for each row execute function public.price_subscription_payment();

-- One claim waiting at a time. A second receipt while the first is unread is
-- almost always the same payment filed twice, and approving both would sell
-- the shop two months for one.
create unique index if not exists subscription_payments_one_pending
  on public.subscription_payments (shop_id)
  where status = 'pending';

-- ------------------------------------------------ granting a Pro period
-- Shared by approval and by an admin grant, so the two cannot drift apart.
-- Not granted to anyone: only those two functions call it.
--
-- A renewal while Pro is still running EXTENDS it: the days left are kept
-- and the new ones follow, and generations not yet used carry over instead
-- of being reset away. A lapsed or free shop starts a fresh period today.

create or replace function public.apply_pro_period(p_shop_id uuid, p_days int, p_generations int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  ends timestamptz;
begin
  select * into sub from public.shop_subscriptions
    where shop_id = p_shop_id for update;
  if not found then
    insert into public.shop_subscriptions (shop_id) values (p_shop_id)
      returning * into sub;
  end if;

  if sub.tier = 'pro' and sub.period_end is not null and sub.period_end > now() then
    ends := sub.period_end + make_interval(days => p_days);
    update public.shop_subscriptions
      set period_end = ends,
          generations_limit = greatest(sub.generations_limit - sub.generations_used, 0) + p_generations,
          generations_used = 0,
          updated_at = now()
      where shop_id = p_shop_id;
  else
    ends := now() + make_interval(days => p_days);
    update public.shop_subscriptions
      set tier = 'pro',
          period_start = now(),
          period_end = ends,
          generations_used = 0,
          generations_limit = p_generations,
          retries_used = 0,
          updated_at = now()
      where shop_id = p_shop_id;
  end if;

  return ends;
end;
$$;

revoke all on function public.apply_pro_period(uuid, int, int) from public, anon, authenticated;

-- --------------------------------------------------------- the verdicts
-- As in 20260910000100, except that approval now extends a running period
-- (apply_pro_period) and both notices link to the shop's subscription card.

create or replace function public.approve_subscription_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.subscription_payments%rowtype;
  owner_id uuid;
  plan record;
  ends timestamptz;
  available int;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may verify a subscription payment.';
  end if;

  select * into pay from public.subscription_payments
    where id = p_payment_id for update;
  if not found then
    raise exception 'No such subscription payment.';
  end if;
  if pay.status <> 'pending' then
    raise exception 'This payment has already been %.', pay.status;
  end if;

  select * into plan from public.subscription_plan();

  update public.subscription_payments
    set status = 'approved', verified_by = auth.uid(), verified_at = now(),
        rejected_reason = null
    where id = p_payment_id;

  ends := public.apply_pro_period(pay.shop_id, plan.period_days, plan.pro_generations);
  select generations_limit - generations_used into available
    from public.shop_subscriptions where shop_id = pay.shop_id;

  select s.user_id into owner_id from public.shops s where s.id = pay.shop_id;

  perform public.emit_notification(
    owner_id, 'subscription_approved', 'Subscription active',
    available || ' photo-to-3D generations are available until ' || to_char(ends, 'FMMon FMDD, YYYY') || '.',
    '/protected/shop?section=subscription', auth.uid(), 'shop', pay.shop_id, 'shop'
  );
end;
$$;

revoke all on function public.approve_subscription_payment(uuid) from public, anon;
grant execute on function public.approve_subscription_payment(uuid) to authenticated;

create or replace function public.reject_subscription_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.subscription_payments%rowtype;
  owner_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may verify a subscription payment.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A rejected payment must carry a reason the shop can act on.';
  end if;

  select * into pay from public.subscription_payments
    where id = p_payment_id for update;
  if not found then
    raise exception 'No such subscription payment.';
  end if;
  if pay.status <> 'pending' then
    raise exception 'This payment has already been %.', pay.status;
  end if;

  update public.subscription_payments
    set status = 'rejected', rejected_reason = p_reason,
        verified_by = auth.uid(), verified_at = now()
    where id = p_payment_id;

  select s.user_id into owner_id from public.shops s where s.id = pay.shop_id;

  perform public.emit_notification(
    owner_id, 'subscription_rejected', 'Subscription payment not verified',
    p_reason, '/protected/shop?section=subscription', auth.uid(), 'shop', pay.shop_id, 'shop'
  );
end;
$$;

revoke all on function public.reject_subscription_payment(uuid, text) from public, anon;
grant execute on function public.reject_subscription_payment(uuid, text) to authenticated;

-- ------------------------------------------------------------ admin grant
-- Pro without a payment: demos, promotions, a shop owed goodwill. Recorded
-- as a zero-amount approved payment so every Pro period on the platform can
-- be traced to either a receipt or a named grant. Generations scale with
-- the length granted, at the plan's rate.

create or replace function public.grant_pro(p_shop_id uuid, p_days int default 30, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  plan record;
  generations int;
  ends timestamptz;
  owner_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may grant a subscription.';
  end if;
  if p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'A grant runs between 1 and 366 days.';
  end if;
  select s.user_id into owner_id from public.shops s
    where s.id = p_shop_id and s.status = 'approved';
  if owner_id is null then
    raise exception 'That shop is not an approved shop.';
  end if;

  select * into plan from public.subscription_plan();
  generations := ceil(plan.pro_generations * p_days::numeric / plan.period_days)::int;

  insert into public.subscription_payments (shop_id, amount, reference, status, verified_by, verified_at)
  values (p_shop_id, 0, coalesce(nullif(btrim(p_note), ''), 'Granted by admin'), 'approved', auth.uid(), now());

  ends := public.apply_pro_period(p_shop_id, p_days, generations);

  perform public.emit_notification(
    owner_id, 'subscription_granted', 'Pro subscription added',
    'FurniCraft added ' || generations || ' photo-to-3D generations to your shop, available until '
      || to_char(ends, 'FMMon FMDD, YYYY') || '.',
    '/protected/shop?section=subscription', auth.uid(), 'shop', p_shop_id, 'shop'
  );

  return ends;
end;
$$;

revoke all on function public.grant_pro(uuid, int, text) from public, anon;
grant execute on function public.grant_pro(uuid, int, text) to authenticated;

-- ------------------------------------------------------------------ check
--   select pro_price_php, payment_qr_path from public.platform_settings;   -- 499.00, null
--   -- a shop's claim is priced by the server whatever it sends:
--   --   insert ... (shop_id, amount) values ('<shop>', 1)  -> amount = 499.00
--   -- a second pending claim for the same shop fails on
--   --   subscription_payments_one_pending
