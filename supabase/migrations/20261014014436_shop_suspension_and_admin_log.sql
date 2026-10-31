alter table public.shops
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by uuid references auth.users(id) on delete set null;

comment on column public.shops.suspended_at is
  'When an administrator withdrew this shop''s listing. Null means not suspended. Distinct from is_active, which is the owner''s own switch.';
comment on column public.shops.suspended_reason is
  'Why the listing was withdrawn, shown to the shop owner.';

create or replace view public.shops_public as
 select id,
    user_id,
    shop_name,
    description,
    address,
    tagline,
    cover_image_url,
    gallery,
    phone,
    hours,
    policies,
    social_links,
    map_url,
    allowed_materials,
    logo_url,
    accepting_orders
   from shops
  where status = 'approved'::text and is_active and suspended_at is null;

create or replace function public.shop_accepts_orders(shop uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shops r
    where r.id = shop
      and r.status = 'approved'
      and r.is_active
      and r.suspended_at is null
  );
$$;

revoke all on function public.shop_accepts_orders(uuid) from public, anon;
grant execute on function public.shop_accepts_orders(uuid) to authenticated;

create or replace function public.set_shop_suspension(
  p_shop_id uuid,
  p_suspend boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may withdraw or restore a shop listing.';
  end if;

  if p_suspend and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required when withdrawing a shop listing.';
  end if;

  update public.shops
     set suspended_at = case when p_suspend then now() else null end,
         suspended_reason = case when p_suspend then btrim(p_reason) else null end,
         suspended_by = case when p_suspend then auth.uid() else null end
   where id = p_shop_id
  returning shop_name, user_id into v_name, v_owner;

  if v_name is null then
    raise exception 'That shop does not exist.';
  end if;

  perform public.emit_notification(
    v_owner,
    case when p_suspend then 'shop_suspended' else 'shop_reinstated' end,
    case when p_suspend then 'Your shop listing has been withdrawn'
         else 'Your shop listing has been restored' end,
    case when p_suspend then btrim(p_reason)
         else 'Your shop is listed to customers again and can take new orders.' end,
    '/protected/shop',
    auth.uid(),
    'shop',
    p_shop_id,
    'shop'
  );
end;
$$;

revoke all on function public.set_shop_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.set_shop_suspension(uuid, boolean, text) to authenticated;

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  subject_table text not null,
  subject_id uuid,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_subject_idx on public.admin_actions (subject_table, subject_id);

comment on table public.admin_actions is
  'Append-only record of administrator actions. Written by triggers; no update or delete policy exists, so an entry cannot be edited away.';

alter table public.admin_actions enable row level security;

drop policy if exists "admin_actions_select_admin" on public.admin_actions;
create policy "admin_actions_select_admin" on public.admin_actions
  for select to authenticated
  using (public.is_admin());

create or replace function public.log_admin_action(
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    return;
  end if;

  insert into public.admin_actions (admin_user_id, action, subject_table, subject_id, detail)
  values (auth.uid(), p_action, p_subject_table, p_subject_id, nullif(btrim(p_detail), ''));
end;
$$;

revoke all on function public.log_admin_action(text, text, uuid, text) from public, anon, authenticated;

create or replace function public.log_shop_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.log_admin_action('shop_' || new.status, 'shops', new.id, new.shop_name);
  end if;

  if (new.suspended_at is null) is distinct from (old.suspended_at is null) then
    perform public.log_admin_action(
      case when new.suspended_at is not null then 'shop_suspended' else 'shop_reinstated' end,
      'shops', new.id,
      coalesce(new.suspended_reason, new.shop_name)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists log_shop_admin_action on public.shops;
create trigger log_shop_admin_action
  after update on public.shops
  for each row execute function public.log_shop_admin_action();

create or replace function public.log_report_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('resolved', 'dismissed') then
    perform public.log_admin_action('ticket_' || new.status, 'reports', new.id, new.resolution_note);
  end if;
  return new;
end;
$$;

drop trigger if exists log_report_admin_action on public.reports;
create trigger log_report_admin_action
  after update on public.reports
  for each row execute function public.log_report_admin_action();

create or replace function public.log_subscription_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.log_admin_action(
      'subscription_' || new.status, 'subscription_payments', new.id,
      coalesce(new.rejected_reason, new.reference)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_subscription_admin_action on public.subscription_payments;
create trigger log_subscription_admin_action
  after update on public.subscription_payments
  for each row execute function public.log_subscription_admin_action();
