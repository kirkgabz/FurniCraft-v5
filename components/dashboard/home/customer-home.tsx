"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import { CUSTOMER_ACTIONABLE, downpaymentOf, formatPeso, orderStatusMeta, type OrderStatus } from "@/components/orders/order-status";
import { IconArrowUpRight, IconCart, IconCheck, IconFurniture } from "@/components/solihiya/icons";
import { ShopLogo } from "@/components/shops/shop-logo";

/** The fields Home reads from an order. The dashboard's CustomerOrder satisfies it. */
export type HomeOrder = {
  id: string;
  shop_id: string;
  project_name: string;
  preview_url: string | null;
  status: string;
  quoted_total: number | null;
  downpayment_percent: number | null;
  downpayment_amount: number | null;
  /** Set when the shop sent a receipt back; the order returns to "confirmed". */
  payment_rejected_reason?: string | null;
};

export type HomeDraft = {
  id: string;
  name: string;
  preview_url: string | null;
  updated_at: string;
};

export type HomeMessage = {
  shopId: string;
  shopName: string;
  senderName: string;
  text: string;
  time: string;
  online: boolean;
  unread: boolean;
  /** The customer sent it, so it reads "You: ..." rather than their own name. */
  fromYou: boolean;
};

/**
 * The customer's Home: what is waiting on them, then stop.
 *
 * It replaces a welcome hero every visitor saw on every visit, and an
 * "Orders & messages" panel that started folded shut on a phone -- the one
 * thing a returning customer opens the dashboard to check, hidden under copy
 * they had already read. Now:
 *
 *  - Needs you: the order waiting on the customer, with the one button that
 *    moves it on. Only the first; the rest are a count and a link.
 *  - In the furniture shop: orders the shop is working on, with what is happening.
 *  - The latest message, and the draft they left in the studio.
 *
 * Someone with no orders yet gets the first-visit version instead: what
 * FurniCraft does, one button into the studio, and how an order works. It
 * turns into the returning version the moment their first order exists.
 *
 * Shop browsing is not here. On a phone it is the Shops tab; from lg up the
 * dashboard still shows it below this.
 */
