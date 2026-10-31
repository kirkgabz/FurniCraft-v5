"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { followDeepLink } from "@/lib/deep-link";
import { notificationHref } from "@/components/support/open-support";
import {
  IconBell,
  IconCheck,
  IconClose,
  IconDocument,
  IconMessages,
  IconOrders,
  IconWarning,
} from "@/components/solihiya/icons";
import { initialsOf, timeAgo } from "@/lib/time-ago";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";

/**
 * The notification bell: unread count, live updates, and a panel of recent activity.
 *
 * Rows are written only by database triggers (see
 * supabase/migrations/20260825000600_notifications.sql), so nothing here creates
 * a notification -- it reads, and it marks read. Marking read is the only write
 * a user is permitted, enforced by guard_notification_update rather than by
 * this component behaving itself.
 *
 * The realtime subscription mirrors the message channel already in
 * furnicraft-dashboard.tsx: a filtered postgres_changes listener, torn down with
 * removeChannel on unmount.
 */

const RECENT_LIMIT = 20;

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  /** 'shop' reached them as a shop owner, 'personal' as themselves. */
  audience: string;
};

/**
 * A drawn mark per event kind, so the list scans without reading every line.
 * These were emoji, which the OS renders in its own artwork at its own weight
 * and which change appearance per platform; they now come from the product's
 * own set.
 */
function NotificationIcon({ type, className }: { type: string; className?: string }) {
  if (type.startsWith("order_quoted")) return <IconDocument aria-hidden className={className} />;
  if (type.startsWith("payment")) return <IconDocument aria-hidden className={className} />;
  if (type.startsWith("message")) return <IconMessages aria-hidden className={className} />;
  if (type.startsWith("report")) return <IconWarning aria-hidden className={className} />;
  if (type === "subscription_rejected") return <IconWarning aria-hidden className={className} />;
  if (type.startsWith("subscription")) return <IconCheck aria-hidden className={className} />;
  if (type === "order_received") return <IconOrders aria-hidden className={className} />;
  if (type === "order_payment_rejected") return <IconWarning aria-hidden className={className} />;
  if (type === "order_confirmed") return <IconCheck aria-hidden className={className} />;
  if (type === "order_payment_submitted") return <IconDocument aria-hidden className={className} />;
  if (type === "order_completed") return <IconCheck aria-hidden className={className} />;
  if (type === "order_declined") return <IconClose aria-hidden className={className} />;
  // Refunds get their own marks rather than the generic bell: a request is a
  // problem to answer, a refusal is a no, and a paid refund is a settlement.
  if (type === "order_refund_requested") return <IconWarning aria-hidden className={className} />;
  if (type === "order_refund_declined") return <IconClose aria-hidden className={className} />;
  if (type === "order_refunded") return <IconCheck aria-hidden className={className} />;
  return <IconBell aria-hidden className={className} />;
}

