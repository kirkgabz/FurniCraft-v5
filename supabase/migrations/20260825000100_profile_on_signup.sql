-- Creates a user's profile row in the database instead of from the browser.
--
-- Why this is needed
-- ------------------
-- The sign-up form used to create the profile itself, straight after
-- supabase.auth.signUp():
--
--     await supabase.from("user_profiles").upsert({ id: data.user.id, ... })
--
-- That only worked while anyone holding the publishable key could write to
-- user_profiles. The security migration revoked that, correctly -- but it also
-- broke sign-up, because when "Confirm email" is enabled Supabase returns a
-- user with *no session*. The browser is therefore still the `anon` role at the
-- moment of the insert, so the write fails with
--
--     42501  permission denied for table user_profiles
--
-- and the form surfaces it as an error even though the account was created.
--
-- Granting anon write access would undo the security fix. Instead the database
-- creates the row itself, from the metadata signUp already sends, running as
-- the definer so no client privilege is involved at all. This works whether or
-- not email confirmation is on.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Everything here comes from options.data on the client's signUp call.
  insert into public.user_profiles (
    id, full_name, phone, address, role, shop_owner, updated_at
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'address', ''),
    'customer',
    false,
    now()
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- A profile is worth having, but never worth failing account creation for.
    -- If this ever fires, the reason is in the Postgres logs and the customer
    -- can still complete their details from the dashboard's settings tab.
    raise warning 'handle_new_user could not create a profile for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------- existing accounts
-- Anyone who signed up while the insert was failing has an auth user but no
-- profile. This backfills them; it is safe to run more than once.
insert into public.user_profiles (id, full_name, phone, address, role, shop_owner, updated_at)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), u.email),
  nullif(u.raw_user_meta_data ->> 'phone', ''),
  nullif(u.raw_user_meta_data ->> 'address', ''),
  'customer',
  false,
  now()
from auth.users u
left join public.user_profiles p on p.id = u.id
where p.id is null;

-- ------------------------------------------------------------------ check
-- Should return no rows once the backfill has run:
--
--   select u.id, u.email
--   from auth.users u
--   left join public.user_profiles p on p.id = u.id
--   where p.id is null;
