"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconBell,
  IconClose,
  IconDocument,
  IconMessages,
  IconOrders,
  IconWarning,
} from "@/components/solihiya/icons";

export type ToastNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_user_id: string | null;
  actor_name?: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  audience?: string;
};

interface NotificationToastItemProps {
  notification: ToastNotification;
  onDismiss: (id: string) => void;
  onClick: (notification: ToastNotification) => void;
  durationMs?: number;
}

/**
 * `type` is declared as a required `string` on ToastNotification, but the only
 * producer of these is a realtime `postgres_changes` payload cast straight
 * through with `as ToastNotification` and no runtime check -- so a payload
 * that arrives partial (Supabase Realtime can deliver one mid-resubscribe)
 * reaches here as `undefined` despite what the type claims. This sits at the
 * root layout, above every page in the app, so a crash here is not a broken
 * toast -- it is a broken app. Falling back to the default badge for
 * anything that isn't actually a string is what keeps it to the former.
 */
function getCategoryBadge(type: string | null | undefined, audience?: string): { label: string; iconType: string } {
  if (typeof type !== "string") {
    return { label: "FurniCraft", iconType: "bell" };
  }
  if (type.startsWith("message")) {
    return { label: "Messages", iconType: "message" };
  }
  if (type.startsWith("order_quoted") || type.startsWith("payment")) {
    return { label: audience === "shop" ? "Shop • Orders" : "Orders & Quotes", iconType: "quote" };
  }
  if (type.startsWith("order")) {
    return { label: audience === "shop" ? "Shop • Orders" : "Orders", iconType: "order" };
  }
  if (type.startsWith("report")) {
    return { label: "System • Alert", iconType: "report" };
  }
  return { label: "FurniCraft", iconType: "bell" };
}

function ToastTypeIcon({ iconType, className }: { iconType: string; className?: string }) {
  switch (iconType) {
    case "message":
      return <IconMessages aria-hidden className={className} size={16} />;
    case "order":
      return <IconOrders aria-hidden className={className} size={16} />;
    case "quote":
      return <IconDocument aria-hidden className={className} size={16} />;
    case "report":
      return <IconWarning aria-hidden className={className} size={16} />;
    default:
      return <IconBell aria-hidden className={className} size={16} />;
  }
}

