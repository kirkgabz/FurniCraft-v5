-- Lets a shop's template point at a model that was generated from a photo,
-- and lets a customer actually read that model.
--
-- The bucket in 20260910000200 grants read to the user who generated the file
-- and to admins. That is right for /dev/model-lab, where the only reader is
-- the person who paid for the generation. It is wrong the moment a shop
-- publishes a generated piece: the customer browsing that template is neither
-- the generating user nor an admin, so the .glb -- the entire model -- would
-- come back 403 while the rest of the page rendered fine.

-- Which stored object backs this template, if any. Null for the five shipped
-- models, which need no file of their own.
--
-- The path is ALSO carried inside cad_state, which is the copy that travels
-- with the design into an order and back into the studio. This column is a
-- deliberate denormalisation of it, and exists for exactly one reason: the
-- policy below has to be able to find a path without scanning jsonb on every
-- object read. Write both together or the model becomes unreadable.
alter table public.design_templates
  add column if not exists model_path text;

create index if not exists design_templates_model_path_idx
  on public.design_templates (model_path)
  where model_path is not null;

-- Publishing a template is what opens its model up for reading.
--
-- Keyed on the template row rather than on a published/visible flag, because
-- design_templates has no such flag -- a row existing IS the published state,
-- which is what "design_templates_select_all" already assumes. One condition,
-- no second thing to keep in step.
--
-- Read only, and deliberately no matching write policy: a customer being able
-- to see the model a shop offers must never become a customer being able to
-- replace it.
drop policy if exists "generated_models_read_published" on storage.objects;
create policy "generated_models_read_published" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'generated-models'
    and exists (
      select 1 from public.design_templates t
      where t.model_path = storage.objects.name
    )
  );

-- ------------------------------------------------------------------ check
--   -- a customer (neither owner nor admin) can read a published model:
--   --   select from storage.objects where name = '{other_user}/{task}.glb'
--   --   -> 0 rows before the template exists, 1 row after.
--
-- KNOWN GAP: deleting a template revokes access to the model behind any
-- order already placed against it, because this policy asks only about
-- design_templates. Whichever lands first -- extending this to design_orders,
-- or soft-deleting templates that have orders -- closes it. Left open rather
-- than guessed at, since the order queue likely wants soft-delete anyway.
