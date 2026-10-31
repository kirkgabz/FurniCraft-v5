-- Self-service account deletion with a 30-day undo window.
--
-- design_orders.customer_user_id and design_templates.created_by are ON
-- DELETE NO ACTION -- a literal `delete from auth.users` fails outright for
-- almost any real account, since that would destroy the other party's order
-- records. So "permanent delete" here means: after 30 days, scrub personal
-- info and soft-delete the auth user (Supabase's admin.deleteUser(id, true)
-- keeps the row, so every foreign key into it stays valid, but the account
-- can never sign in again). See process-account-deletions/index.ts for the
-- half of this that has to run through the auth admin API rather than SQL.

alter table public.user_profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.user_profiles.deletion_requested_at is
  'Set by the account holder to start the 30-day deletion countdown. Cleared automatically if they sign back in before it elapses.';
comment on column public.user_profiles.deleted_at is
  'Set only by the scheduled anonymization job once the 30 days have elapsed. Never set by the account holder directly.';

-- Extends the existing is_admin guard (20260824000300_guard_admin_flag.sql)
-- rather than adding a second trigger on the same table: deleted_at is the
-- same shape of problem (a system-managed flag a row-level UPDATE policy
-- can't by itself keep the owner from writing to).
create or replace function public.guard_user_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No end-user session behind the statement: the SQL editor, a migration,
  -- the service role, or the scheduled deletion job. That is where deleted_at
  -- has to be settable from, since the account holder can no longer sign in
  -- by the time it is.
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) then
      raise exception 'Only an administrator may grant administrator access.';
    end if;
    if new.deleted_at is not null then
      raise exception 'deleted_at cannot be set directly.';
    end if;
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin then
    raise exception 'Only an administrator may change administrator access.';
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'deleted_at cannot be set directly.';
  end if;

  if new.id is distinct from old.id then
    raise exception 'A profile cannot be reassigned to another user.';
  end if;

  return new;
end;
$$;

-- pg_cron schedules the daily sweep; pg_net is how that scheduled SQL job
-- reaches the Edge Function (SQL itself cannot call the auth admin API, and
-- the function needs that API to soft-delete a user).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A cron-only bearer secret, not the project's real service role key: the
-- function checks this header itself (see process-account-deletions/index.ts)
-- rather than trusting a Supabase-issued JWT, so nothing but this one value
-- ever has to live in the database. Generated fresh per-environment rather
-- than hardcoded here, since a literal secret in a migration file would be
-- permanently readable by anyone with repo access. After this runs, read it
-- back with `select decrypted_secret from vault.decrypted_secrets where name
-- = 'cron_secret_for_account_deletion'` and set that value as the
-- CRON_SECRET secret on the process-account-deletions Edge Function.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret_for_account_deletion') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret_for_account_deletion'
    );
  end if;
end;
$$;

select cron.schedule(
  'process-account-deletions-daily',
  '17 3 * * *',
  $$
  select net.http_post(
    url := 'https://zpjjuzyqtespmvisjkxm.supabase.co/functions/v1/process-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_for_account_deletion')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ------------------------------------------------------------------ check
-- As the account owner: `update user_profiles set deletion_requested_at =
-- now() where id = auth.uid()` succeeds; `update ... set deleted_at = now()`
-- is rejected with 'deleted_at cannot be set directly.'
--   select jobname, schedule from cron.job where jobname = 'process-account-deletions-daily';
