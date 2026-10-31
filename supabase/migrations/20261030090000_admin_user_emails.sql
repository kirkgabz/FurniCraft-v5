-- Every account's email, for the admin Users page -- and two names put back.
--
-- An account's email lives in auth.users, which the browser cannot read, so
-- the Users page only ever showed an email when one had been copied into the
-- name. That copying is the second half of this: approving a shop used to
-- write the owner's email over their full_name, so approved owners appeared
-- under their email while everyone else had none. The panel no longer does
-- that, and the names it overwrote are restored from what the owners typed
-- when they signed up.
--
-- Nothing new is stored: the email is read from auth.users when asked for.
--
-- Run this in the Supabase SQL editor.

-- Admins only. Anyone else gets nothing back, not an error, so the page can
-- call it without first checking who is signed in.
create or replace function public.admin_user_emails()
returns table (id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_admin();
$$;

revoke all on function public.admin_user_emails() from public, anon;
grant execute on function public.admin_user_emails() to authenticated;

-- The names approval overwrote: full_name equal to the account's own email,
-- with the name given at sign-up still on record.
update public.user_profiles p
   set full_name = btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')),
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.full_name = u.email
   and coalesce(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '') <> '';

-- ------------------------------------------------------------------ check
--   select count(*) from public.user_profiles p join auth.users u on u.id = p.id
--   where p.full_name = u.email;
--   -- 0
--   select * from public.admin_user_emails();
--   -- as an admin in the app: every account; in the SQL editor: nothing
--   -- (no admin is signed in there), which is expected