export default function CustomerHome({
  firstName,
  ordersLoaded,
  ordersFailed,
  orders,
  needsYou,
  inProgress,
  shopNameFor,
  renderOrderRow,
  latestMessage,
  latestDraft,
  onOpenOrder,
  onOpenOrders,
  onOpenMessage,
  onOpenDraft,
  onStartDesigning,
  onBrowseShops,
  onRetryOrders,
  cartPieces = 0,
  onOpenCart,
  chosenShop = null,
}: {
  firstName: string;
  /** False until the first fetch of orders has finished, so nobody sees the first-visit screen flash past. */
  ordersLoaded: boolean;
  ordersFailed: boolean;
  orders: HomeOrder[];
  needsYou: HomeOrder[];
  inProgress: HomeOrder[];
  shopNameFor: (shopId: string) => string;
  /** The same row the Orders section uses, so the two lists read alike. */
  renderOrderRow: (order: HomeOrder) => React.ReactNode;
  latestMessage: HomeMessage | null;
  latestDraft: HomeDraft | null;
  onOpenOrder: (orderId: string) => void;
  onOpenOrders: () => void;
  onOpenMessage: (shopId: string) => void;
  onOpenDraft: () => void;
  onStartDesigning: () => void;
  onBrowseShops: () => void;
  onRetryOrders: () => void;
  /** Pieces in the cart (design-cart.ts), not yet sent to a shop. */
  cartPieces?: number;
  onOpenCart?: () => void;
  /** The furniture shop this customer's next order goes to, if they have picked one. */
  chosenShop?: { name: string; logoUrl?: string | null; isPro?: boolean } | null;
}) {
  const { t: uiText } = useUiLanguage();
  if (!ordersLoaded) {
    return (
      <div id="overview" className="mb-8 space-y-4" aria-busy="true" aria-label={uiText("Loading your orders")}>
        <div className="h-8 w-56 rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] motion-safe:animate-pulse" />
        <div className="h-40 rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] motion-safe:animate-pulse" />
        <div className="h-24 rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] motion-safe:animate-pulse" />
      </div>
    );
  }

  // Pieces added but never sent are an order the customer has half placed:
  // shown near the top, not left for them to find in a menu.
  const cartNotice =
    cartPieces > 0 && onOpenCart ? <CartNotice pieces={cartPieces} onOpen={onOpenCart} /> : null;

  const leftovers = (
    <>
      {latestMessage ? <LatestMessage message={latestMessage} onOpen={() => onOpenMessage(latestMessage.shopId)} /> : null}
      {latestDraft ? <DraftRow draft={latestDraft} onOpen={onOpenDraft} /> : null}
    </>
  );

  if (ordersFailed) {
    return (
      <div id="overview" className="mb-8 space-y-8">
        <Greeting title={firstName ? uiText("Welcome back, {0}", { 0: firstName }) : uiText("Welcome back")} />
        <div role="alert" className="rounded-2xl border border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_6%,transparent)] p-4">
          <p className="font-semibold text-[var(--fc-text)]">{uiText("We couldn't load your orders.")}</p>
          <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Check your connection, then try again.")}</p>
          <button type="button" onClick={onRetryOrders} className={QUIET_BUTTON + " mt-3"}>{uiText("Try again")}</button>
        </div>
        {cartNotice}
        {leftovers}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div id="overview" className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-x-12">
        <section className="dash-hero" aria-labelledby="home-first-title">
          <h1 id="home-first-title">{uiText("Design it in 3D. Build it with a real shop.")}</h1>
          <p>{uiText("Pick a piece, size it to your room, and send the exact design to a local furniture shop.")}</p>
          <div className="dash-hero-actions">
            <button type="button" onClick={onStartDesigning} className="dash-hero-btn-primary inline-flex items-center gap-2">
              <IconFurniture aria-hidden className="h-4 w-4" />{uiText(" Start designing")}</button>
            <button type="button" onClick={onBrowseShops} className="dash-hero-btn-secondary inline-flex items-center gap-2 lg:hidden">{uiText("Browse shops")}</button>
          </div>
        </section>

        <div className="space-y-8">
          {cartNotice}
          <CommissionSteps
            shop={chosenShop}
            cartPieces={cartPieces}
            onBrowseShops={onBrowseShops}
            onStartDesigning={onStartDesigning}
            onOpenCart={onOpenCart}
          />
          {leftovers}
        </div>
      </div>
    );
  }

  const [first, ...moreWaiting] = needsYou;
  const subtitle =
    needsYou.length === 1
      ? "One order is waiting on you."
      : needsYou.length > 1
        ? `${needsYou.length} orders are waiting on you.`
        : inProgress.length > 0
          ? "Nothing needs you right now."
          : "No orders in progress.";

  return (
    <div id="overview" className="mb-8 space-y-8">
      <Greeting
        title={firstName ? uiText("Welcome back, {0}", { 0: firstName }) : uiText("Welcome back")}
        subtitle={uiText(subtitle)}
        onStartDesigning={onStartDesigning}
      />

      {/* Above the fold for a returning customer too, because the furniture shop
          their next order goes to is a fact they can otherwise only find by
          opening the Shops tab and reading a sentence. */}
      <CommissionSteps
        shop={chosenShop}
        cartPieces={cartPieces}
        onBrowseShops={onBrowseShops}
        onStartDesigning={onStartDesigning}
        onOpenCart={onOpenCart}
      />

      {/* Not two equal halves. What needs you and what is being built is the
          column people came to read; the latest message and the draft are
          there to be glanced at. Equal columns said they weighed the same. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-x-12">
        <div className="min-w-0 space-y-8">
          {first ? (
            <section aria-labelledby="home-needs-title">
              <SectionLabel id="home-needs-title">{uiText("Needs you")}</SectionLabel>
              <NeedsYouCard order={first} shopName={shopNameFor(first.shop_id)} onOpen={() => onOpenOrder(first.id)} />
              {moreWaiting.length > 0 ? (
                <button type="button" onClick={onOpenOrders} className={LINK_BUTTON + " mt-2"}>
                  {moreWaiting.length === 1 ? uiText("1 more order is waiting on you") : uiText("{0} more orders are waiting on you", { 0: moreWaiting.length })}
                </button>
              ) : null}
            </section>
          ) : null}

          {cartNotice}

          <section aria-labelledby="home-furniture-shop-title">
            <SectionLabel
              id="home-furniture-shop-title"
              action={
                <button type="button" onClick={onOpenOrders} className={LINK_BUTTON}>{uiText("All orders")}</button>
              }
            >{uiText("In the furniture shop")}</SectionLabel>
            {inProgress.length > 0 ? (
              /* Two abreast once the column is wide enough. A single file of
                 these on a 1920 monitor gave each row about 980px to hold a
                 thumbnail, a name and a stamp, so the stamp sat half a screen
                 from the piece it belonged to. Two columns spend the width on
                 another row instead of on the gap inside one. */
              <div className="space-y-0.5 xl:grid xl:grid-cols-2 xl:gap-x-6 xl:space-y-0">
                {inProgress.slice(0, 3).map((order) => (
                  <div key={order.id}>{renderOrderRow(order)}</div>
                ))}
                {inProgress.length > 3 ? (
                  <button type="button" onClick={onOpenOrders} className={LINK_BUTTON + " ml-2"}>
                    {inProgress.length - 3}{uiText(" more in the furniture shop")}</button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--fc-border)] p-4">
                <p className="text-sm text-[var(--fc-muted)]">{uiText("No shop is working on anything for you right now.")}</p>
                <button type="button" onClick={onStartDesigning} className={QUIET_BUTTON + " mt-3"}>{uiText("Start a new design")}</button>
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-8">{leftovers}</div>
      </div>

      <FindAMaker onBrowseShops={onBrowseShops} />
    </div>
  );
}

/**
 * The full-width band the design file closes its dashboard with.
 *
 * It is here because the overview ran out of content before it ran out of
 * page: with two orders and one draft, both columns stopped around 620px down
 * a 1000px screen and left three hundred pixels of nothing under them. The
 * honest way to use that is not taller cards, it is one more thing worth
 * doing, and browsing furniture shops is the thing a customer does between orders.
 *
 * Full width rather than a third column, because it is a different kind of
 * thing from what is above it: that is your work in progress, this is an
 * invitation.
 */
function FindAMaker({ onBrowseShops }: { onBrowseShops: () => void }) {
  const { t: uiText } = useUiLanguage();
  return (
    <section
      aria-labelledby="home-makers-title"
      className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] sm:flex-row sm:items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/shop.webp"
        alt=""
        loading="lazy"
        className="h-36 w-full shrink-0 object-cover sm:h-32 sm:w-52"
      />
      <div className="min-w-0 flex-1 px-5 pb-5 sm:px-0 sm:pb-0">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >{uiText("Good craft, close to home")}</p>
        <h2
          id="home-makers-title"
          className="mt-1.5 font-display text-lg font-bold tracking-[-0.02em] text-[var(--fc-text)]"
        >{uiText("Your next maker might be around the corner.")}</h2>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Independent furniture shops on FurniCraft, with the pieces they publish.")}</p>
      </div>
      <div className="shrink-0 px-5 pb-5 sm:pb-0 sm:pr-5">
        <button
          type="button"
          onClick={onBrowseShops}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--fc-ink-accent)] px-4 text-sm font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98]"
        >{uiText("Explore shops")}<IconArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}


