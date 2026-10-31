-- High detail costs a shop 3 generations, not 2.
--
-- A textured high-detail piece costs Meshy 40 credits (30 for the model and
-- its texture, 10 for the split) against 15 for a textured quick one: nearly
-- three times as much. Charged at 2, a shop spending its whole allowance and
-- its three retries on high detail cost the platform 415 credits a month.
-- Charged at 3, the most any shop can cost is 345: three high-detail attempts
-- that fail and are refunded, then fifteen textured quick ones. Together with
-- the ₱599 price (20260927000200), that keeps the subscription covering the
-- platform's full cost even under that heaviest use (the Cost-Benefit
-- Analysis, Chapter 3).
--
-- What a generation cost is now written on its row when it is recorded, and a
-- refund pays back THAT, not today's price. Otherwise a high-detail piece
-- charged 2 before this migration and rejected after it would be refunded 3.
--
-- Safe to re-run.

-- ------------------------------------------------------------------ the row
alter table public.shop_generations
  add column if not exists cost int;

-- Everything recorded before now was charged at the old prices.
update public.shop_generations
  set cost = case when mode = 'detailed' then 2 else 1 end
  where cost is null;

alter table public.shop_generations drop constraint if exists shop_generations_cost_check;
alter table public.shop_generations add constraint shop_generations_cost_check
  check (cost is null or cost in (1, 2, 3));

