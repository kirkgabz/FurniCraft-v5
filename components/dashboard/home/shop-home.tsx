"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import { formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import { IconFurniture } from "@/components/solihiya/icons";

/** The fields Home reads from an order. The shop dashboard's DesignOrder satisfies it. */
export type ShopHomeOrder = {
  id: string;
  customer_user_id: string;
  project_name: string;
  preview_url: string | null;
  status: string;
  quoted_total: number | null;
  estimated_price: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
};

export type ShopHomeMessage = {
  customerId: string;
  customerName: string;
  text: string;
  time: string;
  online: boolean;
  unread: boolean;
};

/**
 * The shop owner's Home: what is waiting on the shop, then stop.
 *
 * The dashboard used to open on Storefront: a line of counts, then the
 * materials picker, the payment details and a full copy of the public shop
 * page, about 6,650px on a phone. The owner opens it many times a day to see
 * whether a customer is waiting on them; this answers that first.
 *
 *  - Needs you: the newest order waiting on the shop for a decision (a price
 *    to send, a receipt to check, a refund to answer), with the button that
 *    moves it on. The rest are a count and a link.
 *  - On the bench: what is being built.
 *  - The money, the latest message, and anything the shop is missing in
 *    order to be paid or found (payment details, a first template).
 *
 * Storefront editing is one tab away and unchanged in what it can do.
 */
