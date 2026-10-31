-- When the piece will be ready: the shop's own date, if it gives one.
--
-- Every order in production is finished within 2 weeks to 30 days of the
-- shop starting it. That window is worked out from production_started_at and
-- is not stored. What the shop may add -- optionally -- is the exact day it
-- expects to finish, and that is the one new column here.
--
-- Who and when, held by the database rather than the screen:
--   * only the shop sets or clears it (never the customer)
--   * only while the order is in production, which is after the quote is
--     accepted and the downpayment approved
--   * no earlier than today, and no later than 30 days after production
--     started -- the window customers are promised
--
-- The customer is notified whenever the date is set or changed.
--
-- Run this in the Supabase SQL editor.

alter table public.design_orders
  add column if not exists estimated_completion_date date;

comment on column public.design_orders.estimated_completion_date is
  'Optional. The day the shop expects to finish, set while in production; at most 30 days after production_started_at.';

create or replace function public.guard_estimated_completion_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  started date;
begin
  if new.estimated_completion_date is not distinct from old.estimated_completion_date then
    return new;
  end if;

  -- The SQL editor, the service role, an admin.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if not exists (select 1 from public.shops s where s.id = old.shop_id and s.user_id = auth.uid()) then
    raise exception 'Only the shop may set when this order will be finished.';
  end if;

  if new.status <> 'in_production' then
    raise exception 'A finish date can only be set while the order is in production.';
  end if;

  if new.estimated_completion_date is not null then
    started := coalesce(new.production_started_at, old.production_started_at, now())::date;
    if new.estimated_completion_date < current_date then
      raise exception 'The finish date cannot be in the past.';
    end if;
    if new.estimated_completion_date > started + 30 then
      raise exception 'The finish date must be within 30 days of the start of production (by %).', to_char(started + 30, 'Mon DD, YYYY');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_estimated_completion_date on public.design_orders;
create trigger guard_estimated_completion_date
  before update on public.design_orders
  for each row execute function public.guard_estimated_completion_date();

-- Tells the customer. Inserted directly: emit_notification() is not callable
-- from the shop's session.
create or replace function public.notify_estimated_completion_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estimated_completion_date is not distinct from old.estimated_completion_date
     or new.estimated_completion_date is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
  values (
    new.customer_user_id, 'order_completion_date',
    'Your order has a finish date',
    coalesce(nullif(new.project_name, ''), 'Your order') || ' is expected to be finished on '
      || to_char(new.estimated_completion_date, 'FMMonth FMDD, YYYY') || '.',
    '/protected/orders/' || new.id, 'design_order', new.id, 'personal'
  );

  return new;
end;
$$;

revoke all on function public.guard_estimated_completion_date() from public, anon, authenticated;
revoke all on function public.notify_estimated_completion_date() from public, anon, authenticated;

drop trigger if exists notify_estimated_completion_date on public.design_orders;
create trigger notify_estimated_completion_date
  after update of estimated_completion_date on public.design_orders
  for each row execute function public.notify_estimated_completion_date();

-- ------------------------------------------------------------------ check
--   select id, status, production_started_at, estimated_completion_date
--   from public.design_orders where status = 'in_production';
--   -- the new column is there, empty until a shop sets it