-- ------------------------------------------------------------------ pricing
create or replace function public.generation_cost(p_mode text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when p_mode = 'detailed' then 3 else 1 end;
$$;

revoke all on function public.generation_cost(text) from public, anon;
grant execute on function public.generation_cost(text) to authenticated;

-- ------------------------------------------------------------- spending it
-- Unchanged from 20260921123928 except that high detail is charged at
-- generation_cost('detailed') whatever the caller sent, and the "not enough
-- left" message states the real numbers instead of assuming 2 and 1.
create or replace function public.consume_generation(p_shop_id uuid, p_cost int default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  on_pro boolean;
  remaining int;
begin
  if p_cost not in (1, 2, 3) then
    raise exception 'A generation costs % or %, not %.',
      public.generation_cost('quick'), public.generation_cost('detailed'), p_cost;
  end if;
  -- 2 is what the route sent for high detail before this migration. A deploy
  -- that has not caught up is still asking for high detail, so it pays the
  -- current price rather than being refused.
  if p_cost > 1 then
    p_cost := public.generation_cost('detailed');
  end if;

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
    if sub.generations_used + p_cost > sub.generations_limit then
      remaining := sub.generations_limit - sub.generations_used;
      raise exception
        'High detail uses % generations, and only % % left in this period. Use Quick, or wait for the allowance to reset on %.',
        p_cost, remaining, case when remaining = 1 then 'is' else 'are' end,
        to_char(sub.period_end, 'FMMon FMDD, YYYY');
    end if;

    update public.shop_subscriptions
      set generations_used = generations_used + p_cost,
          unrecorded_generations = unrecorded_generations + p_cost,
          updated_at = now()
      where shop_id = p_shop_id;

    return sub.generations_limit - sub.generations_used - p_cost;
  end if;

  -- Free, or a pro period that has lapsed: the one lifetime trial, if it is
  -- still unspent. It is one generation of either kind.
  if sub.trial_used then
    raise exception
      'The free trial generation has already been used. Subscribe to create more templates from photos.';
  end if;

  update public.shop_subscriptions
    set trial_used = true,
        unrecorded_generations = unrecorded_generations + p_cost,
        updated_at = now()
    where shop_id = p_shop_id;

  return 0;
end;
$$;

revoke all on function public.consume_generation(uuid, int) from public, anon;
grant execute on function public.consume_generation(uuid, int) to authenticated;

-- ------------------------------------------------------------ recording it
-- Unchanged from 20260921123928 except that the row now carries its cost.
create or replace function public.record_generation(
  p_shop_id uuid,
  p_task_id text,
  p_mode text default 'quick',
  p_category text default null,
  p_textured boolean default false,
  p_photo_count int default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  if p_shop_id is null then
    -- A lab run. Nobody paid for it through an allowance, so there is
    -- nothing to settle; it is recorded only so the chain can be advanced.
    if not public.is_admin() then
      raise exception 'Only an admin may record a generation without a shop.';
    end if;
    insert into public.shop_generations (task_id, shop_id, created_by, mode, category, textured, photo_count, cost)
    values (p_task_id, null, auth.uid(), p_mode, p_category, p_textured, p_photo_count, public.generation_cost(p_mode))
    on conflict (task_id) do nothing;
    return;
  end if;

  if not public.is_admin() then
    if not exists (
      select 1 from public.shops s
      where s.id = p_shop_id and s.user_id = auth.uid()
    ) then
      raise exception 'Only the shop owner may record a generation for this shop.';
    end if;
  end if;

  insert into public.shop_generations (task_id, shop_id, created_by, mode, category, textured, photo_count, cost)
  values (p_task_id, p_shop_id, auth.uid(), p_mode, p_category, p_textured, p_photo_count, public.generation_cost(p_mode))
  on conflict (task_id) do nothing;

  -- Only a FIRST recording settles a consume. Recording the same task twice
  -- must not quietly account for a second, unrelated consume.
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.shop_subscriptions
      set unrecorded_generations = greatest(unrecorded_generations - public.generation_cost(p_mode), 0),
          updated_at = now()
      where shop_id = p_shop_id;
  end if;
end;
$$;

revoke all on function public.record_generation(uuid, text, text, text, boolean, int) from public, anon;
grant execute on function public.record_generation(uuid, text, text, text, boolean, int) to authenticated;

-- ------------------------------------------------------------ refunding it
-- Unchanged from 20260921123928 except for the amounts:
--
--   api_failure        capped at the dearest mode's cost instead of 2.
--   pipeline_rejected  the cost recorded on the generation's row, so a piece
--                      is paid back what it was charged, whatever the price
--                      is today. Rows from before `cost` existed were
--                      backfilled above.
create or replace function public.refund_generation(
  p_shop_id uuid,
  p_reason text,
  p_task_id text default null,
  p_cost int default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  g public.shop_generations%rowtype;
  allowance int;
  amount int := 1;
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

  if p_reason = 'api_failure' then
    if sub.unrecorded_generations < 1 then
      -- Every generation this shop has spent has a Meshy task recorded against
      -- it, so Meshy did not fail to take any of them and nothing is owed.
      return;
    end if;
    -- Any cost above 1 is high detail, including the 2 an older deploy sends.
    amount := least(
      case when p_cost > 1 then public.generation_cost('detailed') else 1 end,
      sub.unrecorded_generations
    );
  else
    select retry_allowance into allowance from public.subscription_plan();
    if sub.retries_used >= allowance then
      -- Allowance exhausted. Deliberately silent rather than an exception: the
      -- caller is already telling the shop its model was unusable, and a second
      -- failure on top of that helps nobody.
      return;
    end if;

    if p_task_id is not null then
      select * into g from public.shop_generations
        where task_id = p_task_id and shop_id = p_shop_id for update;
      if not found or g.refunded then
        return;
      end if;
      amount := coalesce(g.cost, public.generation_cost(g.mode));
      update public.shop_generations set refunded = true where task_id = p_task_id;
    end if;
  end if;

  if sub.generations_used > 0 then
    update public.shop_subscriptions
      set generations_used = greatest(generations_used - amount, 0),
          retries_used = retries_used + case when p_reason = 'pipeline_rejected' then 1 else 0 end,
          unrecorded_generations = unrecorded_generations - case when p_reason = 'api_failure' then amount else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  elsif sub.trial_used then
    update public.shop_subscriptions
      set trial_used = false,
          retries_used = retries_used + case when p_reason = 'pipeline_rejected' then 1 else 0 end,
          unrecorded_generations = unrecorded_generations - case when p_reason = 'api_failure' then amount else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  end if;
end;
$$;

revoke all on function public.refund_generation(uuid, text, text, int) from public, anon;
grant execute on function public.refund_generation(uuid, text, text, int) to authenticated;

-- ------------------------------------------------------------------- check
--   select mode, cost, count(*) from public.shop_generations group by 1, 2;
--   -- a detailed consume with two generations left must refuse with "only 2 are left"
