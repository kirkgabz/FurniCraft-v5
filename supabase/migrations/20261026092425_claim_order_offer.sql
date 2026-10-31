-- Turning a shared link into a real order.
--
-- SECURITY DEFINER for one reason: the figures must come from the offer the
-- shop wrote, never from the browser claiming it. A client-side insert would
-- let the customer name their own price -- which, until
-- 20261026092444_customer_insert_cannot_self_quote, design_orders_insert_customer
-- actually allowed.
--
-- Returns the order id, and returns the same one if the same person follows
-- the link twice, so a double tap or a back button does not make two orders.
create or replace function public.claim_order_offer(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  offer public.order_offers;
  claimer uuid := auth.uid();
  new_order_id uuid;
begin
  if claimer is null then
    raise exception 'Sign in to accept this order.' using errcode = '28000';
  end if;

  select * into offer from public.order_offers where token = p_token;
  if not found then
    raise exception 'That link is not valid.' using errcode = 'P0002';
  end if;

  if offer.claimed_order_id is not null then
    if offer.claimed_by = claimer then
      return offer.claimed_order_id;
    end if;
    raise exception 'That link has already been used.' using errcode = 'P0001';
  end if;

  if offer.expires_at is not null and offer.expires_at <= now() then
    raise exception 'That link has expired.' using errcode = 'P0001';
  end if;

  if not public.shop_accepts_orders(offer.shop_id) then
    raise exception 'That workshop is not taking new orders right now.' using errcode = 'P0001';
  end if;

  if offer.created_by = claimer then
    raise exception 'This is your own offer, so there is nobody to order it from.' using errcode = 'P0001';
  end if;

  insert into public.design_orders
    (shop_id, customer_user_id, project_name, furniture_type, status,
     quoted_total, downpayment_percent, quoted_by, quoted_at,
     cad_state, preview_url, notes, reference_images)
  values
    (offer.shop_id, claimer, offer.project_name, offer.furniture_type, 'quoted',
     offer.quoted_total, offer.downpayment_percent, offer.created_by, now(),
     offer.cad_state, offer.preview_url, offer.notes, '[]'::jsonb)
  returning id into new_order_id;

  update public.order_offers
     set claimed_order_id = new_order_id,
         claimed_by = claimer,
         claimed_at = now()
   where id = offer.id;

  return new_order_id;
end;
$$;

revoke all on function public.claim_order_offer(text) from public, anon;
grant execute on function public.claim_order_offer(text) to authenticated;

-- ------------------------------------------------------------------ check
-- Capture the token as the SHOP (the recipient cannot read order_offers --
-- in the app the token comes from the URL, not a query), then claim it as
-- somebody else. Claiming twice must return the same order id; a second
-- person must be refused with "already been used"; the shop claiming its own
-- offer must be refused too.
