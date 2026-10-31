-- Records when a customer accepted the terms and conditions.
--
-- The sign-up form passes the acceptance time through options.data on
-- supabase.auth.signUp(), the same channel that already carries full_name,
-- phone and address, and handle_new_user() copies it onto the profile.
--
-- What this is and is not
-- -----------------------
-- The checkbox on /auth/sign-up is a UI gate. This column is the record of what
-- the client asserted when the account was created. It is deliberately not a
-- NOT NULL constraint: Supabase creates the auth user before any of our code
-- runs, so a constraint here could only fail the profile insert, leaving an
-- account with no profile -- the exact breakage
-- 20260825000100_profile_on_signup.sql was written to fix.
--
-- Anything that must legally depend on acceptance should read this column
-- rather than trusting that the form was used.

alter table public.user_profiles
  add column if not exists terms_accepted_at timestamptz;

comment on column public.user_profiles.terms_accepted_at is
  'When the account holder accepted the terms. Null for accounts created before this was recorded.';

-- Extends the trigger from 20260825000100_profile_on_signup.sql. Unchanged
-- except for the new column, which is parsed defensively: a malformed value
-- must not cost someone their profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_at timestamptz;
begin
  begin
    accepted_at := nullif(new.raw_user_meta_data ->> 'terms_accepted_at', '')::timestamptz;
  exception
    when others then
      accepted_at := null;
  end;

  insert into public.user_profiles (
    id, full_name, phone, address, role, shop_owner, terms_accepted_at, updated_at
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), new.email),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'address', ''),
    'customer',
    false,
    accepted_at,
    now()
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- A profile is worth having, but never worth failing account creation for.
    raise warning 'handle_new_user could not create a profile for %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ------------------------------------------------------------------ check
--   select count(*) filter (where terms_accepted_at is not null) as accepted,
--          count(*) as total
--   from public.user_profiles;
