"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import BackButton from "@/components/ui/back-button";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { ThemeSwitcher } from "@/components/dashboard/theme-switcher";
import { useLanguage } from "@/components/language/language-context";
import AdminSupportInbox from "@/components/admin/admin-support-inbox";
import AdminTickets from "@/components/admin/admin-tickets";
import AdminRefundRequests from "@/components/admin/admin-refund-requests";
import AdminOrders from "@/components/admin/admin-orders";
import AdminAccountClosures from "@/components/admin/admin-account-closures";
import AdminShopActivity from "@/components/admin/admin-shop-activity";
import AdminSubscriptions from "@/components/admin/admin-subscriptions";
import AdminDashboard from "@/components/admin/admin-dashboard";
import { AccountSuspensionControl } from "@/components/admin/account-suspension-control";
import { SUSPENSIONS_TABLE, type Suspension } from "@/lib/account-suspension";
import {
  IconClock,
  IconClose,
  IconDocument,
  IconMenu,
  IconMessages,
  IconOrders,
  IconOverview,
  IconProfile,
  IconSettings,
  IconStar,
  IconWarning,
  type SolihiyaIcon,
} from "@/components/solihiya/icons";

type ShopOwnerRequest = {
  id: string;
  user_id: string;
  email: string;
  shop_name: string;
  description: string | null;
  address: string | null;
  bir_registered_name: string | null;
  bir_document_url: string | null;
  valid_id_url: string | null;
  status: string;
  rejection_reason?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type UserProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  role: string;
  shop_owner: boolean;
};

/**
 * Everything used to sit in one long scroll: applications, users, support,
 * reported reviews and shop owners stacked in a 1.3fr/0.7fr grid. It worked
 * at first, but the sidebar column kept growing every time a new admin tool
 * was added and had become five cards deep. Splitting it into sections behind
 * a proper nav -- the same shell shop-dashboard-page.tsx already uses --
 * keeps each tool one click away instead of one scroll away, and gives the
 * sidebar a place for Settings (dark mode) that isn't just another card.
 */
type AdminSection =
  | "dashboard"
  | "applications"
  | "users"
  | "orders"
  | "support"
  | "tickets"
  | "deactivated_shops"
  | "closures"
  | "subscriptions"
  | "settings";

const ADMIN_NAV: Array<{ id: AdminSection; label: string; icon: SolihiyaIcon }> = [
  { id: "dashboard", label: "Dashboard", icon: IconOverview },
  { id: "applications", label: "Applications", icon: IconDocument },
  { id: "users", label: "Users", icon: IconProfile },
  { id: "orders", label: "Orders", icon: IconOrders },
  { id: "support", label: "Support", icon: IconMessages },
  { id: "tickets", label: "Tickets", icon: IconWarning },
  { id: "deactivated_shops", label: "Deactivated shops", icon: IconClock },
  { id: "closures", label: "Deletion requests", icon: IconWarning },
  { id: "subscriptions", label: "Subscriptions", icon: IconStar },
  { id: "settings", label: "Settings", icon: IconSettings },
];

const SECTION_META: Record<AdminSection, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "What needs your attention, and what was done last." },
  applications: { title: "Shop-owner approvals", subtitle: "Review seller applications, verify BIR documents, and approve shop-owner accounts." },
  users: { title: "Users", subtitle: "Every account on the platform: customers, and shop owners with an approved storefront." },
  orders: {
    title: "Orders and refunds",
    subtitle: "Every order on the platform, and the refunds still waiting on a shop.",
  },
  support: { title: "Support", subtitle: "Reply to customers and shop owners who have written in." },
  tickets: { title: "Tickets", subtitle: "Everything customers and shop owners have reported — chats, payments, refunds, orders, reviews and shops — in one queue." },
  deactivated_shops: {
    title: "Deactivated shops",
    subtitle: "Shops switched off after 90 days without activity, and how active every approved shop has been.",
  },
  closures: {
    title: "Deletion requests",
    subtitle: "Accounts asking to be closed, and the shops listed for customers.",
  },
  subscriptions: { title: "Pro subscriptions", subtitle: "Verify what shops paid, grant Pro, and set the price and payment QR." },
  settings: { title: "Settings", subtitle: "Preferences for your own admin session." },
};

