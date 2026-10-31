-- A rejected shop application always says why, and the applicant is told.
--
-- The admin panel already asks for a note before Reject goes through; this
-- makes the database hold to it as well, so no client can reject an
-- application without a reason. shops.rejection_reason already exists (see
-- 20260831000100_rename_shop_owner_requests_to_shops.sql); nothing new is
-- stored.
--
-- Until now the applicant heard nothing either way, although the apply form
-- promises "You'll be notified once it's decided". The decision now arrives
-- as a notification, carrying the reason when it is a rejection.
--
-- Run this in the Supabase SQL editor.

create or replace function public.guard_shop_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    if new.status = 'rejected' and new.status is distinct from old.status
       and coalesce(btrim(new.rejection_reason), '') = '' then
      raise exception 'A reason is required to reject a shop application.';
    end if;
    -- An application approved later, or sent back to review, no longer
    -- carries an old rejection note.
    if new.status <> 'rejected' then
      new.rejection_reason := null;
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Only an administrator may change a shop application''s status.';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'A shop application cannot be reassigned to another user.';
  end if;
  return new;
end;
$$;

-- Inserts into notifications directly: emit_notification() is not callable by
-- the admin's session, and this runs inside the admin's own update.
create or replace function public.notify_shop_application_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'approved' then
    insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
    values (
      new.user_id, 'shop_application_approved',
      'Your shop application was approved',
      new.shop_name || ' is now live. Open your shop dashboard to start taking orders.',
      '/protected/shop', 'shop', new.id, 'shop'
    );
  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, audience)
    values (
      new.user_id, 'shop_application_rejected',
      'Your shop application was not approved',
      'Reason: ' || coalesce(nullif(btrim(new.rejection_reason), ''), 'No reason given.') ||
        ' You can fix this and apply again from your dashboard.',
      '/protected', 'shop', new.id, 'personal'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_shop_application_decision() from public, anon, authenticated;

drop trigger if exists notify_shop_application_decision on public.shops;
create trigger notify_shop_application_decision
  after update of status on public.shops
  for each row execute function public.notify_shop_application_decision();

-- ------------------------------------------------------------------ check
--   update public.shops set status = 'rejected' where id = '<pending shop>';
--   -- as admin: fails with "A reason is required to reject a shop application."
--   update public.shops set status = 'rejected', rejection_reason = 'Unreadable BIR copy.' where id = '<pending shop>';
--   -- succeeds, and the applicant has a shop_application_rejected notification
