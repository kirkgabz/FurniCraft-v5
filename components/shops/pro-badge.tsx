"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";

/** What the badge means, said once so the tooltip and the tapped note agree. */
const MEANING = "This shop is a FurniCraft Pro member.";

/**
 * "Pro", beside a shop's name.
 *
 * It says the shop subscribes to FurniCraft Pro and nothing more -- not
 * verified, not top-rated, not vouched for. Pro buys photo-to-3D generations;
 * a badge worded as a judgement of the furniture shop would tell a customer
 * something the platform has not checked. Approval (BIR and ID) is a
 * separate fact, and every listed shop has it.
 *
 * A button rather than a bare label, because a tooltip never appears under a
 * finger: hovering shows the meaning on a desktop, tapping shows it on a
 * phone, and a tap anywhere else puts it away. No star beside the word: stars
 * on this page are ratings, and Pro is not one.
 */
export function ProBadge({ interactive = true }: { interactive?: boolean }) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!interactive) {
    return (
      <span
        title={uiText(MEANING)}
        aria-label={uiText("Pro. {0}", { 0: uiText(MEANING) })}
        className="inline-flex shrink-0 items-center rounded-full border border-[#c9a24a] bg-[linear-gradient(135deg,#f6e2a8,#d9b25b)] px-2 py-0.5 text-[10px] font-bold uppercase leading-normal tracking-[0.14em] text-[#4a3410]"
      >{uiText("Pro")}</span>
    );
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={uiText(MEANING)}
        aria-expanded={open}
        aria-label={uiText("Pro. {0}", { 0: uiText(MEANING) })}
        className="inline-flex min-h-8 items-center rounded-full border border-[#c9a24a] bg-[linear-gradient(135deg,#f6e2a8,#d9b25b)] px-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#4a3410] shadow-[0_1px_0_rgba(255,255,255,0.4)_inset] transition-transform duration-150 active:scale-[0.96]"
      >{uiText("Pro")}</button>
      {open ? (
        <span
          role="status"
          className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-xs font-medium normal-case tracking-normal text-[var(--fc-text)] shadow-lg"
        >
          {uiText(MEANING)}
        </span>
      ) : null}
    </span>
  );
}
