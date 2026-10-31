-- A photo attached to every report.
--
-- The report dialog now requires the reporter to describe the problem and to
-- attach one screenshot or photo of it, so the person reading the ticket sees
-- what the reporter saw.
--
-- Additive only: one nullable column and one private bucket. Existing reports
-- keep a null photo_path and read exactly as before; the requirement lives in
-- the dialog, not in a NOT NULL that older rows could never satisfy.

alter table public.reports add column if not exists photo_path text;

-- ------------------------------------------------------------- the bucket
-- Private, read through signed URLs like chat photos and receipts. Paths are
-- "<reporter user id>/<file>", and the policies read the owner out of that
-- first segment, so lib/report-photos.ts is the only place that builds one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- The reporter may upload into, read and remove from their own folder only.
-- Removing is there so a report that fails to save does not strand its photo.
drop policy if exists "report_photos_own" on storage.objects;
create policy "report_photos_own" on storage.objects
  for all to authenticated
  using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'report-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Admins read every report photo, which is the point of attaching one. The
-- reported shop or person never can.
drop policy if exists "report_photos_read_admin" on storage.objects;
create policy "report_photos_read_admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'report-photos' and public.is_admin());

-- ------------------------------------------------------------------ check
--   select column_name from information_schema.columns
--     where table_schema = 'public' and table_name = 'reports' and column_name = 'photo_path';
--   select id, public, file_size_limit from storage.buckets where id = 'report-photos';  -- f, 5242880
