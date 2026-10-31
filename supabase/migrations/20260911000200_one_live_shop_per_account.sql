-- One live shop per account.
--
-- Nothing stopped an account from holding several pending-or-approved shop
-- rows, and one did: an application was left pending while a later one from
-- the same account was approved. Every lookup in the app that asks for "this
-- user's shop" expects a single row, and PostgREST answers two with an error
-- rather than a row -- so an approved owner was told they had no shop at all.
-- The dashboards now choose between rows, and the application form now
-- refuses a second application, but the invariant belongs here, where no
-- screen can get it wrong.
--
-- Rejected rows are outside the rule on purpose: they are history, and a
-- rejected applicant must be able to apply again.

-- 1. Settle any account that already breaks the rule, the same way the
--    dashboards choose: an approved shop outranks a pending application, and
--    the newest wins within each. The others are rejected rather than
--    deleted, so the application and the documents uploaded with it stay on
--    record. Without this the index below cannot be built.
--
--    guard_shop_request_status refuses any status change not made by an
--    admin, and a migration runs with no signed-in user at all -- so the
--    guard is stood down for this one statement and restored straight after.
--    ALTER TABLE holds an exclusive lock on shops until this migration
--    commits, so nothing else can change a status while the guard is off.
alter table public.shops disable trigger guard_shop_request_status;

with ranked as (
  select id,
         row_number() over (
           partition by user_id
           order by (status = 'approved') desc, created_at desc
         ) as keep_rank
    from public.shops
   where status in ('pending', 'approved')
)
update public.shops s
   set status = 'rejected',
       updated_at = now()
  from ranked r
 where s.id = r.id
   and r.keep_rank > 1;

alter table public.shops enable trigger guard_shop_request_status;

-- 2. The rule. A second live application now fails at the database, whatever
--    screen or script sends it.
create unique index if not exists shops_one_live_per_user
  on public.shops (user_id)
  where status in ('pending', 'approved');

-- ------------------------------------------------------------------ check
--   select user_id, count(*) from public.shops
--    where status in ('pending', 'approved')
--    group by user_id having count(*) > 1;      -- no rows
--
--   -- a second pending application for an account with a live shop:
--   --   ERROR: duplicate key value violates unique constraint
--   --          "shops_one_live_per_user"
