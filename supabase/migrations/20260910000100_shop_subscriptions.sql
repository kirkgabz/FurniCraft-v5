-- Subscriptions, so a shop can turn a photograph into a customizable template.
--
-- Image-to-3D costs real money per call (Meshy, 5 credits a generation in
-- `smart-topology`), which makes this the first thing in FurniCraft where a
-- signed-in user can spend the platform's money. Everything below exists to
-- make that spend impossible to exceed from the browser.
--
-- Two tiers, deliberately:
--
--   free  one trial generation, for the life of the shop. Not one a month:
--         a monthly free allowance costs credits for every shop that ever
--         registered, active or not, forever. One trial is enough to prove
--         the feature works on the shop's own furniture, which is what a
--         trial is for. Manual .glb upload and the shipped models stay
--         available on free -- a shop that never pays can still use the
--         whole platform.
--
--   pro   15 generations per 30-day period.
--
-- There is no `status` column. A shop is on pro when `tier = 'pro'` and
-- `period_end > now()`, derived at read time -- a stored status needs a cron
-- tick to expire it and is wrong for however long that tick is late.
--
-- Payment reuses the flow the platform already runs on customers: the shop
-- pays FurniCraft by QR transfer, uploads the receipt, and an admin verifies
-- it. No gateway, no card data, and the platform still never holds funds in
-- escrow -- it receives payment for a service, the way any vendor does.
--
-- WHEN A PERIOD LAPSES the shop drops to free and cannot generate new
-- templates. Templates it already made stay published and orders against
-- them keep working. Withdrawing a template a customer has already paid
-- against would break a live order, and none of this is worth that.

-- ------------------------------------------------------------ the tables

create table if not exists public.shop_subscriptions (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  tier text not null default 'free',
  period_start timestamptz,
  period_end timestamptz,
  generations_used int not null default 0,
  generations_limit int not null default 0,
  -- Lifetime, not per period. See the header.
  trial_used boolean not null default false,
  -- Generations handed back this period because our own pipeline could not
  -- use what Meshy returned. Capped, so "retry" cannot become "unlimited".
  retries_used int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.shop_subscriptions
  drop constraint if exists shop_subscriptions_tier_check;
alter table public.shop_subscriptions
  add constraint shop_subscriptions_tier_check check (tier in ('free', 'pro'));

alter table public.shop_subscriptions
  drop constraint if exists shop_subscriptions_counters_check;
alter table public.shop_subscriptions
  add constraint shop_subscriptions_counters_check check (
    generations_used >= 0
    and generations_limit >= 0
    and retries_used >= 0
    and generations_used <= generations_limit + 1
  );

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount numeric(10, 2),
  reference text,
  receipt_url text,
  status text not null default 'pending',
  rejected_reason text,
  submitted_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz
);

alter table public.subscription_payments
  drop constraint if exists subscription_payments_status_check;
alter table public.subscription_payments
  add constraint subscription_payments_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists subscription_payments_shop_idx
  on public.subscription_payments (shop_id, submitted_at desc);
-- The admin queue reads pending-first across every shop.
create index if not exists subscription_payments_status_idx
  on public.subscription_payments (status, submitted_at);

-- ------------------------------------------------------------------- RLS
--
-- Reads are policy-governed. Writes to shop_subscriptions are not governed at
-- all -- the grant is removed, so no policy can accidentally restore them.
-- Every legitimate write goes through the security-definer functions below,
-- which is the only place the quota arithmetic is allowed to happen.

alter table public.shop_subscriptions enable row level security;

drop policy if exists "shop_subscriptions_select_own" on public.shop_subscriptions;
create policy "shop_subscriptions_select_own" on public.shop_subscriptions
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.shop_subscriptions from anon, authenticated;
grant select on public.shop_subscriptions to authenticated;

alter table public.subscription_payments enable row level security;

drop policy if exists "subscription_payments_select_own" on public.subscription_payments;
create policy "subscription_payments_select_own" on public.subscription_payments
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

