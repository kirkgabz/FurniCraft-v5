"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { type Dispatch, type SetStateAction, useId, useState } from "react";
import { type CustomerOrder } from "@/components/dashboard/customer-dashboard-types";
import { CustomerOrderRow, OrderStatusBadge } from "@/components/dashboard/customer-order-parts";
import { customerCanMove, downpaymentOf, formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import OrderStepper from "@/components/orders/order-stepper";
import ProductionSchedule from "@/components/orders/production-schedule";
import { OrderDesignColumn, OrderPartyCard, ShopPaymentDetailsCard, type ShopPaymentInfo, SideCard } from "@/components/orders/order-workspace";
import { RefundPanel } from "@/components/orders/refund-panel";
import { QuoteBreakdownList } from "@/components/orders/quote-breakdown";
import { parseQuoteLines } from "@/components/orders/quote-lines";
import { Modal } from "@/components/ui/modal";
import { ORDER_TOPICS, type ReportCategory } from "@/lib/report-topics";

export type OrdersSectionProps = {
  customerOrders: CustomerOrder[];
  hasUnviewedActions: boolean;
  getShopNameForOrder: (shopId: string) => string;
  getShopLogoForOrder: (shopId: string) => string | null;
  handleQuoteResponse: (orderId: string, response: "confirmed" | "declined", declineReason?: string) => Promise<void>;
  handleRequestRefund: (orderId: string, reason: string) => Promise<void>;
  handleSelectShop: (shopId: string) => Promise<void>;
  handleSubmitReceipt: (orderId: string) => Promise<void>;
  isLoadingCustomerOrders: boolean;
  isRefundBusy: boolean;
  isRespondingToQuote: boolean;
  isSubmittingReceipt: boolean;
  ordersClosed: CustomerOrder[];
  ordersInProgress: CustomerOrder[];
  ordersNeedingYou: CustomerOrder[];
  paymentReference: string;
  quoteResponseError: string | null;
  receiptError: string | null;
  receiptFile: File | null;
  selectedCustomerOrder: CustomerOrder | null;
  selectedCustomerOrderId: string | null;
  setActiveSection: Dispatch<SetStateAction<string>>;
  setPaymentReference: Dispatch<SetStateAction<string>>;
  setQuoteDeclineOrderId: Dispatch<SetStateAction<string | null>>;
  setReceiptFile: Dispatch<SetStateAction<File | null>>;
  setReportTarget: Dispatch<SetStateAction<{ targetId: string; topics: ReportCategory[]; title: string; context?: string; } | null>>;
  setSelectedCustomerOrderId: Dispatch<SetStateAction<string | null>>;
  shopPayment: ShopPaymentInfo | null;
  shopQrUrl: string | null;
};

/** The order dialog's tabs, under the stepper; the shop's dialog has the same. */
const ORDER_TABS = [
  { id: "design", label: "Design" },
  { id: "quote", label: "Quote" },
  { id: "shop", label: "Message shop" },
] as const;
type OrderTab = (typeof ORDER_TABS)[number]["id"];

/**
 * Orders: the customer's orders by who is waiting, and the detail of the one that is open.
 *
 * The dashboard owns the order data and handlers; this section owns its tabs.
 */
/**
 * The column headings above a group of orders, from lg up only.
 *
 * Its template has to match CustomerOrderRow's table variant exactly, which is
 * the cost of laying a table out in grid rather than in <table>. It is worth
 * paying here: a real <table> cannot also be the stacked, two-line card the
 * same list has to be on a phone, and having one component answer to both
 * beats keeping two lists of orders in step by hand.
 *
 * Hidden from assistive tech: each row already states its shop, status, price
 * and date in its own text, so these would be read as five more labels with
 * nothing to attach them to.
 */
function OrderTableHead() {
  const { t: uiText } = useUiLanguage();
  return (
    <div
      aria-hidden
      className="mt-3 hidden w-full items-center gap-4 border-b border-[var(--fc-border)] px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)] lg:grid lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_auto_minmax(0,1.1fr)_minmax(0,0.7fr)]"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <span>{uiText("Piece")}</span>
      <span>{uiText("Furniture shop")}</span>
      <span>{uiText("Status")}</span>
      {/* Not "Estimate". The column holds whichever of three different things
          the order actually has, and each row says which: the shop's quote once
          there is one, the customer's own budget before that, and on orders
          predating budgets the old studio estimate. One heading for all three
          has to be the neutral word. */}
      <span>{uiText("Amount")}</span>
      <span>{uiText("Updated")}</span>
    </div>
  );
}

export default function OrdersSection({
  customerOrders,
  hasUnviewedActions,
  getShopNameForOrder,
  getShopLogoForOrder,
  handleQuoteResponse,
  handleRequestRefund,
  handleSelectShop,
  handleSubmitReceipt,
  isLoadingCustomerOrders,
  isRefundBusy,
  isRespondingToQuote,
  isSubmittingReceipt,
  ordersClosed,
  ordersInProgress,
  ordersNeedingYou,
  paymentReference,
  quoteResponseError,
  receiptError,
  receiptFile,
  selectedCustomerOrder,
  selectedCustomerOrderId,
  setActiveSection,
  setPaymentReference,
  setQuoteDeclineOrderId,
  setReceiptFile,
  setReportTarget,
  setSelectedCustomerOrderId,
  shopPayment,
  shopQrUrl,
}: OrdersSectionProps) {
  const { t: uiText } = useUiLanguage();
  const categoryId = useId();
  const [category, setCategory] = useState("needs-you");
  const categories = [
    { id: "needs-you", label: "Action needed", orders: ordersNeedingYou, empty: "You're all caught up. No orders need your attention." },
    { id: "in-progress", label: "In progress", orders: ordersInProgress, empty: "No orders in progress. Orders waiting on a shop will appear here." },
    { id: "closed", label: "Completed & declined", orders: ordersClosed, empty: "No completed or declined orders yet." },
  ];
  const [orderTab, setOrderTab] = useState<OrderTab>("design");
  // A different order opens on its design, not on whichever tab the last one was left on.
  const [tabOrderId, setTabOrderId] = useState(selectedCustomerOrderId);
  if (tabOrderId !== selectedCustomerOrderId) {
    setTabOrderId(selectedCustomerOrderId);
    setOrderTab("design");
  }
  return (
    <section>
      <div
        role="tablist"
        aria-label={uiText("Order categories")}
        className="flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:thin]"
      >
        {categories.map((item, index) => {
          const selected = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${categoryId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${categoryId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setCategory(item.id)}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % categories.length;
                else if (event.key === "ArrowLeft") nextIndex = (index + categories.length - 1) % categories.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = categories.length - 1;
                else return;
                event.preventDefault();
                setCategory(categories[nextIndex].id);
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                tabs?.[nextIndex]?.focus();
              }}
              className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 rounded-t-lg px-3 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fc-accent)] sm:px-4 ${
                selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:bg-[var(--fc-panel)] hover:text-[var(--fc-text)]"
              }`}
            >
              {uiText(item.label)}
              {item.id === "needs-you" && hasUnviewedActions && !isLoadingCustomerOrders ? (
                <span role="img" aria-label={uiText("Unviewed actions")} className="h-2 w-2 shrink-0 rounded-full bg-[var(--fc-danger)]" />
              ) : null}
              <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                selected ? "bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]" : "bg-[var(--fc-border)] text-[var(--fc-muted)]"
              }`}>
                {isLoadingCustomerOrders ? "…" : item.orders.length}
              </span>
              {selected ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" /> : null}
            </button>
          );
        })}
      </div>

      {categories.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${categoryId}-panel-${item.id}`}
          aria-labelledby={`${categoryId}-tab-${item.id}`}
          hidden={category !== item.id}
          tabIndex={0}
          className="pt-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fc-accent)]"
        >
          {isLoadingCustomerOrders ? (
            <p role="status" className="muted-small">{uiText("Loading orders…")}</p>
          ) : item.orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--fc-border)] px-4 py-8 text-sm text-[var(--fc-muted)]">
              {uiText(customerOrders.length === 0
                ? "No orders yet — design something in the Customizer and send it to a shop."
                : item.empty)}
            </div>
          ) : (
            <>
              <OrderTableHead />
              <div className="mt-2 space-y-1 lg:mt-0">
                {item.orders.map((order) => (
                  <CustomerOrderRow
                    table
                    key={order.id}
                    order={order}
                    shopName={getShopNameForOrder(order.shop_id)}
                    selected={selectedCustomerOrderId === order.id}
                    onOpen={() => setSelectedCustomerOrderId(order.id === selectedCustomerOrderId ? null : order.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      {selectedCustomerOrder ? (
        <Modal
          open
          onClose={() => setSelectedCustomerOrderId(null)}
          ariaLabel={uiText("Order: {0}", { 0: selectedCustomerOrder.project_name })}
          eyebrow={uiText("Order detail")}
          title={selectedCustomerOrder.project_name}
          className="sm:max-w-5xl"
        >
          {/* The shop and the status used to live in the dialog's own header
              beside a 32px close button. The header is the shell's now, and it
              stays put while this scrolls -- which matters because this body
              runs to about four phone screens. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted-small m-0">{uiText("Sent to ")}{getShopNameForOrder(selectedCustomerOrder.shop_id)}</p>
            <OrderStatusBadge status={selectedCustomerOrder.status} />
          </div>

          <OrderStepper status={selectedCustomerOrder.status} className="mt-5" />

          {/* One tab per part of the order instead of one long scroll, the same
              as the shop's order dialog. A dot on Quote marks an order waiting
              on the customer: a quote to answer or a downpayment to pay. */}
          <div
            role="tablist"
            aria-label={uiText("Order")}
            className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:none]"
          >
            {ORDER_TABS.map((item) => {
              const selected = orderTab === item.id;
              const needsAttention =
                item.id === "quote" &&
                (selectedCustomerOrder.status === "quoted" || selectedCustomerOrder.status === "confirmed");
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`customer-order-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`customer-order-panel-${item.id}`}
                  onClick={() => setOrderTab(item.id)}
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

          {/* Panels stay mounted and are only hidden, so a chosen receipt or a
              half-typed reference number survives a tab switch. */}
          <div className="mt-5">
            <div
              role="tabpanel"
              id="customer-order-panel-design"
              aria-labelledby="customer-order-tab-design"
              hidden={orderTab !== "design"}
            >
              <OrderDesignColumn
                previewUrl={selectedCustomerOrder.preview_url}
                cadState={selectedCustomerOrder.cad_state}
                notes={selectedCustomerOrder.notes}
                referenceImages={selectedCustomerOrder.reference_images}
              />
            </div>

            <div
              role="tabpanel"
              id="customer-order-panel-quote"
              aria-labelledby="customer-order-tab-quote"
              hidden={orderTab !== "quote"}
            >
          <p className="text-sm text-[var(--fc-muted)]">{uiText(orderStatusMeta(selectedCustomerOrder.status).customerHint)}</p>

          {selectedCustomerOrder.status === "declined" && selectedCustomerOrder.decline_reason ? (
            <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">{uiText("Why ")}{getShopNameForOrder(selectedCustomerOrder.shop_id)}{uiText(" declined")}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--fc-text)]">{selectedCustomerOrder.decline_reason}</p>
            </div>
          ) : null}

          {/* Refunds sit with the quote and the payment they would undo. */}
          <div className="mt-3">
            <RefundPanel
              order={selectedCustomerOrder}
              viewer="customer"
              busy={isRefundBusy}
              onRequest={(reason) => void handleRequestRefund(selectedCustomerOrder.id, reason)}
            />
          </div>

          {selectedCustomerOrder.status === "confirmed" && selectedCustomerOrder.payment_rejected_reason ? (
            <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">{uiText("Payment verification issue from ")}{getShopNameForOrder(selectedCustomerOrder.shop_id)}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--fc-text)]">{selectedCustomerOrder.payment_rejected_reason}</p>
              <p className="mt-1.5 text-xs text-[var(--fc-muted)]">{uiText("Please double-check the shop's payment options and upload a new receipt below.")}</p>
            </div>
          ) : null}

          {selectedCustomerOrder.quoted_total == null && selectedCustomerOrder.status === "pending_quote" ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[var(--fc-border)] px-4 py-3 text-sm text-[var(--fc-muted)]">{uiText("No price yet. The shop sends a quote once they have looked at the design.")}</p>
          ) : null}

          {selectedCustomerOrder.quoted_total != null ? (
            <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Quote")}</div>
              {/* Columns that answer to this box, not to the window.
                  sm:grid-cols-3 asked the viewport how wide things were, but
                  this card sits in a four-of-twelve sidebar: on a wide screen
                  the breakpoint said "three columns" and gave each about 90px,
                  so a six-figure total at 18px ran straight into the
                  downpayment beside it. auto-fit with a 104px floor lets the
                  card itself decide, and it drops to two columns or one when
                  the numbers need the room. */}
              {/* What the price is made of, when the shop sent a breakdown. */}
              <QuoteBreakdownList
                lines={parseQuoteLines(selectedCustomerOrder.quote_lines)}
                className="mt-2 border-b border-[var(--fc-border)] pb-2.5"
              />
              <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-x-3 gap-y-2 text-sm">
                <div className="min-w-0"><dt className="text-[var(--fc-muted)]">{uiText("Total")}</dt><dd className="truncate text-base font-bold tabular-nums">{formatPeso(Number(selectedCustomerOrder.quoted_total))}</dd></div>
                <div className="min-w-0"><dt className="text-[var(--fc-muted)]">{uiText("Downpayment")}</dt><dd className="truncate text-base font-bold tabular-nums">{selectedCustomerOrder.downpayment_percent}%</dd></div>
                <div className="min-w-0"><dt className="text-[var(--fc-muted)]">{uiText("Due now")}</dt><dd className="truncate text-base font-bold tabular-nums text-[var(--fc-ink-accent)]">{formatPeso(downpaymentOf(Number(selectedCustomerOrder.quoted_total), Number(selectedCustomerOrder.downpayment_percent)))}</dd></div>
              </dl>

              {customerCanMove(selectedCustomerOrder.status, "confirmed") ? (
                <>
                  {/* No payment details here: the shop's account shows only
                      after the quote is confirmed (20261027130000). */}
                  <p className="mt-3 text-xs text-[var(--fc-muted)]">{uiText("Confirming accepts this price. You will then pay the downpayment directly to the shop and upload the receipt — FurniCraft does not handle the payment.")}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={isRespondingToQuote}
                      onClick={() => handleQuoteResponse(selectedCustomerOrder.id, "confirmed")}
                      className="btn btn-primary">{uiText("Confirm quote")}</button>
                    <button type="button" disabled={isRespondingToQuote}
                      onClick={() => setQuoteDeclineOrderId(selectedCustomerOrder.id)}
                      className="btn btn-secondary">{uiText("Decline")}</button>
                  </div>
                </>
              ) : null}
              {quoteResponseError ? (
                <p className="mt-2 text-sm text-fc-danger-soft">{uiText(quoteResponseError)}</p>
              ) : null}
            </div>
          ) : null}

          {selectedCustomerOrder.status === "confirmed" ? (
            <div className="mt-4 space-y-4">
              {selectedCustomerOrder.payment_rejected_reason ? (
                <div className="rounded-2xl border border-[var(--fc-danger)]/30 bg-[color-mix(in_srgb,var(--fc-danger)_10%,transparent)] p-3.5">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--fc-danger)]">{uiText("Payment rejected by ")}{getShopNameForOrder(selectedCustomerOrder.shop_id)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--fc-text)]">
                    &ldquo;{selectedCustomerOrder.payment_rejected_reason}&rdquo;
                  </p>
                </div>
              ) : null}

              <ShopPaymentDetailsCard
                payment={shopPayment}
                qrUrl={shopQrUrl}
                title={uiText("Pay the Downpayment")}
                subtitle={uiText("Send {0} directly to the shop", { 0: formatPeso(downpaymentOf(Number(selectedCustomerOrder.quoted_total), Number(selectedCustomerOrder.downpayment_percent))) })}
              />

              <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-4 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Upload Proof of Payment")}</div>
                <p className="text-xs text-[var(--fc-muted)] leading-relaxed">{uiText("After paying directly to the shop above, attach your receipt and enter the reference number below.")}</p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Receipt (photo or PDF) *")}</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
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
                      placeholder={uiText("GCash / Bank reference")}
                      className="mt-1.5 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)]"
                    />
                  </label>
                </div>

                {receiptError ? (
                  <p className="mt-2 text-sm text-fc-danger-soft">{uiText(receiptError)}</p>
                ) : null}

                <button
                  type="button"
                  disabled={isSubmittingReceipt || !receiptFile || !paymentReference.trim()}
                  onClick={() => handleSubmitReceipt(selectedCustomerOrder.id)}
                  className="btn btn-primary btn-block"
                >
                  {isSubmittingReceipt ? uiText("Uploading…") : uiText("I have paid — upload receipt")}
                </button>
              </div>

              {/* The same way out the order page gives, here too: until the
                  downpayment is in, the customer can still call it off. */}
              <div>
                <button
                  type="button"
                  disabled={isRespondingToQuote}
                  onClick={() => setQuoteDeclineOrderId(selectedCustomerOrder.id)}
                  className="btn btn-secondary btn-block"
                >{uiText("Cancel order")}</button>
                <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("You can call this off until you have paid the downpayment.")}</p>
              </div>
            </div>
          ) : null}

          <ProductionSchedule
            orderId={selectedCustomerOrder.id}
            status={selectedCustomerOrder.status}
            viewerIsShop={false}
            className="mt-4"
          />
            </div>

            <div
              role="tabpanel"
              id="customer-order-panel-shop"
              aria-labelledby="customer-order-tab-shop"
              hidden={orderTab !== "shop"}
              className="max-w-md space-y-4"
            >
              <SideCard title={uiText("Shop")}>
                <OrderPartyCard
                  name={getShopNameForOrder(selectedCustomerOrder.shop_id)}
                  logoUrl={getShopLogoForOrder(selectedCustomerOrder.shop_id)}
                  subtitle={uiText(orderStatusMeta(selectedCustomerOrder.status).label)}
                  onMessage={() => {
                    handleSelectShop(selectedCustomerOrder.shop_id);
                    setActiveSection("messages");
                    setSelectedCustomerOrderId(null);
                  }}
                />
              </SideCard>

              {/* A ticket with FurniCraft, for when asking the shop has
                  stopped working; it sits with the shop it is about. */}
              <button
                type="button"
                onClick={() =>
                  setReportTarget({
                    targetId: selectedCustomerOrder.id,
                    topics: ORDER_TOPICS,
                    title: "Report a problem",
                    context: `${selectedCustomerOrder.project_name} — ${getShopNameForOrder(selectedCustomerOrder.shop_id)}`,
                  })
                }
                className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] hover:text-[var(--fc-danger)] active:scale-[0.98]"
              >{uiText("Report a problem")}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
