// Reads the signed-in user's session, so this segment blocks rather than
// prerendering a shell -- the same convention /protected and /admin use.
export const instant = false;

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OrderDetail from "@/components/orders/order-detail";

/**
 * A single order, addressable by URL.
 *
 * This exists so the chat cards and notifications have somewhere to point.
 * Before it, an order could only be reached by opening a dashboard and clicking
 * through to it, which is not something a link can do.
 *
 * Access is decided by row-level security rather than by this page: the select
 * below returns a row only for the customer who placed the order or the shop
 * that received it, so an id in the URL is not a way in. A miss becomes a 404
 * rather than a redirect, so the route does not confirm that an order exists.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();

  const { data: order } = await supabase
    .from("design_orders")
    .select(
      "id, shop_id, customer_user_id, project_name, furniture_type, estimated_price, budget_min, budget_max, cad_state, preview_url, notes, reference_images, status, created_at, quoted_total, downpayment_percent, downpayment_amount, quote_lines, customer_response, payment_receipt_url, payment_reference, payment_submitted_at, payment_approved_at, payment_rejected_reason, decline_reason"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  // user_id identifies the owner, which decides whether this viewer
  // gets the shop's actions. Read from shops_public, fallback to shops.
  const { data: shop } = await supabase
    .from("shops_public")
    .select("shop_name, user_id, logo_url")
    .eq("id", order.shop_id)
    .maybeSingle();

  const shopRow = shop as { shop_name?: string; user_id?: string; logo_url?: string | null } | null;
  let isShopOwner = Boolean(shopRow?.user_id && shopRow.user_id === userData.user.id);
  let shopName = shopRow?.shop_name ?? "the shop";

  if (!isShopOwner) {
    const { data: myShop } = await supabase
      .from("shops")
      .select("id, shop_name, user_id")
      .eq("id", order.shop_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (myShop) {
      isShopOwner = true;
      if (myShop.shop_name) shopName = myShop.shop_name;
    }
  }

  return (
    <OrderDetail
      order={order}
      shopName={shopName}
      shopLogoUrl={shopRow?.logo_url ?? null}
      viewerIsCustomer={order.customer_user_id === userData.user.id}
      viewerIsShop={isShopOwner}
    />
  );
}
