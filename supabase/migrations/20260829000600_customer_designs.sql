-- The customer's own work in the studio: drafts kept automatically so nothing
-- is lost by closing a tab, and designs they have explicitly named and saved.
--
-- "My templates" previously showed only shop-published templates, which meant
-- a customer's own in-progress or finished designs had nowhere to live between
-- sessions except localStorage on one browser. This is that missing storage --
-- owned by the customer, never touched by a shop, and distinct from
-- design_templates (which a shop publishes for others to start from) and
-- design_orders (a design once it has actually been sent to a shop).
create table if not exists public.customer_designs (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  furniture_type text,
  cad_state jsonb not null,
  preview_url text,
  -- 'draft': kept automatically while the customer works, never named by them.
  -- 'saved': the customer explicitly chose to keep this one under a name.
  -- The distinction is only ever surfaced to the customer -- both kinds are
  -- written and read the same way, by the same owner.
  kind text not null default 'draft' check (kind in ('draft', 'saved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_designs_customer_idx
  on public.customer_designs (customer_user_id, updated_at desc);

alter table public.customer_designs enable row level security;

drop policy if exists "customer_designs_select_owner" on public.customer_designs;
create policy "customer_designs_select_owner" on public.customer_designs
  for select using (customer_user_id = auth.uid());

drop policy if exists "customer_designs_insert_owner" on public.customer_designs;
create policy "customer_designs_insert_owner" on public.customer_designs
  for insert with check (customer_user_id = auth.uid());

drop policy if exists "customer_designs_update_owner" on public.customer_designs;
create policy "customer_designs_update_owner" on public.customer_designs
  for update using (customer_user_id = auth.uid())
  with check (customer_user_id = auth.uid());

drop policy if exists "customer_designs_delete_owner" on public.customer_designs;
create policy "customer_designs_delete_owner" on public.customer_designs
  for delete using (customer_user_id = auth.uid());

revoke all on public.customer_designs from anon;
grant select, insert, update, delete on public.customer_designs to authenticated;

-- Keeps updated_at honest on every autosave/rename without every call site
-- having to remember to set it.
create or replace function public.touch_customer_design_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists touch_customer_design_updated_at on public.customer_designs;
create trigger touch_customer_design_updated_at
  before update on public.customer_designs
  for each row execute function public.touch_customer_design_updated_at();
