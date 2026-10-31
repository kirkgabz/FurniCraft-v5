-- Room for a template's full material list.
--
-- design_templates_allowed_materials_sane capped the list at 160 ids and 6,000
-- characters. That was set when the catalogue had a few dozen finishes; with
-- every material in every colour it is 593 ids and about 12,300 characters, so
-- a shop ticking more than 160 of them could not publish the template at all
-- ("violates check constraint design_templates_allowed_materials_sane").
--
-- The app now saves "everything ticked" as null, which is what null already
-- means, so Select all never reaches this cap. This raises it for a large
-- partial selection: still a bound on the column, never one a real list hits.
--
-- Run this in the Supabase SQL editor.

alter table public.design_templates
  drop constraint if exists design_templates_allowed_materials_sane;

alter table public.design_templates
  add constraint design_templates_allowed_materials_sane
  check (
    allowed_materials is null
    or (
      array_length(allowed_materials, 1) <= 1000
      and array_position(allowed_materials, null) is null
      and char_length(array_to_string(allowed_materials, ',')) <= 40000
    )
  );

-- ------------------------------------------------------------------ check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'design_templates_allowed_materials_sane';
--   -- ... <= 1000 ... <= 40000
