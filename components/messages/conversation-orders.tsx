"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";
import { formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import { IconChevronDown, IconFurniture, IconOrders } from "@/components/solihiya/icons";

export type ConversationOrder = {
  id: string;
  project_name: string;
  status: string;
  preview_url: string | null;
  price: number | null;
  created_at: string;
  /**
   * Which pile it belongs in, from the viewer's side: waiting on the viewer,
   * still moving, or finished. Decided by the caller, which knows whose turn
   * each status is (SHOP_ACTIONABLE and CUSTOMER_ACTIONABLE).
   */
  group: "needs" | "active" | "done";
  /** Replaces the status label, e.g. "Refund requested" on a completed order. */
  label?: string;
};

type Filter = "needs" | "active" | "done" | "all";

/**
 * The orders in one conversation, pinned under the chat header.
 *
 * An order arrives in the chat as a card and then scrolls away under the
 * messages about it, so after a busy week the shop could no longer find the
 * order it was being asked about, and a customer with several orders at one
 * shop could not see them side by side. This keeps them in one place that
 * never scrolls: a single line saying how many and how many are waiting on
 * you, which opens into the full list.
 *
 * For bulk orders the list is triage, not twenty cards: a pile for what is
 * waiting on you, one for what is moving, one for what is finished, each with
 * its count, newest first. Each row opens the order, and "Show in chat" jumps
 * back to the card it was sent as.
 */
export default function ConversationOrders({
  orders,
  onOpenOrder,
  onShowInChat,
}: {
  orders: ConversationOrder[];
  onOpenOrder: (orderId: string) => void;
  /** Null when the order's card is not in the loaded thread. */
  onShowInChat: (orderId: string) => (() => void) | null;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const counts = {
    needs: orders.filter((o) => o.group === "needs").length,
    active: orders.filter((o) => o.group === "active").length,
    done: orders.filter((o) => o.group === "done").length,
    all: orders.length,
  };
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>(counts.needs > 0 ? "needs" : "all");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Escape and a tap outside close the list, as a menu would.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [isOpen]);

  if (orders.length === 0) return null;

  const newest = [...orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const visible = filter === "all" ? newest : newest.filter((o) => o.group === filter);
  const firstWaiting = newest.find((o) => o.group === "needs");
  const only = orders.length === 1 ? orders[0] : null;

  const open = () => {
    // Opening lands on whatever is waiting, if anything is, every time.
    setFilter(counts.needs > 0 ? "needs" : "all");
    setIsOpen(true);
  };

  const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: "needs", label: "Needs you" },
    { id: "active", label: "In progress" },
    { id: "done", label: "Done" },
    { id: "all", label: "All" },
  ];

  return (
    <div ref={rootRef} className="relative z-10 shrink-0 border-b" style={{ borderColor: "var(--msgr-hairline, var(--fc-border))" }}>
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        aria-expanded={isOpen}
        aria-controls="conversation-orders-panel"
        className="flex min-h-12 w-full items-center gap-2.5 px-4 py-2 text-left transition-[background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)]"
        style={{ background: "var(--msgr-surface, var(--fc-panel))" }}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-[var(--fc-ink-accent)]">
          <IconOrders aria-hidden className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--fc-text)]">
              {only ? only.project_name : uiText("{0} orders", { 0: orders.length })}
            </span>
            {counts.needs > 0 ? (
              <span className="shrink-0 rounded-full bg-fc-danger px-2 py-0.5 text-[11px] font-bold text-fc-danger-fg">
                {only ? uiText("Needs you") : uiText(counts.needs === 1 ? "{0} needs you" : "{0} need you", { 0: counts.needs })}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-[var(--fc-muted)]">
            {only ? only.label ?? orderStatusMeta(only.status).label : firstWaiting ? uiText("Next: {0}", { 0: firstWaiting.project_name }) : counts.active > 0 ? uiText("{0} in progress", { 0: counts.active }) : uiText("All finished")}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-[var(--fc-ink-accent)]">{isOpen ? uiText("Hide") : uiText("View")}</span>
        <IconChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-[var(--fc-muted)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        // Over the thread rather than pushing it down: the conversation stays
        // where it was, and closing the list puts the reader back in it.
        <div
          id="conversation-orders-panel"
          className="absolute inset-x-0 top-full flex max-h-[min(65dvh,520px)] flex-col border-b shadow-[0_18px_40px_rgba(43,24,16,0.18)]"
          style={{ background: "var(--msgr-surface, var(--fc-panel))", borderColor: "var(--msgr-hairline, var(--fc-border))" }}
        >
          {orders.length > 1 ? (
            <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none]" role="group" aria-label={uiText("Show orders")}>
              {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] ${
                    filter === f.id
                      ? "border-[var(--fc-btn)] bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]"
                      : "border-[var(--fc-border)] text-[var(--fc-text)]"
                  }`}
                >
                  {uiText(f.label)}
                  <span className="tabular-nums opacity-70">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          ) : null}

          <ul className="min-h-0 flex-1 list-none overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
            {visible.map((order) => {
              const meta = orderStatusMeta(order.status);
              const showInChat = onShowInChat(order.id);
              return (
                <li key={order.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenOrder(order.id);
                    }}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-[background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)]"
                  >
                    {order.preview_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={order.preview_url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg border border-[var(--fc-border)] bg-white object-cover"
                      />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-dashed border-[var(--fc-border)]">
                        <IconFurniture aria-hidden className="h-4 w-4 opacity-60" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--fc-text)]">{order.project_name}</span>
                      <span className="flex items-center gap-1.5 text-xs text-[var(--fc-muted)]">
                        <span
                          className={`shrink-0 font-semibold ${order.group === "needs" ? "text-fc-danger" : ""}`}
                        >
                          {order.label ?? meta.label}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="truncate tabular-nums">
                          {order.price != null ? `${formatPeso(order.price).replace(/\.00$/, "")}, ` : ""}
                          {new Date(order.created_at).toLocaleDateString(uiLocale, { month: "short", day: "numeric" })}
                        </span>
                      </span>
                    </span>
                  </button>
                  {showInChat ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        showInChat();
                      }}
                      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-semibold text-[var(--fc-ink-accent)] hover:underline"
                    >{uiText("In chat")}</button>
                  ) : null}
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-[var(--fc-muted)]">{uiText("Nothing here.")}</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
