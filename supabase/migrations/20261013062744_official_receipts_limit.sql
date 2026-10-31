-- The ten-receipt cap, moved out of the insert policy.
--
-- 20261013062618_official_receipts counted an order's receipts inside
-- order_official_receipts' own insert policy. Postgres treats a policy that
-- reads its own table as infinite recursion and refuses every insert, so no
-- shop could attach a receipt at all. A trigger counts without going through
-- the policies, and can say what is wrong in words.
--
-- Safe to re-run.

drop policy if exists "order_official_receipts_insert_shop" on public.order_official_receipts;
create policy "order_official_receipts_insert_shop" on public.order_official_receipts
  for insert to authenticated
  with check (
    issued_by = auth.uid()
    and exists (
      select 1 from public.design_orders o
      join public.shops s on s.id = o.shop_id
      where o.id = order_official_receipts.order_id
        and s.user_id = auth.uid()
        and o.status in ('in_production', 'completed')
    )
  );

create or replace function public.guard_official_receipt_count()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Ten is far more than a downpayment and a balance need, and stops a
  -- runaway client.
  if (select count(*) from public.order_official_receipts r where r.order_id = new.order_id) >= 10 then
    raise exception 'An order can have at most ten receipts. Remove one before attaching another.';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_official_receipt_count on public.order_official_receipts;
create trigger guard_official_receipt_count
  before insert on public.order_official_receipts
  for each row execute function public.guard_official_receipt_count();
