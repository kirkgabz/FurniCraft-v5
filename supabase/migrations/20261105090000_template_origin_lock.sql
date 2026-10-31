-- A piece made from a shop's published template carries that shop's id on the
-- piece itself (cad_state.items[].originShopId, written by the studio). Every
-- table that stores a design holds to it: an order, an order link or a
-- template containing such a piece may only belong to that shop, and a
-- customer's own saved designs and drafts may not contain one at all.
--
-- The studio already refuses all of this; this is the same rule where a
-- hand-made request cannot skip it. Only rows written from now on are
-- checked: the triggers fire on insert, and on updates that touch the design
-- or the shop, so quoting or completing an existing order is unaffected.
create or replace function public.enforce_template_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  origins text[];
begin
  if new.cad_state is null or jsonb_typeof(new.cad_state -> 'items') is distinct from 'array' then
    return new;
  end if;

  select array_agg(distinct item ->> 'originShopId')
    into origins
    from jsonb_array_elements(new.cad_state -> 'items') as item
   where jsonb_typeof(item) = 'object'
     and coalesce(item ->> 'originShopId', '') <> '';

  if origins is null then
    return new;
  end if;

  if tg_table_name = 'customer_designs' then
    raise exception 'A shop''s template cannot be saved to My templates.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from unnest(origins) as origin where origin <> new.shop_id::text) then
    raise exception 'This design is another shop''s template.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_template_origin on public.design_orders;
create trigger enforce_template_origin
  before insert or update of cad_state, shop_id on public.design_orders
  for each row execute function public.enforce_template_origin();

drop trigger if exists enforce_template_origin on public.design_templates;
create trigger enforce_template_origin
  before insert or update of cad_state, shop_id on public.design_templates
  for each row execute function public.enforce_template_origin();

drop trigger if exists enforce_template_origin on public.order_offers;
create trigger enforce_template_origin
  before insert or update of cad_state, shop_id on public.order_offers
  for each row execute function public.enforce_template_origin();

drop trigger if exists enforce_template_origin on public.customer_designs;
create trigger enforce_template_origin
  before insert or update of cad_state on public.customer_designs
  for each row execute function public.enforce_template_origin();