const LINK_BUTTON =
  "inline-flex items-center text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline [@media(pointer:coarse)]:min-h-11";

const QUIET_BUTTON =
  "inline-flex min-h-11 items-center rounded-xl border border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.98]";


/**
 * Where you are in placing an order, as three steps that fill in.
 *
 * Two complaints, one control. The dashboard never said which furniture shop your
 * next order goes to -- that lived on the Shops tab as a line of prose, "Your
 * next order goes to Mark Furniture Shop", which is easy to read past and
 * impossible to see at a glance. And the only account of the steps was
 * HOW_IT_WORKS, which described what happens *after* you design and vanished
 * the moment you had a single order, so it taught nobody anything twice.
 *
 * Here the furniture shop is its logo at 36px, not a sentence, and each step is
 * either done or the thing to do next. Written shop-first because that is the
 * order a customer thinks in; designing first is still allowed, and then step
 * one simply ticks after the fact rather than scolding anybody.
 */
function CommissionSteps({
  shop,
  cartPieces,
  onBrowseShops,
  onStartDesigning,
  onOpenCart,
}: {
  shop: { name: string; logoUrl?: string | null; isPro?: boolean } | null;
  cartPieces: number;
  onBrowseShops: () => void;
  onStartDesigning: () => void;
  onOpenCart?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const hasShop = Boolean(shop);
  const hasPiece = cartPieces > 0;

  return (
    <section aria-labelledby="home-steps-title" className="dash-steps">
      <h2 id="home-steps-title" className="sr-only">{uiText("Steps to send an order")}</h2>
      <ol className="dash-steps-list">
        <StepCell
          index={1}
          label={uiText("Furniture shop")}
          done={hasShop}
          /* The logo is the point of this cell: a name in text was the thing
             that could not be noticed. */
          figure={shop ? <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={36} /> : null}
          value={shop ? <ShopName shop={shop} /> : "Not chosen yet"}
          actionLabel={hasShop ? "Change" : "Browse shops"}
          onAction={onBrowseShops}
        />
        <StepCell
          index={2}
          label={uiText("Piece")}
          done={hasPiece}
          value={
            hasPiece
              ? `${cartPieces} ${cartPieces === 1 ? "piece" : "pieces"} in your cart`
              : "Nothing designed yet"
          }
          actionLabel={hasPiece ? "Add another" : "Design a piece"}
          onAction={onStartDesigning}
        />
        <StepCell
          index={3}
          label={uiText("Send")}
          done={false}
          value={hasPiece ? "Ready to send" : "Send it when you're ready"}
          actionLabel={hasPiece && onOpenCart ? "Review and send" : undefined}
          onAction={onOpenCart}
        />
      </ol>
    </section>
  );
}

function StepCell({
  index,
  label,
  done,
  figure,
  value,
  actionLabel,
  onAction,
}: {
  index: number;
  label: string;
  done: boolean;
  figure?: React.ReactNode;
  value: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <li className="dash-step min-w-0" data-done={done ? "" : undefined}>
      <p className="dash-step-label">
        <span aria-hidden className="dash-step-marker">
          {done ? <IconCheck aria-hidden className="h-3 w-3" /> : index}
        </span>
        {uiText(label)}
        {done ? <span className="sr-only">{uiText(" — done")}</span> : null}
      </p>
      <div className="dash-step-main">
        {figure}
        <p className="dash-step-value">{value}</p>
      </div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="dash-step-action">
          {uiText(actionLabel)}
        </button>
      ) : null}
    </li>
  );
}
/**
 * The page's own heading, and on a desktop the one thing a customer comes here
 * to start.
 *
 * "Design a piece" sits here from lg up only, because below that it is already
 * the middle tab of the bar under the thumb and a second copy would be two
 * buttons for one action. From lg the bar is gone and the studio was reachable
 * only through the sidebar, which is where you look for places rather than for
 * something to do.
 */