export default function NotificationBell({ className = "" }: { className?: string }) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [items, setItems] = useState<Notification[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const userIdRef = useRef<string | null>(null);

  const unreadCount = items.filter((item) => item.read_at === null).length;
  const hasShopItems = items.some((item) => item.audience === "shop");

  /** Names for the avatars. The view exposes only id and full_name. */
  const loadActorNames = useCallback(async (rows: Notification[]) => {
    const ids = Array.from(
      new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id)))
    );
    if (ids.length === 0) return;

    const supabase = createClient();
    const { data } = await supabase.from(USER_NAMES_TABLE).select("id, full_name").in("id", ids);
    if (!data) return;

    setActorNames((current) => {
      const next = { ...current };
      for (const row of data as Array<{ id: string; full_name: string | null }>) {
        if (row.full_name) next[row.id] = row.full_name;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const load = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;
      userIdRef.current = userId;
      if (!userId) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      const { data } = await supabase
        .from("notifications")
        .select("id, type, title, body, link, actor_user_id, entity_type, entity_id, read_at, created_at, audience")
        .order("created_at", { ascending: false })
        .limit(RECENT_LIMIT);

      if (cancelled) return;
      const rows = (data ?? []) as Notification[];
      setItems(rows);
      setIsLoading(false);
      void loadActorNames(rows);
    };

    void load();

    // Subscribed after the first load so a row arriving mid-fetch is not missed
    // by both paths.
    //
    // Both handlers re-run the same query rather than reading the row out of
    // the event and merging it in. `payload.new` was found to arrive as a
    // genuinely empty object for this table in this environment -- caught via
    // the toast provider's own guard against exactly that -- and real
    // notification rows are always written by a SECURITY DEFINER trigger, the
    // same kind of write my test used to catch it, not a client insert. So
    // this cannot be assumed reliable for any real notification either.
    // Refetching is a full round trip on every event, but the list is capped
    // at RECENT_LIMIT and this only fires on the user's own notifications.
    const channel = supabase.channel("notifications-bell");
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      () => void load()
    );
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications" },
      () => void load()
    );
    channel.subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [loadActorNames]);

  // Close on an outside click or Escape, the way the other panels here behave.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();

    // Optimistic: the panel should not lag behind the click.
    setItems((current) =>
      current.map((item) => (ids.includes(item.id) ? { ...item, read_at: item.read_at ?? now } : item))
    );

    const supabase = createClient();
    const { error } = await supabase.from("notifications").update({ read_at: now }).in("id", ids);
    if (error) {
      // Put it back rather than showing a read state the database rejected.
      console.error("Could not mark notifications read:", error);
      setItems((current) =>
        current.map((item) => (ids.includes(item.id) ? { ...item, read_at: null } : item))
      );
    }
  }, []);

  const openItem = useCallback(
    (item: Notification) => {
      // Marking read is fire-and-forget on purpose: navigation should not
      // wait on a write, and markRead already rolls back its own optimism if
      // the database refuses.
      if (item.read_at === null) void markRead([item.id]);
      setIsOpen(false);
      // Not router.push: a link to the page you are already on navigates
      // without remounting, so the target never learns it was asked to open a
      // particular conversation. followDeepLink delivers those as an event.
      const href = notificationHref(item);
      if (href) followDeepLink(router, href);
    },
    [markRead, router]
  );

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={unreadCount > 0 ? uiText("Notifications, {0} unread", { 0: unreadCount }) : uiText("Notifications")}
        aria-expanded={isOpen}
        // A round icon on a phone; on desktop, where the header has the
        // room, it says what it is.
        className="relative grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 place-items-center rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.1)] active:scale-[0.95] lg:flex lg:w-auto lg:gap-1.5 lg:px-3 lg:[@media(pointer:coarse)]:w-auto"
      >
        <IconBell aria-hidden className="h-5 w-5" />
        <span aria-hidden className="hidden text-sm font-semibold lg:inline">{uiText("Notifications")}</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[var(--fc-danger)] px-1 text-[10px] font-bold leading-[18px] text-[var(--fc-danger-fg)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label={uiText("Notifications")}
          /* On a phone the panel is pinned to the viewport rather than hung off
             the bell. Anchored, its right edge lines up with the bell -- which
             sits ~100px in from the right, behind Sign out -- so a 360px panel
             started at -29px and the first ~30px of every row was off the left
             of the screen. Clamping the width did not fix it, because the
             overflow came from where it was anchored, not how wide it was.

             From sm up there is room to the left of the bell and the anchored
             popover is the better shape: it points at what opened it. */
          className="fixed inset-x-3 top-20 z-50 max-h-[70dvh] overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-[0_20px_50px_rgba(20,12,6,0.22)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(360px,calc(100vw-2rem))]"
        >
          <div className="flex items-center justify-between border-b border-[var(--fc-border)] px-4 py-3">
            <h2 className="text-sm font-bold text-[var(--fc-text)]">{uiText("Notifications")}</h2>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => markRead(items.filter((item) => item.read_at === null).map((item) => item.id))}
                className="text-xs font-semibold text-[var(--fc-ink-accent)] underline"
              >{uiText("Mark all as read")}</button>
            ) : null}
          </div>

          <div className="max-h-[calc(70vh-3rem)] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--fc-muted)]">{uiText("Nothing yet. Quotes, payments and messages will appear here.")}</p>
            ) : (
              <ul className="list-none p-0">
                {items.map((item) => {
                  const isUnread = item.read_at === null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openItem(item)}
                        className={`flex w-full items-start gap-3 border-b border-[var(--fc-border)] px-4 py-3 text-left transition hover:bg-[rgba(178,106,56,0.07)] ${
                          isUnread ? "bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)]" : ""
                        }`}
                      >
                        <span
                          aria-hidden
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-sm font-bold text-[var(--fc-ink-accent)]"
                        >
                          {item.actor_user_id && actorNames[item.actor_user_id]
                            ? initialsOf(actorNames[item.actor_user_id])
                            : <NotificationIcon type={item.type} className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {hasShopItems ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] ${
                                  item.audience === "shop"
                                    ? "bg-[rgba(58,86,136,0.16)] text-[#3a5688]"
                                    : "bg-[rgba(178,106,56,0.16)] text-[var(--fc-ink-accent)]"
                                }`}
                              >
                                {item.audience === "shop" ? uiText("Your shop") : uiText("You")}
                              </span>
                            ) : null}
                            <span className="text-sm font-semibold text-[var(--fc-text)]">{uiText(item.title)}</span>
                          </span>
                          {item.body ? (
                            <span className="mt-0.5 block truncate text-xs text-[var(--fc-muted)]">{item.type.startsWith("message") || item.type === "support_reply" ? item.body : uiText(item.body)}</span>
                          ) : null}
                          <span className="mt-1 block text-[11px] text-[var(--fc-muted)]">{timeAgo(item.created_at, undefined, uiLanguage)}</span>
                        </span>
                        {isUnread ? (
                          <span aria-label={uiText("Unread")} className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#c0392b]" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
