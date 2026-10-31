"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { SAVED_EVENT, type SavedNoticeDetail } from "@/lib/saved-notice";

/** Long enough to read two words, short enough not to sit on the page. */
const VISIBLE_MS = 2200;

/**
 * The quiet success pill confirming a save or a finished action, triggered by
 * notifySaved() / notifySuccess().
 *
 * Deliberately not a notification toast: no chime, no sender, nothing to
 * click. Top-centre on every screen size -- phone, tablet and desktop -- where
 * it is seen straight after the click, clear of the notification toasts in the
 * corner and of the phone tab bar at the bottom. A second success while it is
 * showing restarts the timer rather than stacking a second pill.
 */
export function SavedToast() {
  const { t: uiText } = useUiLanguage();
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<SavedNoticeDetail>).detail;
      const text = detail?.message || "Saved";
      setMessage(text);
      setVisible(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      // A pill that also lists what is still missing needs longer to read.
      const shownFor = Math.min(8000, Math.max(VISIBLE_MS, text.length * 70));
      timerRef.current = window.setTimeout(() => setVisible(false), shownFor);
    };
    window.addEventListener(SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(SAVED_EVENT, onSaved);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top,0px))] z-[99998] flex justify-center px-4"
    >
      {message ? (
        <span
          className={`inline-flex max-w-xl items-center gap-2 rounded-2xl text-left bg-[var(--fc-btn)] px-4 py-2 text-sm font-semibold text-[var(--fc-btn-fg)] shadow-lg transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
            visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
          }`}
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {uiText(message)}
        </span>
      ) : null}
    </div>
  );
}