-- A shop may file its own claim of payment, and only as pending. The verdict
-- columns are not writable from here at all -- update is revoked below, so
-- approving is reachable only through the admin function.
drop policy if exists "subscription_payments_insert_own" on public.subscription_payments;
create policy "subscription_payments_insert_own" on public.subscription_payments
  for insert with check (
    status = 'pending'
    and verified_by is null
    and verified_at is null
    and rejected_reason is null
    and exists (
      select 1 from public.shops s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

revoke update, delete on public.subscription_payments from anon, authenticated;
grant select, insert on public.subscription_payments to authenticated;

-- --------------------------------------------------------------- storage
-- Same shape as payment-receipts: private bucket, read through signed URLs,
-- first path segment is the row the object belongs to.
--
--   subscription-receipts  {shop_id}/receipt_{timestamp}.{ext}

insert into storage.buckets (id, name, public)
values ('subscription-receipts', 'subscription-receipts', false)
on conflict (id) do nothing;

drop policy if exists "subscription_receipts_write_owner" on storage.objects;
create policy "subscription_receipts_write_owner" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'subscription-receipts'
    and exists (
      select 1 from public.shops s
      where s.id::text = (storage.foldername(name))[1]
        and s.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'subscription-receipts'
    and exists (
      select 1 from public.shops s
      where s.id::text = (storage.foldername(name))[1]
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "subscription_receipts_admin_read" on storage.objects;
create policy "subscription_receipts_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'subscription-receipts' and public.is_admin());

-- ------------------------------------------------------- the tier constants
-- One place, so the route, the dashboard and the admin screen cannot drift
-- apart on what a subscription actually buys.

create or replace function public.subscription_plan()
returns table (pro_generations int, period_days int, retry_allowance int)
language sql
immutable
as $$
  select 15, 30, 3;
$$;

grant execute on function public.subscription_plan() to authenticated;

-- ------------------------------------------------------------ every shop has one
-- Backfilled rather than created on demand, so the dashboard has something to
-- read before a shop has ever generated anything.

insert into public.shop_subscriptions (shop_id)
select s.id from public.shops s
on conflict (shop_id) do nothing;

create or replace function public.create_shop_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shop_subscriptions (shop_id) values (new.id)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_shop_subscription() from public, anon, authenticated;

drop trigger if exists shops_create_subscription on public.shops;
create trigger shops_create_subscription
  after insert on public.shops
  for each row execute function public.create_shop_subscription();

-- --------------------------------------------------------- spending a generation
--
-- Called by /api/meshy/image-to-3d BEFORE it spends the API key. The row is
-- locked for the duration: two tabs submitting at once must not both read
-- "14 used" and both pass.
--
-- Returns how many remain after this one, so the caller can tell the shop
-- without a second query.

create or replace function public.consume_generation(p_shop_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  on_pro boolean;
begin
  -- Admins bypass the ownership check, not the quota: /dev/model-lab drives
  -- this same route and there is no shop behind it.
  if not public.is_admin() then
    if not exists (
      select 1 from public.shops s
      where s.id = p_shop_id and s.user_id = auth.uid()
    ) then
      raise exception 'Only the shop owner may generate a model for this shop.';
    end if;
  end if;

  select * into sub from public.shop_subscriptions
    where shop_id = p_shop_id for update;

  if not found then
    insert into public.shop_subscriptions (shop_id) values (p_shop_id)
      returning * into sub;
  end if;

  on_pro := sub.tier = 'pro'
        and sub.period_end is not null
        and sub.period_end > now();

  if on_pro then
    if sub.generations_used >= sub.generations_limit then
      raise exception
        'All % generations in this period have been used. The allowance resets on %.',
        sub.generations_limit, to_char(sub.period_end, 'FMMon FMDD, YYYY');
    end if;

    update public.shop_subscriptions
      set generations_used = generations_used + 1, updated_at = now()
      where shop_id = p_shop_id;

    return sub.generations_limit - sub.generations_used - 1;
  end if;

  -- Free, or a pro period that has lapsed: the one lifetime trial, if it is
  -- still unspent.
  if sub.trial_used then
    raise exception
      'The free trial generation has already been used. Subscribe to create more templates from photos.';
  end if;

  update public.shop_subscriptions
    set trial_used = true, updated_at = now()
    where shop_id = p_shop_id;

  return 0;
end;
$$;

revoke all on function public.consume_generation(uuid) from public, anon;
grant execute on function public.consume_generation(uuid) to authenticated;

-- ------------------------------------------------------- handing one back
--
-- Two different failures, and they are not owed the same thing.
--
--   'api_failure'       Meshy never returned a model. Nothing was bought, so
--                       the generation goes straight back and does not count
--                       against the retry allowance.
--
--   'pipeline_rejected' Meshy returned a model our own pipeline cannot use --
--                       one fused shell with no separable parts, or past the
--                       shell ceiling. The credits are spent; this is our
--                       system failing the shop rather than the shop misusing
--                       it, so the generation goes back, but only while the
--                       period's retry allowance lasts.
--
-- A shop simply not liking the result is neither of these and is refunded
-- nothing. That call belongs to the caller, not to this function.

create or replace function public.refund_generation(p_shop_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  allowance int;
begin
  if p_reason not in ('api_failure', 'pipeline_rejected') then
    raise exception 'Unknown refund reason %.', p_reason;
  end if;

  if not public.is_admin() then
    if not exists (
      select 1 from public.shops s
      where s.id = p_shop_id and s.user_id = auth.uid()
    ) then
      raise exception 'Only the shop owner may be refunded a generation.';
    end if;
  end if;

  select * into sub from public.shop_subscriptions
    where shop_id = p_shop_id for update;
  if not found then
    return;
  end if;

  select retry_allowance into allowance from public.subscription_plan();

  if p_reason = 'pipeline_rejected' and sub.retries_used >= allowance then
    -- Allowance exhausted. Deliberately silent rather than an exception: the
    -- caller is already telling the shop its model was unusable, and a second
    -- failure on top of that helps nobody.
    return;
  end if;

  if sub.generations_used > 0 then
    update public.shop_subscriptions
      set generations_used = generations_used - 1,
          retries_used = retries_used + case when p_reason = 'pipeline_rejected' then 1 else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  elsif sub.trial_used then
    update public.shop_subscriptions
      set trial_used = false,
          retries_used = retries_used + case when p_reason = 'pipeline_rejected' then 1 else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  end if;
end;
$$;

revoke all on function public.refund_generation(uuid, text) from public, anon;
grant execute on function public.refund_generation(uuid, text) to authenticated;

-- ------------------------------------------------------------ the verdict
--
-- Admin-only, and the only path by which a shop reaches pro. The period runs
-- from the moment of approval rather than from a calendar date: a human
-- verifies these, so there is no billing day to align to and no proration to
-- get wrong.

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

  insert into public.shop_subscriptions (
    shop_id, tier, period_start, period_end,
    generations_used, generations_limit, retries_used, updated_at
  )
  values (
    pay.shop_id, 'pro', now(), now() + make_interval(days => plan.period_days),
    0, plan.pro_generations, 0, now()
  )
  on conflict (shop_id) do update
    set tier = 'pro',
        period_start = now(),
        period_end = now() + make_interval(days => plan.period_days),
        generations_used = 0,
        generations_limit = plan.pro_generations,
        retries_used = 0,
        updated_at = now();

  select s.user_id into owner_id from public.shops s where s.id = pay.shop_id;

  perform public.emit_notification(
    owner_id, 'subscription_approved', 'Subscription active',
    plan.pro_generations || ' photo-to-3D generations are available until '
      || to_char(now() + make_interval(days => plan.period_days), 'FMMon FMDD, YYYY'),
    '/protected/shop', auth.uid(), 'shop', pay.shop_id, 'shop'
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
    p_reason, '/protected/shop', auth.uid(), 'shop', pay.shop_id, 'shop'
  );
end;
$$;

revoke all on function public.reject_subscription_payment(uuid, text) from public, anon;
grant execute on function public.reject_subscription_payment(uuid, text) to authenticated;

-- --------------------------------------------------------- the generation log
--
-- One row per Meshy task, so that polling and downloading can be gated on
-- ownership rather than on holding a task id. The route's own note is right
-- that a task id is not a secret; without this table the only alternative is
-- to let any shop owner poll any task.
--
-- It doubles as the record of what the platform actually spent, which is the
-- number the cost side of the study needs.

create table if not exists public.shop_generations (
  task_id text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  -- 'pending' until the shop decides; 'accepted' once it becomes a template,
  -- 'rejected' when the pipeline or the shop throws it away.
  outcome text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.shop_generations
  drop constraint if exists shop_generations_outcome_check;
alter table public.shop_generations
  add constraint shop_generations_outcome_check
  check (outcome in ('pending', 'accepted', 'rejected'));

create index if not exists shop_generations_shop_idx
  on public.shop_generations (shop_id, created_at desc);

alter table public.shop_generations enable row level security;

drop policy if exists "shop_generations_select_own" on public.shop_generations;
create policy "shop_generations_select_own" on public.shop_generations
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shops s
      where s.id = shop_id and s.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.shop_generations from anon, authenticated;
grant select on public.shop_generations to authenticated;

create or replace function public.record_generation(p_shop_id uuid, p_task_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if not exists (
      select 1 from public.shops s
      where s.id = p_shop_id and s.user_id = auth.uid()
    ) then
      raise exception 'Only the shop owner may record a generation for this shop.';
    end if;
  end if;

  insert into public.shop_generations (task_id, shop_id, created_by)
  values (p_task_id, p_shop_id, auth.uid())
  on conflict (task_id) do nothing;
end;
$$;

revoke all on function public.record_generation(uuid, text) from public, anon;
grant execute on function public.record_generation(uuid, text) to authenticated;

/** Whether the caller may poll or download this task. */
create or replace function public.may_read_generation(p_task_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.shop_generations g
    join public.shops s on s.id = g.shop_id
    where g.task_id = p_task_id and s.user_id = auth.uid()
  );
$$;

revoke all on function public.may_read_generation(text) from public, anon;
grant execute on function public.may_read_generation(text) to authenticated;

create or replace function public.set_generation_outcome(p_task_id text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome not in ('accepted', 'rejected') then
    raise exception 'Unknown generation outcome %.', p_outcome;
  end if;
  if not public.may_read_generation(p_task_id) then
    raise exception 'Only the shop that generated this model may resolve it.';
  end if;

  update public.shop_generations
    set outcome = p_outcome
    where task_id = p_task_id and outcome = 'pending';
end;
$$;

revoke all on function public.set_generation_outcome(text, text) from public, anon;
grant execute on function public.set_generation_outcome(text, text) to authenticated;

-- ------------------------------------------------------------------ check
--   select shop_id, tier, generations_used, generations_limit, trial_used,
--          period_end > now() as active
--     from public.shop_subscriptions;
--
--   -- a free shop's first generation succeeds and returns 0 remaining:
--   select public.consume_generation('<shop id>');
--   -- the second raises:
--   --   'The free trial generation has already been used. ...'
--
--   -- a shop cannot write its own counters (no grant, so this fails
--   -- regardless of policy):
--   update public.shop_subscriptions set generations_used = 0;
--   --   ERROR: permission denied for table shop_subscriptions