export default function ShopHome({
  shopName,
  shopIsPro = false,
  isApproved,
  ordersCount,
  needsYou,
  onBench,
  customerNameFor,
  isRefundRequest,
  renderOrderRow,
  money,
  latestMessage,
  hasPaymentDetails,
  templatesCount,
  setupReady,
  onOpenOrder,
  onOpenOrders,
  onOpenMessage,
  onAddPaymentDetails,
  onOpenTemplates,
  onOpenStorefront,
}: {
  shopName: string;
  shopIsPro?: boolean;
  isApproved: boolean;
  ordersCount: number;
  needsYou: ShopHomeOrder[];
  onBench: ShopHomeOrder[];
  customerNameFor: (customerUserId: string) => string;
  isRefundRequest: (order: ShopHomeOrder) => boolean;
  /** The same row the Orders section uses. */
  renderOrderRow: (order: ShopHomeOrder) => React.ReactNode;
  money: { awaitingPayment: number; onBench: number; completed: number };
  latestMessage: ShopHomeMessage | null;
  hasPaymentDetails: boolean;
  templatesCount: number;
  /** False until payment details and templates have loaded, so nothing is flagged missing before it has been read. */
  setupReady: boolean;
  onOpenOrder: (orderId: string) => void;
  onOpenOrders: () => void;
  onOpenMessage: (customerId: string) => void;
  onAddPaymentDetails: () => void;
  onOpenTemplates: () => void;
  onOpenStorefront: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!isApproved) {
    // The status banner above already says why; Home only offers the one
    // thing an applicant can do meanwhile.
    return (
      <div id="home" className="space-y-4">
        <Greeting title={<ShopName shop={{ name: shopName || uiText("Your shop"), isPro: shopIsPro }} />} subtitle={uiText("Orders, templates and messages open once you're approved.")} />
        <button type="button" onClick={onOpenStorefront} className={QUIET_BUTTON}>{uiText("Get your shop page ready")}</button>
      </div>
    );
  }

  const [first, ...moreWaiting] = needsYou;
  const subtitle =
    needsYou.length === 1
      ? "One order is waiting on you."
      : needsYou.length > 1
        ? `${needsYou.length} orders are waiting on you.`
        : ordersCount === 0
          ? "No orders yet."
          : "Nothing needs you right now.";

  const setup = (setupReady ? [
    !hasPaymentDetails
      ? {
          key: "payment",
          urgent: true,
          title: "Add your payment details",
          body: "Until you do, a customer who accepts your quote has nowhere to send the downpayment.",
          action: "Add payment details",
          onClick: onAddPaymentDetails,
        }
      : null,
    templatesCount === 0
      ? {
          key: "template",
          urgent: false,
          title: "Publish your first template",
          body: "A piece of yours customers can open in the studio and change to fit their room.",
          action: "Open templates",
          onClick: onOpenTemplates,
        }
      : null,
  ] : []).filter(Boolean) as Array<{ key: string; urgent: boolean; title: string; body: string; action: string; onClick: () => void }>;

  return (
    <div id="home" className="space-y-8">
      <Greeting title={<ShopName shop={{ name: shopName || uiText("Your shop"), isPro: shopIsPro }} />} subtitle={typeof subtitle === "string" ? uiText(subtitle) : subtitle} />

      {setup.length ? (
        <section aria-labelledby="shop-home-setup" className="space-y-2">
          <h2 id="shop-home-setup" className="sr-only">{uiText("Finish setting up")}</h2>
          {setup.map((item) => (
            <div
              key={item.key}
              className={`rounded-2xl border p-4 ${
                item.urgent
                  ? "border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_6%,transparent)]"
                  : "border-dashed border-[var(--fc-border)]"
              }`}
            >
              <p className="font-semibold text-[var(--fc-text)]">{uiText(item.title)}</p>
              <p className="mt-0.5 text-sm text-[var(--fc-muted)]">{uiText(item.body)}</p>
              <button type="button" onClick={item.onClick} className={QUIET_BUTTON + " mt-3"}>
                {uiText(item.action)}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-12">
        <div className="min-w-0 space-y-8">
          {first ? (
            <section aria-labelledby="shop-home-needs">
              <SectionLabel id="shop-home-needs">
                <span className="inline-flex items-center gap-2">
                  {uiText("Pending order")}
                  {needsYou.some((order) => order.status === "pending_quote") ? (
                    <>
                      <span aria-hidden className="h-2 w-2 rounded-full bg-fc-danger" />
                      <span className="sr-only">{uiText("Needs a quote")}</span>
                    </>
                  ) : null}
                </span>
              </SectionLabel>
              <NeedsYouCard
                order={first}
                customerName={customerNameFor(first.customer_user_id)}
                isRefund={isRefundRequest(first)}
                onOpen={() => onOpenOrder(first.id)}
              />
              {moreWaiting.length > 0 ? (
                <button type="button" onClick={onOpenOrders} className={LINK_BUTTON + " mt-2"}>
                  {moreWaiting.length === 1 ? uiText("1 more order is waiting on you") : uiText("{0} more orders are waiting on you", { 0: moreWaiting.length })}
                </button>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="shop-home-bench">
            <SectionLabel
              id="shop-home-bench"
              action={
                <button type="button" onClick={onOpenOrders} className={LINK_BUTTON}>{uiText("All orders")}</button>
              }
            >{uiText("On the bench")}</SectionLabel>
            {onBench.length > 0 ? (
              <div className="space-y-0.5">
                {onBench.slice(0, 3).map((order) => (
                  <div key={order.id}>{renderOrderRow(order)}</div>
                ))}
                {onBench.length > 3 ? (
                  <button type="button" onClick={onOpenOrders} className={LINK_BUTTON + " ml-2"}>
                    {onBench.length - 3}{uiText(" more on the bench")}</button>
                ) : null}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">
                {ordersCount === 0 ? uiText("When a customer sends you a design, it shows up here with what to do next.") : uiText("Nothing is being built right now.")}
              </p>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-8">
          {ordersCount > 0 ? (
            <section aria-labelledby="shop-home-money">
              <SectionLabel id="shop-home-money">{uiText("Money")}</SectionLabel>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  { label: "Awaiting payment", value: money.awaitingPayment },
                  { label: "On the bench", value: money.onBench },
                  { label: "Completed", value: money.completed },
                ].map((item) => (
                  <div key={item.label} className="min-w-0 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                    <dt className="text-xs text-[var(--fc-muted)]">{uiText(item.label)}</dt>
                    <dd className="mt-1 truncate text-sm font-bold tabular-nums text-[var(--fc-text)]" title={formatPeso(item.value)}>
                      {formatPeso(item.value).replace(/\.00$/, "")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {latestMessage ? (
            <section aria-labelledby="shop-home-message">
              <SectionLabel id="shop-home-message">{uiText("Latest message")}</SectionLabel>
              <button
                type="button"
                onClick={() => onOpenMessage(latestMessage.customerId)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3 text-left transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,var(--fc-panel))] active:scale-[0.99]"
              >
                <span
                  aria-hidden
                  className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-base font-bold text-[var(--fc-ink-accent)]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {(latestMessage.customerName || "?").trim().charAt(0).toUpperCase()}
                  {latestMessage.online ? (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--fc-panel)] bg-fc-online" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-[var(--fc-text)]">{latestMessage.customerName}</span>
                    <span className="shrink-0 text-xs text-[var(--fc-muted)]">{latestMessage.time}</span>
                  </span>
                  <span
                    className={`block truncate text-sm ${
                      latestMessage.unread ? "font-semibold text-[var(--fc-text)]" : "text-[var(--fc-muted)]"
                    }`}
                  >
                    {latestMessage.text}
                  </span>
                </span>
                {latestMessage.unread ? <span className="sr-only">{uiText("Unread")}</span> : null}
              </button>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const LINK_BUTTON =
  "inline-flex items-center text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline [@media(pointer:coarse)]:min-h-11";

const QUIET_BUTTON =
  "inline-flex min-h-11 items-center rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.98]";

function Greeting({ title, subtitle }: { title: React.ReactNode; subtitle: string }) {
  const { t: uiText } = useUiLanguage();
  return (
    <div>
      <h1
        className="text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-[var(--fc-text)] [text-wrap:balance] lg:text-[1.9rem]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {typeof title === "string" ? uiText(title) : title}
      </h1>
      <p className="mt-1 text-[0.95rem] text-[var(--fc-muted)]">{typeof subtitle === "string" ? uiText(subtitle) : subtitle}</p>
    </div>
  );
}

function SectionLabel({ id, children, action }: { id: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 id={id} className="text-sm font-bold text-[var(--fc-text)]">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * The newest order waiting on the shop, saying what to do and with the button
 * that does it. The wording follows the shop-side hints in order-status.ts.
 */
function NeedsYouCard({
  order,
  customerName,
  isRefund,
  onOpen,
}: {
  order: ShopHomeOrder;
  customerName: string;
  isRefund: boolean;
  onOpen: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const meta = orderStatusMeta(order.status);
  const price = order.quoted_total ?? order.estimated_price;
  let label = meta.label;
  let body = meta.shopHint;
  let action = "Open order";
  if (isRefund) {
    label = "Refund requested";
    body = `${customerName} asked for a refund. Read their reason and answer it.`;
    action = "Answer refund";
  } else if (order.status === "pending_quote") {
    body = `${customerName} sent you a design${price != null ? `, estimated at ${formatPeso(price)}` : ""}. Send them your price.`;
    action = "Send quote";
  } else if (order.status === "payment_submitted") {
    body = `${customerName} says they've paid. Check your GCash or bank app, then approve or reject the receipt.`;
    action = "Check receipt";
  }

  return (
    <article className="rounded-2xl border-[1.5px] border-[var(--fc-accent)] bg-[var(--fc-panel)] p-4">
      <div className="flex items-start gap-3">
        {order.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={order.preview_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-xl border border-[var(--fc-border)] bg-white object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-dashed border-[var(--fc-border)]"
          >
            <IconFurniture aria-hidden className="h-5 w-5 opacity-60" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span
            className="inline-block -rotate-2 whitespace-nowrap rounded-full border border-fc-danger px-2 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-fc-danger"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {uiText(label)}
          </span>
          <h3 className="mt-1 font-semibold leading-snug text-[var(--fc-text)]">{order.project_name}</h3>
          <p className="mt-0.5 text-sm text-[var(--fc-muted)]">{uiText(body)}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--fc-btn)] px-4 font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98]"
      >
        {action}
      </button>
    </article>
  );
}
