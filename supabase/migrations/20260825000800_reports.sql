-- Reporting and moderation: anyone signed in can report a message, a shop or an
-- order; only admins can see the queue or act on it.
--
-- A reporter can see their own reports so the UI can say "you already reported
-- this", but the moderation columns are admin-only. As always, row-level
-- policies cannot restrict columns, so the split is enforced by a trigger.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  -- What is being reported. Kept as a loose (type, id) pair rather than three
  -- nullable foreign keys, because the three targets live in unrelated tables.
  target_type text not null check (target_type in ('shop_message', 'shop', 'design_order')),
  target_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- The queue is "open reports, newest first"; the duplicate check is by target.
create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);
create index if not exists reports_target_idx
  on public.reports (target_type, target_id);
create index if not exists reports_reporter_idx
  on public.reports (reporter_user_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports_select_own_or_admin" on public.reports;
create policy "reports_select_own_or_admin" on public.reports
  for select to authenticated
  using (reporter_user_id = auth.uid() or public.is_admin());

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (reporter_user_id = auth.uid());

-- Reporters can update their own report only to correct what they wrote; the
-- trigger below is what stops them from resolving it. Admins may do either.
drop policy if exists "reports_update_own_or_admin" on public.reports;
create policy "reports_update_own_or_admin" on public.reports
  for update to authenticated
  using (reporter_user_id = auth.uid() or public.is_admin())
  with check (reporter_user_id = auth.uid() or public.is_admin());

revoke all on public.reports from anon, authenticated;
grant select, insert, update on public.reports to authenticated;

-- Moderation is not the reporter's to perform. Anything a non-admin changes in
-- the moderation columns is rejected outright rather than silently ignored.
create or replace function public.guard_report_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.resolution_note is distinct from old.resolution_note
     or new.resolved_by is distinct from old.resolved_by
     or new.resolved_at is distinct from old.resolved_at
  then
    raise exception 'Only an administrator may moderate a report.';
  end if;

  if new.reporter_user_id is distinct from old.reporter_user_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
  then
    raise exception 'A report cannot be reassigned to another target or reporter.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_report_moderation() from public, anon, authenticated;

drop trigger if exists guard_report_moderation on public.reports;
create trigger guard_report_moderation
  before update on public.reports
  for each row execute function public.guard_report_moderation();

-- Tell the reporter when their report is closed out.
create or replace function public.notify_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('resolved', 'dismissed')
  then
    perform public.emit_notification(
      new.reporter_user_id,
      'report_' || new.status,
      case new.status
        when 'resolved' then 'Your report was actioned'
        else 'Your report was reviewed'
      end,
      coalesce(new.resolution_note, new.reason),
      '/protected',
      new.resolved_by,
      'report',
      new.id
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notify_report_resolved failed for report %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_report_resolved() from public, anon, authenticated;

drop trigger if exists notify_report_resolved on public.reports;
create trigger notify_report_resolved
  after update on public.reports
  for each row execute function public.notify_report_resolved();

-- ------------------------------------------------------------------ check
--   select status, count(*) from public.reports group by 1;
-- A non-admin attempting to resolve should raise:
--   'Only an administrator may moderate a report.'
