"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { followDeepLink } from "@/lib/deep-link";
import { useUnreadOrderActions } from "@/components/orders/use-unread-order-actions";
import { createClient } from "@/lib/supabase/client";
import { sendOrderReadyEmail } from "@/lib/order-ready-email";
import { openItemInDesigner, resolveDesignItem } from "@/components/design/design-state-utils";
import {
  DOWNPAYMENT_MIN_PERCENT,
  customerCanCancel,
  customerCanMove,
  downpaymentOf,
  formatPeso,
  orderStatusMeta,
  shopCanMove,
} from "@/components/orders/order-status";
import { QR_BUCKET, RECEIPT_BUCKET, signedUrlFor, uploadReceipt } from "@/components/orders/payment-proof";
import OrderStepper from "@/components/orders/order-stepper";
import ConfirmModal from "@/components/ui/confirm-modal";
import CommissionPath from "@/components/solihiya/commission-path";
import {
  CopyField,
  OrderDesignColumn,
  OrderPartyCard,
  QuoteFigures,
  ShopPaymentDetailsCard,
  SideCard,
  type ReferenceImage,
  type ShopPaymentInfo,
} from "@/components/orders/order-workspace";
import OrderCosting from "@/components/orders/order-costing";
import ProductionSchedule from "@/components/orders/production-schedule";
import { orderSuccessMessage } from "@/components/orders/order-success";
import { notifySuccess } from "@/lib/saved-notice";
import { touchShopActivity } from "@/lib/shop-activity";
import { QuoteLinesEditor } from "@/components/orders/quote-breakdown";
import {
  draftTotal,
  draftsFromLines,
  parseQuoteLines,
  quoteFormUnchanged,
  resolveQuote,
  type QuoteLineDraft,
} from "@/components/orders/quote-lines";
import ShopReviews from "@/components/reviews/shop-reviews";

/**
 * One order, addressable by URL, and workable by whoever opened it.
 *
 * This started read-only, which turned out to be the wrong call: an order card
 * in the chat is exactly where a shop first sees a new order, and following it
 * here left them with nothing to do but go find the same order again in their
 * dashboard. So the actions live here too.
 *
 * Which actions appear comes from shopCanMove / customerCanMove -- the UI's copy
 * of the transition table the database enforces in guard_design_order_columns.
 * If the two ever disagree the database wins and the write is rejected, which is
 * why every failure below is surfaced rather than swallowed.
 */

type Order = {
  id: string;
  shop_id: string;
  // Needed so the shop can be sent to this customer's conversation.
  customer_user_id: string;
  project_name: string;
  furniture_type: string | null;
  estimated_price?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
  cad_state: unknown;
  preview_url: string | null;
  notes: string | null;
  reference_images: ReferenceImage[] | null;
  status: string;
  created_at: string;
  quoted_total: number | null;
  /** The shop's breakdown of quoted_total; see quote-lines.ts. */
  quote_lines?: unknown;
  downpayment_percent: number | null;
  customer_response: string | null;
  payment_receipt_url: string | null;
  payment_reference: string | null;
  payment_submitted_at: string | null;
  payment_approved_at: string | null;
  payment_rejected_reason?: string | null;
  decline_reason: string | null;
};

/**
 * The tabs under the stepper, the same as the order dialogs in
 * shop-dashboard-page.tsx and sections/orders-section.tsx. "party" is the
 * other side of the order: the customer for a shop, the shop for a customer.
 */
type DetailTab = "design" | "quote" | "costing" | "party";
const SHOP_TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: "design", label: "Design" },
  { id: "quote", label: "Quote" },
  { id: "costing", label: "Cost sheet" },
  { id: "party", label: "Message customer" },
];
const CUSTOMER_TABS: ReadonlyArray<{ id: DetailTab; label: string }> = [
  { id: "design", label: "Design" },
  { id: "quote", label: "Quote" },
  { id: "party", label: "Message shop" },
];

