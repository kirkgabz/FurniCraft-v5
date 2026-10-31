-- Every report must come with a photo as proof.
--
-- 20261026120000 added the photo and made the report dialog ask for one, but
-- the requirement lived only in the dialog: the database still took a report
-- with no photo, and the shop's "report a review" form never asked for one.
-- Both forms require it now, and so does the table:
--
--   * a new report must name a photo,
--   * the photo must sit in the reporter's own folder of report-photos (the
--     only place they can upload to), and
--   * it must already be uploaded -- a made-up path is refused.
--
-- Once filed, the photo cannot be swapped or removed by the reporter: it is
-- the evidence the ticket was decided on. Reports filed before this keep
-- their missing photo; nothing old is rejected.
--
-- Run this in the Supabase SQL editor.

create or replace function public.guard_report_photo()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  path text := btrim(coalesce(new.photo_path, ''));
begin
  if tg_op = 'UPDATE' then
    if new.photo_path is distinct from old.photo_path and not public.is_admin() then
      raise exception 'The photo on a report cannot be changed once it is sent.';
    end if;
    return new;
  end if;

  if path = '' then
    raise exception 'Attach a photo or screenshot as proof before sending a report.';
  end if;

  if split_part(path, '/', 1) <> new.reporter_user_id::text then
    raise exception 'The proof photo must be one you uploaded.';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'report-photos' and o.name = path
  ) then
    raise exception 'The proof photo was not uploaded. Attach it again and resend.';
  end if;

  new.photo_path := path;
  return new;
end;
$$;

revoke all on function public.guard_report_photo() from public, anon, authenticated;

drop trigger if exists guard_report_photo on public.reports;
create trigger guard_report_photo
  before insert or update of photo_path on public.reports
  for each row execute function public.guard_report_photo();

-- ------------------------------------------------------------------ check
--   insert into public.reports (reporter_user_id, target_type, target_id, reason)
--   values (auth.uid(), 'design_order', gen_random_uuid(), 'test');
--   -- fails: "Attach a photo or screenshot as proof before sending a report."
--   select count(*) filter (where photo_path is null) from public.reports;
--   -- older reports are untouched
