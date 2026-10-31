"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";
import ChatPhotoBubble from "@/components/messages/chat-photo";
import { Stars } from "@/components/reviews/stars";
import { formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import { timeAgo } from "@/lib/time-ago";
import { reportPhotoUrl } from "@/lib/report-photos";
import { AccountSuspensionControl } from "@/components/admin/account-suspension-control";
import { Modal } from "@/components/ui/modal";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import { SUSPENSIONS_TABLE, type Suspension } from "@/lib/account-suspension";
import {
  REPORT_TOPICS,
  TICKET_FILTERS,
  categoryOf,
  type ReportCategory,
} from "@/lib/report-topics";

/**
 * Every report a customer or shop owner has filed, as one queue.
 *
 * This replaces the old "Reported reviews" tool, which read the same `reports`
 * table but with `.eq("target_type", "shop_review")` on the query -- so a
 * report about a payment, a refund or a chat message was written to the
 * database, notified nobody, and appeared on no screen. The reports existed;
 * there was simply nowhere to see them. Dropping one filter is most of what
 * this component is.
 *
 * The review-specific actions the old tool had (remove the review, ban the
 * reviewer) are kept, and now sit on review tickets inside this queue rather
 * than in a second place to look.
 *
 * ---------------------------------------------------------------------------
 * Context, and why it is fetched in batches
 *
 * A ticket is unreadable on its own: "Payment — the shop is asking for more
 * than the quoted amount" needs the order's quote next to it, and "Chat —
 * abusive language" needs the message. So each ticket is joined, client-side,
 * to whatever it points at.
 *
 * Batched by table rather than fetched per ticket, because the naive version
 * is one round trip per row and a queue of forty tickets then opens forty
 * connections on load. Four `.in(...)` queries cover every category.
 *
 * ---------------------------------------------------------------------------
 * What the admin can read, and why the order queries can come back empty
 *
 * Row-level security still applies to an admin. The order behind a ticket is
 * readable only because a report points at it -- see
 * design_orders_select_admin_reported in
 * supabase/migrations/20260914000100. Before that migration is applied every
 * order lookup here returns nothing, and the ticket says so rather than
 * rendering a blank card.
 */

type Report = {
  id: string;
  reporter_user_id: string;
  target_type: string;
  target_id: string;
  category: string | null;
  reason: string;
  details: string | null;
  /** Absent until migration 20261026120000 is applied, and null on older reports. */
  photo_path?: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

type OrderContext = {
  id: string;
  shop_id: string;
  customer_user_id: string;
  project_name: string;
  status: string;
  quoted_total: number | null;
  downpayment_percent: number | null;
  payment_reference: string | null;
  payment_rejected_reason: string | null;
  refund_status: string | null;
  refund_reason: string | null;
  refund_declined_reason: string | null;
  refund_amount: number | null;
  created_at: string;
};

type MessageContext = {
  id: string;
  shop_id: string;
  sender_user_id: string | null;
  sender_role: string | null;
  text: string;
  kind: string;
  payload: unknown;
  created_at: string;
};

type ReviewContext = {
  id: string;
  shop_id: string;
  customer_user_id: string;
  rating: number;
  comment: string | null;
};

const OPEN_STATUSES = new Set(["open", "reviewing"]);

/** Sorts open work above finished work, then newest first inside each. */
function queueOrder(a: Report, b: Report): number {
  const aOpen = OPEN_STATUSES.has(a.status) ? 0 : 1;
  const bOpen = OPEN_STATUSES.has(b.status) ? 0 : 1;
  if (aOpen !== bOpen) return aOpen - bOpen;
  return b.created_at.localeCompare(a.created_at);
}

/** How each status reads on screen; the stored values are lower-case words. */
const STATUS_LABEL: Record<Report["status"], string> = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const NEUTRAL_TONE = "bg-[rgba(120,113,108,0.16)] text-[var(--fc-muted)]";

const STATUS_TONE: Record<Report["status"], string> = {
  open: "bg-[rgba(192,57,43,0.14)] text-[#a8452c]",
  reviewing: "bg-[rgba(192,138,62,0.18)] text-[#8a6118]",
  resolved: "bg-[rgba(53,111,82,0.16)] text-[#356f52]",
  dismissed: "bg-[rgba(120,113,108,0.16)] text-[var(--fc-muted)]",
};

export default function AdminTickets({
  onOpenCountChange,
  refundRequests,
  refundsPending = 0,
}: {
  /** Keeps the sidebar badge in step without counting the queue twice. */
  onOpenCountChange?: (count: number) => void;
  /**
   * The refund requests block, shown under the Refund tab. It stays mounted
   * (hidden) on the other tabs so its pending count keeps the badges right.
   */
  refundRequests?: React.ReactNode;
  /** Refund requests still waiting on a shop, added to the Refund tab's count. */
  refundsPending?: number;
} = {}) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [orders, setOrders] = useState<Record<string, OrderContext>>({});
  const [messages, setMessages] = useState<Record<string, MessageContext>>({});
  const [reviews, setReviews] = useState<Record<string, ReviewContext>>({});
  const [shopNames, setShopNames] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
  // Who owns each shop a ticket touches, so a ticket about a shop can name the
  // account behind it; and that account's role and any suspension.
  const [shopOwnerIds, setShopOwnerIds] = useState<Record<string, string>>({});
  const [shopOwnerAccounts, setShopOwnerAccounts] = useState<Set<string>>(new Set());
  const [suspensions, setSuspensions] = useState<Record<string, Suspension>>({});

  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<ReportCategory | "all">("all");
  const [showClosed, setShowClosed] = useState(false);
  // Close ticket on a card opens the details window straight at the note.
  const [focusClose, setFocusClose] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  // The ticket open in the Report details window, if any.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reviewingOnly, setReviewingOnly] = useState(false);
  // A failed action is reported on the ticket it was tried on, not at the
  // top of a list the admin may have scrolled far down.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const loadingRef = useRef(false);
  const moderationRevision = useRef(0);
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const readRevision = moderationRevision.current;
    try {
      const supabase = createClient();

      const REPORT_COLUMNS =
        "id, reporter_user_id, target_type, target_id, category, reason, details, status, resolution_note, resolved_by, resolved_at, created_at";
      const readReports = (columns: string) =>
        supabase.from("reports").select(columns).order("created_at", { ascending: false });

      const [{ data: userData }, firstRead] = await Promise.all([
        supabase.auth.getUser(),
        readReports(`${REPORT_COLUMNS}, photo_path`),
      ]);
      // Before the report-photos migration is applied there is no photo_path
      // column; read the queue without it rather than show no tickets at all.
      const { data: reportRows, error: reportError } =
        firstRead.error && /photo_path/i.test(firstRead.error.message)
          ? await readReports(REPORT_COLUMNS)
          : firstRead;

      setAdminId(userData.user?.id ?? null);

      if (reportError) {
        // Most likely the `category` column, i.e. the migration has not been
        // applied yet. Say which, rather than leaving an empty queue that looks
        // like "no complaints" when it means "cannot read them".
        setLoadError(
          /category/i.test(reportError.message)
            ? "Tickets need migration 20260914000100 applied to the database — the reports table has no `category` column yet."
            : reportError.message
        );
        setLoading(false);
        return;
      }

      const rows = (reportRows ?? []) as unknown as Report[];
      setLoadError(null);
      if (readRevision === moderationRevision.current) setReports(rows);

      // ------------------------------------------------------------ context
      const idsFor = (targetType: string) =>
        Array.from(new Set(rows.filter((row) => row.target_type === targetType).map((row) => row.target_id)));

      const orderIds = idsFor("design_order");
      const messageIds = idsFor("shop_message");
      const reviewIds = idsFor("shop_review");
      const directShopIds = idsFor("shop");

      const [orderRows, messageRows, reviewRows] = await Promise.all([
        orderIds.length
          ? supabase
              .from("design_orders")
              .select(
                "id, shop_id, customer_user_id, project_name, status, quoted_total, downpayment_percent, payment_reference, payment_rejected_reason, refund_status, refund_reason, refund_declined_reason, refund_amount, created_at"
              )
              .in("id", orderIds)
              .then(({ data, error }) => { if (error) throw error; return (data ?? []) as OrderContext[]; })
          : Promise.resolve([]),
        messageIds.length
          ? supabase
              .from("shop_messages")
              .select("id, shop_id, sender_user_id, sender_role, text, kind, payload, created_at")
              .in("id", messageIds)
              .then(({ data, error }) => { if (error) throw error; return (data ?? []) as MessageContext[]; })
          : Promise.resolve([]),
        reviewIds.length
          ? supabase
              .from("shop_reviews")
              .select("id, shop_id, customer_user_id, rating, comment")
              .in("id", reviewIds)
              .then(({ data, error }) => { if (error) throw error; return (data ?? []) as ReviewContext[]; })
          : Promise.resolve([]),
      ]);

      setOrders(Object.fromEntries(orderRows.map((row) => [row.id, row])));
      setMessages(Object.fromEntries(messageRows.map((row) => [row.id, row])));
      setReviews(Object.fromEntries(reviewRows.map((row) => [row.id, row])));

      // Every shop any ticket touches, however it got there.
      const shopIds = Array.from(
        new Set([
          ...directShopIds,
          ...orderRows.map((row) => row.shop_id),
          ...messageRows.map((row) => row.shop_id),
          ...reviewRows.map((row) => row.shop_id),
        ])
      );
      let owners: Record<string, string> = {};
      if (shopIds.length) {
        const { data: shopRows } = await supabase.from("shops").select("id, shop_name, user_id").in("id", shopIds);
        const typed = (shopRows ?? []) as Array<{ id: string; shop_name: string; user_id: string | null }>;
        setShopNames(Object.fromEntries(typed.map((row) => [row.id, row.shop_name])));
        owners = Object.fromEntries(typed.filter((row) => row.user_id).map((row) => [row.id, row.user_id as string]));
        setShopOwnerIds(owners);
      }

      // Everyone named on a ticket: who reported it, and who they reported.
      const peopleIds = Array.from(
        new Set(
          [
            ...rows.map((row) => row.reporter_user_id),
            ...orderRows.map((row) => row.customer_user_id),
            ...messageRows.map((row) => row.sender_user_id),
            ...reviewRows.map((row) => row.customer_user_id),
            ...Object.values(owners),
          ].filter((id): id is string => Boolean(id))
        )
      );
      if (peopleIds.length) {
        const [{ data: nameRows }, { data: profileRows }, { data: suspensionRows }] = await Promise.all([
          supabase.from(USER_NAMES_TABLE).select("id, full_name").in("id", peopleIds),
          supabase.from("user_profiles").select("id, reviews_banned, shop_owner").in("id", peopleIds),
          // Fails quietly until the suspensions migration is applied.
          supabase.from(SUSPENSIONS_TABLE).select("user_id, suspended_until, reason, report_id, created_at").in("user_id", peopleIds),
        ]);
        setShopOwnerAccounts(
          new Set(
            ((profileRows ?? []) as Array<{ id: string; shop_owner: boolean | null }>)
              .filter((row) => row.shop_owner)
              .map((row) => row.id)
          )
        );
        setSuspensions(Object.fromEntries(((suspensionRows ?? []) as Suspension[]).map((row) => [row.user_id, row])));
        setNames(
          Object.fromEntries(
            ((nameRows ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [
              row.id,
              row.full_name || "Someone",
            ])
          )
        );
        setBannedIds(
          new Set(
            ((profileRows ?? []) as Array<{ id: string; reviews_banned: boolean }>)
              .filter((row) => row.reviews_banned)
              .map((row) => row.id)
          )
        );
      }

    } catch (error) {
      setLoadError(`Could not load ticket evidence: ${error instanceof Error ? error.message : (error as { message?: string })?.message ?? "Check your connection and try again."}`);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busyId && document.visibilityState === "visible") void load();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load, busyId]);

  const openCount = useMemo(
    () => reports.filter((report) => OPEN_STATUSES.has(report.status)).length,
    [reports]
  );

  useEffect(() => {
    onOpenCountChange?.(openCount);
  }, [openCount, onOpenCountChange]);

  /** How many open tickets sit under each tab, for the tab's own badge. */
  const openByCategory = useMemo(() => {
    const counts: Partial<Record<ReportCategory, number>> = {};
    for (const report of reports) {
      if (!OPEN_STATUSES.has(report.status)) continue;
      const category = categoryOf(report);
      counts[category] = (counts[category] ?? 0) + 1;
    }
    return counts;
  }, [reports]);

  const visible = useMemo(
    () =>
      reports
        .filter((report) => showClosed || OPEN_STATUSES.has(report.status))
        .filter((report) => !reviewingOnly || report.status === "reviewing")
        .filter((report) => categoryFilter === "all" || categoryOf(report) === categoryFilter)
        .sort(queueOrder),
    [reports, showClosed, reviewingOnly, categoryFilter]
  );

  // ------------------------------------------------------------------ actions

  /**
   * Writes the moderation columns. Non-admins are rejected by the
   * guard_report_moderation trigger rather than by this component, so a
   * failure here is a real failure and is shown rather than swallowed.
   */
  const patchReport = async (report: Report, patch: Partial<Report>) => {
    moderationRevision.current += 1;
    try {
      const supabase = createClient();
      const { error } = await supabase.from("reports").update(patch).eq("id", report.id).select("id").single();
      if (error) {
        setRowErrors((current) => ({ ...current, [report.id]: `Could not update this ticket: ${error.message}` }));
        return false;
      }
      setRowErrors((current) => {
        const next = { ...current };
        delete next[report.id];
        return next;
      });
      setReports((current) => current.map((row) => (row.id === report.id ? { ...row, ...patch } : row)));
      return true;
    } catch {
      setRowErrors((current) => ({ ...current, [report.id]: "Could not update this ticket. Check your connection and try again." }));
      return false;
    }
  };

  const closeOut = async (report: Report, status: "resolved" | "dismissed", note: string) => {
    setBusyId(report.id);
    setMessage(null);
    const ok = await patchReport(report, {
      status,
      // The reporter is notified with this text (notify_report_resolved), so
      // an empty note would send them a message consisting of their own
      // complaint read back to them.
      resolution_note: note.trim() || (status === "resolved" ? "Actioned by FurniCraft." : "Reviewed — no action taken."),
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
    });
    if (ok) {
      setMessage(status === "resolved" ? "Ticket resolved, and the reporter was notified." : "Ticket dismissed.");
      notifySuccess(status === "resolved" ? "Ticket resolved" : "Ticket dismissed");
      setDetailId(null);
    }
    setBusyId(null);
  };

  const openDetails = (id: string, toClose: boolean) => {
    setFocusClose(toClose);
    setDetailId(id);
  };

  const startReviewing = async (report: Report) => {
    setBusyId(report.id);
    setMessage(null);
    // Deliberately not a close-out: `status` is the only column changed, so
    // notify_report_resolved does not fire and the reporter is not told
    // anything has been decided, because nothing has.
    const ok = await patchReport(report, { status: "reviewing" });
    setBusyId(null);
    if (ok) {
      notifySaved("Ticket marked as reviewing");
      // Straight into the full report, which is what starting a review is for.
      setDetailId(report.id);
    }
  };

  /** Puts a ticket back in the queue untouched; the reporter is told nothing. */
  const reopen = async (report: Report) => {
    setBusyId(report.id);
    setMessage(null);
    const ok = await patchReport(report, { status: "open" });
    setBusyId(null);
    if (ok) notifySaved("Ticket moved back to open");
  };

  const removeReview = async (report: Report) => {
    setBusyId(report.id);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.from("shop_reviews").delete().eq("id", report.target_id);
    if (error) {
      setMessage(`Could not remove the review: ${error.message}`);
      setBusyId(null);
      return;
    }
    setReviews((current) => {
      const next = { ...current };
      delete next[report.target_id];
      return next;
    });
    setBusyId(null);
    await closeOut(report, "resolved", "Review removed.");
  };

  const banReviewer = async (report: Report, customerUserId: string) => {
    setBusyId(report.id);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("user_profiles")
      .update({ reviews_banned: true })
      .eq("id", customerUserId);
    if (error) {
      setMessage(`Could not restrict this reviewer: ${error.message}`);
      setBusyId(null);
      return;
    }
    setBannedIds((current) => new Set(current).add(customerUserId));
    setBusyId(null);
    await closeOut(report, "resolved", "Reviewer restricted from posting reviews.");
  };

  const liftBan = async (customerUserId: string) => {
    setBusyId(customerUserId);
    const supabase = createClient();
    const { error } = await supabase
      .from("user_profiles")
      .update({ reviews_banned: false })
      .eq("id", customerUserId);
    if (error) {
      setMessage(`Could not lift the restriction: ${error.message}`);
    } else {
      setBannedIds((current) => {
        const next = new Set(current);
        next.delete(customerUserId);
        return next;
      });
      setMessage("Restriction lifted.");
      notifySuccess("Restriction lifted");
    }
    setBusyId(null);
  };

  /**
   * The account a ticket is about. A message: whoever sent it. A review: the
   * reviewer. A shop: its owner. An order: the other side from the reporter --
   * a customer reporting an order is reporting the shop, and the reverse.
   */
  const reportedAccount = (report: Report): string | null => {
    if (report.target_type === "shop_message") {
      const row = messages[report.target_id];
      return row ? row.sender_user_id ?? shopOwnerIds[row.shop_id] ?? null : null;
    }
    if (report.target_type === "shop_review") return reviews[report.target_id]?.customer_user_id ?? null;
    if (report.target_type === "design_order") {
      const row = orders[report.target_id];
      if (!row) return null;
      return report.reporter_user_id === row.customer_user_id ? shopOwnerIds[row.shop_id] ?? null : row.customer_user_id;
    }
    if (report.target_type === "shop") return shopOwnerIds[report.target_id] ?? null;
    return null;
  };

  // ------------------------------------------------------------------ render

  /** The thing that was reported, rendered as evidence under the complaint. */
  const renderEvidence = (report: Report) => {
    const category = categoryOf(report);

    if (report.target_type === "shop_message") {
      const row = messages[report.target_id];
      if (!row) return <Missing what="message" />;
      return (
        <Evidence heading={`Message from ${(row.sender_role === "shop" || row.sender_role === "shop_owner") ? shopNames[row.shop_id] ?? uiText("the shop") : names[row.sender_user_id ?? ""] ?? uiText("the customer")}`} when={row.created_at}>
          {row.kind === "image" ? <ChatPhotoBubble payload={row.payload} isMine={false} time={timeAgo(row.created_at, undefined, uiLanguage)} /> :
            <p className="whitespace-pre-wrap text-sm text-[var(--fc-text)]"><AdaptiveText text={row.text} automatic={false} /></p>}
        </Evidence>
      );
    }

    if (report.target_type === "shop_review") {
      const row = reviews[report.target_id];
      if (!row) return <Missing what="review" />;
      return (
        <Evidence heading={`Review of ${shopNames[row.shop_id] ?? uiText("a shop")}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--fc-text)]">
              {names[row.customer_user_id] ?? uiText("Customer")}
            </span>
            <Stars value={row.rating} />
            {bannedIds.has(row.customer_user_id) ? (
              <span className="rounded-full bg-[rgba(231,76,60,0.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#c0392b]">{uiText("Restricted")}</span>
            ) : null}
          </div>
          {row.comment ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--fc-text)]"><AdaptiveText text={row.comment} automatic={false} /></p>
          ) : (
            <p className="mt-1 text-sm italic text-[var(--fc-muted)]">{uiText("Rating only, no written comment.")}</p>
          )}
        </Evidence>
      );
    }

    if (report.target_type === "design_order") {
      const row = orders[report.target_id];
      if (!row) {
        return (
          <div className="mt-2 rounded-xl border border-dashed border-[var(--fc-border)] p-3 text-sm text-[var(--fc-muted)]">{uiText("The order behind this ticket could not be read. Either it was deleted, or migration 20260914000100 — which is what lets an admin read a reported order — has not been applied.")}</div>
        );
      }
      const meta = orderStatusMeta(row.status);
      return (
        <Evidence heading={`${row.project_name} · ${shopNames[row.shop_id] ?? uiText("a shop")}`} when={row.created_at}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.tone}`}>{uiText(meta.label)}</span>
            <span className="text-xs text-[var(--fc-muted)]">{uiText("Customer: ")}{names[row.customer_user_id] ?? uiText("Customer")}
            </span>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <Fact label={uiText("Quoted")} value={formatPeso(row.quoted_total)} />
            <Fact label={uiText("Downpayment")} value={row.downpayment_percent == null ? "—" : `${row.downpayment_percent}%`} />
            {/* Only ever the reference the customer typed in. FurniCraft never
                sees the transfer itself, so there is nothing else to show. */}
            <Fact label={uiText("Payment ref")} value={row.payment_reference || "—"} />
          </dl>

          {category === "payment" && row.payment_rejected_reason ? (
            <Note label={uiText("Shop rejected the receipt")}>{row.payment_rejected_reason}</Note>
          ) : null}

          {(category === "refund" || row.refund_status) && row.refund_status ? (
            <div className="mt-2 rounded-lg bg-[rgba(178,106,56,0.07)] px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-ink-accent)]">{uiText("Refund: ")}{uiText(row.refund_status)}
                {row.refund_amount != null ? ` · ${formatPeso(row.refund_amount)}` : ""}
              </p>
              {row.refund_reason ? (
                <p className="mt-1 text-xs text-[var(--fc-text)]">
                  <span className="text-[var(--fc-muted)]">{uiText("Customer asked: ")}</span>
                  {row.refund_reason}
                </p>
              ) : null}
              {row.refund_declined_reason ? (
                <p className="mt-1 text-xs text-[var(--fc-text)]">
                  <span className="text-[var(--fc-muted)]">{uiText("Shop declined: ")}</span>
                  {row.refund_declined_reason}
                </p>
              ) : null}
            </div>
          ) : null}
        </Evidence>
      );
    }

    // target_type 'shop': the shop itself is the subject, and its name is
    // already in the ticket header, so there is nothing further to quote.
    const shopName = shopNames[report.target_id];
    return (
      <Evidence heading={shopName ? `Shop: ${shopName}` : "Shop"}>
        <p className="text-sm text-[var(--fc-muted)]">{uiText("Reported as a whole rather than about one order.")}</p>
      </Evidence>
    );
  };

  /** Who the ticket is about, their role, and the suspension controls. */
  const renderReportedAccount = (report: Report) => {
    const accountId = reportedAccount(report);
    if (!accountId || accountId === report.reporter_user_id) return null;
    const isShop = shopOwnerAccounts.has(accountId);
    const accountName = names[accountId] ?? uiText("This account");
    return (
      <div className="mt-3 rounded-xl border border-[var(--fc-border)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Reported account")}</span>
          <span className="text-sm font-semibold text-[var(--fc-text)]">{accountName}</span>
          <RoleTag isShop={isShop} />
        </div>
        <div className="mt-2">
          <AccountSuspensionControl
            userId={accountId}
            name={accountName}
            suspension={suspensions[accountId] ?? null}
            reportId={report.id}
            onChange={(next) =>
              setSuspensions((current) => {
                const copy = { ...current };
                if (next) copy[accountId] = next;
                else delete copy[accountId];
                return copy;
              })
            }
          />
        </div>
      </div>
    );
  };

  /** The note to the reporter and the Dismiss / Resolve buttons. */
  const renderCloseForm = (report: Report) => {
    const isBusy = busyId === report.id;
    return (
      <div className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What you did about it")}</span>
          {/* Sent to the reporter verbatim by the notify_report_resolved
              trigger, so it is written for them rather than as an internal
              note. */}
          <textarea
            autoFocus={focusClose}
            value={noteDrafts[report.id] ?? ""}
            onChange={(event) => setNoteDrafts((current) => ({ ...current, [report.id]: event.target.value }))}
            rows={2}
            placeholder={uiText("The reporter is sent this — say what happened.")}
            className="mt-1.5 w-full rounded-lg border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none focus:border-[var(--fc-ink-accent)]"
          />
        </label>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void closeOut(report, "dismissed", noteDrafts[report.id] ?? "")}
            disabled={isBusy}
            className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.98] disabled:opacity-60"
          >{uiText("Dismiss — nothing to do")}</button>
          <button
            type="button"
            onClick={() => void closeOut(report, "resolved", noteDrafts[report.id] ?? "")}
            disabled={isBusy}
            className="rounded-full bg-[var(--fc-ink-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {isBusy ? uiText("Working…") : uiText("Resolve")}
          </button>
        </div>
      </div>
    );
  };

  /** A full date and time, for the details window -- "3 hours ago" is not evidence. */
  const exactTime = (iso: string) =>
    new Date(iso).toLocaleString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const detailReport = detailId ? reports.find((report) => report.id === detailId) ?? null : null;
  const detailReview = detailReport?.target_type === "shop_review" ? reviews[detailReport.target_id] ?? null : null;

  return (
    <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{uiText("Tickets")}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={Boolean(busyId)} className="rounded-full border border-[var(--fc-border)] px-3 py-1 text-xs font-semibold disabled:opacity-50">{uiText("Refresh")}</button>
          {openCount > 0 ? (
            <span className="rounded-full bg-[rgba(231,76,60,0.12)] px-2.5 py-0.5 text-xs font-bold text-[#c0392b]">
              {openCount}{uiText(" open")}</span>
          ) : null}
          <button
            type="button"
            onClick={() => setShowClosed((current) => !current)}
            aria-pressed={showClosed}
            className="rounded-full border border-[var(--fc-border)] px-3 py-1 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.98]"
          >
            {showClosed ? uiText("Hide closed") : uiText("Show closed")}
          </button>
          <button
            type="button"
            onClick={() => setReviewingOnly((current) => !current)}
            aria-pressed={reviewingOnly}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors active:scale-[0.98] ${
              reviewingOnly
                ? "border-[#8a6118] bg-[rgba(192,138,62,0.18)] text-[#8a6118]"
                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
            }`}
          >
            {uiText("Reviewing only")}
          </button>
        </div>
      </div>

      {/* Tabs, not a dropdown: the counts beside each one are half the value of
          having tabs at all -- "Payments 4" is the thing an admin opens this
          screen to find out. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["all", ...TICKET_FILTERS] as Array<ReportCategory | "all">).map((id) => {
          const isActive = categoryFilter === id;
          const count = id === "all" ? openCount : (openByCategory[id] ?? 0) + (id === "refund" ? refundsPending : 0);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCategoryFilter(id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
                isActive
                  ? "border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                  : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
              }`}
            >
              {id === "all" ? uiText("All") : REPORT_TOPICS[id].label}
              {count > 0 ? <span className="ml-1.5 tabular-nums opacity-70">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {refundRequests ? <div className={categoryFilter === "refund" ? "mt-4" : "hidden"}>{refundRequests}</div> : null}

      {loadError ? (
        <p role="alert" className="mt-4 rounded-xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-3 py-2 text-sm text-[var(--fc-text)]">
          {uiText(loadError)}
        </p>
      ) : null}

      {message ? (
        <p className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-muted)]">
          {uiText(message)}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading tickets…")}</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-[var(--fc-muted)]">
            {showClosed ? uiText("No tickets here.") : uiText("No open tickets here.")}
          </p>
        ) : (
          visible.map((report) => {
            const category = categoryOf(report);
            const topic = REPORT_TOPICS[category];
            const isOpen = OPEN_STATUSES.has(report.status);
            const accountId = reportedAccount(report);

            return (
              <article key={report.id} className="rounded-2xl border border-[var(--fc-border)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[rgba(178,106,56,0.12)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fc-ink-accent)]">
                      {uiText(topic.label)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[report.status] ?? NEUTRAL_TONE}`}>
                      {uiText(STATUS_LABEL[report.status] ?? report.status)}
                    </span>
                    {/* Short enough to read, long enough to quote back to
                        someone asking about "that ticket". */}
                    <span className="font-mono text-[11px] text-[var(--fc-muted)]">
                      #{report.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--fc-muted)]">{timeAgo(report.created_at, undefined, uiLanguage)}</span>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <dt className="text-[var(--fc-muted)]">{uiText("Reported by")}</dt>
                    <dd className="font-semibold text-[var(--fc-text)]">{names[report.reporter_user_id] ?? uiText("Someone")}</dd>
                    <RoleTag isShop={shopOwnerAccounts.has(report.reporter_user_id)} />
                  </div>
                  {accountId && accountId !== report.reporter_user_id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <dt className="text-[var(--fc-muted)]">{uiText("Reported account")}</dt>
                      <dd className="font-semibold text-[var(--fc-text)]">{names[accountId] ?? uiText("This account")}</dd>
                      <RoleTag isShop={shopOwnerAccounts.has(accountId)} />
                    </div>
                  ) : null}
                </dl>

                <p className="mt-2 line-clamp-2 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)]">
                  <span className="font-semibold">{uiText("Reason: ")}</span>
                  {report.reason}
                </p>

                {rowErrors[report.id] ? (
                  <p role="alert" className="mt-2 text-xs text-[var(--fc-danger)]">{uiText(rowErrors[report.id])}</p>
                ) : null}

                {/* The card is only a preview: everything that changes a
                    ticket happens in the details window. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openDetails(report.id, false)}
                    className="rounded-full bg-[var(--fc-btn)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-btn-fg)] transition-colors hover:opacity-90 active:scale-[0.98]"
                  >{uiText("View report details")}</button>
                  {isOpen ? (
                    <button
                      type="button"
                      onClick={() => openDetails(report.id, true)}
                      className="rounded-full border border-[var(--fc-border)] bg-[rgba(53,111,82,0.1)] px-3 py-1.5 text-xs font-semibold text-[#356f52] transition-colors hover:bg-[rgba(53,111,82,0.18)] active:scale-[0.98]"
                    >{uiText("Close ticket…")}</button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* The whole report and every action on it: opened by View report
          details, or by Close ticket straight at the note. */}
      {detailReport ? (
        <Modal
          open
          onClose={() => { setDetailId(null); setFocusClose(false); }}
          ariaLabel={uiText("Report details")}
          eyebrow={`${uiText("Ticket")} #${detailReport.id.slice(0, 8)}`}
          title={uiText("Report details")}
          className="sm:max-w-2xl"
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--fc-muted)]">{uiText("Type")}</dt>
              <dd className="font-semibold text-[var(--fc-text)]">{uiText(REPORT_TOPICS[categoryOf(detailReport)].label)}</dd>
            </div>
            <div>
              <dt className="text-[var(--fc-muted)]">{uiText("Status")}</dt>
              <dd className="font-semibold text-[var(--fc-text)]">{uiText(STATUS_LABEL[detailReport.status] ?? detailReport.status)}</dd>
            </div>
            <Fact label="Reported on" value={exactTime(detailReport.created_at)} />
            <div>
              <dt className="text-[var(--fc-muted)]">{uiText("Reported by")}</dt>
              <dd className="flex flex-wrap items-center gap-2 font-semibold text-[var(--fc-text)]">
                {names[detailReport.reporter_user_id] ?? uiText("Someone")}
                <RoleTag isShop={shopOwnerAccounts.has(detailReport.reporter_user_id)} />
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Reason")}</p>
            <p className="mt-1 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)]">{detailReport.reason}</p>
          </div>

          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What they wrote")}</p>
            {detailReport.details ? (
              <p className="mt-1 whitespace-pre-wrap rounded-xl border border-[var(--fc-border)] px-3 py-2 text-sm text-[var(--fc-text)]">{detailReport.details}</p>
            ) : (
              <p className="mt-1 text-sm italic text-[var(--fc-muted)]">{uiText("Nothing else was written.")}</p>
            )}
          </div>

          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Attached photo")}</p>
            {detailReport.photo_path ? (
              <ReportPhoto path={detailReport.photo_path} large />
            ) : (
              <p className="mt-1 text-sm italic text-[var(--fc-muted)]">{uiText("No photo attached.")}</p>
            )}
          </div>

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What was reported")}</p>
            {renderEvidence(detailReport)}
          </div>

          {renderReportedAccount(detailReport)}

          {detailReport.status === "resolved" || detailReport.status === "dismissed" ? (
            <Note tone="calm" label={uiText("Closed {0}", { 0: detailReport.resolved_at ? exactTime(detailReport.resolved_at) : "" })}>
              {detailReport.resolution_note ?? uiText("No note.")}
            </Note>
          ) : (
            <>
              {rowErrors[detailReport.id] ? (
                <p role="alert" className="mt-3 text-xs text-[var(--fc-danger)]">{uiText(rowErrors[detailReport.id])}</p>
              ) : null}

              <div className="mt-4 rounded-xl border border-[var(--fc-border)] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Actions")}</p>
                <p className="mt-1 text-xs text-[var(--fc-muted)]">
                  {detailReport.status === "reviewing"
                    ? uiText("In review. The reporter is not told anything until you close this ticket.")
                    : uiText("Mark it as reviewing so other admins know you are on it. The reporter is not told until you close it.")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {detailReport.status === "open" ? (
                    <button
                      type="button"
                      onClick={() => void startReviewing(detailReport)}
                      disabled={busyId === detailReport.id}
                      className="rounded-full bg-[var(--fc-btn)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-btn-fg)] transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                    >{busyId === detailReport.id ? uiText("Starting…") : uiText("Start reviewing")}</button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void reopen(detailReport)}
                      disabled={busyId === detailReport.id}
                      className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.98] disabled:opacity-60"
                    >{busyId === detailReport.id ? uiText("Working…") : uiText("Stop reviewing")}</button>
                  )}
                  {detailReview ? (
                    <button
                      type="button"
                      onClick={() => void removeReview(detailReport)}
                      disabled={busyId === detailReport.id}
                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 active:scale-[0.98] disabled:opacity-60"
                    >{uiText("Remove review")}</button>
                  ) : null}
                  {detailReview && !bannedIds.has(detailReview.customer_user_id) ? (
                    <button
                      type="button"
                      onClick={() => void banReviewer(detailReport, detailReview.customer_user_id)}
                      disabled={busyId === detailReport.id}
                      className="rounded-full border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-ink-accent)] transition-colors hover:bg-[rgba(178,106,56,0.16)] active:scale-[0.98] disabled:opacity-60"
                    >{uiText("Restrict reviewer")}</button>
                  ) : null}
                  {detailReview && bannedIds.has(detailReview.customer_user_id) ? (
                    <button
                      type="button"
                      onClick={() => void liftBan(detailReview.customer_user_id)}
                      disabled={busyId === detailReview.customer_user_id}
                      className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.98] disabled:opacity-60"
                    >{uiText("Lift restriction")}</button>
                  ) : null}
                </div>
              </div>

              {renderCloseForm(detailReport)}
            </>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

/** Customer or Shop owner, as the small tag beside a name. */
function RoleTag({ isShop }: { isShop: boolean }) {
  const { t: uiText } = useUiLanguage();
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
        isShop
          ? "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
          : "bg-[color-mix(in_srgb,var(--fc-muted)_14%,transparent)] text-[var(--fc-muted)]"
      }`}
    >
      {isShop ? uiText("Shop owner") : uiText("Customer")}
    </span>
  );
}

function Evidence({
  heading,
  when,
  children,
}: {
  heading: string;
  when?: string;
  children: React.ReactNode;
}) {
  const { language: uiLanguage, t: uiText } = useUiLanguage();
  return (
    <div className="mt-2 rounded-xl border border-dashed border-[var(--fc-border)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText(heading)}</p>
        {when ? <span className="text-[11px] text-[var(--fc-muted)]">{timeAgo(when, undefined, uiLanguage)}</span> : null}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Missing({ what }: { what: string }) {
  const { t: uiText } = useUiLanguage();
  return (
    <div className="mt-2 rounded-xl border border-dashed border-[var(--fc-border)] p-3 text-sm text-[var(--fc-muted)]">{uiText("This ")}{uiText(what)}{uiText(" is unavailable. It may have been deleted or you may not have access to it.")}</div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { t: uiText } = useUiLanguage();
  return (
    <div>
      <dt className="text-[var(--fc-muted)]">{uiText(label)}</dt>
      <dd className="font-semibold text-[var(--fc-text)]">{value}</dd>
    </div>
  );
}

function Note({
  label,
  tone = "danger",
  children,
}: {
  label: string;
  /** "danger" for something still wrong; "calm" for a ticket already closed. */
  tone?: "danger" | "calm";
  children: React.ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const isDanger = tone === "danger";
  return (
    <div
      className={`mt-2 rounded-lg px-3 py-2 ${
        isDanger ? "bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)]" : "bg-[rgba(53,111,82,0.1)]"
      }`}
    >
      <p
        className={`text-[11px] font-bold uppercase tracking-[0.12em] ${
          isDanger ? "text-[var(--fc-danger)]" : "text-[#356f52]"
        }`}
      >
        {uiText(label)}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--fc-text)]">{children}</p>
    </div>
  );
}

/** The photo the reporter attached, opened full size in a new tab. */
function ReportPhoto({ path, large = false }: { path: string; large?: boolean }) {
  const { t: uiText } = useUiLanguage();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void reportPhotoUrl(path).then((signed) => {
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("The attached photo could not be loaded.")}</p>;
  }
  if (!url) {
    return <div className="mt-2 h-24 w-24 animate-pulse rounded-xl bg-[var(--fc-bg)]" />;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block" title={uiText("Open the attached photo")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={uiText("Photo attached to this report")} className={`${large ? "max-h-[60vh]" : "max-h-48"} max-w-full rounded-xl border border-[var(--fc-border)] object-contain`} />
    </a>
  );
}
