-- Point order notifications at the order.
--
-- Every order notification linked to '/protected' or '/protected/shop' -- the
-- dashboard, not the thing that happened. Clicking "Mark Furniture Shop quoted
-- your order" dropped you on the overview to go find it yourself. That was the
-- best available target when these triggers were written, because an order had
-- no URL of its own.
--
-- app/protected/orders/[id] now gives it one, and it serves either party: the
-- select behind it is subject to the order's row policies, so the customer and
-- the shop each see it and nobody else does.

create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
  order_link text := '/protected/orders/' || new.id::text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    perform public.emit_notification(
      shop_owner_id, 'order_received', 'New order received', new.project_name,
      order_link, new.customer_user_id, 'design_order', new.id
    );
    return new;
  end if;

  -- 'quoted' belongs to notify_design_order_quote, which names the shop and
  -- includes the amount.
  if new.status is distinct from old.status and new.status <> 'quoted' then
    if new.status = 'payment_submitted' then
      perform public.emit_notification(
        shop_owner_id, 'payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        order_link, new.customer_user_id, 'design_order', new.id
      );
    else
      perform public.emit_notification(
        new.customer_user_id,
        'order_' || new.status,
        case new.status
          when 'declined'      then shop_label || ' declined your order'
          when 'in_production' then shop_label || ' confirmed your payment'
          when 'completed'     then shop_label || ' completed your order'
          when 'confirmed'     then 'Downpayment due for your order'
          else 'Your order is now ' || replace(new.status, '_', ' ')
        end,
        new.project_name,
        order_link, shop_owner_id, 'design_order', new.id
      );
    end if;
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_change failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_change() from public, anon, authenticated;

create or replace function public.notify_design_order_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
  order_link text := '/protected/orders/' || new.id::text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if new.quoted_total is not null
     and (old.quoted_total is distinct from new.quoted_total
          or old.downpayment_percent is distinct from new.downpayment_percent)
  then
    perform public.emit_notification(
      new.customer_user_id,
      'order_quoted',
      shop_label || ' quoted your order',
      new.project_name || ' - PHP ' || to_char(new.quoted_total, 'FM999G999G990D00'),
      order_link, shop_owner_id, 'design_order', new.id
    );
  end if;

  if new.customer_response is distinct from old.customer_response
     and new.customer_response is not null
  then
    perform public.emit_notification(
      shop_owner_id,
      'order_' || new.customer_response,
      case new.customer_response
        when 'confirmed' then 'Customer confirmed your quote'
        else 'Customer declined your quote'
      end,
      new.project_name,
      order_link, new.customer_user_id, 'design_order', new.id
    );
  end if;

  return new;
exception
  when others then
    raise warning 'notify_design_order_quote failed for order %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.notify_design_order_quote() from public, anon, authenticated;

-- Existing rows still point at a dashboard. They carry the order in entity_id,
-- so they can be repaired rather than left as the odd ones out.
update public.notifications
set link = '/protected/orders/' || entity_id::text
where entity_type = 'design_order'
  and entity_id is not null
  and link in ('/protected', '/protected/shop');

-- ------------------------------------------------------------------ check
--   select link, count(*) from public.notifications group by 1 order by 2 desc;
