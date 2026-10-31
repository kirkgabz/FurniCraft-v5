"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";
import { formatPeso } from "@/components/orders/order-status";
import { timeAgo } from "@/lib/time-ago";

/**
 * Refund requests, in the ticket queue where an admin looks for things to
 * follow up -- not on the Orders page, which is the record of transactions.
 *
 * Read only, as before. FurniCraft never holds the money: the shop sends a
 * refund or declines it, and what an admin does with one left waiting is
 * chase the shop. So this shows who is waiting, for how long, and which have
 * gone past the line where waiting has become being ignored.
 */

/** How long a refund may sit unanswered before it is called overdue. */
export const REFUND_OVERDUE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ANSWERED_SHOWN = 5;

type RefundRow = {
  id: string;
  shop_id: string;
  customer_user_id: string;
  project_name: string;
  refund_status: string;
  refund_reason: string | null;
  refund_requested_at: string | null;
  refund_declined_reason: string | null;
  refund_reference: string | null;
  refund_amount: number | null;
  refund_decided_at: string | null;
};

const COLUMNS =
  "id, shop_id, customer_user_id, project_name, refund_status, refund_reason, refund_requested_at, " +
  "refund_declined_reason, refund_reference, refund_amount, refund_decided_at";

export default function AdminRefundRequests({ onPendingCountChange }: { onPendingCountChange?: (count: number) => void }) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [pending, setPending] = useState<RefundRow[]>([]);
  const [answered, setAnswered] = useState<RefundRow[]>([]);
  const [names, setNames] = useState<{ shops: Record<string, string>; people: Record<string, string> }>({ shops: {}, people: {} });
  const [loaded, setLoaded] = useState(false);
  const [showAnswered, setShowAnswered] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [open, done] = await Promise.all([
      supabase.from("design_orders").select(COLUMNS).eq("refund_status", "requested").order("refund_requested_at", { ascending: true }),
      supabase
        .from("design_orders")
        .select(COLUMNS)
        .in("refund_status", ["refunded", "declined"])
        .order("refund_decided_at", { ascending: false, nullsFirst: false })
        .limit(ANSWERED_SHOWN),
    ]);
    const openRows = (open.data ?? []) as unknown as RefundRow[];
    const doneRows = (done.data ?? []) as unknown as RefundRow[];
    setPending(openRows);
    setAnswered(doneRows);
    onPendingCountChange?.(openRows.length);

    const all = [...openRows, ...doneRows];
    const shopIds = Array.from(new Set(all.map((row) => row.shop_id)));
    const peopleIds = Array.from(new Set(all.map((row) => row.customer_user_id)));
    const [shopRows, peopleRows] = await Promise.all([
      shopIds.length ? supabase.from("shops").select("id, shop_name").in("id", shopIds) : { data: [] },
      peopleIds.length ? supabase.from(USER_NAMES_TABLE).select("id, full_name").in("id", peopleIds) : { data: [] },
    ]);
    setNames({
      shops: Object.fromEntries(((shopRows.data ?? []) as Array<{ id: string; shop_name: string | null }>).map((row) => [row.id, row.shop_name || "Shop"])),
      people: Object.fromEntries(((peopleRows.data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [row.id, row.full_name || "Customer"])),
    });
    setLoaded(true);
  }, [onPendingCountChange]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const daysWaiting = (row: RefundRow) =>
    row.refund_requested_at ? Math.floor((Date.now() - new Date(row.refund_requested_at).getTime()) / DAY_MS) : null;
  const overdue = pending.filter((row) => (daysWaiting(row) ?? 0) > REFUND_OVERDUE_DAYS);

  return (
    <section className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--fc-text)]">{uiText("Refund requests")}</h3>
          <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("Only the shop can send the money back. Chase the ones left waiting in Support.")}</p>
        </div>
        <div className="flex gap-2">
          <span
            className="rounded-full border border-[var(--fc-border)] px-3 py-1 text-xs font-semibold text-[var(--fc-text)]"
            title={uiText("Refund requests a shop has not answered yet")}
          >
            {uiText("Pending refunds")} <span className="tabular-nums">{pending.length}</span>
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              overdue.length ? "border-[var(--fc-danger)] bg-[rgba(192,57,43,0.06)] text-[var(--fc-danger)]" : "border-[var(--fc-border)] text-[var(--fc-text)]"
            }`}
            title={uiText("Refund requests a shop hasn't answered in more than {0} days", { 0: REFUND_OVERDUE_DAYS })}
          >
            {uiText("Overdue refunds")} <span className="tabular-nums">{overdue.length}</span>
          </span>
        </div>
      </div>

      {!loaded ? (
        <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>
      ) : pending.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">{uiText("No refund is waiting on a shop.")}</p>
      ) : (
        <ul className="m-0 mt-3 list-none space-y-2 p-0">
          {pending.map((row) => {
            const days = daysWaiting(row);
            const late = (days ?? 0) > REFUND_OVERDUE_DAYS;
            return (
              <li
                key={row.id}
                className={`rounded-2xl border p-3 text-sm ${late ? "border-[var(--fc-danger)] bg-[rgba(192,57,43,0.05)]" : "border-[var(--fc-border)]"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--fc-text)]">{row.project_name}</p>
                    <p className="text-xs text-[var(--fc-muted)]">
                      {names.people[row.customer_user_id] ?? uiText("Customer")} → {names.shops[row.shop_id] ?? uiText("Shop")}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${late ? "bg-[rgba(192,57,43,0.14)] text-[#a8452c]" : "bg-[rgba(192,138,62,0.18)] text-[#8a6118]"}`}>
                    {days === null ? uiText("Waiting") : uiText(days === 1 ? "{0} day waiting" : "{0} days waiting", { 0: days })}
                  </span>
                </div>
                {row.refund_reason ? (
                  <p className="mt-1.5 text-xs text-[var(--fc-text)]">
                    <span className="text-[var(--fc-muted)]">{uiText("Customer: ")}</span>
                    {row.refund_reason}
                  </p>
                ) : null}
                {late ? (
                  <p className="mt-1.5 text-[11px] font-semibold text-[var(--fc-danger)]">
                    {uiText("Overdue: no answer from the shop in more than {0} days.", { 0: REFUND_OVERDUE_DAYS })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {answered.length ? (
        <div className="mt-3 border-t border-[var(--fc-border)] pt-3">
          <button
            type="button"
            onClick={() => setShowAnswered((open) => !open)}
            aria-expanded={showAnswered}
            className="text-xs font-semibold text-[var(--fc-ink-accent)] hover:underline"
          >
            {showAnswered ? uiText("Hide recently answered") : uiText("Show recently answered ({0})", { 0: answered.length })}
          </button>
          {showAnswered ? (
            <ul className="m-0 mt-2 list-none divide-y divide-[var(--fc-border)] p-0">
              {answered.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-[var(--fc-text)]">{row.project_name}</span>
                    <span className="text-[var(--fc-muted)]"> · {names.shops[row.shop_id] ?? uiText("Shop")}</span>
                  </span>
                  <span className="shrink-0 text-[var(--fc-muted)]">
                    {row.refund_status === "refunded"
                      ? uiText("Refunded {0}", { 0: row.refund_amount !== null ? formatPeso(row.refund_amount) : "" })
                      : uiText("Declined")}
                    {row.refund_decided_at ? ` · ${timeAgo(row.refund_decided_at, undefined, uiLanguage)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
