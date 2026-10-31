-- What the customer is willing to spend, replacing what the app used to guess.
--
-- `estimated_price` was a number FurniCraft invented: the studio priced the
-- design from its own materials table and wrote that figure onto the order.
-- It then seeded the shop's quote box, so the shop was quoting against the
-- app's arithmetic rather than its own, and the customer had been shown a
-- price nobody had agreed to. A furniture shop quotes bespoke work; software does
-- not.
--
-- A range rather than one number, because that is how a budget is actually
-- held: "somewhere between eight and twelve thousand" is a real answer and
-- "ten thousand" is a rounder, falser one. It gives the shop room to quote
-- inside it, or to say the piece cannot be built for that.
--
-- `estimated_price` is deliberately NOT dropped. Orders already sent carry
-- one, it is what their history and their totals were built from, and
-- dropping the column would rewrite the past to match a decision taken today.
-- Nothing writes it from here on; the app simply stops asking it for an
-- opinion.
alter table public.design_orders
  add column if not exists budget_min numeric,
  add column if not exists budget_max numeric;

-- Both or neither, never half a range, and never backwards. Orders that
-- predate this carry two nulls and stay valid.
alter table public.design_orders
  drop constraint if exists design_orders_budget_range_check;
alter table public.design_orders
  add constraint design_orders_budget_range_check check (
    (budget_min is null and budget_max is null)
    or (
      budget_min is not null
      and budget_max is not null
      and budget_min >= 0
      and budget_max >= budget_min
    )
  );

comment on column public.design_orders.budget_min is
  'Low end of the budget the customer stated when sending the order. Set once, on insert.';
comment on column public.design_orders.budget_max is
  'High end of the same range. See design_orders_budget_range_check.';

-- A budget is stated once and then stands.
--
-- Its own trigger rather than two more lines inside guard_design_order_columns:
-- that function is a per-role transition table two hundred lines long, and
-- reprinting the whole of it to add one rule is how the shops-table rename
-- broke five functions at once. This is also the rare rule that binds both
-- sides equally -- the shop must not edit the number it is quoting against,
-- and the customer must not move it after seeing the quote -- so it does not
-- belong in either of that function's role branches.
--
-- An admin is exempt, the same way the moderation columns are, because
-- correcting bad data is a real job and there is no other way to do it.
create or replace function public.guard_design_order_budget()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.budget_min is distinct from old.budget_min
     or new.budget_max is distinct from old.budget_max
  then
    raise exception 'A budget is stated once, when the order is sent, and cannot be changed afterwards.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_design_order_budget on public.design_orders;
create trigger guard_design_order_budget
  before update on public.design_orders
  for each row
  execute function public.guard_design_order_budget();
