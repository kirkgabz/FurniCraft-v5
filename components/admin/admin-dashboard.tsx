"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/time-ago";
import {
  IconCheck,
  IconClock,
  IconMessages,
  IconOrders,
  IconStar,
  IconWarning,
  type SolihiyaIcon,
} from "@/components/solihiya/icons";

/** The sections this dashboard can send the admin to. */
export type AdminDashboardTarget =
  | "applications"
  | "support"
  | "tickets"
  | "orders"
  | "subscriptions"
  | "closures"
  | "deactivated_shops";

export type DashboardApplication = {
  id: string;
  shop_name: string;
  email: string;
  created_at: string;
  updated_at?: string | null;
};

type AdminAction = {
  id: string;
  action: string;
  detail: string | null;
  created_at: string;
};

/** Plain words for what triggers write to admin_actions (20261014014436). */
const ACTION_LABEL: Record<string, string> = {
  shop_approved: "Approved a shop application",
  shop_rejected: "Rejected a shop application",
  shop_suspended: "Suspended a shop",
  shop_reinstated: "Reinstated a shop",
  ticket_resolved: "Resolved a ticket",
  ticket_dismissed: "Dismissed a ticket",
  subscription_approved: "Approved a Pro payment",
  subscription_rejected: "Rejected a Pro payment",
};

/** How many approved shops the Shop applications card always shows. */
const RECENT_APPROVED = 3;

/** Rows per page in Needs your attention. */
const ATTENTION_PER_PAGE = 4;

/**
 * Where an admin lands: what is waiting on them, and what was done last.
 *
 * Deliberately not a statistics page. "Needs your attention" lists only what
 * is waiting for a response right now -- a queue with nothing in it is not
 * shown at all. Shop applications have their own card, which also shows the
 * latest approved shops. The queues the panel already counts for its sidebar
 * badges are passed in, so this page and the badges can never disagree; the
 * rest are read here with head-only counts.
 */