export default function AdminApprovalPanel() {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Badge counts for tools whose own queue lives inside a child component --
  // lifted here rather than re-fetched, so the sidebar agrees with whatever
  // that component is actually showing.
  const [supportNeedsReplyCount, setSupportNeedsReplyCount] = useState(0);
  const [ticketsOpenCount, setTicketsOpenCount] = useState(0);
  const [refundsPendingCount, setRefundsPendingCount] = useState(0);
  const [subscriptionsPendingCount, setSubscriptionsPendingCount] = useState(0);

  const [requests, setRequests] = useState<ShopOwnerRequest[]>([]);
  const [approvedRequests, setApprovedRequests] = useState<ShopOwnerRequest[]>([]);
  const [rejectedRequests, setRejectedRequests] = useState<ShopOwnerRequest[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  // A rejection is never sent without a reason: Reject opens this note first.
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [search, setSearch] = useState("");
  const [userTab, setUserTab] = useState<"customers" | "shop_owners">("customers");
  const [userSearch, setUserSearch] = useState("");
  // Sign-in email by user id, and whether the function that reads them is
  // missing (migration not applied yet).
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailsMissing, setEmailsMissing] = useState(false);
  // Account suspensions by user id; empty until the migration is applied.
  const [suspensions, setSuspensions] = useState<Record<string, Suspension>>({});

  useEffect(() => {
    const loadData = async () => {
      const supabase = createClient();
      const [{ data: allRequestsData }, { data: profilesData }] = await Promise.all([
        supabase
          .from("shops")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.from("user_profiles").select("id, full_name, phone, address, role, shop_owner").order("created_at", { ascending: false }),
      ]);

      const allRequests = (allRequestsData ?? []) as ShopOwnerRequest[];
      setRequests(allRequests.filter((request) => request.status === "pending"));
      setApprovedRequests(allRequests.filter((request) => request.status === "approved"));
      setRejectedRequests(allRequests.filter((request) => request.status === "rejected"));
      setProfiles((profilesData ?? []) as UserProfile[]);
      // Every account's sign-in email (20261030090000_admin_user_emails.sql).
      // Until that is applied the call fails; the shop applications' emails
      // still cover shop owners, and the page says what is missing.
      const { data: emailRows, error: emailError } = await supabase.rpc("admin_user_emails");
      const fromShops = Object.fromEntries(allRequests.map((request) => [request.user_id, request.email]));
      setEmails({
        ...fromShops,
        ...Object.fromEntries(((emailRows ?? []) as Array<{ id: string; email: string | null }>).filter((row) => row.email).map((row) => [row.id, row.email as string])),
      });
      setEmailsMissing(Boolean(emailError));
      const { data: suspensionRows } = await supabase
        .from(SUSPENSIONS_TABLE)
        .select("user_id, suspended_until, reason, report_id, created_at");
      setSuspensions(Object.fromEntries(((suspensionRows ?? []) as Suspension[]).map((row) => [row.user_id, row])));
      setLoading(false);
    };

    loadData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isSidebarOpen) setIsSidebarOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isSidebarOpen]);

  const getSignedUrl = useCallback(async (path: string): Promise<string | null> => {
    if (signedUrls[path]) return signedUrls[path];

    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("seller-documents")
      .createSignedUrl(path, 3600);

    if (error || !data?.signedUrl) return null;

    setSignedUrls((current) => ({ ...current, [path]: data.signedUrl }));
    return data.signedUrl;
  }, [signedUrls]);

  const handleViewDocument = useCallback(async (path: string) => {
    const url = await getSignedUrl(path);
    if (url) {
      window.open(url, "_blank");
    } else {
      setMessage("Failed to generate document link. The file may not exist.");
    }
  }, [getSignedUrl]);

  const handleApprove = async (request: ShopOwnerRequest) => {
    setBusyId(request.id);
    setMessage(null);
    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("shops")
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", request.id);

    if (!updateError) {
      const { error: profileError } = await supabase.from("user_profiles").upsert(
        {
          id: request.user_id,
          role: "shop_owner",
          shop_owner: true,
          // full_name is left alone: approval used to write the email over
          // the owner's real name here.
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (!profileError) {
        setRequests((current) => current.filter((item) => item.id !== request.id));
        setApprovedRequests((current) => [
          { ...request, status: "approved", updated_at: new Date().toISOString() },
          ...current,
        ]);
        setProfiles((current) => {
          const existing = current.find((item) => item.id === request.user_id);
          const next = current.filter((item) => item.id !== request.user_id);
          return [
            ...next,
            {
              id: request.user_id,
              full_name: existing?.full_name ?? null,
              phone: existing?.phone ?? null,
              address: existing?.address ?? null,
              role: "shop_owner",
              shop_owner: true,
            },
          ];
        });
        setEmails((current) => (current[request.user_id] ? current : { ...current, [request.user_id]: request.email }));
        setMessage(`✅ Approved ${request.shop_name}.`);
        notifySuccess("Shop approved");
        setExpandedRequestId(null);
      } else {
        setMessage("Approval failed while updating the profile.");
      }
    } else {
      setMessage("Approval failed. Please try again.");
    }

    setBusyId(null);
  };

  const handleReject = async (request: ShopOwnerRequest, reason: string) => {
    const note = reason.trim();
    if (!note) return;
    setBusyId(request.id);
    setMessage(null);
    const supabase = createClient();

    const { error } = await supabase
      .from("shops")
      .update({ status: "rejected", rejection_reason: note, updated_at: new Date().toISOString() })
      .eq("id", request.id);

    if (!error) {
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setRejectedRequests((current) => [{ ...request, status: "rejected", rejection_reason: note }, ...current]);
      setMessage(`❌ Rejected ${request.shop_name}.`);
      notifySuccess("Application rejected");
      setRejecting(null);
      setExpandedRequestId(null);
    } else {
      setMessage("Rejection failed. Please try again.");
    }

    setBusyId(null);
  };

  const handleVerifyOnBnrs = useCallback(async (businessName: string) => {
    try {
      await navigator.clipboard.writeText(businessName);
      setMessage(`📋 Copied "${businessName}" to clipboard — paste it into the DTI BNRS search field.`);
    } catch {
      setMessage(`Copy this name manually: ${businessName}`);
    }
    window.open("https://bnrs.dti.gov.ph/search", "_blank");
  }, []);

  const QUEUES = {
    pending: requests,
    approved: approvedRequests,
    rejected: rejectedRequests,
  } as const;

  const needle = search.trim().toLowerCase();
  const visibleRequests = QUEUES[queueFilter].filter((request) =>
    needle
      ? [request.shop_name, request.email, request.bir_registered_name, request.address]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle))
      : true
  );

  // Users, split the way the platform splits them: an approved application is
  // what makes someone a shop owner.
  const customerProfiles = profiles.filter((profile) => !profile.shop_owner);
  const shopOwnerProfiles = profiles.filter((profile) => profile.shop_owner);
  const tabUsers = userTab === "customers" ? customerProfiles : shopOwnerProfiles;

  // Name search narrows letter by letter: "j" lists every name with a word
  // starting with J, "ju" narrows it, and so on to the full name. Matching
  // the start of any word lets a surname find someone too; names that start
  // with what was typed come first.
  const userNeedle = userSearch.trim().toLowerCase().replace(/\s+/g, " ");
  const nameMatch = (name: string | null): 0 | 1 | null => {
    if (!userNeedle) return 0;
    const value = (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (value.startsWith(userNeedle)) return 0;
    return value.split(" ").some((_, index, words) => words.slice(index).join(" ").startsWith(userNeedle)) ? 1 : null;
  };
  // The person's name, never their email: a name that is just the account's
  // email (what approval used to write) counts as no name.
  const displayName = (profile: UserProfile) => {
    const name = profile.full_name?.trim();
    if (!name) return null;
    const email = emails[profile.id];
    if (email ? name.toLowerCase() === email.toLowerCase() : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)) return null;
    return name;
  };
  const visibleUsers = tabUsers
    .map((profile) => ({ profile, rank: nameMatch(displayName(profile)) }))
    .filter((entry): entry is { profile: UserProfile; rank: 0 | 1 } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || (displayName(a.profile) ?? "￿").localeCompare(displayName(b.profile) ?? "￿"))
    .map((entry) => entry.profile);

  /** The name with the typed letters picked out where they matched. */
  const highlightName = (name: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!userNeedle) return clean;
    const lower = clean.toLowerCase();
    const at = lower.startsWith(userNeedle) ? 0 : lower.indexOf(" " + userNeedle);
    if (at < 0) return clean;
    const start = at === 0 && lower.startsWith(userNeedle) ? 0 : at + 1;
    return (
      <>
        {clean.slice(0, start)}
        <mark className="rounded bg-[rgba(178,106,56,0.22)] px-0.5 text-inherit">{clean.slice(start, start + userNeedle.length)}</mark>
        {clean.slice(start + userNeedle.length)}
      </>
    );
  };

  const renderRequestCard = (request: ShopOwnerRequest, showActions: boolean) => {
    const isExpanded = expandedRequestId === request.id;
    const hasDocuments = Boolean(request.bir_registered_name || request.bir_document_url || request.valid_id_url);
    const submittedDate = new Date(request.created_at).toLocaleDateString(uiLocale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return (
      <div key={request.id} className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] overflow-hidden">
        {/* Header */}
        <div
          className="flex cursor-pointer items-start justify-between gap-3 p-4 transition hover:bg-[rgba(178,106,56,0.06)]"
          onClick={() => setExpandedRequestId(isExpanded ? null : request.id)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-[var(--fc-text)]">{request.shop_name}</p>
              {hasDocuments ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#3a5688]">{uiText("Docs attached")}</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">{uiText("No docs")}</span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-[var(--fc-muted)]">{request.email}</p>
            <p className="text-xs text-[var(--fc-muted)]">{submittedDate}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${
              request.status === "pending" ? "bg-[#efe1d0] text-[var(--fc-ink-accent)]"
              : request.status === "approved" ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-700"
            }`}>
              {uiText(request.status)}
            </span>
            <span className={`text-sm text-[var(--fc-muted)] transition ${isExpanded ? "rotate-180" : ""}`}>▼</span>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="border-t border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4 space-y-4">
            {/* Basic Info */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Business Address")}</div>
                <p className="mt-1 text-sm text-[var(--fc-text)]">{request.address || uiText("Not provided")}</p>
              </div>
              <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Description")}</div>
                <p className="mt-1 text-sm text-[var(--fc-text)]">{request.description || uiText("Not provided")}</p>
              </div>
            </div>

            {/* BIR & Documents Section */}
            {hasDocuments && (
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Verification Documents")}</div>

                {/* BIR Registered Name */}
                {request.bir_registered_name && (
                  <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("BIR Registered Name")}</div>
                        <p className="mt-1 text-sm font-semibold text-[var(--fc-text)]">{request.bir_registered_name}</p>
                      </div>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                        onClick={(e) => { e.stopPropagation(); handleVerifyOnBnrs(request.bir_registered_name!); }}
                      >{uiText("🔍 Verify on DTI BNRS")}</button>
                    </div>
                    <p className="mt-2 text-[11px] text-[var(--fc-muted)]">{uiText("Cross-check this name against the DTI Business Name Registration System to confirm legitimacy.")}</p>
                  </div>
                )}

                {/* Document Cards */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* BIR Document */}
                  <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("BIR Certificate (Form 2303)")}</div>
                    {request.bir_document_url ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-lg">📄</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDocument(request.bir_document_url!);
                          }}
                          className="btn btn-primary btn-sm"
                        >{uiText("View Document")}</button>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Not uploaded")}</p>
                    )}
                  </div>

                  {/* Valid ID */}
                  <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Valid Government ID")}</div>
                    {request.valid_id_url ? (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-lg">🪪</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewDocument(request.valid_id_url!);
                          }}
                          className="btn btn-primary btn-sm"
                        >{uiText("View ID")}</button>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Not uploaded")}</p>
                    )}
                  </div>
                </div>

                {/* Shop name vs BIR name match check */}
                {request.bir_registered_name && (
                  <div className={`rounded-xl border px-3 py-2 text-xs ${
                    request.shop_name.toLowerCase().trim() === request.bir_registered_name.toLowerCase().trim()
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                    {request.shop_name.toLowerCase().trim() === request.bir_registered_name.toLowerCase().trim() ? (
                      <span>✅ <strong>{uiText("Name match:")}</strong>{uiText(" Shop name matches BIR registered name.")}</span>
                    ) : (
                      <span>⚠️ <strong>{uiText("Name mismatch:")}</strong>{uiText(" Shop name “")}{request.shop_name}{uiText("” differs from BIR name “")}{request.bir_registered_name}{uiText("”. Please verify carefully.")}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {request.status === "rejected" && request.rejection_reason ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-700">{uiText("Reason for rejection")}</div>
                <p className="mt-1 whitespace-pre-line text-sm text-[var(--fc-text)]">{request.rejection_reason}</p>
              </div>
            ) : null}

            {/* Action Buttons */}
            {showActions && rejecting?.id === request.id ? (
              <div className="space-y-2 rounded-xl border border-red-200 bg-[var(--fc-panel)] p-3" onClick={(e) => e.stopPropagation()}>
                <label htmlFor={`reject-reason-${request.id}`} className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-700">
                  {uiText("Reason for rejection (required)")}
                </label>
                <textarea
                  id={`reject-reason-${request.id}`}
                  rows={3}
                  autoFocus
                  maxLength={500}
                  className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-2.5 text-sm text-[var(--fc-text)] outline-none focus:border-red-400"
                  placeholder={uiText("e.g. The BIR certificate is unreadable. Please upload a clearer copy and apply again.")}
                  value={rejecting.reason}
                  onChange={(event) => setRejecting({ id: request.id, reason: event.target.value })}
                />
                <p className="text-[11px] text-[var(--fc-muted)]">{uiText("The applicant sees this note, so say what to fix before they apply again.")}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                    disabled={!rejecting.reason.trim() || busyId === request.id}
                    onClick={() => void handleReject(request, rejecting.reason)}
                  >
                    {busyId === request.id ? uiText("Working...") : uiText("Confirm rejection")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-[var(--fc-border)] px-4 py-2 text-sm font-semibold text-[var(--fc-muted)] transition hover:text-[var(--fc-text)]"
                    disabled={busyId === request.id}
                    onClick={() => setRejecting(null)}
                  >{uiText("Cancel")}</button>
                </div>
              </div>
            ) : showActions && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  onClick={(e) => { e.stopPropagation(); handleApprove(request); }}
                  disabled={busyId === request.id}
                >
                  {busyId === request.id ? uiText("Working...") : uiText("✓ Approve")}
                </button>
                <button
                  className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  onClick={(e) => { e.stopPropagation(); setRejecting({ id: request.id, reason: "" }); }}
                  disabled={busyId === request.id}
                >{uiText("✕ Reject")}</button>
                {request.bir_registered_name && (
                  <button
                    type="button"
                    className="ml-auto rounded-full border border-[var(--fc-border)] bg-[rgba(58,86,136,0.1)] px-3 py-2 text-xs font-semibold text-[#3a5688] transition hover:bg-blue-100"
                    onClick={(e) => { e.stopPropagation(); handleVerifyOnBnrs(request.bir_registered_name!); }}
                  >{uiText("🔍 Check DTI BNRS")}</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const section = (id: AdminSection, content: React.ReactNode) => (
    <div className={activeSection === id ? "" : "hidden"}>{content}</div>
  );

  return (
    <div className="flex min-h-screen bg-[var(--fc-bg)] text-[var(--fc-text)]">
      {/* Drawer scrim -- mobile only; above `lg` the sidebar is always in flow. */}
      {isSidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-[#2b1b14]/60 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="dashboard-logo">{uiText("FurniCraft")}</h1>
            <p className="truncate text-xs text-[var(--fc-muted)]">{t("Admin panel")}</p>
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            aria-label={uiText("Close navigation")}
            className="text-[var(--fc-muted)] transition hover:text-[var(--fc-text)] lg:hidden"
          >
            <IconClose aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <nav className="space-y-1">
          {ADMIN_NAV.map((item) => {
            const isActive = activeSection === item.id;
            const badge =
              item.id === "applications" ? requests.length
              : item.id === "support" ? supportNeedsReplyCount
              : item.id === "tickets" ? ticketsOpenCount + refundsPendingCount
              : item.id === "subscriptions" ? subscriptionsPendingCount
              : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setIsSidebarOpen(false);
                }}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                    : "text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.07)]"
                }`}
              >
                <item.icon aria-hidden className="h-4 w-4" />
                <span className="flex-1 text-left">{t(item.label)}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-fc-danger px-1.5 py-0.5 text-[10px] font-bold text-fc-danger-fg">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1 border-t border-[var(--fc-border)] pt-4">
          {/* Was an <a href>, which left the app and reloaded it to reach a
              dashboard the admin may never have been on. Now it returns to
              whatever they were looking at before the console, and only falls
              back to the dashboard when there is nothing behind this tab. */}
          <BackButton
            fallback="/protected"
            label={uiText("Back")}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--fc-text)] transition-colors hover:bg-[rgba(178,106,56,0.07)]"
          />
          {/* Admins now sign in with a normal account, so this is the ordinary
              sign-out rather than clearing a bespoke admin cookie. */}
          <div className="px-3 pt-2">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-3 shadow-sm sm:px-6">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            aria-label={uiText("Open navigation")}
            className="text-[var(--fc-muted)] transition hover:text-[var(--fc-text)] lg:hidden"
          >
            <IconMenu aria-hidden className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{t("Admin panel")}</p>
            <h2 className="truncate text-lg font-semibold text-[var(--fc-text)]">{t(SECTION_META[activeSection].title)}</h2>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">
          <p className="mb-4 text-sm text-[var(--fc-muted)]">{t(SECTION_META[activeSection].subtitle)}</p>

          {message ? (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-3 text-sm text-[var(--fc-muted)] shadow-sm">
              <span className="min-w-0">{uiText(message)}</span>
              <button
                type="button"
                onClick={() => setMessage(null)}
                aria-label={uiText("Dismiss")}
                className="shrink-0 rounded-full px-1.5 text-[var(--fc-muted)] transition hover:text-[var(--fc-text)]"
              >
                ✕
              </button>
            </div>
          ) : null}

          {section(
            "dashboard",
            <AdminDashboard
              pendingApplications={requests}
              approvedApplications={approvedRequests}
              supportNeedsReply={supportNeedsReplyCount}
              ticketsOpen={ticketsOpenCount}
              subscriptionsPending={subscriptionsPendingCount}
              onOpen={(target) => setActiveSection(target)}
              onReviewApplication={(id, queue) => {
                setQueueFilter(queue);
                setSearch("");
                setExpandedRequestId(id);
                setActiveSection("applications");
              }}
            />
          )}

          {section(
            "applications",
            <div className="space-y-6">
              {/* What the queue looks like before opening anything. Pending is
                  the only number that is ever a call to action, so it alone
                  alarms. */}
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Awaiting review", value: requests.length, alert: requests.length > 0 },
                  { label: "Approved", value: approvedRequests.length, alert: false },
                  { label: "Rejected", value: rejectedRequests.length, alert: false },
                  { label: "Shop owners", value: profiles.filter((profile) => profile.shop_owner).length, alert: false },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className={`rounded-2xl border p-4 ${
                      stat.alert
                        ? "border-[#c0392b]/40 bg-[#c0392b]/5"
                        : "border-[var(--fc-border)] bg-[var(--fc-panel)]"
                    }`}
                  >
                    <div
                      className={`text-3xl font-extrabold ${
                        stat.alert ? "text-[#c0392b]" : "text-[var(--fc-ink-accent)]"
                      }`}
                    >
                      {stat.value}
                    </div>
                    <div className="mt-1 text-sm text-[var(--fc-muted)]">{uiText(stat.label)}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">{uiText("Applications")}</h2>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={uiText("Search shop, email, BIR name…")}
                    className="w-full max-w-xs rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-2 text-sm text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] sm:w-auto"
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    ["pending", "Awaiting review", requests.length],
                    ["approved", "Approved", approvedRequests.length],
                    ["rejected", "Rejected", rejectedRequests.length],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQueueFilter(key)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        queueFilter === key
                          ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                          : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
                      } ${count === 0 && queueFilter !== key ? "opacity-45" : ""}`}
                    >
                      {uiText(label)} <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  {loading ? (
                    <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading requests…")}</p>
                  ) : visibleRequests.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">
                      {needle ? uiText("Nothing matching \"{0}\" in this queue.", { 0: search.trim() }) : queueFilter === "pending" ? uiText("Nothing awaiting review. Every application has been dealt with.") : uiText("No {0} requests yet.", { 0: queueFilter })}
                    </p>
                  ) : (
                    visibleRequests.map((request) => renderRequestCard(request, queueFilter === "pending"))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-[var(--fc-border)] bg-[rgba(58,86,136,0.1)] p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-[#3a5688]">{uiText("🔍 DTI BNRS Verification")}</h2>
                <p className="mt-1 text-sm text-[#3a5688]">{uiText("Use the DTI Business Name Registration System to verify seller business names before approving applications.")}</p>
                <a
                  href="https://bnrs.dti.gov.ph/search"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >{uiText("Open DTI BNRS Search →")}</a>
              </div>
            </div>
          )}

          {section(
            "users",
            <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2" role="tablist" aria-label={uiText("Users")}>
                  {([
                    ["customers", "Customers"],
                    ["shop_owners", "Shop owners"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={userTab === key}
                      onClick={() => setUserTab(key)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        userTab === key
                          ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                          : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
                      }`}
                    >
                      {uiText(label)}
                    </button>
                  ))}
                </div>
                <div className="w-full sm:w-72">
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder={uiText("Search by name…")}
                    aria-label={uiText("Search by name")}
                    className="w-full rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-2 text-sm text-[var(--fc-text)] placeholder:text-[var(--fc-muted)]"
                  />
                  {/* Only the open tab's number, as one tidy count: the whole
                      tab, or how many of it the search has left. */}
                  <div className="mt-2 flex sm:justify-end">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] py-1 pl-1 pr-3 text-xs font-semibold text-[var(--fc-text)]">
                      <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--fc-ink-accent)] px-2 text-[11px] font-bold tabular-nums text-white">
                        {userNeedle ? `${visibleUsers.length}/${tabUsers.length}` : tabUsers.length}
                      </span>
                      {userTab === "customers"
                        ? tabUsers.length === 1 ? uiText("customer") : uiText("customers")
                        : tabUsers.length === 1 ? uiText("shop owner") : uiText("shop owners")}
                      {userNeedle ? <span className="font-normal text-[var(--fc-muted)]">{uiText("match your search")}</span> : null}
                    </span>
                  </div>
                </div>
              </div>
              {emailsMissing ? (
                <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-2 text-xs text-[var(--fc-muted)]">
                  {uiText("Customer emails appear once migration 20261030090000_admin_user_emails.sql is applied in Supabase.")}
                </p>
              ) : null}
              <div className="mt-4 space-y-2">
                {tabUsers.length === 0 ? (
                  <p className="text-sm text-[var(--fc-muted)]">
                    {userTab === "customers" ? uiText("No customers yet.") : uiText("No approved shop owners yet.")}
                  </p>
                ) : visibleUsers.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">
                    {uiText("No names start with “{0}”.", { 0: userSearch.trim() })}
                  </p>
                ) : (
                  visibleUsers.map((profile) => (
                    <div key={profile.id} className="rounded-2xl border border-[var(--fc-border)] p-3 text-sm text-[var(--fc-muted)]">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--fc-text)]">
                            {displayName(profile) ? highlightName(displayName(profile) as string) : (
                              <span className="font-normal italic text-[var(--fc-muted)]">{uiText("No name set")}</span>
                            )}
                          </p>
                          <p className="mt-0.5 break-all">
                            {emails[profile.id] ? (
                              <a href={`mailto:${emails[profile.id]}`} className="text-[var(--fc-text)] underline-offset-2 hover:underline">
                                {emails[profile.id]}
                              </a>
                            ) : (
                              uiText("Email unavailable")
                            )}
                          </p>
                          {userTab === "shop_owners" ? (
                            <p className="mt-1 font-semibold text-[var(--fc-ink-accent)]">
                              {approvedRequests.find((request) => request.user_id === profile.id)?.shop_name ?? uiText("Shop owner")}
                            </p>
                          ) : null}
                          <p className="mt-1">{profile.phone ?? uiText("No phone")}</p>
                          <p className="mt-1">{profile.address ?? uiText("No address")}</p>
                        </div>
                        {/* Shop-owner access comes from an approved application
                            only, so it is not toggled here. What an admin can
                            do to any account is suspend it; a suspended
                            owner's shop is hidden from customers until it
                            ends. */}
                        <div className="w-full sm:w-auto sm:max-w-sm">
                          <AccountSuspensionControl
                            userId={profile.id}
                            name={profile.full_name ?? "this account"}
                            suspension={suspensions[profile.id] ?? null}
                            onChange={(next) =>
                              setSuspensions((current) => {
                                const copy = { ...current };
                                if (next) copy[profile.id] = next;
                                else delete copy[profile.id];
                                return copy;
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Support and Tickets stay mounted at all times, just hidden when
              not the active section -- their own polling keeps running in the
              background, so the sidebar badge above is never stale just
              because you're looking at a different tab. */}
          {section("support", <AdminSupportInbox onNeedsReplyCountChange={setSupportNeedsReplyCount} />)}
          {section(
            "tickets",
            <AdminTickets
              onOpenCountChange={setTicketsOpenCount}
              refundsPending={refundsPendingCount}
              refundRequests={<AdminRefundRequests onPendingCountChange={setRefundsPendingCount} />}
            />
          )}
          {section("subscriptions", <AdminSubscriptions onPendingCountChange={setSubscriptionsPendingCount} />)}

          {section("orders", <AdminOrders />)}

          {section("deactivated_shops", <AdminShopActivity />)}
          {section("closures", <AdminAccountClosures />)}

          {section(
            "settings",
            <div className="grid max-w-md gap-4">
              <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
                <h2 className="text-xl font-semibold">{t("Appearance")}</h2>
                <p className="mt-1 text-sm text-[var(--fc-muted)]">
                  {t(
                    "Switch between light and dark for this admin session. This only affects how the panel looks on this device."
                  )}
                </p>
                <div className="mt-4">
                  <ThemeSwitcher />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
