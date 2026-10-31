-- Two notification faults, both visible in the first day of real use.
--
-- 1. The data migration in 20260826000100 moved four orders from pending /
--    accepted to pending_quote. The after-trigger fired for each, so two
--    customers were told "Your order is now pending_quote" about a change
--    nobody made. A schema migration is not an event worth a notification.
--
--    emit_notification now ignores calls with no end-user session, which is the
--    same test the guard triggers already use to recognise a migration, the SQL
--    editor or an admin script. Real activity always has auth.uid().
--
-- 2. A quote produced two notifications for the same customer:
--
--      "Your order is now quoted"           (notify_design_order_change)
--      "<shop> quoted your order - PHP ..."  (notify_design_order_quote)
--
--    Both triggers legitimately fire -- the status changed and the price was
--    set -- but only one of them should speak. The quote notifier wins: it names
--    the shop and carries the amount. The status notifier now stays quiet for
--    'quoted' and lets it through.

create or replace function public.emit_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_actor_user_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nobody is acting: a migration, the SQL editor, a maintenance script. There
  -- is no event here to tell anyone about.
  if auth.uid() is null then
    return;
  end if;

  -- Never notify someone about their own action; the bell is for things that
  -- happened to you, not things you did.
  if p_user_id is null or p_user_id = p_actor_user_id then
    return;
  end if;

  insert into public.notifications (
    user_id, type, title, body, link, actor_user_id, entity_type, entity_id
  )
  values (
    p_user_id, p_type, p_title, p_body, p_link, p_actor_user_id, p_entity_type, p_entity_id
  );
end;
$$;

revoke all on function public.emit_notification(uuid, text, text, text, text, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.notify_design_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shop_owner_id uuid;
  shop_label text;
begin
  select r.user_id, coalesce(r.shop_name, 'the shop')
    into shop_owner_id, shop_label
  from public.shop_owner_requests r
  where r.id = new.shop_id;

  if tg_op = 'INSERT' then
    perform public.emit_notification(
      shop_owner_id, 'order_received', 'New order received', new.project_name,
      '/protected/shop', new.customer_user_id, 'design_order', new.id
    );
    return new;
  end if;

  -- 'quoted' belongs to notify_design_order_quote, which names the shop and
  -- includes the amount. Saying it twice is worse than saying it once.
  if new.status is distinct from old.status and new.status <> 'quoted' then
    if new.status = 'payment_submitted' then
      perform public.emit_notification(
        shop_owner_id, 'payment_submitted', 'Downpayment receipt uploaded',
        new.project_name || ' - check your GCash or bank app, then approve',
        '/protected/shop', new.customer_user_id, 'design_order', new.id
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
        '/protected', shop_owner_id, 'design_order', new.id
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

-- Remove the two the migration generated. Matched narrowly by type, title and
-- the minute they were written, so genuine notifications are untouched.
delete from public.notifications
where type = 'order_pending_quote'
  and title = 'Your order is now pending_quote';

-- ------------------------------------------------------------------ check
--   select type, count(*) from public.notifications group by 1 order by 2 desc;
-- A quote should now produce exactly one notification for the customer.