export default function AdminDashboard({
  pendingApplications,
  approvedApplications,
  supportNeedsReply,
  ticketsOpen,
  subscriptionsPending,
  onOpen,
  onReviewApplication,
}: {
  pendingApplications: DashboardApplication[];
  approvedApplications: DashboardApplication[];
  supportNeedsReply: number;
  ticketsOpen: number;
  subscriptionsPending: number;
  onOpen: (target: AdminDashboardTarget) => void;
  onReviewApplication: (id: string, queue: "pending" | "approved") => void;
}) {
  const { t: uiText, locale: uiLocale, language: uiLanguage } = useUiLanguage();
  const [refundsOpen, setRefundsOpen] = useState(0);
  const [deletionRequests, setDeletionRequests] = useState(0);
  const [deactivatedShops, setDeactivatedShops] = useState(0);
  const [actions, setActions] = useState<AdminAction[] | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [refunds, deletions, deactivated, log] = await Promise.all([
      supabase.from("design_orders").select("id", { count: "exact", head: true }).eq("refund_status", "requested"),
      supabase
        .from("user_profiles")
        .select("id", { count: "exact", head: true })
        .not("deletion_requested_at", "is", null)
        .is("deleted_at", null),
      supabase
        .from("shops")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .not("inactive_deactivated_at", "is", null),
      supabase.from("admin_actions").select("id, action, detail, created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    // A count that fails to load reads as nothing waiting rather than an
    // error banner on the page an admin opens first.
    setRefundsOpen(refunds.count ?? 0);
    setDeletionRequests(deletions.count ?? 0);
    setDeactivatedShops(deactivated.count ?? 0);
    setActions(log.error ? [] : ((log.data ?? []) as AdminAction[]));
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // Everything waiting for a response except shop applications, which have
  // their own card. Only queues with something in them are listed.
  const waiting = (
    [
      {
        target: "support",
        icon: IconMessages,
        count: supportNeedsReply,
        title: "Support chats waiting for a reply",
        hint: "Customers and shop owners who wrote in and haven't heard back.",
        action: "Reply",
      },
      {
        target: "tickets",
        icon: IconWarning,
        count: ticketsOpen,
        title: "Open tickets",
        hint: "Reported chats, payments, refunds, orders, reviews and shops.",
        action: "Open",
      },
      {
        target: "subscriptions",
        icon: IconStar,
        count: subscriptionsPending,
        title: "Pro payments to verify",
        hint: "Match each receipt and reference before granting Pro.",
        action: "Verify",
      },
      {
        target: "tickets",
        icon: IconOrders,
        count: refundsOpen,
        title: "Refunds still waiting on a shop",
        hint: "Follow up if a shop is slow to answer a refund request.",
        action: "View",
      },
      {
        target: "closures",
        icon: IconWarning,
        count: deletionRequests,
        title: "Account deletion requests",
        hint: "Accounts that asked to be closed and haven't been removed yet.",
        action: "View",
      },
      {
        target: "deactivated_shops",
        icon: IconClock,
        count: deactivatedShops,
        title: "Shops deactivated for inactivity",
        hint: "Hidden from customers after 90 days. They come back when the owner returns.",
        action: "View",
      },
    ] satisfies Array<{
      target: AdminDashboardTarget;
      icon: SolihiyaIcon;
      count: number;
      title: string;
      hint: string;
      action: string;
    }>
  ).filter((item) => item.count > 0);

  const pending = [...pendingApplications].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  // Last touched first: approval stamps updated_at, so a newly approved shop
  // leads. No date is shown, because an owner's later edits move it too.
  const approvedAt = (shop: DashboardApplication) => shop.updated_at || shop.created_at;
  const recentApproved = [...approvedApplications]
    .sort((a, b) => Date.parse(approvedAt(b)) - Date.parse(approvedAt(a)))
    .slice(0, RECENT_APPROVED);

  // A page holds as many rows as sit beside the Shop applications card, so
  // this card never grows past its neighbour; at most six queues means at
  // most two pages. Clamped, because a queue emptying can remove a page.
  const pageCount = Math.max(1, Math.ceil(waiting.length / ATTENTION_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = waiting.slice((currentPage - 1) * ATTENTION_PER_PAGE, currentPage * ATTENTION_PER_PAGE);

  const toRespond = waiting.length + (pending.length > 0 ? 1 : 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning, Admin" : hour < 18 ? "Good afternoon, Admin" : "Good evening, Admin";
  const today = new Date().toLocaleDateString(uiLocale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="grid gap-6">
      <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{today}</p>
        <h2 className="mt-1 text-2xl font-semibold text-[var(--fc-text)]">{uiText(greeting)}</h2>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">
          {toRespond === 0
            ? uiText("You're all caught up. Nothing needs your attention right now.")
            : toRespond === 1
              ? uiText("One thing needs your attention today.")
              : uiText("{0} things need your attention today.", { 0: toRespond })}
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="self-start rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Needs your attention")}</h3>
          <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("Waiting for your response. Answer these as soon as you can.")}</p>
          {waiting.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">
              <IconCheck aria-hidden className="h-4 w-4 text-[#2e7d50]" />
              {uiText("Nothing is waiting for a response.")}
            </p>
          ) : (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {pageItems.map((item) => (
                <li
                  key={item.target}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]">
                    <item.icon aria-hidden className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--fc-text)]">
                      <span className="rounded-full bg-fc-danger px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-fc-danger-fg">{item.count}</span>
                      <span className="min-w-0">{uiText(item.title)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText(item.hint)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpen(item.target)}
                    className="shrink-0 rounded-full bg-[var(--fc-ink-accent)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                  >
                    {uiText(item.action)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {waiting.length > 0 ? (
            <nav aria-label={uiText("Needs your attention pages")} className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--fc-border)] pt-3">
              <p className="text-xs text-[var(--fc-muted)]">
                {uiText("Showing {0}–{1} of {2}", {
                  0: (currentPage - 1) * ATTENTION_PER_PAGE + 1,
                  1: (currentPage - 1) * ATTENTION_PER_PAGE + pageItems.length,
                  2: waiting.length,
                })}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="rounded-full border border-[var(--fc-border)] px-3 py-1 text-xs font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {uiText("Prev")}
                </button>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
                  <button
                    key={number}
                    type="button"
                    onClick={() => setPage(number)}
                    aria-current={number === currentPage ? "page" : undefined}
                    className={`h-7 min-w-[1.75rem] rounded-full px-2 text-xs font-semibold tabular-nums transition ${
                      number === currentPage
                        ? "bg-[var(--fc-ink-accent)] text-white"
                        : "text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.08)]"
                    }`}
                  >
                    {number}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  className="rounded-full border border-[var(--fc-border)] px-3 py-1 text-xs font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.08)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {uiText("Next")}
                </button>
              </div>
            </nav>
          ) : null}
        </section>

        <div className="grid content-start gap-6">
          <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Shop applications")}</h3>
              <button
                type="button"
                onClick={() => onOpen("applications")}
                className="text-xs font-semibold text-[var(--fc-ink-accent)] hover:underline"
              >
                {uiText("See all")}
              </button>
            </div>

            <p className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-muted)]">
              {uiText("Awaiting your response")}
              {pending.length > 0 ? (
                <span className="rounded-full bg-fc-danger px-1.5 py-0.5 text-[10px] font-bold tabular-nums tracking-normal text-fc-danger-fg">{pending.length}</span>
              ) : null}
            </p>
            {pending.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("No applications are waiting.")}</p>
            ) : (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {pending.map((application) => (
                  <li
                    key={application.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--fc-text)]">{application.shop_name}</p>
                      <p className="truncate text-xs text-[var(--fc-muted)]">
                        {uiText("Applied {0}", { 0: timeAgo(application.created_at, undefined, uiLanguage) })} · {application.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onReviewApplication(application.id, "pending")}
                      className="shrink-0 rounded-full bg-[var(--fc-ink-accent)] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                    >
                      {uiText("Review")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-4 border-t border-[var(--fc-border)] pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-muted)]">
              {uiText("Recently approved")}
            </p>
            {recentApproved.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("No approved shop owners yet.")}</p>
            ) : (
              <ul className="m-0 mt-1 list-none divide-y divide-[var(--fc-border)] p-0">
                {recentApproved.map((shop) => (
                  <li key={shop.id}>
                    <button
                      type="button"
                      onClick={() => onReviewApplication(shop.id, "approved")}
                      className="flex w-full items-center gap-2.5 py-2 text-left"
                    >
                      <IconCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-[#2e7d50]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--fc-text)]">{shop.shop_name}</span>
                        <span className="block truncate text-xs text-[var(--fc-muted)]">{shop.email}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[rgba(46,125,80,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#2e7d50]">
                        {uiText("Approved")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Recent admin actions")}</h3>
            <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("Recorded automatically and can't be edited.")}</p>
            {actions === null ? (
              <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>
            ) : actions.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("No admin actions recorded yet.")}</p>
            ) : (
              <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                {actions.map((entry) => (
                  <li key={entry.id} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--fc-ink-accent)]" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[var(--fc-text)]">
                        {uiText(ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, " "))}
                        {entry.detail ? <span className="text-[var(--fc-muted)]"> · {entry.detail}</span> : null}
                      </p>
                      <p className="text-xs text-[var(--fc-muted)]">{timeAgo(entry.created_at, undefined, uiLanguage)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
