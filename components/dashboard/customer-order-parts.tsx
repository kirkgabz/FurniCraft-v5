"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { CUSTOMER_ACTIONABLE, formatBudget, formatPeso, orderStatusMeta, type OrderStatus } from "@/components/orders/order-status";
import { IconEdit, IconFurniture, IconTrash } from "@/components/solihiya/icons";
import type { CustomerDesign, CustomerOrder } from "@/components/dashboard/customer-dashboard-types";

/**
 * The order row and design card the customer dashboard and its sections share.
 */

/**
 * One of the customer's orders.
 *
 * The same shape as the shop's queue row, for the same reason: a list of
 * orders that all say "My Victorian Chair" is unreadable without the design
 * beside it, and the row should say what the customer has to do rather than
 * making them open it to find out. customerHint is the mirror of the shopHint
 * the shop sees, from the same table.
 */
export function CustomerOrderRow({
  order,
  shopName,
  selected,
  dimmed = false,
  compact = false,
  showHint = false,
  table = false,
  onOpen,
}: {
  order: CustomerOrder;
  shopName: string;
  selected: boolean;
  dimmed?: boolean;
  /** The overview card's column is roughly a third the width of the full
   *  Orders page. Name, stamp and price all on one baseline row only has
   *  room for "My ..." there, so compact drops the price (and its dotted
   *  leader) from that row and appends it to the detail line instead --
   *  same information, just where the width actually is. */
  compact?: boolean;
  /** Show the status hint even when the order is not waiting on the customer
   *  ("Your piece is being built."). Home's In the furniture shop list uses it, where
   *  what the shop is doing is the whole point of the row. */
  showHint?: boolean;
  /**
   * From lg up, lay the row out as a table line: piece, furniture shop, status,
   * estimate, updated, each under its own heading.
   *
   * Opt-in rather than automatic, because the same row is also used in the
   * overview's right-hand column, which is about a third of this width. A
   * table there would have five columns in 345px. The Orders page is the only
   * place wide enough, and the only place where comparing one order against
   * another is the point. Below lg both callers get the stacked row, which is
   * the right shape under a thumb.
   */
  table?: boolean;
  onOpen: () => void;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const meta = orderStatusMeta(order.status);
  const needsYou = CUSTOMER_ACTIONABLE.includes(order.status as OrderStatus);
  /**
   * What the row shows in its money column, and what to call it.
   *
   * Once a shop has quoted, the quote is the only number that matters and it is
   * the one the customer will be asked to pay. Before that, the honest figure is
   * what the customer themselves said they hoped to spend, not the estimate the
   * studio used to invent from its own materials table. Orders sent before
   * budgets existed still carry that estimate and still show it, because for
   * them it is the only number there is.
   */
  const budget = formatBudget(order.budget_min, order.budget_max);
  const quoted = order.quoted_total;
  const money =
    quoted != null
      ? { label: "Quoted", text: formatPeso(quoted), firm: true }
      : budget
        ? { label: "Budget", text: budget, firm: false }
        : order.estimated_price != null
          ? { label: "Estimate", text: formatPeso(order.estimated_price), firm: false }
          : null;
  const updated = new Date(order.created_at).toLocaleDateString(uiLocale);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-1 rounded-lg px-2 py-2.5 text-left transition-[background-color,transform] duration-150 active:scale-[0.99] ${
        selected ? "bg-[rgba(178,106,56,0.08)]" : "hover:bg-[rgba(178,106,56,0.04)]"
      } ${dimmed ? "opacity-70 hover:opacity-100" : ""}`}
    >
      {/* The table line. Columns match the headings the Orders page draws
          above the list, so the two cannot drift apart without it showing. */}
      {table ? (
        <span className="hidden w-full items-center gap-4 lg:grid lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_auto_minmax(0,1.1fr)_minmax(0,0.7fr)]">
          <span className="flex min-w-0 items-center gap-3">
            <OrderThumb src={order.preview_url} />
            <span className="min-w-0 truncate font-semibold text-[var(--fc-text)]">{order.project_name}</span>
          </span>
          <span className="min-w-0 truncate text-sm text-[var(--fc-muted)]">{shopName}</span>
          <StatusStamp label={uiText(meta.label)} needsYou={needsYou} />
          {/* A quote is set in the house's bold ink; a budget is the customer's
              own hope and is written quieter, so the two are never mistaken for
              each other at a glance down the column. */}
          <span className="min-w-0 truncate">
            {money ? (
              <>
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]">
                  {uiText(money.label)}
                </span>
                <span
                  className={`block truncate text-sm tabular-nums ${
                    money.firm ? "font-bold text-[var(--fc-text)]" : "text-[var(--fc-muted)]"
                  }`}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {money.text}
                </span>
              </>
            ) : (
              <span className="text-sm text-[var(--fc-muted)]">{uiText("not quoted")}</span>
            )}
          </span>
          <span className="truncate text-sm tabular-nums text-[var(--fc-muted)]">{updated}</span>
        </span>
      ) : null}

      {/* Thumbnail beside the text rather than inside the line of it.
          It used to be a flex item in a baseline-aligned row, and an image
          baseline-aligns on its bottom edge -- so a 30px square hung 8px above
          the title it was meant to sit against, which a translate-y-0.5 had
          been added to paper over and did not. The text keeps its baselines in
          the inner row; the picture is simply the column to their left, and
          the second line now starts where the first does because they share
          that column rather than guessing at it with a hard-coded indent. */}
      <span className={`flex items-start gap-2 ${table ? "lg:hidden" : ""}`}>
        <OrderThumb src={order.preview_url} />
        <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--fc-text)]">{order.project_name}</span>
        {/* The ink-stamp mark: an outline rather than a filled pill, rotated
            like a hand stamp rather than sitting dead level. Red only for the
            statuses actually waiting on the customer; every other state reads
            as a quiet, neutral mark -- the urgency lives in the mark's color,
            not in a colored bar down the row's edge. */}
        <span
          className={`shrink-0 -rotate-2 whitespace-nowrap rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-[0.08em] ${
            needsYou ? "border-fc-danger text-fc-danger" : "border-[var(--fc-border)] text-[var(--fc-muted)]"
          }`}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {uiText(meta.label)}
        </span>
        {!compact && money ? (
          <>
            {/* Below sm the price moves to the detail line, as compact does:
                a six-figure price and the stamp left the name no width at
                all on a phone, so a row read as a price with no piece. */}
            <span aria-hidden className="mb-1 hidden min-w-3 flex-1 border-b border-dotted border-[var(--fc-border)] sm:block" />
            <span
              className={`hidden shrink-0 whitespace-nowrap tabular-nums sm:inline ${
                money?.firm ? "font-bold text-[var(--fc-text)]" : "text-[var(--fc-muted)]"
              }`}
              style={{ fontFamily: "var(--font-mono)" }}
              title={uiText(money?.label)}
            >
              {money?.text}
            </span>
          </>
        ) : null}
        </span>
      <span className="mt-0.5 block text-xs text-[var(--fc-muted)]">
        {shopName} · {updated}
        {money ? (
          <span className={compact ? "" : "sm:hidden"}>
            {" · "}
            {money.firm ? (
              <strong className="font-semibold text-[var(--fc-text)]">{money.text}</strong>
            ) : (
              <>
                {uiText(money.label.toLowerCase())} {money.text}
              </>
            )}
          </span>
        ) : null}
        {(needsYou || showHint) && meta.customerHint ? ` · ${meta.customerHint}` : ""}
      </span>
        </span>
      </span>
    </button>
  );
}

/**
 * The piece's render, or a dashed stand-in at the same size when it has none.
 *
 * 40px rather than 30. The studio writes its previews letterboxed -- 800x600,
 * 640x325 -- so a square crop of one is mostly empty background, and at 30px
 * the chair inside was a speck: a thumbnail that cost a row 38px of width and
 * showed nothing. Both the table and the phone row draw this same component,
 * so the size is set once here and the text column beside it follows from the
 * flex gap rather than a hard-coded indent.
 */
function OrderThumb({ src }: { src: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="h-10 w-10 shrink-0 rounded-md border border-[var(--fc-border)] bg-white object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-dashed border-[var(--fc-border)]"
    >
      <IconFurniture aria-hidden className="h-[18px] w-[18px] opacity-60" />
    </span>
  );
}

/**
 * The ink-stamp mark: an outline rather than a filled pill, rotated like a
 * hand stamp rather than sitting dead level. Red only for the statuses
 * actually waiting on the customer; every other state reads as a quiet,
 * neutral mark, so the urgency lives in the mark's colour rather than in a
 * coloured bar down the row's edge.
 */
function StatusStamp({ label, needsYou }: { label: string; needsYou: boolean }) {
  const { t: uiText } = useUiLanguage();
  return (
    <span
      className={`shrink-0 -rotate-2 justify-self-start whitespace-nowrap rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-[0.08em] ${
        needsYou ? "border-fc-danger text-fc-danger" : "border-[var(--fc-border)] text-[var(--fc-muted)]"
      }`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {uiText(label)}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const { t: uiText } = useUiLanguage();
  const meta = orderStatusMeta(status);
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${meta.tone}`}>
      {uiText(meta.label)}
    </span>
  );
}