function Greeting({
  title,
  subtitle,
  onStartDesigning,
}: {
  title: string;
  subtitle?: string;
  onStartDesigning?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1
          className="text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-[var(--fc-text)] lg:text-[1.9rem]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {uiText(title)}
        </h1>
        {subtitle ? <p className="mt-1 text-[0.95rem] text-[var(--fc-muted)]">{uiText(subtitle)}</p> : null}
      </div>
      {onStartDesigning ? (
        <button
          type="button"
          onClick={onStartDesigning}
          className="hidden shrink-0 items-center gap-2 rounded-xl bg-[var(--fc-btn)] px-5 py-3 text-sm font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98] lg:inline-flex"
        >
          <IconFurniture aria-hidden className="h-4 w-4" />{uiText("Design a piece")}</button>
      ) : null}
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

function Thumb({ src, size }: { src: string | null; size: number }) {
  const style = { width: size, height: size };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" style={style} className="shrink-0 rounded-xl border border-[var(--fc-border)] bg-white object-cover" />
  ) : (
    <span
      aria-hidden
      style={style}
      className="grid shrink-0 place-items-center rounded-xl border border-dashed border-[var(--fc-border)]"
    >
      <IconFurniture aria-hidden className="h-5 w-5 opacity-60" />
    </span>
  );
}

/**
 * The one order waiting on the customer, saying what is due and with the
 * button that moves it on. The two waiting states are the only ones a
 * customer can act on (CUSTOMER_ACTIONABLE): a quote to answer, and a
 * downpayment to send.
 */
function NeedsYouCard({ order, shopName, onOpen }: { order: HomeOrder; shopName: string; onOpen: () => void }) {
  const { t: uiText } = useUiLanguage();
  const meta = orderStatusMeta(order.status);
  const downpayment = order.downpayment_amount ?? downpaymentOf(order.quoted_total, order.downpayment_percent);
  let body = meta.customerHint;
  let action = "Open order";
  if (order.status === "quoted") {
    action = "Review quote";
    if (order.quoted_total != null) {
      body = `${shopName} priced it at ${formatPeso(order.quoted_total)}.${downpayment != null ? ` Downpayment ${formatPeso(downpayment)}.` : ""}`;
    }
  } else if (order.status === "confirmed" && order.payment_rejected_reason) {
    // A rejected receipt puts the order back to "confirmed". Saying "send the
    // downpayment" again would hide that the shop already looked and why it
    // said no, which is the one thing the customer needs to read first.
    action = "Upload new receipt";
    body = `${shopName} couldn't confirm your payment: “${order.payment_rejected_reason}”. Check their payment details and upload a new receipt.`;
  } else if (order.status === "confirmed") {
    action = "Pay downpayment";
    if (downpayment != null) {
      body = `Send the ${formatPeso(downpayment)} downpayment to ${shopName}, then upload the receipt.`;
    }
  }
  const isActionable = CUSTOMER_ACTIONABLE.includes(order.status as OrderStatus);

  return (
    <article className="rounded-2xl border-[1.5px] border-[var(--fc-accent)] bg-[var(--fc-panel)] p-4">
      <div className="flex items-start gap-3">
        <Thumb src={order.preview_url} size={64} />
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block -rotate-2 whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-bold uppercase tracking-[0.08em] ${
              isActionable ? "border-fc-danger text-fc-danger" : "border-[var(--fc-border)] text-[var(--fc-muted)]"
            }`}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {uiText(meta.label)}
          </span>
          <h3 className="mt-1 font-semibold leading-snug text-[var(--fc-text)]">{order.project_name}</h3>
          <p className="mt-0.5 text-sm text-[var(--fc-muted)]">{uiText(body)}</p>
        </div>
      </div>
      {/* Full width under the thumb, and only as wide as its own label from lg
          up. Left full width on a desktop this measured 746px: one button
          across three quarters of the screen, which reads as a banner rather
          than as something to press. */}
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--fc-btn)] px-5 font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98] lg:w-auto"
      >
        {action}
      </button>
    </article>
  );
}

function CartNotice({ pieces, onOpen }: { pieces: number; onOpen: () => void }) {
  const { t: uiText } = useUiLanguage();
  return (
    <section aria-labelledby="home-cart-title">
      <SectionLabel id="home-cart-title">{uiText("Your cart")}</SectionLabel>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3 text-left transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,var(--fc-panel))] active:scale-[0.99]"
      >
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-[var(--fc-ink-accent)]"
        >
          <IconCart className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-[var(--fc-text)]">
            {pieces === 1 ? uiText("1 piece") : uiText("{0} pieces", { 0: pieces })}{uiText(" not sent yet")}</span>
          <span className="block text-sm text-[var(--fc-muted)]">{uiText("Review them and send to the shop.")}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-[var(--fc-ink-accent)]">{uiText("Open")}</span>
      </button>
    </section>
  );
}

function LatestMessage({ message, onOpen }: { message: HomeMessage; onOpen: () => void }) {
  const { t: uiText } = useUiLanguage();
  return (
    <section aria-labelledby="home-message-title">
      <SectionLabel id="home-message-title">{uiText("Latest message")}</SectionLabel>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3 text-left transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,var(--fc-panel))] active:scale-[0.99]"
      >
        <span
          aria-hidden
          className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-base font-bold text-[var(--fc-ink-accent)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {(message.shopName || "?").trim().charAt(0).toUpperCase()}
          {message.online ? (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--fc-panel)] bg-fc-online" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold text-[var(--fc-text)]">{message.shopName}</span>
            <span className="shrink-0 text-xs text-[var(--fc-muted)]">{message.time}</span>
          </span>
          <span className={`block truncate text-sm ${message.unread ? "font-semibold text-[var(--fc-text)]" : "text-[var(--fc-muted)]"}`}>
            {message.fromYou ? uiText("You: ") : message.senderName !== message.shopName ? `${message.senderName}: ` : ""}
            {message.text}
          </span>
        </span>
        {message.unread ? <span className="sr-only">{uiText("Unread")}</span> : null}
      </button>
    </section>
  );
}

function DraftRow({ draft, onOpen }: { draft: HomeDraft; onOpen: () => void }) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const edited = new Date(draft.updated_at).toLocaleDateString(uiLocale, { month: "short", day: "numeric" });
  return (
    <section aria-labelledby="home-draft-title">
      <SectionLabel id="home-draft-title">{uiText("Pick up where you left off")}</SectionLabel>
      {/* A larger preview than the 44px thumbnail this used to carry. The
          design file gives the draft the biggest picture on the dashboard,
          and it is right to: this is the one card that is a piece of
          furniture rather than a status, and the column it sits in had the
          room going spare. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3 text-left transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,var(--fc-panel))] active:scale-[0.99]"
      >
        <Thumb src={draft.preview_url} size={76} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-[var(--fc-text)]">{draft.name}</span>
          <span className="mt-0.5 block text-sm text-[var(--fc-muted)]">{uiText("Draft, edited ")}{edited}</span>
          <span className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--fc-btn)] px-3 text-xs font-bold text-[var(--fc-btn-fg)]">{uiText("Continue in studio")}<IconArrowUpRight aria-hidden className="h-3 w-3" />
          </span>
        </span>
      </button>
    </section>
  );
}
