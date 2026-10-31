"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import { FAQ_QUICK_QUESTIONS, type FaqEntry } from "./faq-data";

type ChatMessage = {
  id: string;
  role: "user" | "bot";
  text: string;
};

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "bot",
  text: "Hi! Choose a question below to learn how FurniCraft works.",
};

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `m${Date.now()}-${nextId}`;
}

/**
 * A floating FAQ helper, available on every page.
 *
 * Bottom-left rather than bottom-right on purpose -- the notification toasts
 * (notification-toast.tsx) already own bottom-right at a very high z-index,
 * and stacking a second floating control in that same corner would crowd it.
 *
 * Visitors choose from the provided questions. Each button displays its
 * curated answer from faq-data.ts; the widget accepts no typed messages.
 */
export default function FaqWidget({
  layerClassName = "z-[9000]",
  open,
  onOpenChange,
  launcherClassName = "",
}: {
  /**
   * Stacking layer. On the landing page it floats over everything; inside a
   * dashboard it should sit above the phone tab bar (20) but under the drawer's
   * scrim (30) and modals (50), or it hovers on top of an open drawer.
   */
  layerClassName?: string;
  /**
   * Controlled open state, for a host that opens the panel from its own menu
   * (the phone dashboard's Account sheet, "Help & FAQ"). Uncontrolled when
   * omitted, as on the landing page.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the round launcher, e.g. to hide it where a menu opens the panel instead. */
  launcherClassName?: string;
} = {}) {
  const { t: uiText } = useUiLanguage();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(isOpen) : next;
      if (onOpenChange) onOpenChange(value);
      else setUncontrolledOpen(value);
    },
    [isOpen, onOpenChange]
  );
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [isThinking, setIsThinking] = useState(false);
  /** Quick-question chips already asked, so only the ones still worth tapping stay on screen. */
  const [askedQuickIds, setAskedQuickIds] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thinkingTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      // Must include the toggle button itself, not just the panel -- otherwise
      // tapping it to close reads as an "outside" click, this handler closes
      // the panel first, and the button's own onClick (which runs right after)
      // toggles it straight back open.
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, isThinking]);

  useEffect(() => {
    return () => {
      if (thinkingTimeoutRef.current) window.clearTimeout(thinkingTimeoutRef.current);
    };
  }, []);

  const ask = (entry: FaqEntry) => {
    if (isThinking) return;

    setMessages((current) => [...current, { id: newId(), role: "user", text: entry.question }]);
    setIsThinking(true);

    thinkingTimeoutRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "bot", text: entry.answer },
      ]);
      setAskedQuickIds((current) => new Set(current).add(entry.id));
      setIsThinking(false);
    }, 400);
  };

  const remainingQuickQuestions = FAQ_QUICK_QUESTIONS.filter((entry) => !askedQuickIds.has(entry.id));

  return (
    // --fc-tabbar-offset is the height of a dashboard's phone tab bar when one
    // is on screen (globals.css), so the bubble sits above it instead of on it.
    <div ref={rootRef} className={`fixed bottom-[calc(1rem+var(--fc-tabbar-offset,0px))] left-3 sm:bottom-[calc(1.25rem+var(--fc-tabbar-offset,0px))] sm:left-5 ${layerClassName}`}>
      {isOpen ? (
        <div
          role="dialog"
          aria-label={uiText("FurniCraft FAQs")}
          className="absolute bottom-14 left-0 flex h-[28rem] w-[22rem] max-w-[calc(100vw-1.5rem)] sm:bottom-16 sm:max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--fc-border)] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--fc-text)]">{uiText("FurniCraft FAQs")}</p>
              <p className="truncate text-xs text-[var(--fc-muted)]">{uiText("Choose a question below")}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={uiText("Close FAQ")}
              className="shrink-0 rounded-full p-1 text-[var(--fc-muted)] transition hover:text-[var(--fc-text)] active:scale-[0.9]"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 break-words ${
                    message.role === "user"
                      ? "bg-[#8b5a2b] text-white"
                      : "bg-[rgba(178,106,56,0.1)] text-[var(--fc-text)]"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{uiText(message.text)}</p>
                </div>
              </div>
            ))}
            {isThinking ? (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-[rgba(178,106,56,0.1)] px-3 py-2 text-sm text-[var(--fc-muted)]">…</div>
              </div>
            ) : null}

            {!isThinking && remainingQuickQuestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {remainingQuickQuestions.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => ask(entry)}
                    className="inline-grid min-h-11 place-items-center rounded-full border border-[var(--fc-border)] px-3 text-xs font-medium text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.97]"
                  >
                    {uiText(entry.question)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen ? uiText("Close FAQ") : uiText("Open FAQ")}
        aria-expanded={isOpen}
        className={`${launcherClassName} grid h-12 w-12 place-items-center rounded-full bg-[#8b5a2b] text-xl font-bold sm:h-14 sm:w-14 sm:text-2xl text-white shadow-[0_10px_30px_rgba(139,90,43,0.45)] transition-transform duration-150 hover:bg-[#7a4d24] active:scale-[0.94]`}
      >
        {isOpen ? "✕" : "?"}
      </button>
    </div>
  );
}
