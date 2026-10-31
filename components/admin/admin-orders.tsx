"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";
import { formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import { timeAgo } from "@/lib/time-ago";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";
import { IconArrowLeft } from "@/components/solihiya/icons";

/**
 * Every order on the platform, and every refund that has not finished.
 *
 * The gap this fills: before it, an admin could read exactly the orders
 * somebody had filed a report about. A customer writing in because their order
 * has sat in production for two months has usually not filed a report, and
 * there was nowhere to look their order up -- on the one table carrying money.
 *
 * ---------------------------------------------------------------------------
 * Read only, and that is the design rather than a first pass
 *
 * Nothing here writes. A refund on FurniCraft is money moving directly between
 * a customer and a shop; the platform never holds it, so an admin who could
 * mark one "refunded" would be recording a payment nobody made, in the exact
 * field both parties would later point at. What an admin needs is to SEE that
 * a refund has been sitting in `requested` for three weeks -- and then chase
 * the shop, which is a conversation, not a database write.
 *
 * The same reasoning covers order status. A shop moves its own orders along;
 * an admin reaching into that would be building a piece of furniture on the
 * shop's behalf.
 *
 * ---------------------------------------------------------------------------
 * Why the list can come back empty
 *
 * Row-level security still applies to an admin. Reading every order depends on
 * `design_orders_select_admin` in
 * supabase/migrations/20260921000100_admin_order_oversight.sql. Until that is
 * applied this renders the "nothing readable" notice rather than an empty
 * table that looks like a platform with no orders.
 */

/** Names are fetched in one batch per list, not one query per row. */
type Order = {
  id: string;
  shop_id: string;
  customer_user_id: string;
  project_name: string;
  status: string;
  quoted_total: number | null;
  downpayment_percent: number | null;
  downpayment_amount: number | null;
  payment_reference: string | null;
  payment_submitted_at: string | null;
  refund_status: string | null;
  refund_reason: string | null;
  refund_requested_at: string | null;
  refund_declined_reason: string | null;
  refund_reference: string | null;
  refund_amount: number | null;
  created_at: string;
};

const ORDER_COLUMNS =
  "id, shop_id, customer_user_id, project_name, status, quoted_total, downpayment_percent, " +
  "downpayment_amount, payment_reference, payment_submitted_at, refund_status, refund_reason, " +
  "refund_requested_at, refund_declined_reason, refund_reference, refund_amount, created_at";

/**
 * The order counts at the top: the whole platform, counted by the database
 * (head-only counts), not the 200 newest rows the list below loads.
 *
 * Refunds are not counted here. They are follow-up work and live in Tickets
 * (admin-refund-requests.tsx); this page is the record of transactions.
 */
const STATUS_CARDS: Array<{ label: string; statuses: string[] | null; hint: string }> = [
  { label: "Total orders", statuses: null, hint: "Every order placed on FurniCraft" },
  { label: "Waiting for a quote", statuses: ["pending_quote"], hint: "Sent to a shop, not yet quoted" },
  { label: "Waiting for payment", statuses: ["quoted", "confirmed", "payment_submitted"], hint: "Quoted, accepted, or a receipt being checked" },
  { label: "In production", statuses: ["in_production"], hint: "Being built" },
  { label: "Completed", statuses: ["completed"], hint: "Finished and handed over" },
  { label: "Declined", statuses: ["declined"], hint: "Declined or cancelled" },
];

const REFUND_TONE: Record<string, string> = {
  requested: "bg-[rgba(192,138,62,0.18)] text-[#8a6118]",
  declined: "bg-[rgba(192,57,43,0.14)] text-[#a8452c]",
  refunded: "bg-[rgba(53,111,82,0.16)] text-[#356f52]",
};

export default function AdminOrders() {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<number[] | null>(null);
  const [shopNames, setShopNames] = useState<Record<string, string>>({});
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /**
   * Which shop is open, or null for the list of shops.
   *
   * The list is the landing view rather than every order at once: an admin
   * arrives here asking about one shop -- "what is this shop doing", "which
   * shop is sitting on refunds" -- and a page that opens with four hundred
   * orders from thirty shops answers neither until it has been scrolled.
   */
  const [openShopId, setOpenShopId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // The newest 200 for the list, and the exact counts for the cards.
    const [recentResult, ...countResults] = await Promise.all([
      supabase.from("design_orders").select(ORDER_COLUMNS).order("created_at", { ascending: false }).limit(200),
      ...STATUS_CARDS.map((card) => {
        const query = supabase.from("design_orders").select("id", { count: "exact", head: true });
        return card.statuses ? query.in("status", card.statuses) : query;
      }),
    ]);

    if (recentResult.error) {
      // An RLS refusal comes back as an empty result rather than an error, so
      // this is for a genuine failure -- a dropped connection, a bad column.
      console.error("Admin orders failed to load:", recentResult.error);
      setUnreadable(true);
      setLoading(false);
      return;
    }

    const all = (recentResult.data ?? []) as unknown as Order[];
    setCounts(countResults.map((result) => result.count ?? 0));
    setOrders(all);
    // Nothing readable at all, on a platform that has shops: almost certainly
    // the policy rather than an empty database. Said as a notice rather than
    // left to look like "no orders yet".
    setUnreadable(all.length === 0);

    const shopIds = Array.from(new Set(all.map((order) => order.shop_id)));
    const peopleIds = Array.from(new Set(all.map((order) => order.customer_user_id)));

    const [shopRows, peopleRows] = await Promise.all([
      shopIds.length ? supabase.from("shops").select("id, shop_name").in("id", shopIds) : { data: [] },
      peopleIds.length ? supabase.from(USER_NAMES_TABLE).select("id, full_name").in("id", peopleIds) : { data: [] },
    ]);

    setShopNames(
      Object.fromEntries(
        ((shopRows.data ?? []) as Array<{ id: string; shop_name: string | null }>).map((row) => [
          row.id,
          row.shop_name || "Shop",
        ])
      )
    );
    setCustomerNames(
      Object.fromEntries(
        ((peopleRows.data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [
          row.id,
          row.full_name || "Customer",
        ])
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The list, gathered under the shop each order belongs to, shops in name
   * order and each shop's orders newest first: the question here is "what is
   * this shop doing", which needs one shop's orders side by side.
   */
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const matching = orders
      // A card can stand for several statuses ("Waiting for payment"), so the
      // filter value is a comma list.
      .filter((order) => (statusFilter === "all" ? true : statusFilter.split(",").includes(order.status)))
      .filter((order) => {
        if (!needle) return true;
        return [
          order.project_name,
          shopNames[order.shop_id] ?? "",
          customerNames[order.customer_user_id] ?? "",
          order.payment_reference ?? "",
          order.refund_reference ?? "",
          order.id,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });

    const byShop = new Map<string, Order[]>();
    for (const order of matching) {
      const list = byShop.get(order.shop_id);
      if (list) list.push(order);
      else byShop.set(order.shop_id, [order]);
    }

    const built = Array.from(byShop.entries()).map(([shopId, rows]) => ({
      shopId,
      name: shopNames[shopId] ?? "Shop",
      orders: [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }));

    return built.sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, search, statusFilter, shopNames, customerNames]);

  const visibleCount = groups.reduce((total, group) => total + group.orders.length, 0);

  /**
   * The shop currently open, looked up in the filtered groups rather than
   * held as its own object.
   *
   * So a search or a status filter that excludes every one of a shop's orders
   * closes it rather than leaving an empty list under its name.
   */
  const openShop = openShopId ? (groups.find((group) => group.shopId === openShopId) ?? null) : null;

  if (loading) {
    return <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading orders…")}</p>;
  }

  if (unreadable) {
    return (
      <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 text-sm">
        <h3 className="font-semibold text-[var(--fc-text)]">{uiText("No orders are readable")}</h3>
        <p className="mt-2 text-[var(--fc-muted)]">{uiText("Either the platform has no orders yet, or the admin read policy has not been applied. If shops are trading, it is the policy: run")}{" "}
          <code className="rounded bg-[rgba(122,105,96,0.14)] px-1.5 py-0.5 text-xs">{uiText("supabase/migrations/20260921000100_admin_order_oversight.sql")}</code>{" "}{uiText("in the SQL editor.")}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* ---- where every order on the platform stands. Clicking a card
          filters the list below to it. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STATUS_CARDS.map((card, index) => {
          const filterValue = card.statuses?.length === 1 ? card.statuses[0] : card.statuses ? card.statuses.join(",") : "all";
          const on = statusFilter === filterValue;
          return (
            <button
              key={card.label}
              type="button"
              title={uiText(card.hint)}
              aria-pressed={on}
              onClick={() => {
                setStatusFilter(on ? "all" : filterValue);
                setOpenShopId(null);
              }}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                on ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.10)]" : "border-[var(--fc-border)] bg-[var(--fc-panel)] hover:bg-[rgba(178,106,56,0.05)]"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wider text-[var(--fc-muted)]">{uiText(card.label)}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--fc-text)]">{counts ? counts[index] : "—"}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={uiText("Search customer, shop, project or reference")}
          aria-label={uiText("Search orders")}
          className="min-w-0 flex-1 rounded-full border border-[var(--fc-border)] bg-transparent px-4 py-2 text-sm outline-none"
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label={uiText("Filter by status")}
          className="rounded-full border border-[var(--fc-border)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="all">{uiText("Any status")}</option>
          <option value="quoted,confirmed,payment_submitted">{uiText("Waiting for payment")}</option>
          {["pending_quote", "quoted", "confirmed", "payment_submitted", "in_production", "completed", "declined"].map(
            (status) => (
              <option key={status} value={status}>
                {uiText(orderStatusMeta(status).label)}
              </option>
            )
          )}
        </select>
      </div>

      {visibleCount === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-6 text-center text-sm text-[var(--fc-muted)]">
          {uiText("Nothing matches.")}
        </p>
      ) : null}

      {/* ---- the shops, until one is opened */}
      {openShop === null
        ? groups.map((group) => (
            <button
              key={group.shopId}
              type="button"
              onClick={() => setOpenShopId(group.shopId)}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 text-left transition hover:bg-[rgba(178,106,56,0.06)]"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--fc-text)]">{group.name}</p>
                <p className="mt-0.5 text-xs text-[var(--fc-muted)]">
                  {group.orders.length} {group.orders.length === 1 ? uiText("transaction") : uiText("transactions")}
                  {" · "}
                  {formatPeso(group.orders.reduce((sum, order) => sum + (order.quoted_total ?? 0), 0))}
                  {uiText(" quoted")}
                </p>
              </div>
              <span className="shrink-0 text-xs font-bold text-[var(--fc-ink-accent)]">{uiText("View transactions →")}</span>
            </button>
          ))
        : null}

      {/* ---- one shop's transactions */}
      {openShop ? (
        <section className="grid gap-2.5">
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-[var(--fc-bg)] px-1 py-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-[var(--fc-text)]">{openShop.name}</h3>
              <p className="text-[11px] text-[var(--fc-muted)]">
                {openShop.orders.length} {openShop.orders.length === 1 ? uiText("transaction") : uiText("transactions")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpenShopId(null)}
              className={BACK_BUTTON_CLASS}
            >
              <IconArrowLeft aria-hidden className="h-4 w-4" />{uiText("All shops")}</button>
          </div>

        {openShop.orders.map((order) => {
          const meta = orderStatusMeta(order.status);

          return (
            <article key={order.id} className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate font-semibold text-[var(--fc-text)]">{order.project_name}</h4>
                  {/* No shop name here: the group heading above already says
                      whose orders these are, and repeating it on every card
                      pushes the customer -- the thing that actually differs
                      row to row -- out to the end of the line. */}
                  <p className="mt-0.5 text-xs text-[var(--fc-muted)]">
                    {customerNames[order.customer_user_id] ?? uiText("Customer")}{uiText(" · ordered ")}{timeAgo(order.created_at, undefined, uiLanguage)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.tone}`}>
                    {uiText(meta.label)}
                  </span>
                  {/* Only the fact, for the record. Following a refund up is
                      Tickets' job. */}
                  {order.refund_status ? (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        REFUND_TONE[order.refund_status] ?? "bg-[rgba(122,105,96,0.14)]"
                      }`}
                    >
                      {uiText("Refund ")}
                      {uiText(order.refund_status)}
                    </span>
                  ) : null}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-[var(--fc-muted)]">{uiText("Quoted")}</dt>
                  <dd className="font-semibold tabular-nums">{formatPeso(order.quoted_total)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--fc-muted)]">{uiText("Downpayment")}</dt>
                  <dd className="font-semibold tabular-nums">
                    {order.downpayment_amount !== null
                      ? formatPeso(order.downpayment_amount)
                      : order.downpayment_percent !== null
                        ? `${order.downpayment_percent}%`
                        : "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--fc-muted)]">{uiText("Payment ref")}</dt>
                  <dd className="truncate font-semibold">{order.payment_reference || "—"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[var(--fc-muted)]">{uiText("Order id")}</dt>
                  <dd className="truncate font-mono text-[10px]">{order.id}</dd>
                </div>
              </dl>

            </article>
          );
        })}
        </section>
      ) : null}

      <p className="text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("Read only. Money moves directly between a customer and a shop, so nothing here can move an order along. Refund requests are followed up in Tickets.")}</p>
    </div>
  );
}
