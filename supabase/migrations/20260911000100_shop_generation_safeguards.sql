-- Safeguards that matter the moment photo-to-3D reaches shop owners.
--
-- Until now the only caller was /dev/model-lab, run by an admin. Opening the
-- same routes to every approved shop exposes two ways to spend the
-- platform's money without limit. This closes both.
--
-- 1. AN "api_failure" REFUND WAS TAKEN ON THE CALLER'S WORD.
--    refund_generation is granted to authenticated users, and its
--    'api_failure' branch is uncapped by design -- Meshy never returning a
--    model costs nothing, so nothing is owed back to a cap. But nothing
--    checked that Meshy had in fact failed. A shop could generate, keep the
--    model, call refund_generation(..., 'api_failure') from the browser
--    console, and generate again, indefinitely, on the platform's credits.
--
--    The claim is now checked against the one thing the database can see.
--    The route consumes a generation and then, only once Meshy has accepted
--    the task, records it. A consume with no record behind it is therefore
--    exactly a generation Meshy never took. `unrecorded_generations` counts
--    those, and an api_failure refund has to spend one.
--
-- 2. THE LABELLING PASS WAS ADMIN-ONLY.
--    Shops need it -- a generated model is useless until its parts are
--    named -- but every pass is a Gemini request on the platform's key. It is
--    now admitted only for a generation the caller's shop paid for, only
--    while that generation is still undecided, and at most three times.
--
-- Written as a new migration rather than an edit to 20260910000100, which
-- may already be applied: every function here is create-or-replace.

-- ------------------------------------------------- 1. honest api refunds

alter table public.shop_subscriptions
  add column if not exists unrecorded_generations int not null default 0;

alter table public.shop_subscriptions
  drop constraint if exists shop_subscriptions_unrecorded_check;
alter table public.shop_subscriptions
  add constraint shop_subscriptions_unrecorded_check check (unrecorded_generations >= 0);

-- Unchanged from 20260910000100 except that every successful consume is
-- counted as unrecorded until record_generation settles it.
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
      set generations_used = generations_used + 1,
          unrecorded_generations = unrecorded_generations + 1,
          updated_at = now()
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
    set trial_used = true,
        unrecorded_generations = unrecorded_generations + 1,
        updated_at = now()
    where shop_id = p_shop_id;

  return 0;
end;
$$;

revoke all on function public.consume_generation(uuid) from public, anon;
grant execute on function public.consume_generation(uuid) to authenticated;

create or replace function public.record_generation(p_shop_id uuid, p_task_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
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

  -- Only a FIRST recording settles a consume. Recording the same task twice
  -- must not quietly account for a second, unrelated consume -- that one
  -- would then look as though Meshy had taken it, and could never be
  -- refunded even if Meshy had not.
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.shop_subscriptions
      set unrecorded_generations = greatest(unrecorded_generations - 1, 0),
          updated_at = now()
      where shop_id = p_shop_id;
  end if;
end;
$$;

revoke all on function public.record_generation(uuid, text) from public, anon;
grant execute on function public.record_generation(uuid, text) to authenticated;

-- Unchanged from 20260910000100 except for the api_failure check.
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

  if p_reason = 'api_failure' and sub.unrecorded_generations < 1 then
    -- Every generation this shop has spent has a Meshy task recorded against
    -- it, so Meshy did not fail to take any of them and nothing is owed.
    -- Silent for the same reason as the allowance case below.
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
          unrecorded_generations = unrecorded_generations - case when p_reason = 'api_failure' then 1 else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  elsif sub.trial_used then
    update public.shop_subscriptions
      set trial_used = false,
          retries_used = retries_used + case when p_reason = 'pipeline_rejected' then 1 else 0 end,
          unrecorded_generations = unrecorded_generations - case when p_reason = 'api_failure' then 1 else 0 end,
          updated_at = now()
      where shop_id = p_shop_id;
  end if;
end;
$$;

revoke all on function public.refund_generation(uuid, text) from public, anon;
grant execute on function public.refund_generation(uuid, text) to authenticated;

-- --------------------------------------------- 2. capped labelling passes

alter table public.shop_generations
  add column if not exists analyses_used int not null default 0;

alter table public.shop_generations
  drop constraint if exists shop_generations_analyses_check;
alter table public.shop_generations
  add constraint shop_generations_analyses_check check (analyses_used >= 0);

-- Spends one labelling pass on a generation and returns how many are left.
--
-- Three: the pass that runs straight after generation, and two relabels for
-- when the first answer is wrong -- the same identical input has been seen to
-- label at 100%, 31% and 89%, so one retry is not always enough and an
-- unbounded number is a Gemini bill anyone can run up.
--
-- There is deliberately no function to hand a pass back when a call fails. A
-- pass that the browser can return is a pass that can be spent forever; a
-- failed call costing one of three is the smaller problem.
create or replace function public.consume_analysis(p_task_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.shop_generations%rowtype;
  passes constant int := 3;
begin
  if not public.may_read_generation(p_task_id) then
    raise exception 'Only the shop that generated this model may label it.';
  end if;

  select * into g from public.shop_generations
    where task_id = p_task_id for update;
  if not found then
    raise exception 'That generation is not on record.';
  end if;

  if g.outcome <> 'pending' then
    raise exception 'This generation has already been published or discarded, so its parts cannot be relabelled.';
  end if;

  if g.analyses_used >= passes then
    raise exception 'All % labelling passes for this generation have been used.', passes;
  end if;

  update public.shop_generations
    set analyses_used = analyses_used + 1
    where task_id = p_task_id;

  return passes - g.analyses_used - 1;
end;
$$;

revoke all on function public.consume_analysis(text) from public, anon;
grant execute on function public.consume_analysis(text) to authenticated;

-- ------------------------------------------------------------------ check
--   -- a refund with nothing unrecorded is a no-op:
--   select unrecorded_generations from public.shop_subscriptions where shop_id = '<id>';
--   select public.refund_generation('<id>', 'api_failure');   -- counters unchanged
--
--   -- the fourth pass on one generation raises:
--   select public.consume_analysis('<task>');  -- 2, 1, 0, then ERROR
