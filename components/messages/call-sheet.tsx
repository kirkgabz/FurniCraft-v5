"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useState } from "react";

import { IconPhone } from "@/components/solihiya/icons";
import { useModalA11y } from "@/components/ui/modal";

/**
 * What the header's call button opens.
 *
 * The button used to set `window.location.href = "tel:..."` directly, which on
 * a phone opens the dialler and on a desktop browser does nothing visible at
 * all -- the button simply appeared broken, which is what it was reported as.
 * A sheet works everywhere: on a phone "Call" still hands off to the dialler,
 * and on a desktop the number is on screen to read, copy, or type into the
 * handset sitting next to it.
 */
export default function CallSheet({
  name,
  phone,
  onClose,
}: {
  name: string;
  /** null when the shop has published no number; the sheet says so plainly. */
  phone: string | null;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [copied, setCopied] = useState(false);
  const panelRef = useModalA11y(true, onClose);

  const copy = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright (an insecure origin, a
      // permission the browser never asked about). The number is already on
      // screen to read, so this is not worth an error message.
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={uiText("Call {0}", { 0: name })}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        /* pb clears the home indicator: this is pinned to the bottom edge on a
           phone, so without it "Close" sits under the system gesture area. */
        className="w-full max-w-sm rounded-t-3xl bg-[var(--fc-panel)] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center shadow-xl outline-none sm:rounded-3xl sm:pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        <span
          className="mx-auto grid h-14 w-14 place-items-center rounded-full"
          style={{ background: "rgba(178,106,56,0.12)", color: "var(--fc-ink-accent)" }}
        >
          <IconPhone aria-hidden className="h-6 w-6" />
        </span>

        <h3 className="mt-3 text-lg font-semibold text-[var(--fc-text)]">{name}</h3>

        {phone ? (
          <>
            <p className="mt-1 text-xl font-semibold tracking-wide text-[var(--fc-ink-accent)]">{phone}</p>
            <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("Calls go through your own phone line. FurniCraft does not place or record the call.")}</p>

            <div className="mt-5 grid gap-2">
              <a
                href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                className="rounded-full bg-[var(--fc-ink-accent)] px-4 py-3 text-sm font-semibold text-white active:scale-[0.98]"
              >{uiText("Call now")}</a>
              <button
                type="button"
                onClick={copy}
                className="rounded-full border border-[var(--fc-border)] px-4 py-3 text-sm font-semibold text-[var(--fc-text)] active:scale-[0.98]"
              >
                {copied ? uiText("Copied") : uiText("Copy number")}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--fc-muted)]">
            {name}{uiText(" has not published a phone number. Send a message here instead -- it reaches the same person.")}</p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 inline-grid min-h-11 w-full place-items-center px-4 text-sm font-medium text-[var(--fc-muted)] transition-transform active:scale-[0.98]"
        >{uiText("Close")}</button>
      </div>
    </div>
  );
}