/**
 * The chrome around the order, on its own page or inside a dialog.
 *
 * Defined here at module scope rather than inside OrderDetail's render body,
 * where it previously lived. A component defined inside another component's
 * function is a brand-new function value on every render, so React sees a
 * different element type each time and destroys the whole subtree to build a
 * fresh one -- every DOM node under it, including whatever the person had just
 * typed or selected. For most of this page that only cost an animation; for
 * the receipt file input it cost the file itself, silently, on the next
 * re-render after they chose one -- which is a near-certainty for a real
 * payment, since choosing a receipt means leaving to check GCash and coming
 * back, not a same-second action.
 */
function Shell({ variant, children }: { variant: "page" | "modal"; children: React.ReactNode }) {
  return variant === "modal" ? (
    <div className="min-w-0">{children}</div>
  ) : (
    <main className="min-h-screen bg-[var(--fc-bg)] px-5 py-8 text-[var(--fc-text)]">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}

export default function OrderDetail({
  order: initialOrder,
  shopName,
  shopLogoUrl = null,
  viewerIsCustomer,
  viewerIsShop,
  variant = "page",
  onLeave,
}: {
  order: Order;
  shopName: string;
  /** shops_public.logo_url; null shows the shop's initials. */
  shopLogoUrl?: string | null;
  viewerIsCustomer: boolean;
  viewerIsShop: boolean;
  /** "modal" drops the page chrome the surrounding dialog already provides. */
  variant?: "page" | "modal";
  /** Closes the surrounding dialog before Message takes the viewer to the chat. */
  onLeave?: () => void;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [order, setOrder] = useState(initialOrder);
  useUnreadOrderActions(
    viewerIsCustomer ? order.customer_user_id : null,
    viewerIsCustomer ? order.id : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Empty unless already quoted. Seeding it from estimated_price meant the
  // shop was handed the app's own guess to confirm; the customer's budget sits
  // beside the box as context instead.
  const [quoteTotal, setQuoteTotal] = useState(
    initialOrder.quoted_total != null ? String(initialOrder.quoted_total) : ""
  );
  const [quoteLineDrafts, setQuoteLineDrafts] = useState<QuoteLineDraft[]>(() =>
    draftsFromLines(parseQuoteLines(initialOrder.quote_lines))
  );
  const [quotePercent, setQuotePercent] = useState(
    initialOrder.downpayment_percent != null
      ? String(initialOrder.downpayment_percent)
      : "30"
  );
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [shopPayment, setShopPayment] = useState<ShopPaymentInfo | null>(null);
  const [shopQrUrl, setShopQrUrl] = useState<string | null>(null);
  /**
   * Which way this order is being ended or rejected, while the reason is collected.
   *
   * Every route to "declined" or "receipt mismatch" asks for a reason now, not just the shop's.
   */
  const [declineIntent, setDeclineIntent] = useState<null | "customer-quote" | "customer-cancel" | "shop" | "shop-receipt-mismatch">(null);

  const tabs = viewerIsShop ? SHOP_TABS : CUSTOMER_TABS;
  const [tab, setTab] = useState<DetailTab>("design");

  const meta = orderStatusMeta(order.status);
  const due = downpaymentOf(
    order.quoted_total == null ? null : Number(order.quoted_total),
    order.downpayment_percent == null ? null : Number(order.downpayment_percent)
  );

  // A shop working an order counts as activity for the inactivity rule.
  useEffect(() => {
    if (viewerIsShop) void touchShopActivity();
  }, [viewerIsShop]);

  const lastOrderIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (order.id !== lastOrderIdRef.current) {
      lastOrderIdRef.current = order.id;
      setQuoteTotal(order.quoted_total != null ? String(order.quoted_total) : "");
      setQuoteLineDrafts(draftsFromLines(parseQuoteLines(order.quote_lines)));
      setQuotePercent(
        order.downpayment_percent != null
          ? String(order.downpayment_percent)
          : "30"
      );
    }
  }, [order.id, order.quoted_total, order.quote_lines, order.estimated_price, order.downpayment_percent]);

  useEffect(() => {
    // Only once the quote is accepted; shop_payment_details returns nothing before then.
    if (!order.shop_id || !viewerIsCustomer || order.status !== "confirmed") {
      setShopPayment(null);
      setShopQrUrl(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("shop_payment_details", { p_shop_id: order.shop_id });
      const row = Array.isArray(data) ? (data[0] as ShopPaymentInfo) : null;
      if (cancelled || !row) return;
      setShopPayment(row);
      const qr = await signedUrlFor(QR_BUCKET, row.payment_qr_url ?? null);
      if (!cancelled) setShopQrUrl(qr);
    })();

    return () => {
      cancelled = true;
    };
  }, [order.shop_id, order.status, viewerIsCustomer]);

  const openInStudio = useCallback(() => {
    const item = resolveDesignItem(order.cad_state);
    // Staging without navigating is what made this button do nothing: the
    // design landed in localStorage and the page never moved.
    if (item && !openItemInDesigner(item, order.project_name)) return;
    router.push("/customize-furniture");
  }, [order.cad_state, order.project_name, router]);

  // ?open=studio is what the chat card's "Inspect 3D design" button sends.
  useEffect(() => {
    if (searchParams.get("open") === "studio") openInStudio();
    // Fires once per arrival, not whenever the order object changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** Every write goes through here, so no path can quietly ignore a rejection. */
  const apply = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const supabase = createClient();
        const { data, error: writeError } = await supabase
          .from("design_orders")
          .update(patch)
          .eq("id", order.id)
          .select(
            "id, shop_id, customer_user_id, project_name, furniture_type, estimated_price, budget_min, budget_max, cad_state, preview_url, notes, reference_images, status, created_at, quoted_total, downpayment_percent, quote_lines, customer_response, payment_receipt_url, payment_reference, payment_submitted_at, payment_approved_at, payment_rejected_reason, decline_reason"
          )
          .maybeSingle();

        if (writeError) {
          setError(writeError.message);
          return false;
        }
        if (data) setOrder(data as Order);
        const done = orderSuccessMessage(patch, order.status);
        if (done) notifySuccess(done);
        return true;
      } finally {
        setBusy(false);
      }
    },
    [order.id, order.status]
  );

  /**
   * Keeps this one order current while the other party acts on it.
   *
   * `order` state was only ever replaced by this viewer's own writes, through
   * apply()'s returning select. If the other party changed the row instead --
   * the shop rejecting a receipt while the customer sat on this exact page --
   * nothing here ever knew, and the page kept showing the stale status until
   * it was closed and reopened. A rejected receipt looked, from here, like
   * nothing had happened: still "waiting for the shop," no reason, and no way
   * to upload again because the "confirmed" upload form never came back.
   */
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`order-detail-${order.id}`);
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "design_orders", filter: `id=eq.${order.id}` },
      (payload) => setOrder(payload.new as Order)
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [order.id]);

  const sendQuote = async () => {
    const resolved = resolveQuote(quoteTotal, quoteLineDrafts);
    const percent = Number(quotePercent.replace(/[^0-9.]/g, ""));
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    const { total, lines } = resolved;
    if (!Number.isFinite(percent) || percent < DOWNPAYMENT_MIN_PERCENT || percent > 100) {
      setError(`Downpayment must be between ${DOWNPAYMENT_MIN_PERCENT}% and 100%.`);
      return;
    }

    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    await apply({
      status: "quoted",
      quoted_total: total,
      // Always written with the total: null clears a breakdown the shop has
      // emptied, rather than leaving lines that no longer add up.
      quote_lines: lines,
      downpayment_percent: percent,
      quoted_at: new Date().toISOString(),
      quoted_by: userData.user?.id ?? null,
    });
  };

  const approvePayment = async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    await apply({
      status: "in_production",
      payment_approved_at: now,
      payment_approved_by: userData.user?.id ?? null,
      production_started_at: now,
    });
  };

  const submitReceipt = async () => {
    if (!receiptFile) {
      setError("Attach a photo or PDF of your payment receipt.");
      return;
    }
    if (!paymentReference.trim()) {
      setError("Enter the reference number from your GCash or bank transfer.");
      return;
    }
    setBusy(true);
    setError(null);
    const uploaded = await uploadReceipt(order.id, receiptFile);
    setBusy(false);
    if ("error" in uploaded) {
      setError(uploaded.error);
      return;
    }
    const ok = await apply({
      status: "payment_submitted",
      payment_receipt_url: uploaded.path,
      payment_reference: paymentReference.trim(),
      payment_submitted_at: new Date().toISOString(),
    });
    if (ok) setReceiptFile(null);
  };

  // Both dashboards read ?section= and ?shop= on arrival, so this lands on
  // the right conversation rather than on an overview. Inside the dialog the
  // dashboard is the page already open, where router.push changes nothing it
  // listens to -- Message did nothing on phones and the dialog stayed over the
  // chat -- so the dialog closes first and the link goes as a deep link.
  const onMessageParty = () => {
    onLeave?.();
    followDeepLink(
      router,
      viewerIsShop
        ? `/protected/shop?section=messages&customer=${order.customer_user_id}`
        : `/protected?section=messages&shop=${order.shop_id}`
    );
  };

  const viewReceipt = async () => {
    const url = await signedUrlFor(RECEIPT_BUCKET, order.payment_receipt_url);
    if (url) window.open(url, "_blank", "noreferrer");
    else setError("That receipt could not be opened.");
  };

  return (
    <Shell variant={variant}>
        {/* Was a hardcoded jump to the dashboard root, which lost the section
            the viewer had been on and ignored that they may have arrived from a
            conversation or a notification. The trail knows; the fallback covers
            a cold open of the URL, and differs by role because a shop owner's
            orders live on a different screen. */}
        {variant === "page" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CommissionPath
              current={{ href: `/protected/orders/${order.id}`, label: order.project_name || uiText("Order") }}
              fallback={
                viewerIsShop
                  ? { href: "/protected/shop?section=orders", label: "Orders" }
                  : { href: "/protected?section=orders", label: "Your orders" }
              }
            />
          </div>
        ) : null}

        <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">
              <span className="text-[var(--fc-muted)]">{uiText("Order #")}{order.id.slice(0, 8)}</span>{" · "}
              {order.project_name}
            </h1>
            <p className="mt-1 text-sm text-[var(--fc-muted)]">
              {viewerIsShop ? uiText("From your customer") : uiText("Sent to {0}", { 0: shopName })} ·{" "}
              {new Date(order.created_at).toLocaleDateString(uiLocale)}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${meta.tone}`}>
            {uiText(meta.label)}
          </span>
        </header>

        <OrderStepper status={order.status} className="mt-6" />

        {/* The same tabs, in the same order, as the order dialogs in both
            dashboards, so an order looks the same wherever it is opened --
            from a chat card, a notification or its own link. A dot on Quote
            marks an order waiting on whoever is looking. */}
        <div
          role="tablist"
          aria-label={uiText("Order")}
          className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:none]"
        >
          {tabs.map((item) => {
            const selected = tab === item.id;
            const needsAttention =
              item.id === "quote" &&
              (viewerIsShop
                ? order.status === "pending_quote" || order.status === "payment_submitted"
                : order.status === "quoted" || order.status === "confirmed");
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`order-detail-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`order-detail-panel-${item.id}`}
                onClick={() => setTab(item.id)}
                className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold transition-colors ${
                  selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                }`}
              >
                {uiText(item.label)}
                {needsAttention ? (
                  <span aria-label={uiText("needs attention")} className="h-1.5 w-1.5 rounded-full bg-fc-danger" />
                ) : null}
                {selected ? (
                  <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" />
                ) : null}
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="mt-3 rounded-xl bg-[rgba(192,57,43,0.1)] px-3 py-2 text-sm text-[#a8452c]">{uiText(error)}</p>
        ) : null}

        {/* Panels stay mounted and are only hidden, so a chosen receipt, a
            half-typed quote or an unsaved cost sheet survives a tab switch. */}
        <div className="mt-5">
          <div role="tabpanel" id="order-detail-panel-design" aria-labelledby="order-detail-tab-design" hidden={tab !== "design"}>
            <OrderDesignColumn
              previewUrl={order.preview_url}
              cadState={order.cad_state}
              notes={order.notes}
              referenceImages={order.reference_images}
              onOpenStudio={openInStudio}
            />
          </div>

          {/* The shop's own costing. Shop only: order_costings has no policy
              for the customer, so the panel would never load for them. */}
          {viewerIsShop && order.shop_id ? (
            <div role="tabpanel" id="order-detail-panel-costing" aria-labelledby="order-detail-tab-costing" hidden={tab !== "costing"}>
              <OrderCosting
                orderId={order.id}
                shopId={order.shop_id}
                defaultOpen
                quotedTotal={order.quoted_total == null ? null : Number(order.quoted_total)}
                onUseAsQuote={
                  shopCanMove(order.status, "quoted")
                    ? (suggested, lines) => {
                        setQuoteTotal(String(suggested));
                        setQuoteLineDrafts(draftsFromLines(lines));
                        // The filled-in quote is on the other tab; go to it.
                        setTab("quote");
                      }
                    : undefined
                }
              />
            </div>
          ) : null}

          <div role="tabpanel" id="order-detail-panel-quote" aria-labelledby="order-detail-tab-quote" hidden={tab !== "quote"} className="max-w-2xl">
        <p className="text-sm text-[var(--fc-muted)]">{uiText(viewerIsShop ? meta.shopHint : meta.customerHint)}</p>

        {/* A declined order without its reason tells the customer only that
            they have been refused, which is the least useful half of the
            message. The shop is now required to give a reason; this is where
            the customer reads it. Shown to both sides: the shop should be able
            to see what it told this customer. */}
        {order.status === "declined" && order.decline_reason ? (
          <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">
              {viewerIsShop ? uiText("The reason you gave") : uiText("Why {0} declined", { 0: shopName })}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--fc-text)]">{order.decline_reason}</p>
          </div>
        ) : null}

        {order.status === "confirmed" && order.payment_rejected_reason ? (
          <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">
              {viewerIsShop ? uiText("Payment mismatch note sent to customer") : uiText("Payment verification issue from {0}", { 0: shopName })}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--fc-text)]">{order.payment_rejected_reason}</p>
            {viewerIsCustomer ? (
              <p className="mt-1.5 text-xs text-[var(--fc-muted)]">{uiText("Please double-check the shop's payment options below and upload a new receipt.")}</p>
            ) : null}
          </div>
        ) : null}

            <div className="mt-4">
            <SideCard title={uiText("Quote")}>
              <QuoteFigures
                total={order.quoted_total == null ? null : Number(order.quoted_total)}
                percent={order.downpayment_percent == null ? null : Number(order.downpayment_percent)}
                due={due}
                lines={parseQuoteLines(order.quote_lines)}
              />

              {/* ---- the shop's decisions ---- */}
              {viewerIsShop && shopCanMove(order.status, "quoted") ? (
                <div className="mt-4 space-y-3 border-t border-[var(--fc-border)] pt-4">
                  {/* Optional, but open: a customer sent a single figure has
                      nothing to weigh it against, and asking "what is that
                      for?" in chat is how most quotes stall. */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Breakdown ")}<span className="normal-case tracking-normal">{uiText("(optional)")}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("The customer sees each line and its price. Your cost sheet stays private.")}</p>
                    <div className="mt-2">
                      <QuoteLinesEditor drafts={quoteLineDrafts} onChange={setQuoteLineDrafts} />
                    </div>
                  </div>
                  {quoteLineDrafts.length ? (
                    <div className="flex items-baseline justify-between rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] px-3 py-2 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Total")}</span>
                      <strong className="font-display text-lg tabular-nums">
                        {formatPeso(draftTotal(quoteTotal, quoteLineDrafts))}
                      </strong>
                    </div>
                  ) : (
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Total price (₱)")}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 15000"
                        value={quoteTotal}
                        onChange={(event) => setQuoteTotal(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none"
                      />
                    </label>
                  )}
                  <label className="block text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Downpayment (%)")}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="30"
                      value={quotePercent}
                      onChange={(event) => setQuotePercent(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none"
                    />
                  </label>
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Due now:")}{" "}
                    <strong className="text-[var(--fc-ink-accent)]">
                      {formatPeso(
                        downpaymentOf(
                          draftTotal(quoteTotal, quoteLineDrafts),
                          Number(quotePercent.replace(/[^0-9.]/g, "")) || null
                        )
                      )}
                    </strong>
                  </p>
                  {(() => {
                    // Pressed until something in the sent quote changes.
                    const unchanged =
                      order.status === "quoted" &&
                      quoteFormUnchanged(
                        { typedTotal: quoteTotal, drafts: quoteLineDrafts, percentText: quotePercent },
                        {
                          quotedTotal: order.quoted_total == null ? null : Number(order.quoted_total),
                          quoteLines: order.quote_lines,
                          downpaymentPercent: order.downpayment_percent == null ? null : Number(order.downpayment_percent),
                        }
                      );
                    return (
                      <>
                        <button
                          type="button"
                          disabled={busy || unchanged}
                          onClick={sendQuote}
                          className={`btn btn-primary btn-block ${unchanged ? "btn-pressed" : ""}`}
                        >
                          {order.status === "quoted" ? uiText("Update quote") : uiText("Send quote")}
                        </button>
                        {unchanged ? (
                          <p className="text-center text-xs text-[var(--fc-muted)]">{uiText("Sent. Change a price, a line or the downpayment to update it.")}</p>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}

              {/* ---- the customer's decisions ---- */}
              {viewerIsCustomer && customerCanMove(order.status, "confirmed") ? (
                <div className="mt-4 space-y-3 border-t border-[var(--fc-border)] pt-4">
                  {/* No payment details here: the shop's account shows only
                      after the quote is confirmed (20261027130000). */}
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Confirming accepts this price. You will then pay the downpayment directly to the shop.")}</p>
                  <button
                    type="button" disabled={busy} className="btn btn-primary btn-block"
                    onClick={() => apply({ status: "confirmed", customer_response: "confirmed", customer_responded_at: new Date().toISOString() })}
                  >{uiText("Accept quote & pay downpayment")}</button>
                  <button
                    type="button" disabled={busy} className="btn btn-secondary btn-block"
                    onClick={() => setDeclineIntent("customer-quote")}
                  >{uiText("Decline")}</button>
                </div>
              ) : null}

              {viewerIsCustomer && order.status === "confirmed" ? (
                <div className="mt-4 space-y-4 border-t border-[var(--fc-border)] pt-4">
                  <ShopPaymentDetailsCard
                    payment={shopPayment}
                    qrUrl={shopQrUrl}
                    title={uiText("Pay Downpayment")}
                    subtitle={uiText("Send {0} directly to the shop", { 0: formatPeso(due) })}
                  />

                  {order.payment_rejected_reason ? (
                    <div className="rounded-xl border border-[var(--fc-danger)]/30 bg-[color-mix(in_srgb,var(--fc-danger)_10%,transparent)] p-3">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">{uiText("Payment verification issue from ")}{shopName}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--fc-text)]">
                        &ldquo;{order.payment_rejected_reason}&rdquo;
                      </p>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4 space-y-3">
                    <p className="text-xs text-[var(--fc-muted)] leading-relaxed">{uiText("After sending ")}{formatPeso(due)}{uiText(" directly to the shop above, attach your receipt and enter the reference number below.")}</p>
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Receipt (photo or PDF) *")}</span>
                      <input
                        type="file" accept="image/*,application/pdf"
                        onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                        className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-xl file:border file:border-[var(--fc-border)] file:bg-[var(--fc-bg)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--fc-text)] hover:file:bg-[rgba(178,106,56,0.1)]"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Reference number *")}</span>
                      <input
                        required
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value)}
                        placeholder={uiText("e.g. GCash / Bank reference")}
                        className="mt-1.5 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)]"
                      />
                    </label>
                    <button
                      type="button" disabled={busy || !receiptFile || !paymentReference.trim()} onClick={submitReceipt}
                      className="btn btn-primary btn-block"
                    >
                      {busy ? uiText("Uploading…") : uiText("I have paid — upload receipt")}
                    </button>
                  </div>
                </div>
              ) : null}

              {viewerIsCustomer && customerCanCancel(order.status) ? (
                <div className="mt-4 border-t border-[var(--fc-border)] pt-4">
                  <button
                    type="button"
                    disabled={busy}
                    className="btn btn-secondary btn-block"
                    onClick={() => setDeclineIntent("customer-cancel")}
                  >{uiText("Cancel this order")}</button>
                  <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("You can call this off until you have paid the downpayment.")}</p>
                </div>
              ) : null}

              {viewerIsCustomer && order.status === "payment_submitted" ? (
                <div className="mt-4 space-y-3 border-t border-[var(--fc-border)] pt-4">
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Receipt submitted — waiting for ")}{shopName}{uiText(" to confirm it against their own GCash or bank records.")}</p>
                  {order.payment_receipt_url ? (
                    <button type="button" onClick={viewReceipt} className="btn btn-secondary btn-block">{uiText("View receipt")}</button>
                  ) : null}
                </div>
              ) : null}

              {/* ---- the shop reviewing that receipt ---- */}
              {viewerIsShop && order.status === "payment_submitted" ? (
                <div className="mt-4 space-y-3 border-t border-[var(--fc-border)] pt-4">
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Check your own GCash or bank app for ")}{formatPeso(due)}{uiText(" before approving. FurniCraft cannot see this payment.")}</p>
                  {order.payment_reference ? (
                    <CopyField label="Reference number given" value={order.payment_reference} mono />
                  ) : null}
                  {order.payment_receipt_url ? (
                    <button type="button" onClick={viewReceipt} className="btn btn-secondary btn-block">{uiText("View receipt")}</button>
                  ) : null}
                </div>
              ) : null}

              {/* ---- the remaining moves, whichever side owns them ---- */}
              <div className="mt-4 space-y-2">
                {viewerIsShop && shopCanMove(order.status, "in_production") ? (
                  <button type="button" disabled={busy} onClick={approvePayment} className="btn btn-primary btn-block">{uiText("Payment received — start production")}</button>
                ) : null}
                {viewerIsShop && order.status === "payment_submitted" ? (
                  <button
                    type="button" disabled={busy} className="btn btn-secondary btn-block"
                    onClick={() => setDeclineIntent("shop-receipt-mismatch")}
                  >{uiText("Receipt does not match")}</button>
                ) : null}
                {viewerIsShop && shopCanMove(order.status, "completed") ? (
                  <button
                    type="button" disabled={busy} className="btn btn-primary btn-block"
                    onClick={async () => {
                      const ok = await apply({ status: "completed", completed_at: new Date().toISOString() });
                      if (ok) sendOrderReadyEmail(order.id);
                    }}
                  >{uiText("Mark completed")}</button>
                ) : null}
                {viewerIsShop && shopCanMove(order.status, "declined") ? (
                  <button type="button" disabled={busy} onClick={() => setDeclineIntent("shop")} className="btn btn-secondary btn-block">{uiText("Decline order")}</button>
                ) : null}
              </div>
            </SideCard>
            </div>
            <ProductionSchedule orderId={order.id} status={order.status} viewerIsShop={viewerIsShop} className="mt-4" />
          </div>

          <div
            role="tabpanel"
            id="order-detail-panel-party"
            aria-labelledby="order-detail-tab-party"
            hidden={tab !== "party"}
            className="max-w-md space-y-4"
          >
            <SideCard title={viewerIsShop ? uiText("Customer") : uiText("Shop")}>
              <OrderPartyCard
                name={viewerIsShop ? "Your customer" : shopName}
                subtitle={viewerIsShop ? undefined : meta.label}
                onMessage={onMessageParty}
                messageLabel={viewerIsShop ? "Message customer" : "Message shop"}
                logoUrl={viewerIsShop ? undefined : shopLogoUrl}
              />
            </SideCard>

            {viewerIsCustomer && order.status === "completed" ? (
              <ShopReviews shopId={order.shop_id} shopName={shopName} compact />
            ) : null}
          </div>
        </div>

      {/* One dialog for all ways this order can end or be returned, so the wording and
          the keyboard behaviour cannot drift apart between them. */}
      <ConfirmModal
        open={declineIntent !== null}
        title={
          declineIntent === "customer-cancel" ? uiText("Cancel this order?") : declineIntent === "customer-quote" ? uiText("Decline this quote?") : declineIntent === "shop-receipt-mismatch" ? uiText("Receipt does not match?") : uiText("Decline this order?")
        }
        body={
          declineIntent === "shop-receipt-mismatch"
            ? "Tell the customer why this payment could not be verified. The order will return to 'Downpayment due' with your note so they can check your payment details and upload a valid receipt."
            : declineIntent === "shop"
              ? `${order.project_name} will be closed and the customer told why. This cannot be undone.`
              : `${shopName} will be told this is no longer going ahead, and will see the reason you give. This cannot be undone.`
        }
        confirmLabel={
          declineIntent === "customer-cancel" ? uiText("Cancel order") : declineIntent === "shop-receipt-mismatch" ? uiText("Reject receipt") : uiText("Decline")
        }
        // Beside "Cancel order", a plain "Cancel" reads as the same action.
        cancelLabel={declineIntent === "customer-cancel" ? uiText("Keep order") : uiText("Cancel")}
        tone="danger"
        busy={busy}
        reason={{
          label: declineIntent === "shop-receipt-mismatch" ? "Reason for rejection" : "Reason",
          placeholder:
            declineIntent === "shop-receipt-mismatch"
              ? "e.g. Reference number not found in GCash, or received amount was incomplete."
              : declineIntent === "shop"
                ? "e.g. The timber for this finish is out of stock until March."
                : "e.g. The quote is over my budget for this piece.",
          required: true,
        }}
        onConfirm={(declineReason) => {
          const intent = declineIntent;
          setDeclineIntent(null);
          if (!intent) return;
          if (intent === "shop-receipt-mismatch") {
            void apply({
              status: "confirmed",
              payment_receipt_url: null,
              payment_submitted_at: null,
              payment_reference: null,
              payment_rejected_reason: declineReason ?? null,
            });
            return;
          }
          void apply(
            intent === "shop"
              ? { status: "declined", decline_reason: declineReason ?? null }
              : {
                  status: "declined",
                  decline_reason: declineReason ?? null,
                  customer_response: "declined",
                  customer_responded_at: new Date().toISOString(),
                }
          );
        }}
        onCancel={() => setDeclineIntent(null)}
      />
    </Shell>
  );
}