export function NotificationToastItem({
  notification,
  onDismiss,
  onClick,
  durationMs = 6000,
}: NotificationToastItemProps) {
  const { t: uiText } = useUiLanguage();
  const [isHovered, setIsHovered] = useState(false);
  const [progress, setProgress] = useState(100);
  const [isClosing, setIsClosing] = useState(false);
  /**
   * True for the toast's very first paint, false on every paint after.
   *
   * A toast mounts already in its resting classes (opacity-100, no offset),
   * so there was never a "before" state for the transition to animate from --
   * only the exit had one, since isClosing genuinely flips after mount. Two
   * rAFs (one to let the entering paint commit, one to schedule the class
   * change after it) is the reliable way to get a real transition out of a
   * mount rather than the two states landing in the same paint.
   */
  const [isEntering, setIsEntering] = useState(true);
  const remainingTimeRef = useRef<number>(durationMs);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setIsEntering(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const { label, iconType } = getCategoryBadge(notification.type, notification.audience);

  const handleClose = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      setIsClosing(true);
      setTimeout(() => {
        onDismiss(notification.id);
      }, 220);
    },
    [notification.id, onDismiss]
  );

  const handleCardClick = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClick(notification);
    }, 120);
  };

  useEffect(() => {
    if (isHovered || isClosing) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalMs = 25;
    timerRef.current = setInterval(() => {
      remainingTimeRef.current -= intervalMs;
      const pct = Math.max(0, (remainingTimeRef.current / durationMs) * 100);
      setProgress(pct);

      if (remainingTimeRef.current <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleClose();
      }
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isHovered, isClosing, durationMs, handleClose]);

  const body = notification.body
    ? notification.type.startsWith("message") || notification.type === "support_reply"
      ? notification.body
      : uiText(notification.body)
    : uiText(notification.actor_name ? "Sent an update" : "You have a new update in FurniCraft.");
  const displayBody = notification.actor_name ? `${notification.actor_name}: ${body}` : body;

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleCardClick}
      // Every colour from the theme's own tokens. The card used
      // `bg-[var(--fc-panel-surface,#1f1814)]/95`: that variable has never
      // existed, and Tailwind cannot put an opacity on a var(), so the rule
      // produced no background at all -- the toast was see-through, with
      // whatever card sat under it reading straight through the message.
      className={`group relative w-full max-w-[360px] origin-top-right lg:origin-bottom-right cursor-pointer overflow-hidden rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 text-[var(--fc-text)] shadow-[0_16px_36px_rgba(20,12,6,0.22)] transition-[transform,opacity,border-color,box-shadow] duration-300 ease-fc ${
        isClosing || isEntering
          ? "scale-95 opacity-0 translate-y-3"
          : "scale-100 opacity-100 translate-y-0 hover:border-[var(--fc-accent)] hover:shadow-[0_20px_45px_rgba(20,12,6,0.28)]"
      }`}
    >
      {/* Top Header Row: Icon + Source Category + Close Button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--fc-accent)_15%,transparent)] text-[var(--fc-ink-accent)] ring-1 ring-[color-mix(in_srgb,var(--fc-accent)_30%,transparent)]">
            <ToastTypeIcon iconType={iconType} />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--fc-muted)]">{uiText("FurniCraft • ")}{uiText(label)}
          </span>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label={uiText("Dismiss notification")}
          className="-mr-1.5 -mt-1.5 flex h-8 w-8 items-center justify-center rounded-md text-[var(--fc-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--fc-cane-soft)] hover:text-[var(--fc-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fc-accent)] active:scale-[0.94] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <IconClose aria-hidden size={14} />
        </button>
      </div>

      {/* Main Notification Content */}
      <div className="mt-2.5">
        <h4 className="font-display text-sm font-semibold tracking-tight text-[var(--fc-text)] transition-colors group-hover:text-[var(--fc-ink-accent)]">
          {uiText(notification.title)}
        </h4>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--fc-muted)]">
          {displayBody}
        </p>
      </div>

      {/* Footer Timestamp / Action hint */}
      <div className="mt-3 flex items-center justify-between text-[10px] text-[var(--fc-muted)]">
        <span className="font-mono tracking-tight">{uiText("Just now")}</span>
        <span className="font-medium text-[var(--fc-ink-accent)] opacity-0 transition-opacity duration-200 group-hover:opacity-100">{uiText("Click to view →")}</span>
      </div>

      {/* Countdown progress hairline bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-[var(--fc-border)]">
        <div
          className="h-full bg-[var(--fc-accent)] transition-[width] duration-75 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

interface NotificationToastContainerProps {
  toasts: ToastNotification[];
  onDismiss: (id: string) => void;
  onClick: (notification: ToastNotification) => void;
}

export function NotificationToastContainer({
  toasts,
  onDismiss,
  onClick,
}: NotificationToastContainerProps) {
  const { t: uiText } = useUiLanguage();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label={uiText("Notifications")}
      tabIndex={-1}
      className="pointer-events-auto fixed top-[calc(1rem+env(safe-area-inset-top,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] z-[99999] flex max-w-[calc(100vw-2rem)] flex-col gap-3 lg:top-auto lg:bottom-[calc(1.25rem+var(--fc-tabbar-offset,0px))] lg:right-5 lg:flex-col-reverse"
    >
      {toasts.map((toast) => (
        <NotificationToastItem
          key={toast.id}
          notification={toast}
          onDismiss={onDismiss}
          onClick={onClick}
        />
      ))}
    </div>
  );
}
