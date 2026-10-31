-- Which finishes a shop will actually build a template in.
--
-- A shop that only works in solid hardwood should not have a customer send them
-- an order in "Blush linen" and have to decline it, or worse, quote it. The
-- restriction belongs on the template because it is a property of that design
-- as the shop offers it, not of the shop as a whole -- the same furniture shop may
-- offer a dining chair in six woods and an upholstered tub chair in four
-- fabrics.
--
-- A separate column rather than a key inside cad_state: cad_state is the
-- customer's saved design, round-tripped through the studio and rewritten every
-- time they change a leg height. A shop's restriction is not the customer's to
-- carry, and burying it there would mean the studio could silently drop it.

alter table public.design_templates
  add column if not exists allowed_materials text[];

comment on column public.design_templates.allowed_materials is
  'Material ids a customer may choose for this template. NULL means no restriction.';

-- NULL and {} are different answers and the difference matters: NULL is "the
-- shop never said", which every existing template is and which must keep
-- meaning "all materials allowed". An empty array would mean "the shop allowed
-- nothing", which is never a useful thing to save, so it is refused rather than
-- left to be misread as the former.
alter table public.design_templates
  drop constraint if exists design_templates_allowed_materials_not_empty;
alter table public.design_templates
  add constraint design_templates_allowed_materials_not_empty
  check (allowed_materials is null or array_length(allowed_materials, 1) >= 1);

-- A cap, so the column cannot be used to store something it is not.
--
-- Expressed with array operators rather than `not exists (select ... unnest)`:
-- a CHECK constraint may not contain a subquery, and array_to_string bounds
-- the total payload without needing to walk the elements one at a time.
alter table public.design_templates
  drop constraint if exists design_templates_allowed_materials_sane;
alter table public.design_templates
  add constraint design_templates_allowed_materials_sane
  check (
    allowed_materials is null
    or (
      array_length(allowed_materials, 1) <= 40
      and array_position(allowed_materials, null) is null
      and char_length(array_to_string(allowed_materials, ',')) <= 2000
    )
  );

-- ------------------------------------------------------------------ check
--   update public.design_templates set allowed_materials = '{}' where id = '<t>';
--     -- expect 23514 (empty is not "unrestricted"; use NULL)
--   update public.design_templates set allowed_materials = '{oak,walnut}' where id = '<t>';
--     -- expect success
--   select count(*) from public.design_templates where allowed_materials is null;
--     -- every pre-existing template: unrestricted, as before
