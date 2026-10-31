-- Lets a shop hide a template from customers without deleting it.
--
-- A shop that has stopped stocking a timber, or wants a piece off the shelf
-- for a season, had one option: delete the template, and with it the work of
-- generating and naming it. A hidden template stays in the shop's own list,
-- marked hidden, and comes back with one tap.
--
-- Hidden is enforced here, not only in the pages: customers cannot read a
-- hidden template at all, whichever query asks. The owning shop still can, so
-- it can see and un-hide it. Orders already placed from a template are not
-- affected; an order carries its own copy of the design (cad_state).

alter table public.design_templates
  add column if not exists is_hidden boolean not null default false;

comment on column public.design_templates.is_hidden is
  'Hidden by the shop: invisible to customers, still listed for the shop that owns it.';

-- Replaces "any signed-in user reads every template".
drop policy if exists "design_templates_select_all" on public.design_templates;
drop policy if exists "design_templates_select_visible" on public.design_templates;
create policy "design_templates_select_visible" on public.design_templates
  for select using (
    auth.uid() is not null
    and (
      not is_hidden
      or exists (
        select 1 from public.shops s
        where s.id = design_templates.shop_id and s.user_id = auth.uid()
      )
    )
  );

-- The shop's own list asks for its templates newest first; the customer
-- feed asks for visible ones. Both are served by the shop_id lookup that
-- already exists, so no new index.
