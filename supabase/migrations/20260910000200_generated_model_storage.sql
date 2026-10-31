-- Storage for models generated from a photograph.
--
-- A generation costs credits and produces a 5-7 MB .glb. Until now that file
-- existed only as a blob URL inside one browser tab: it died on reload, it
-- could not be reopened, and the only way to see it again was to pay for it
-- again. Keeping it removes that, and takes the bytes off the serverless
-- function, which was proxying the whole file on every load.
--
-- Path
-- ----
--   generated-models  {user_id}/{task_id}.glb
--
-- The first path segment is the row the object belongs to, the same shape
-- seller-documents and payment-receipts use. Keyed on the AUTH USER rather
-- than on a shop, because the only caller today is /dev/model-lab, which is
-- an admin tool with no shop behind it. When the shop flow lands, a shop's
-- generations are still its owner's, so this keeps working -- whereas keying
-- on a shop now would leave the lab with nothing to write under.
--
-- Private, like every other bucket here. A generated model is a shop's
-- unreleased product design; it does not belong on a URL that never expires.

insert into storage.buckets (id, name, public, file_size_limit)
values ('generated-models', 'generated-models', false, 33554432)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Owned by the user who generated it: only they may write or read it.
drop policy if exists "generated_models_own" on storage.objects;
create policy "generated_models_own" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'generated-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'generated-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins may read, so a generation can be inspected when a shop reports that
-- the pipeline made a mess of its photograph. Read only: nobody should be
-- able to alter the file a shop's template was built from.
drop policy if exists "generated_models_admin_read" on storage.objects;
create policy "generated_models_admin_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'generated-models' and public.is_admin());

-- ------------------------------------------------------------------ check
--   select id, public, file_size_limit from storage.buckets
--    where id = 'generated-models';
--
--   -- a user may write under their own id and nowhere else:
--   --   {auth.uid()}/01a0895f-....glb   ok
--   --   {someone else}/01a0895f-....glb  ERROR: new row violates row-level
--   --                                    security policy
