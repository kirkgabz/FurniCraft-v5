"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconMore } from "@/components/solihiya/icons";
import { MESSAGE_REACTIONS } from "@/lib/message-reactions";

/** A visible trigger and a viewport-bound tray, clear of the thread's clipping. */
export function MessageActions({ open, onOpenChange, onReact, onReport, selected, disabled, isMine }: {
  open: boolean; onOpenChange: (open: boolean) => void; onReact: (emoji: string) => void;
  onReport?: () => void; selected?: string; disabled?: boolean; isMine: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = Math.min(344, window.innerWidth - 16);
    setPosition({ left: Math.max(8, Math.min(anchor.left - width / 2, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(anchor.top >= 68 ? anchor.top - 60 : anchor.bottom + 8, window.innerHeight - 60)) });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onOpenChange(false); trigger.current?.focus({ preventScroll: true }); }
    };
    const close = () => onOpenChange(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key);
      window.removeEventListener("resize", close); document.removeEventListener("scroll", close, true);
    };
  }, [open, onOpenChange]);
  const finish = (action: () => void) => { onOpenChange(false); trigger.current?.focus({ preventScroll: true }); action(); };
  return <>
    <button ref={trigger} type="button" aria-label={uiText("Message options")} aria-haspopup="true" aria-expanded={open}
      onClick={() => onOpenChange(!open)}
      className={`absolute top-0 grid h-9 w-9 place-items-center rounded-full text-[var(--fc-muted)] hover:bg-[var(--fc-cane-soft)] focus-visible:outline focus-visible:outline-2 ${isMine ? "-left-9" : "-right-9"}`}>
      <IconMore aria-hidden className="h-5 w-5" />
    </button>
    {open ? createPortal(
      <div ref={menu} role="toolbar" aria-label={uiText("Message actions")} style={position}
        className="fixed z-[49] flex w-[min(21.5rem,calc(100vw-1rem))] items-center justify-between gap-0.5 rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] p-1.5 text-[var(--fc-text)] shadow-xl">
        {MESSAGE_REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={uiText("React {0}", { 0: emoji })} aria-pressed={selected === emoji}
          disabled={disabled} onClick={() => finish(() => onReact(emoji))}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg hover:bg-[var(--fc-cane-soft)] aria-pressed:bg-[var(--fc-cane-soft)] disabled:opacity-40">{emoji}</button>)}
        {onReport ? <button type="button" onClick={() => finish(onReport)}
          className="min-h-9 border-l border-[var(--fc-border)] px-2 text-xs font-semibold text-[var(--fc-danger)]">{uiText("Report")}</button> : null}
      </div>, document.body) : null}
  </>;
}
