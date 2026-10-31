-- High-detail generations.
--
-- A high-detail piece is not one Meshy task but a chain of up to three:
--
--   1. a detailed model -- Meshy's standard mode, tens of thousands of faces,
--      from one photo or up to four -- which arrives as ONE fused surface;
--   2. a split of that model into parts ("Auto Split"), which is what makes
--      it a template at all: the studio resizes and refinishes parts, and a
--      fused surface has none;
--   3. optionally, a retexture of the split parts from the shop's photo,
--      because the split refuses a textured model.
--
-- The chain is driven by the server as the browser polls, so a shop that
-- closes the tab can pick the piece up later. That needs the chain written
-- down somewhere other than the tab, and the natural place is the row that
-- already records the generation: `shop_generations`, keyed on the FIRST
-- task's id, which stays the generation's identity throughout.
--
-- It also costs Meshy six times what a quick generation does, so it costs a
-- shop 2 generations instead of 1. The allowance functions below learn to
-- count in those units. See the refund notes for why the amount refunded is
-- read off the recorded generation rather than passed in.
--
-- Safe to re-run.

-- ------------------------------------------------------------------ the row
-- An admin's run from /dev/model-lab belongs to no shop, and until now simply
-- went unrecorded. A high-detail run has to be recorded to be advanced, so
-- the shop becomes optional; record_generation only lets an admin leave it
-- empty.
alter table public.shop_generations alter column shop_id drop not null;

alter table public.shop_generations
  add column if not exists mode text not null default 'quick',
  add column if not exists category text,
  add column if not exists photo_count int not null default 1,
  add column if not exists textured boolean not null default false,
  add column if not exists split_task_id text,
  add column if not exists split_mode text,
  add column if not exists retexture_task_id text,
  -- Set once a pipeline_rejected refund has paid this generation back, so
  -- the same task cannot be refunded twice.
  add column if not exists refunded boolean not null default false;

alter table public.shop_generations drop constraint if exists shop_generations_mode_check;
alter table public.shop_generations add constraint shop_generations_mode_check
  check (mode in ('quick', 'detailed'));

alter table public.shop_generations drop constraint if exists shop_generations_category_check;
alter table public.shop_generations add constraint shop_generations_category_check
  check (
    category is null
    or category in ('chair', 'table', 'sofa', 'cabinet', 'bed', 'bookshelf', 'desk', 'stool')
  );

alter table public.shop_generations drop constraint if exists shop_generations_photo_count_check;
alter table public.shop_generations add constraint shop_generations_photo_count_check
  check (photo_count between 1 and 4);

alter table public.shop_generations drop constraint if exists shop_generations_split_mode_check;
alter table public.shop_generations add constraint shop_generations_split_mode_check
  check (split_mode is null or split_mode in ('by_parts', 'auto'));

-- ------------------------------------------------------------------ pricing
-- One place that knows what a mode costs, so the three functions below cannot
-- disagree about it.
create or replace function public.generation_cost(p_mode text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when p_mode = 'detailed' then 2 else 1 end;
$$;

revoke all on function public.generation_cost(text) from public, anon;
grant execute on function public.generation_cost(text) to authenticated;

-- ------------------------------------------------------------- spending it
-- `unrecorded_generations` now counts UNITS, not calls: a detailed consume
-- that Meshy then refuses owes 2 back, and the api_failure refund below caps
-- itself against this count, so it has to be in the same currency.
--
-- The free trial stays one generation of either kind. It is spent by the
-- trial flag, not by units, so its cost is recorded but never compared.
drop function if exists public.consume_generation(uuid);
create or replace function public.consume_generation(p_shop_id uuid, p_cost int default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.shop_subscriptions%rowtype;
  on_pro boolean;
begin
  if p_cost not in (1, 2) then
    raise exception 'A generation costs 1 or 2, not %.', p_cost;
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
      raise exception
        'High detail uses 2 generations, and only 1 is left in this period. Use Quick, or wait for the allowance to reset on %.',
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
  -- still unspent.
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
drop function if exists public.record_generation(uuid, text);
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
    insert into public.shop_generations (task_id, shop_id, created_by, mode, category, textured, photo_count)
    values (p_task_id, null, auth.uid(), p_mode, p_category, p_textured, p_photo_count)
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

  insert into public.shop_generations (task_id, shop_id, created_by, mode, category, textured, photo_count)
  values (p_task_id, p_shop_id, auth.uid(), p_mode, p_category, p_textured, p_photo_count)
  on conflict (task_id) do nothing;

  -- Only a FIRST recording settles a consume. Recording the same task twice
  -- must not quietly account for a second, unrelated consume -- that one
  -- would then look as though Meshy had taken it, and could never be
  -- refunded even if Meshy had not.
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
-- Two ways a generation comes back, and each decides the amount differently:
--
--   api_failure        Meshy never took the request. The route passes the
--                      cost it had just consumed, capped against the
--                      unrecorded units -- which only a consume that was never
--                      recorded can leave behind, so a caller cannot claim
--                      back more than it spent without a task to show for it.
--   pipeline_rejected  Meshy took it and the result was unusable. The amount
--                      is the RECORDED generation's cost, read here, never
--                      passed in: otherwise a quick generation could be
--                      refunded as a detailed one. Once per task.
--
-- A caller that passes no task keeps the old behaviour, 1 generation.
drop function if exists public.refund_generation(uuid, text);
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
    amount := least(greatest(p_cost, 1), 2, sub.unrecorded_generations);
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
      amount := public.generation_cost(g.mode);
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

-- --------------------------------------------------------- advancing it
-- Records the next task in a high-detail chain. Write-once, with one
-- exception: a split that failed in by_parts mode is retried once in auto
-- mode, and that retry replaces it. Anything else would let a caller point a
-- generation at some other Meshy task and have the server fetch it.
create or replace function public.set_generation_stage(
  p_task_id text,
  p_split_task_id text default null,
  p_split_mode text default null,
  p_retexture_task_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.shop_generations%rowtype;
begin
  if not public.may_read_generation(p_task_id) then
    raise exception 'Only the shop that generated this model may advance it.';
  end if;

  select * into g from public.shop_generations where task_id = p_task_id for update;
  if not found then
    raise exception 'That generation is not on record.';
  end if;
  if g.mode <> 'detailed' then
    raise exception 'Only a high-detail generation has further steps.';
  end if;

  if p_split_task_id is not null then
    if p_split_mode not in ('by_parts', 'auto') then
      raise exception 'Unknown split mode %.', p_split_mode;
    end if;
    if g.split_task_id is not null and not (g.split_mode = 'by_parts' and p_split_mode = 'auto') then
      raise exception 'This generation has already been split.';
    end if;
    update public.shop_generations
      set split_task_id = p_split_task_id, split_mode = p_split_mode
      where task_id = p_task_id;
  end if;

  if p_retexture_task_id is not null then
    if g.retexture_task_id is not null then
      raise exception 'This generation has already been textured.';
    end if;
    update public.shop_generations
      set retexture_task_id = p_retexture_task_id
      where task_id = p_task_id;
  end if;
end;
$$;

revoke all on function public.set_generation_stage(text, text, text, text) from public, anon;
grant execute on function public.set_generation_stage(text, text, text, text) to authenticated;

-- ------------------------------------------------------------------- check
--   select mode, count(*), sum(public.generation_cost(mode)) from public.shop_generations group by 1;
--   -- a detailed consume with one generation left must refuse with the "only 1 is left" message
