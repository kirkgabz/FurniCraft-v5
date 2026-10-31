-- Claiming a step of a high-detail chain before starting it.
--
-- The chain (see 20260921000100) is advanced by whichever poll notices the
-- previous step has finished. Two polls can notice at once -- a shop with the
-- page open in two tabs, or a retry landing on top of a slow request -- and
-- each would start its own split or retexture. Meshy bills both. The
-- write-once rule on the recorded task id stops the second one being
-- RECORDED, but by then it has already been paid for.
--
-- So a step is claimed first, in one locked update, and only the poll that
-- wins the claim calls Meshy. The slot holds the marker 'claimed' until the
-- real task id replaces it. A claim that never gets its task id -- the
-- request to Meshy failed, the function timed out -- goes stale after two
-- minutes and can be claimed again, so a chain cannot be wedged by one
-- failed call.
--
-- Safe to re-run.

alter table public.shop_generations
  add column if not exists step_claimed_at timestamptz;

create or replace function public.claim_generation_step(p_task_id text, p_step text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.shop_generations%rowtype;
  stale boolean;
begin
  if p_step not in ('split', 'split_auto', 'retexture') then
    raise exception 'Unknown generation step %.', p_step;
  end if;
  if not public.may_read_generation(p_task_id) then
    raise exception 'Only the shop that generated this model may advance it.';
  end if;

  select * into g from public.shop_generations where task_id = p_task_id for update;
  if not found or g.mode <> 'detailed' then
    return false;
  end if;

  stale := g.step_claimed_at is null or g.step_claimed_at < now() - interval '2 minutes';

  if p_step = 'split' then
    if g.split_task_id is null or (g.split_task_id = 'claimed' and g.split_mode = 'by_parts' and stale) then
      update public.shop_generations
        set split_task_id = 'claimed', split_mode = 'by_parts', step_claimed_at = now()
        where task_id = p_task_id;
      return true;
    end if;
    return false;
  end if;

  if p_step = 'split_auto' then
    -- The one retry: a by_parts split that finished badly, or an auto claim
    -- that went stale before its task was recorded.
    if (g.split_mode = 'by_parts' and g.split_task_id is not null and g.split_task_id <> 'claimed')
       or (g.split_mode = 'auto' and g.split_task_id = 'claimed' and stale) then
      update public.shop_generations
        set split_task_id = 'claimed', split_mode = 'auto', step_claimed_at = now()
        where task_id = p_task_id;
      return true;
    end if;
    return false;
  end if;

  -- retexture
  if g.retexture_task_id is null or (g.retexture_task_id = 'claimed' and stale) then
    update public.shop_generations
      set retexture_task_id = 'claimed', step_claimed_at = now()
      where task_id = p_task_id;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.claim_generation_step(text, text) from public, anon;
grant execute on function public.claim_generation_step(text, text) to authenticated;

-- Filling a claimed slot with the task Meshy actually started. Only a slot
-- this chain has claimed can be filled, which is what stops a caller pointing
-- a generation at some other task.
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

  if p_split_task_id is not null then
    if g.split_task_id is distinct from 'claimed' or g.split_mode is distinct from p_split_mode then
      raise exception 'That split step was not claimed.';
    end if;
    update public.shop_generations
      set split_task_id = p_split_task_id, step_claimed_at = null
      where task_id = p_task_id;
  end if;

  if p_retexture_task_id is not null then
    if g.retexture_task_id is distinct from 'claimed' then
      raise exception 'That texturing step was not claimed.';
    end if;
    update public.shop_generations
      set retexture_task_id = p_retexture_task_id, step_claimed_at = null
      where task_id = p_task_id;
  end if;
end;
$$;

revoke all on function public.set_generation_stage(text, text, text, text) from public, anon;
grant execute on function public.set_generation_stage(text, text, text, text) to authenticated;
