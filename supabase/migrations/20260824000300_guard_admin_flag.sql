-- Protects user_profiles.is_admin from being set by the account it would promote.
--
-- is_admin column and the public.is_admin() function that migration creates.
--
-- 20260824000200_security_rls_and_admin_role.sql added the is_admin flag and put row
-- level security on user_profiles, but the update policy is row-level only --
-- Postgres policies cannot restrict individual columns. The result is that any
-- signed-in user may PATCH their own profile row and set is_admin = true, which
-- grants them every admin power at once: reading every user's name, phone and
-- address, reading and approving shop applications, and downloading applicants'
-- BIR registrations and government IDs from the seller-documents bucket.
--
-- shop_owner_requests.status is already protected this way by
-- guard_shop_request_status(); this is the equivalent guard for the admin flag.
--
-- Run this in the Supabase SQL editor.

create or replace function public.guard_user_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No end-user session behind the statement: the SQL editor, a migration, or
  -- the service role. That is where the first administrator has to come from,
  -- since there is by definition no admin yet to authorise it.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A profile row is created on sign-up; it may never arrive pre-promoted.
    if coalesce(new.is_admin, false) then
      raise exception 'Only an administrator may grant administrator access.';
    end if;
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'Only an administrator may change administrator access.';
  end if;

  if new.id is distinct from old.id then
    raise exception 'A profile cannot be reassigned to another user.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_user_profile_admin_flag on public.user_profiles;
create trigger guard_user_profile_admin_flag
  before insert or update on public.user_profiles
  for each row execute function public.guard_user_profile_admin_flag();

-- ------------------------------------------------------------- who is admin?
-- Run this after applying the trigger. Anyone unexpected in this list could
-- have promoted themselves while the gap was open; revoke with
--   update public.user_profiles set is_admin = false where id = '...';
--
--   select u.email, p.is_admin
--   from public.user_profiles p
--   join auth.users u on u.id = p.id
--   where p.is_admin;