/**
 * A card for one of the customer's own designs, drafted or saved.
 *
 * Defined at module scope rather than inside the dashboard's render body on
 * purpose: a component defined inside another component's function is a new
 * function value on every render, and React then rebuilds its whole DOM
 * subtree from scratch on every re-render rather than reusing it. That exact
 * mistake once wiped an uncommitted file selection in the order-detail page;
 * a card here has no input to lose, but there is no reason to reintroduce the
 * same footgun.
 */
export function CustomerDesignCard({
  design,
  busy,
  onOpen,
  onDelete,
  selected = false,
  onToggleSelect,
}: {
  design: CustomerDesign;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  /** Passed only where cards can be picked for a bulk delete (Drafts). */
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  return (
    // The name and both actions are always shown. They used to be a caption
    // revealed on hover, and a phone has no hover: a tap on the picture did
    // nothing, so a saved design could not be opened or deleted from there.
    <div className={`relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--fc-panel)] ${
      selected ? "border-fc-danger ring-2 ring-[rgba(192,57,43,0.25)]" : "border-[var(--fc-border)]"
    }`}>
      {onToggleSelect ? (
        // A sibling of the picture's button, not inside it: a checkbox nested
        // in a button would open the design on every tick.
        <label className="absolute left-2 top-2 z-10 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-[var(--fc-panel)]/90 shadow-sm [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={uiText("Select {0}", { 0: design.name })}
            className="h-4 w-4 cursor-pointer accent-[var(--fc-ink-accent)]"
          />
        </label>
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        aria-label={uiText("Open {0}", { 0: design.name })}
        className="group relative block aspect-[4/3] w-full overflow-hidden bg-[rgba(178,106,56,0.06)]"
      >
        {design.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={design.preview_url}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:[@media(hover:hover)]:group-hover:scale-[1.04]"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center">
            <IconFurniture aria-hidden className="h-8 w-8 opacity-40" />
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-2.5 sm:p-3">
        <h5 className="truncate text-sm font-semibold text-[var(--fc-text)]">{design.name}</h5>
        {/* A div, not a p: this card sits inside .card sections, whose
            global `.card p` sets 15px text and a 12px margin over these. */}
        <div className="mt-0.5 truncate text-xs text-[var(--fc-muted)]">
          {design.furniture_type ? `${design.furniture_type} · ` : ""}
          {new Date(design.updated_at).toLocaleDateString(uiLocale)}
        </div>
        <div className="mt-auto flex gap-1.5 pt-2">
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 rounded-full border border-dashed border-fc-ink-accent px-2 py-1.5 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 ease-out hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.97]"
          >
            <span className="inline-flex items-center justify-center gap-1.5">
              <IconEdit aria-hidden className="h-3.5 w-3.5" />{uiText(" Open")}</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label={uiText("Delete {0}", { 0: design.name })}
            className="grid shrink-0 place-items-center rounded-full border border-[var(--fc-border)] px-2.5 py-1.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-[var(--fc-muted)] transition-[border-color,color,transform] duration-150 ease-out hover:border-fc-danger hover:text-fc-danger active:scale-[0.97] disabled:opacity-50"
          >
            <IconTrash aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
