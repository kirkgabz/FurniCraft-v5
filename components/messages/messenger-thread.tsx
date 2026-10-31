"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useActiveMessageConversation } from "@/components/messages/use-active-message-conversation";
import type { MessageConversation } from "@/lib/message-notifications";
import ChatPhotoBubble from "@/components/messages/chat-photo";
import { MessageActions } from "./message-actions";
import { useMessageReactions } from "./use-message-reactions";
import { reactionSummary } from "@/lib/message-reactions";
import { ShopMapPreview } from "@/components/shops/shop-map";
import { collapseOrderEvents, eventOrderId } from "./order-event-cards";
import {
  IconArrowLeft,
  IconCheck,
  IconImage,
  IconPhone,
  IconPlus,
  IconThumbUp,
} from "@/components/solihiya/icons";

/**
 * One entry in a thread. Deliberately narrower than the dashboard's own
 * Message type: this component needs to know who spoke, when, and whether the
 * row is a system card, and nothing else about how the app stores any of it.
 */
export type ThreadEntry = {
  id: string;
  text: string;
  /** Already formatted for display by the caller, e.g. "9:44 PM". */
  time: string;
  senderUserId?: string | null;
  /**
   * 'order_event' rows render through `renderEventCard` instead of a bubble,
   * and 'assistant' rows render as a labelled automated answer. Anything else
   * is an ordinary message.
   */
  kind?: string;
  payload?: unknown;
  /**
   * A place to draw under an 'assistant' answer, set only on the reply to
   * "Where is your shop?". The address is in `text` either way; this is
   * what the chat adds when the shop's pin resolves, not what it replaces.
   */
  map?: { shopName: string; address: string | null; mapUrl: string | null };
  /** Sorts and groups by day; falls back to no separator when absent. */
  created_at?: string;
};

export { orderEntryId } from "./order-event-cards";

/**
 * Scrolls the open thread to one entry and flashes it, for "In chat" on the
 * pinned orders list. Returns false when the entry is not in the thread.
 */
export function scrollToThreadEntry(entryId: string): boolean {
  const element = document.querySelector<HTMLElement>(`.msgr [data-entry-id="${CSS.escape(entryId)}"]`);
  if (!element) return false;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  element.classList.remove("msgr-flash");
  // Restart the animation if the same entry is asked for twice in a row.
  void element.offsetWidth;
  element.classList.add("msgr-flash");
  return true;
}

const SEEN_CARDS_KEY = "fc:order-cards-seen";

