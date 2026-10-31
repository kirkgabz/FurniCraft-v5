"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { LEGAL_DECK, LEGAL_LAST_UPDATED } from "./legal-content";

/**
 * The terms, read one section at a time.
 *
 * The checkbox at sign-up used to sit beside two spans styled to look like
 * links that were not links: "Terms and Conditions" and "Privacy Policy" did
 * nothing when clicked, so the only way to accept them was without having been
 * shown them. That is the failure this dialog exists to fix.
 *
 * It pages rather than scrolls, and that is the deliberate part. A single
 * scrolling wall of text is accepted by dragging a scrollbar to the bottom; a
 * deck advanced with Next arrives at each section on purpose, and the counter
 * tells the reader how much is left, which a scrollbar on a phone does not. The
 * accept button only exists on the last card, so agreeing is the end of the
 * read rather than something available from the start.
 *
 * Nothing here records anything. Acceptance is ticked back on the form, which
 * already stamps `terms_accepted_at` into the sign-up metadata.
 */
export function TermsDialog({
  open,
  startIndex = 0,
  onClose,
  onAccept,
}: {
  open: boolean;
  /** Which card to open on, so the Privacy Policy link lands on the privacy pages. */
  startIndex?: number;
  onClose: () => void;
  onAccept: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [index, setIndex] = useState(startIndex);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Reopening from a different link must land on that link's section, and a
  // reader who closes halfway should not come back to where they gave up.
  useEffect(() => {
    if (open) setIndex(startIndex);
  }, [open, startIndex]);

  // Each card starts at its own beginning; without this, turning to a shorter
  // section from a scrolled one opens it part-way down.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const section = LEGAL_DECK[index];
  const isLast = index === LEGAL_DECK.length - 1;
  const isFirst = index === 0;

  if (!section) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={uiText("Terms and Conditions and Privacy Policy")}
      className="sm:max-w-xl"
      bodyClassName="p-0 sm:p-0"
      // Reading this is a condition of opening an account, so the deck has no
      // exit but its own last card: no close control in the header, and a
      // stray click on the scrim does not dismiss a document somebody is about
      // to certify they have read. Escape still works -- that is the safety
      // valve for a keyboard user and for anyone who opened this by accident,
      // and it leaves the checkbox unticked, so it skips nothing.
      dismissOnBackdrop={false}
    >
      <div className="flex min-h-0 flex-col">
        <header className="border-b border-[var(--fc-border)] p-5 sm:p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
              {uiText(section.doc)}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold leading-tight text-[var(--fc-text)]">
              {uiText(section.title)}
            </h2>
          </div>
          {/* One tick per section: how long this is, and how far in you are. */}
          <ol className="mt-4 flex items-center gap-1.5" aria-hidden="true">
            {LEGAL_DECK.map((s, i) => (
              <li
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-[background-color] duration-200 ${
                  i <= index ? "bg-[var(--fc-ink-accent)]" : "bg-[var(--fc-border)]"
                }`}
              />
            ))}
          </ol>
        </header>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"
          // Paging changes the content underneath a reader who is not looking
          // at it; announcing it is the difference between a screen-reader user
          // hearing the next section and hearing nothing happen.
          aria-live="polite"
        >
          {section.body.map((paragraph, i) => (
            <p
              key={i}
              className="text-sm leading-relaxed text-[var(--fc-text)] [&:not(:first-child)]:mt-4"
            >
              {uiText(paragraph)}
            </p>
          ))}
          {/* On the last card only, beside the button that accepts it: the
              revision date matters at the moment you agree to a version, not
              nine times on the way there. */}
          {isLast && (
            <p className="mt-6 border-t border-[var(--fc-border)] pt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--fc-muted)]">{uiText("Last updated ")}{uiText(LEGAL_LAST_UPDATED)}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--fc-border)] p-4 sm:px-6">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={isFirst}
            className="min-h-[44px] rounded border border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform,opacity] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >{uiText("Back")}</button>

          <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--fc-muted)]" data-numeric>
            {index + 1} / {LEGAL_DECK.length}
          </p>

          {isLast ? (
            <button
              type="button"
              onClick={onAccept}
              className="min-h-[44px] rounded bg-[var(--fc-btn)] px-5 text-sm font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98]"
            >{uiText("Accept and continue")}</button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(LEGAL_DECK.length - 1, i + 1))}
              className="min-h-[44px] rounded bg-[var(--fc-btn)] px-5 text-sm font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98]"
            >{uiText("Next")}</button>
          )}
        </footer>

        {isLast ? (
          <div className="border-t border-[var(--fc-border)] px-4 pb-4 pt-3 text-center sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-semibold text-[var(--fc-muted)] underline decoration-dotted underline-offset-4 transition-[opacity] duration-150 hover:opacity-75"
            >{uiText("Close without accepting")}</button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
