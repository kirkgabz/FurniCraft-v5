-- Shops that go quiet: warned at 30 and 60 days, deactivated at 90.
--
-- An approved shop that nobody is running still sits in the directory taking
-- orders that will never be answered. From here on:
--
--   30 days without activity   a notification: open the dashboard to stay active
--   60 days                     a second warning: 30 days left
--   90 days                     the shop is deactivated -- hidden from customers,
--                               no new orders -- and listed under Deactivated
--                               shops in the admin panel
--
-- "Activity" is the owner opening the shop dashboard (or a shop's order page),
-- which is where every shop action happens. The app calls
-- touch_shop_activity() on those screens; that stamps shops.last_active_at and,
-- for a shop deactivated by this rule, brings it straight back. Nothing has to
-- be asked of FurniCraft to return.
--
-- Deactivation reuses shops.is_active, the switch shops_public and ordering
-- already respect, so nothing else needed to learn a new state.
-- inactive_deactivated_at records that it was THIS rule that switched the shop
-- off: a shop its owner switched off, or an admin hid, is never switched back
-- on by a visit.
--
-- The warnings are not stored anywhere new. Whether a 30- or 60-day warning was
-- already sent since the shop's last activity is read from the notifications
-- themselves.
--
-- Every existing shop starts the clock today, so applying this deactivates
-- nobody: each shop gets the full 90 days and both warnings first.
--
-- Run this in the Supabase SQL editor.

alter table public.shops
  add column if not exists last_active_at timestamptz,
  add column if not exists inactive_deactivated_at timestamptz;

update public.shops set last_active_at = now() where last_active_at is null;

alter table public.shops alter column last_active_at set default now();

comment on column public.shops.last_active_at is
  'When the owner last used the shop dashboard. Stamped by touch_shop_activity(); read by sweep_inactive_shops().';
comment on column public.shops.inactive_deactivated_at is
  'Set when sweep_inactive_shops() deactivated the shop for 90 days without activity; cleared when it is active again.';

-- However the shop comes back on -- the owner returning, the owner's own
-- Reactivate switch, or an admin -- it is no longer "deactivated for
-- inactivity", and the clock starts again.
create or replace function public.clear_shop_inactivity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and not coalesce(old.is_active, false) then
    new.inactive_deactivated_at := null;
    new.last_active_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists clear_shop_inactivity on public.shops;
create trigger clear_shop_inactivity
  before update of is_active on public.shops
  for each row execute function public.clear_shop_inactivity();

-- Called by the shop dashboard and a shop's order page. Stamps activity at most
-- once every ten minutes (a dashboard re-renders far more often than that), and
-- brings back a shop that this rule deactivated. Returns what it found, so the
-- dashboard can welcome the owner back.
create or replace function public.touch_shop_activity()
returns table (shop_id uuid, previous_active_at timestamptz, reactivated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  if auth.uid() is null then
    return;
  end if;

  for s in
    select id, last_active_at, inactive_deactivated_at, suspended_at
    from public.shops
    where user_id = auth.uid() and status = 'approved'
  loop
    shop_id := s.id;
    previous_active_at := s.last_active_at;
    reactivated := false;

    -- A suspension is FurniCraft's decision and outlasts a visit.
    if s.inactive_deactivated_at is not null and s.suspended_at is null then
      update public.shops set is_active = true where id = s.id;
      reactivated := true;
    elsif s.last_active_at is null or s.last_active_at < now() - interval '10 minutes' then
      update public.shops set last_active_at = now() where id = s.id;
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function public.touch_shop_activity() from public, anon;
grant execute on function public.touch_shop_activity() to authenticated;

-- The daily pass. Inserts into notifications directly: emit_notification()
-- does nothing without a signed-in caller, and a scheduled job has none.
create or replace function public.sweep_inactive_shops()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  idle interval;
begin
  for s in
    select id, user_id, last_active_at
    from public.shops
    where status = 'approved'
      and is_active
      and suspended_at is null
      and last_active_at is not null
  loop
    idle := now() - s.last_active_at;

    if idle >= interval '90 days' then
      update public.shops
         set is_active = false, inactive_deactivated_at = now()
       where id = s.id;
      insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
      values (
        s.user_id, 'shop_inactive_deactivated',
        'Your shop was deactivated for inactivity',
        'It had no activity for 90 days and is now hidden from customers. Open your shop dashboard to reactivate it.',
        '/protected/shop', 'shop', s.id, 'shop'
      );

    elsif idle >= interval '60 days' then
      if not exists (
        select 1 from public.notifications n
        where n.user_id = s.user_id and n.type = 'shop_inactive_60' and n.created_at > s.last_active_at
      ) then
        insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
        values (
          s.user_id, 'shop_inactive_60',
          'Your shop has been inactive for 60 days',
          'Open your shop dashboard within 30 days, or your shop will be deactivated and hidden from customers.',
          '/protected/shop', 'shop', s.id, 'shop'
        );
      end if;

    elsif idle >= interval '30 days' then
      if not exists (
        select 1 from public.notifications n
        where n.user_id = s.user_id and n.type = 'shop_inactive_30' and n.created_at > s.last_active_at
      ) then
        insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
        values (
          s.user_id, 'shop_inactive_30',
          'Your shop has been inactive for 30 days',
          'Open your shop dashboard to keep your shop active. Shops with no activity for 90 days are deactivated and hidden from customers.',
          '/protected/shop', 'shop', s.id, 'shop'
        );
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.sweep_inactive_shops() from public, anon, authenticated;

-- Once a day, after the account-deletion sweep (03:17).
do $$
begin
  perform cron.unschedule('sweep-inactive-shops-daily')
  where exists (select 1 from cron.job where jobname = 'sweep-inactive-shops-daily');
end $$;

select cron.schedule('sweep-inactive-shops-daily', '37 3 * * *', $$select public.sweep_inactive_shops()$$);

-- ------------------------------------------------------------------ check
--   select id, shop_name, last_active_at, inactive_deactivated_at, is_active
--   from public.shops where status = 'approved';
--   -- every approved shop has last_active_at = the time this ran
--
-- To see the 90-day path on a test shop (as an admin, in the SQL editor):
--   update public.shops set last_active_at = now() - interval '91 days' where id = '<test shop>';
--   select public.sweep_inactive_shops();
--   -- that shop: is_active false, inactive_deactivated_at set, one notification
--   -- Opening its shop dashboard as the owner then reactivates it.
