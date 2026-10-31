"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import OrderDetail from "@/components/orders/order-detail";

/**
 * An order opened without leaving the conversation it was mentioned in.
 *
 * Following an order card out of the chat used to mean a full navigation to
 * /protected/orders/[id]: the thread was replaced, and coming back meant
 * finding the conversation again. Quoting or approving a payment is usually
 * something you do *while* talking to the other party, so it belongs over the
 * conversation rather than instead of it.
 *
 * The page at that URL is unchanged and still works on its own -- notifications
 * and shared links point at it, and it is what someone lands on from outside
 * the app. This is the same component in a dialog.
 *
 * Loading happens here rather than in the caller because both dashboards need
 * it, and because the row is read fresh: the copy a dashboard already holds may
 * predate a quote the other party has since sent.
 */

const ORDER_COLUMNS =
  "id, shop_id, customer_user_id, project_name, furniture_type, estimated_price, budget_min, budget_max, cad_state, preview_url, notes, reference_images, status, created_at, quoted_total, downpayment_percent, quote_lines, customer_response, payment_receipt_url, payment_reference, payment_submitted_at, payment_approved_at, payment_rejected_reason, decline_reason";

type LoadedOrder = Parameters<typeof OrderDetail>[0]["order"];

export default function OrderDetailModal({
  orderId,
  onClose,
}: {
  /** null closes the dialog; an id opens it and loads that order. */
  orderId: string | null;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [order, setOrder] = useState<LoadedOrder | null>(null);
  const [shopName, setShopName] = useState("the shop");
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [viewerIsShop, setViewerIsShop] = useState(false);
  const [viewerIsCustomer, setViewerIsCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      setError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const viewerId = userData.user?.id ?? null;

      // Row-level security decides whether this returns anything, exactly as it
      // does for the page: an id alone is not access.
      const { data, error: readError } = await supabase
        .from("design_orders")
        .select(ORDER_COLUMNS)
        .eq("id", orderId)
        .maybeSingle();

      if (cancelled) return;
      if (readError || !data) {
        setError("That order could not be opened.");
        return;
      }

      const loaded = data as unknown as LoadedOrder;

      const { data: shop } = await supabase
        .from("shops_public")
        .select("shop_name, user_id, logo_url")
        .eq("id", loaded.shop_id)
        .maybeSingle();

      if (cancelled) return;
      const shopRow = shop as { shop_name?: string; user_id?: string; logo_url?: string | null } | null;
      let isOwner = Boolean(viewerId && shopRow?.user_id === viewerId);
      let name = shopRow?.shop_name ?? "the shop";

      if (!isOwner && viewerId) {
        const { data: myShop } = await supabase
          .from("shops")
          .select("id, shop_name, user_id")
          .eq("id", loaded.shop_id)
          .eq("user_id", viewerId)
          .maybeSingle();
        if (myShop) {
          isOwner = true;
          if (myShop.shop_name) name = myShop.shop_name;
        }
      }

      setOrder(loaded);
      setShopName(name);
      setShopLogoUrl(shopRow?.logo_url ?? null);
      setViewerIsShop(isOwner);
      setViewerIsCustomer(Boolean(viewerId && loaded.customer_user_id === viewerId));
      setError(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <Modal
      open={Boolean(orderId)}
      onClose={onClose}
      ariaLabel={order ? uiText("Order {0}", { 0: order.project_name }) : uiText("Order details")}
      eyebrow={uiText("Order detail")}
      title={order?.project_name ?? uiText("Opening order…")}
      className="sm:max-w-5xl"
    >
      {error ? (
        <p className="py-10 text-center text-sm text-[var(--fc-danger)]">{uiText(error)}</p>
      ) : !order ? (
        // Says what is happening rather than showing an empty dialog.
        <p className="py-10 text-center text-sm text-[var(--fc-muted)]">{uiText("Opening order…")}</p>
      ) : (
        <OrderDetail
          order={order}
          shopName={shopName}
          shopLogoUrl={shopLogoUrl}
          viewerIsCustomer={viewerIsCustomer}
          viewerIsShop={viewerIsShop}
          variant="modal"
          onLeave={onClose}
        />
      )}
    </Modal>
  );
}