/** Order id -> the card id this viewer last opened, kept in this browser only. */
function readSeenCards(userId: string | null): Record<string, string> {
  if (!userId) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${SEEN_CARDS_KEY}:${userId}`) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function dayLabel(iso: string | undefined, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (isSameDay(date, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * A conversation thread in the shape of mobile Messenger.
 *
 * Three fixed bands -- header, scrolling middle, composer -- inside a 100dvh
 * column, so the composer stays put while the thread scrolls under it and
 * neither moves when a phone's address bar collapses.
 *
 * Sending, fetching messages and read state stay with the caller. Reactions
 * use one shared persistence hook so both inboxes show the same saved state.
 */
export default function MessengerThread({
  title,
  titleHref,
  subtitle,
  avatar,
  headerAvatar,
  isOnline,
  entries,
  currentUserId,
  draft,
  onDraftChange,
  onSend,
  onBack,
  onCall,
  onPickPhoto,
  extraActions,
  isSendingPhoto,
  headerExtra,
  assistantLabel,
  assistantNote,
  composerAbove,
  onReportMessage,
  renderEventCard,
  className,
  pinned,
  notificationConversation,
  isMobileThreadOpen = false,
}: {
  title: string;
  /** Where the header's name and avatar link to, e.g. the shop's storefront. */
  titleHref?: string;
  subtitle?: string;
  /** Small avatar for the message gutter, 32px. */
  avatar: React.ReactNode;
  /** Larger avatar for the header, ~36px. */
  headerAvatar: React.ReactNode;
  isOnline: boolean;
  entries: ThreadEntry[];
  currentUserId: string | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  /** Mobile back arrow. Hidden from lg up, where the list is always on screen. */
  onBack: () => void;
  onCall?: () => void;
  /**
   * Opens the device's photo picker. Omitted by callers that cannot send one,
   * which is what keeps the paperclip menu from offering an action that does
   * nothing -- the complaint that produced this feature in the first place.
   */
  onPickPhoto?: () => void;
  /**
   * Anything else this caller wants in the plus menu, beside Photo and Call.
   *
   * A prop rather than more named callbacks because what belongs there is the
   * caller's business and differs by side: the shop writes orders, the
   * customer calls. They are appended after the built-ins, so the two actions
   * people already know keep their positions.
   */
  extraActions?: Array<{ id: string; label: string; icon: React.ReactNode; run: () => void }>;
  /** True while a photo is uploading, so the composer can say so. */
  isSendingPhoto?: boolean;
  /** Sits on the status line, for anything this conversation needs beside it. */
  headerExtra?: React.ReactNode;
  /**
   * Heading on an `kind: "assistant"` entry, e.g. "Shop assistant".
   *
   * Passed in rather than hardcoded because this component is the presentation
   * layer for a conversation and has no business knowing what an assistant is
   * called; the caller that decides to show one decides what to call it.
   */
  assistantLabel?: string;
  /** The small print under an assistant answer, saying it is automated. */
  assistantNote?: string;
  /**
   * Sits between the thread and the composer, pinned with it.
   *
   * For the quick-question chips. They belong here rather than inside the
   * scrolling thread because they are a control, not a message: scrolled away
   * with the conversation they would be unreachable in exactly the situation
   * they exist for -- a long thread where the customer is still waiting.
   */
  composerAbove?: React.ReactNode;
  /**
   * Offers a "Report" action on messages the viewer did not send.
   *
   * Available from the three-dot menu for either side of a conversation.
   */
  onReportMessage?: (entry: ThreadEntry) => void;
  renderEventCard: (entry: ThreadEntry) => React.ReactNode;
  className?: string;
  /**
   * Pinned under the header, above the scrolling thread, e.g. the
   * conversation's orders (conversation-orders.tsx), which would otherwise
   * scroll away under the messages about them.
   */
  pinned?: React.ReactNode;
  /** Identifies the inbox room only while this thread is actually visible. */
  notificationConversation?: MessageConversation;
  isMobileThreadOpen?: boolean;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  useActiveMessageConversation(notificationConversation, isMobileThreadOpen);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef<{ id: string; at: number } | null>(null);

  const { rows: reactions, react, saving: savingReaction, error: reactionError, ready: reactionsReady } = useMessageReactions(entries, currentUserId);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const visibleEntries = useMemo(() => collapseOrderEvents(entries), [entries]);

  /**
   * Which order cards this viewer has opened since their last update. Read
   * after mount, since the server render has no localStorage; until then no
   * card shows a dot rather than every card flashing one.
   */
  const [seenCards, setSeenCards] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setSeenCards(readSeenCards(currentUserId));
  }, [currentUserId]);

  const markCardSeen = useCallback(
    (orderId: string, entryId: string) => {
      setSeenCards((current) => {
        if (!current || current[orderId] === entryId) return current;
        const next = { ...current, [orderId]: entryId };
        try {
          if (currentUserId) window.localStorage.setItem(`${SEEN_CARDS_KEY}:${currentUserId}`, JSON.stringify(next));
        } catch {
          // Private mode or blocked storage: the dot just clears for this visit.
        }
        return next;
      });
    },
    [currentUserId]
  );

  /**
   * The plus menu. Open state rather than a popover so it pushes the thread up
   * instead of covering the last message, which on a phone is the one the
   * customer is answering.
   */
  const [isAttachOpen, setIsAttachOpen] = useState(false);

  /** What the plus offers, built from the actions this caller actually gave us. */
  const attachActions: Array<{ id: string; label: string; icon: React.ReactNode; run: () => void }> = [];
  if (onPickPhoto) {
    attachActions.push({ id: "photo", label: "Photo", icon: <IconImage aria-hidden className="h-5 w-5" />, run: onPickPhoto });
  }
  if (onCall) {
    attachActions.push({ id: "call", label: "Call", icon: <IconPhone aria-hidden className="h-5 w-5" />, run: onCall });
  }
  for (const action of extraActions ?? []) {
    attachActions.push(action);
  }

  // useLayoutEffect, not useEffect: pinning to the bottom after paint shows a
  // frame of the thread mid-scroll first.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  const openPicker = useCallback((id: string) => {
    setPickerFor((current) => (current === id ? null : id));
  }, []);

  const handleTap = useCallback(
    (id: string) => {
      const now = Date.now();
      const previous = lastTap.current;
      if (previous && previous.id === id && now - previous.at < 300) {
        lastTap.current = null;
        // Double-tap is Messenger's shortcut straight to a heart rather than
        // to the picker, which is the whole point of it being a shortcut.
        void react(id, "❤️");
        return;
      }
      lastTap.current = { id, at: now };
    },
    [react]
  );

  const hasDraft = draft.trim().length > 0;
  const myLastEntryId = currentUserId ? [...entries].reverse().find((entry) => entry.senderUserId === currentUserId)?.id ?? null : null;

  return (
    <div className={`msgr flex flex-col ${className ?? ""}`}>
      {/* ---- header ---- */}
      <header
        className="sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2 backdrop-blur"
        style={{ background: "var(--msgr-chrome)", borderColor: "var(--msgr-hairline)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={uiText("Back to conversations")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full active:scale-[0.94] lg:hidden"
          style={{ color: "var(--msgr-action)" }}
        >
          <IconArrowLeft aria-hidden className="h-5 w-5" />
        </button>

        {/* With titleHref, the avatar and name open that page -- a
            customer's chat links the shop's name to its storefront. */}
        {titleHref ? (
          <Link
            href={titleHref}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-0.5 pr-1 transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--msgr-action)]"
            title={uiText("Visit {0}'s storefront", { 0: title })}
          >
            <span className="relative shrink-0">
              {headerAvatar}
              {isOnline ? (
                <>
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
                    style={{ background: "var(--fc-online)", borderColor: "var(--msgr-surface)" }}
                  />
                  <span className="sr-only">{uiText("Active now")}</span>
                </>
              ) : null}
            </span>
            <span className="min-w-0 flex-1 pl-1">
              <span className="block truncate text-[15px] font-semibold leading-tight underline-offset-2 hover:underline" style={{ color: "var(--msgr-recv-fg)" }}>
                {title}
              </span>
              <span className="flex items-center gap-1.5 truncate text-[12px] leading-tight" style={{ color: "var(--msgr-muted)" }}>
                <span className="truncate">{isOnline ? uiText("Active now") : subtitle}</span>
                {headerExtra}
              </span>
            </span>
          </Link>
        ) : (
        <>
        <span className="relative shrink-0">
          {headerAvatar}
          {isOnline ? (
            <>
              {/* The app's own presence green, the same one the shop cards and
                  the conversation list use, rather than Messenger's. */}
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
                style={{ background: "var(--fc-online)", borderColor: "var(--msgr-surface)" }}
              />
              <span className="sr-only">{uiText("Active now")}</span>
            </>
          ) : null}
        </span>

        <div className="min-w-0 flex-1 pl-1">
          <p className="truncate text-[15px] font-semibold leading-tight" style={{ color: "var(--msgr-recv-fg)" }}>
            {title}
          </p>
          <p className="flex items-center gap-1.5 truncate text-[12px] leading-tight" style={{ color: "var(--msgr-muted)" }}>
            <span className="truncate">{isOnline ? uiText("Active now") : subtitle}</span>
            {headerExtra}
          </p>
        </div>
        </>
        )}

        {/* Rendered only when the caller has something for them to do. A header
            that shows a call button on a shop with no phone number on file is a
            button that lies. */}
        {onCall ? (
          <button
            type="button"
            onClick={onCall}
            aria-label={uiText("Call {0}", { 0: title })}
            title={uiText("Call {0}", { 0: title })}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full active:scale-[0.94]"
            style={{ color: "var(--msgr-action)" }}
          >
            <IconPhone aria-hidden className="h-5 w-5" />
          </button>
        ) : null}
      </header>

      {pinned}
      {reactionError ? <p role="alert" className="px-3 py-2 text-xs text-[var(--fc-danger)]">{reactionError}</p> : null}

      {/* ---- thread ---- */}
      <div ref={scrollRef} className="msgr-scroll flex-1 overflow-y-auto px-3 py-3">
        {visibleEntries.map((entry, index) => {
          const isMine = Boolean(currentUserId) && entry.senderUserId === currentUserId;
          const summary = reactionSummary(reactions, entry.id);
          const previous = visibleEntries[index - 1];
          const next = visibleEntries[index + 1];

          const startsRun = !previous || previous.senderUserId !== entry.senderUserId;
          const endsRun = !next || next.senderUserId !== entry.senderUserId;

          const separator = dayLabel(entry.created_at, uiLocale);
          const previousSeparator = dayLabel(previous?.created_at, uiLocale);
          const showSeparator = Boolean(separator) && separator !== previousSeparator;

          // 2px inside a run, 14px between speakers: the gap is what tells the
          // two apart, so it carries more weight than any per-bubble styling.
          const spacing = startsRun ? (index === 0 ? "" : "mt-3.5") : "mt-0.5";

          const isEvent = entry.kind === "order_event";
          const isAssistant = entry.kind === "assistant";
          const isPhoto = entry.kind === "image";

          return (
            <div key={entry.id} data-entry-id={entry.id}>
              {showSeparator ? (
                <div className="my-4 text-center text-[12px] font-medium" style={{ color: "var(--msgr-muted)" }}>
                  {separator ? uiText(separator) : null}
                </div>
              ) : null}

              <div className={`flex items-end gap-2 ${spacing} ${isMine ? "justify-end" : "justify-start"}`}>
                {/* The avatar rides the closing bubble of a received run; the
                    rest of the run keeps its column with a spacer. */}
                {isMine ? null : endsRun ? (
                  <span className="shrink-0">{avatar}</span>
                ) : (
                  <span aria-hidden className="w-8 shrink-0" />
                )}

                {isAssistant ? (
                  /* Deliberately NOT a received bubble. The assistant is not
                     the shop, and a customer who mistakes one for the other
                     has been told the shop said something it never said -- so
                     it gets its own colour, its own outline, and a label that
                     says what it is and that a person is still coming. */
                  <div
                    className="max-w-[86%] rounded-2xl border px-3 py-2"
                    style={{ borderColor: "var(--fc-border)", background: "rgba(178,106,56,0.07)" }}
                  >
                    <p
                      className="text-[10px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: "var(--fc-ink-accent)" }}
                    >
                      {assistantLabel ?? uiText("Assistant")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-snug" style={{ color: "var(--fc-text)" }}>
                      {entry.text}
                    </p>
                    {entry.map ? (
                      <ShopMapPreview
                        shopName={entry.map.shopName}
                        address={entry.map.address}
                        mapUrl={entry.map.mapUrl}
                      />
                    ) : null}
                    <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--fc-muted)" }}>
                      {assistantNote}
                    </p>
                  </div>
                ) : isEvent ? (
                  (() => {
                    const orderId = eventOrderId(entry);
                    const isUnseenUpdate =
                      Boolean(orderId) && (entry.replacedCards ?? 0) > 0 && seenCards !== null && seenCards[orderId!] !== entry.id;
                    return (
                      /* Any tap on the card counts as having looked at the
                         update, including "View order details". */
                      <div
                        className="relative w-full max-w-sm"
                        onClickCapture={() => {
                          if (orderId) markCardSeen(orderId, entry.id);
                        }}
                      >
                        {renderEventCard(entry)}
                        {isUnseenUpdate ? (
                          <span
                            role="status"
                            className="absolute -right-1 -top-1 flex items-center gap-1 rounded-full bg-[var(--fc-danger,#dc2626)] py-0.5 pl-1.5 pr-2 text-[10px] font-bold uppercase tracking-[0.1em] text-white shadow"
                          >
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white" />
                            {uiText("Updated")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()
                ) : (
                  /* The width cap belongs on this wrapper, not on the bubble
                     inside it. With it on the bubble, this flex item stretched
                     to the full row, justify-end had nothing left to push, and
                     a long sent message sat flush left looking like the other
                     person had said it. Short ones never stretched it, which is
                     why it only showed up on a full-width message. */
                  <div className="relative max-w-[74%]">
                    <MessageActions
                      open={pickerFor === entry.id}
                      onOpenChange={(open) => setPickerFor(open ? entry.id : null)}
                      onReact={(emoji) => void react(entry.id, emoji)}
                      selected={reactions.find((row) => row.message_id === entry.id && row.user_id === currentUserId)?.emoji}
                      disabled={!reactionsReady || savingReaction || !currentUserId}
                      isMine={isMine}
                      onReport={onReportMessage && !isMine && entry.senderUserId ? () => onReportMessage(entry) : undefined}
                    />
                    {isPhoto ? <ChatPhotoBubble payload={entry.payload} isMine={isMine} time={entry.time} /> : <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleTap(entry.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openPicker(entry.id);
                      }}
                      onPointerDown={() => {
                        pressTimer.current = window.setTimeout(() => openPicker(entry.id), 450);
                      }}
                      onPointerUp={() => window.clearTimeout(pressTimer.current)}
                      onPointerLeave={() => window.clearTimeout(pressTimer.current)}
                      onPointerCancel={() => window.clearTimeout(pressTimer.current)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openPicker(entry.id);
                        }
                      }}
                      aria-label={uiText("Message: {0}. {1}. Press Enter to react{2}.", { 0: entry.text, 1: entry.time, 2: onReportMessage && !isMine ? " or report" : "" })}
                      className={`msgr-bubble select-none ${isMine ? "msgr-bubble-sent" : "msgr-bubble-recv"} ${
                        endsRun ? "is-tail" : ""
                      }`}
                    >
                      {entry.text}
                    </div>}

                    {!isPhoto && !isMine && <AdaptiveText text={entry.text} translationOnly />}

                    {summary ? (
                      <span
                        className="msgr-reaction absolute -bottom-2 rounded-full px-1.5 py-0.5 text-[11px] leading-none"
                        style={{ [isMine ? "left" : "right"]: "6px" } as React.CSSProperties}
                      >
                        {summary}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Delivery mark under the newest thing you said, the way the
                  real thing puts it there and nowhere else. */}
              {isMine && entry.id === myLastEntryId ? (
                <div className="mt-1 flex items-center justify-end gap-1 pr-1">
                  <IconCheck aria-hidden className="h-3 w-3" style={{ color: "var(--msgr-muted)" }} />
                  <span className="text-[11px]" style={{ color: "var(--msgr-muted)" }}>{uiText("Sent ")}{entry.time}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}

        {entries.length === 0 ? (
          <p className="py-10 text-center text-[13px]" style={{ color: "var(--msgr-muted)" }}>{uiText("Say hello to ")}{title}.
          </p>
        ) : null}
      </div>

      {composerAbove ? (
        <div
          className="sticky bottom-0 border-t px-2 pb-1 pt-2 backdrop-blur"
          style={{ background: "var(--msgr-chrome)", borderColor: "var(--msgr-hairline)" }}
        >
          {composerAbove}
        </div>
      ) : null}

      {/* ---- the plus menu ---- */}
      {isAttachOpen && attachActions.length > 0 ? (
        <div
          className="sticky bottom-0 flex gap-2 border-t px-3 py-3 backdrop-blur"
          style={{ background: "var(--msgr-chrome)", borderColor: "var(--msgr-hairline)" }}
        >
          {attachActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => {
                setIsAttachOpen(false);
                action.run();
              }}
              disabled={action.id === "photo" && isSendingPhoto}
              className="flex w-16 flex-col items-center gap-1.5 rounded-xl py-1 text-[11px] font-medium active:scale-[0.96] disabled:opacity-50"
              style={{ color: "var(--msgr-recv-fg)" }}
            >
              <span
                className="grid h-11 w-11 place-items-center rounded-full"
                style={{ background: "rgba(178,106,56,0.12)", color: "var(--msgr-action)" }}
              >
                {action.icon}
              </span>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {isSendingPhoto ? (
        <p
          className="sticky bottom-0 px-4 pb-1 text-[11px]"
          style={{ background: "var(--msgr-chrome)", color: "var(--msgr-muted)" }}
        >{uiText("Sending photo...")}</p>
      ) : null}

      {/* ---- composer ---- */}
      <footer
        className="sticky bottom-0 flex items-end gap-1 border-t px-2 py-2 backdrop-blur"
        style={{ background: "var(--msgr-chrome)", borderColor: "var(--msgr-hairline)" }}
      >
        {/* The action row collapses to the plus alone once there is a draft,
            which is what makes room for a long message on a narrow phone. */}
        {/* The plus is here whether or not there is a draft; the photo
            shortcut beside it collapses into the plus once the customer starts
            typing, which is what makes room for a long message on a narrow
            phone. There is no camera button: it opened nothing, and on a phone
            the photo picker offers the camera anyway. */}
        {attachActions.length > 0 ? (
          <button
            type="button"
            onClick={() => setIsAttachOpen((open) => !open)}
            aria-label={uiText("More actions")}
            title={uiText("More actions")}
            aria-expanded={isAttachOpen}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform active:scale-[0.94]"
            style={{
              color: "var(--msgr-action)",
              transform: isAttachOpen ? "rotate(45deg)" : undefined,
            }}
          >
            <IconPlus aria-hidden className="h-5 w-5" />
          </button>
        ) : null}

        {!hasDraft && onPickPhoto ? (
          <button
            type="button"
            onClick={onPickPhoto}
            disabled={isSendingPhoto}
            aria-label={uiText("Send a photo")}
            title={uiText("Send a photo")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full active:scale-[0.94] disabled:opacity-50"
            style={{ color: "var(--msgr-action)" }}
          >
            <IconImage aria-hidden className="h-5 w-5" />
          </button>
        ) : null}

        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={uiText("Aa")}
          aria-label={uiText("Message {0}", { 0: title })}
          className="msgr-field min-h-11 min-w-0 flex-1 px-4 py-2.5 text-[15px] outline-none"
        />

        <button
          type="button"
          onClick={() => {
            if (hasDraft) onSend();
            else onDraftChange("👍");
          }}
          aria-label={hasDraft ? uiText("Send") : uiText("Send a thumbs up")}
          title={hasDraft ? uiText("Send") : uiText("Send a thumbs up")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full active:scale-[0.94]"
          style={{ color: "var(--msgr-action)" }}
        >
          {hasDraft ? (
            <IconArrowLeft aria-hidden className="h-5 w-5 rotate-180" />
          ) : (
            <IconThumbUp aria-hidden className="h-5 w-5" />
          )}
        </button>
      </footer>
    </div>
  );
}
