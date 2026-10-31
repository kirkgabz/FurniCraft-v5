"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";

/**
 * The confirmation step for actions that cost something to get wrong.
 *
 * This replaces `window.confirm`, which cannot be styled, cannot be read by the
 * page's own voice, is suppressible by the browser, and on mobile arrives as an
 * OS sheet that looks like it came from somewhere other than this product.
 *
 * It also carries the decline-reason case rather than being copied into a
 * second component: declining an order is a confirmation that happens to
 * collect a sentence, and the two would otherwise drift apart in wording and
 * keyboard behaviour.
 *
 * The confirm button names the action ("Decline order"), never "OK" -- someone
 * reading only the button should still know what is about to happen.
 */
export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  reason,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  /** Names the action, e.g. "Decline order". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for anything destructive or hard to walk back. */
  tone?: "default" | "danger";
  busy?: boolean;
  /** Present when the action must collect an explanation before it can proceed. */
  reason?: {
    label: string;
    placeholder?: string;
    /** When true the action cannot proceed on an empty reason. */
    required?: boolean;
    /** Pre-fills the field -- for naming a design already carrying a project name, not for a reason. */
    defaultValue?: string;
  };
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [reasonText, setReasonText] = useState("");

  // A reason belongs to one decision. Reopening for a different order must not
  // inherit what was typed about the last one -- but a naming field, unlike a
  // reason, may have something worth pre-filling for THIS opening, which is
  // read fresh from the render that flipped `open`, not tracked continuously.
  useEffect(() => {
    if (open) setReasonText(reason?.defaultValue ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reasonMissing = Boolean(reason?.required) && reasonText.trim().length === 0;

  return (
    <Modal open={open} onClose={onCancel} ariaLabel={uiText(title)}>
      <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-[var(--fc-text)]">{uiText(title)}</h2>
      {body ? <div className="mt-2 text-sm leading-relaxed text-[var(--fc-muted)]">{typeof body === "string" ? uiText(body) : body}</div> : null}

      {reason ? (
        <label className="mt-4 block">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">
            {uiText(reason.label)}
            {reason.required ? "" : uiText(" (optional)")}
          </span>
          <textarea
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            placeholder={reason.placeholder}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none transition-colors focus:border-[var(--fc-accent)]"
          />
        </label>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary">
          {uiText(cancelLabel)}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason ? reasonText.trim() || undefined : undefined)}
          disabled={busy || reasonMissing}
          className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
          // Says why it is unavailable rather than just looking dead.
          title={reasonMissing ? uiText("{0} is required", { 0: reason?.label }) : undefined}
        >
          {busy ? uiText("Working…") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
