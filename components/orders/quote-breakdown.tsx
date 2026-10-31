"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { AdaptiveText } from "@/components/language/adaptive-text";


import { formatPeso } from "@/components/orders/order-status";
import { IconClose, IconPlus } from "@/components/solihiya/icons";
import {
  MAX_QUOTE_LABEL,
  MAX_QUOTE_LINES,
  QUOTE_LINE_CHIPS,
  newQuoteLineDraft,
  parseAmount,
  type QuoteLine,
  type QuoteLineDraft,
} from "@/components/orders/quote-lines";

/** A discount shows as money off, not as a negative price. */
function lineAmount(amount: number): string {
  return amount < 0 ? `−${formatPeso(-amount)}` : formatPeso(amount);
}

/**
 * What the price is made of, line by line. Shown above the total wherever the
 * customer reads a quote; renders nothing for a quote sent without one.
 */
export function QuoteBreakdownList({ lines, className = "" }: { lines: QuoteLine[]; className?: string }) {
  const { t: uiText } = useUiLanguage();
  if (!lines.length) return null;
  return (
    <div className={className}>
      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">{uiText("Breakdown")}</p>
      <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
        {lines.map((line, index) => (
          <li key={`${index}-${line.label}`} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 text-[var(--fc-text)]"><AdaptiveText text={line.label} plain /></span>
            {/* A dotted leader carries the eye from the name to its amount on a wide card. */}
            <span aria-hidden className="mb-1 hidden min-w-4 flex-1 border-b border-dotted border-[var(--fc-border)] sm:block" />
            <span
              className={`shrink-0 tabular-nums ${amountTone(line.amount)}`}
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {lineAmount(line.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function amountTone(amount: number): string {
  return amount < 0 ? "font-semibold text-fc-online" : "font-semibold text-[var(--fc-text)]";
}

/**
 * The shop's side: one row per line, a name and an amount, with chips for the
 * usual headings. Edits drafts the parent owns, so the quote form decides when
 * they are valid and what the total is.
 */
export function QuoteLinesEditor({
  drafts,
  onChange,
}: {
  drafts: QuoteLineDraft[];
  onChange: (next: QuoteLineDraft[]) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const update = (id: string, patch: Partial<QuoteLineDraft>) =>
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  const remove = (id: string) => onChange(drafts.filter((draft) => draft.id !== id));
  const add = (label = "") => {
    if (drafts.length >= MAX_QUOTE_LINES) return;
    // A discount starts with its minus sign, so it is typed as money off.
    onChange([...drafts, newQuoteLineDraft(label, label === "Discount" ? "-" : "")]);
  };
  const used = new Set(drafts.map((draft) => draft.label.trim()));

  return (
    <div>
      {drafts.length ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {drafts.map((draft, index) => {
            const amount = parseAmount(draft.amount);
            const bad = draft.amount.trim() !== "" && draft.amount.trim() !== "-" && !Number.isFinite(amount);
            return (
              <li key={draft.id} className="flex items-center gap-1.5">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{uiText("Line ")}{index + 1}{uiText(" name")}</span>
                  <input
                    type="text"
                    value={draft.label}
                    maxLength={MAX_QUOTE_LABEL}
                    placeholder={uiText("e.g. Narra hardwood")}
                    onChange={(event) => update(draft.id, { label: event.target.value })}
                    className="w-full rounded-lg border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2.5 py-2 text-base text-[var(--fc-text)] outline-none transition-colors focus:border-[var(--fc-accent)] sm:text-sm"
                  />
                </label>
                <label className="w-[6.75rem] shrink-0">
                  <span className="sr-only">{uiText("Line ")}{index + 1}{uiText(" amount in pesos")}</span>
                  <span
                    className={`flex items-center rounded-lg border bg-[var(--fc-bg)] transition-colors focus-within:border-[var(--fc-accent)] ${
                      bad ? "border-fc-danger" : "border-[var(--fc-border)]"
                    }`}
                  >
                    <span aria-hidden className="pl-2 text-sm text-[var(--fc-muted)]">₱</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.amount}
                      placeholder="0"
                      aria-invalid={bad}
                      onChange={(event) => update(draft.id, { amount: event.target.value })}
                      className="w-full min-w-0 bg-transparent px-1.5 py-2 text-right text-base tabular-nums text-[var(--fc-text)] outline-none sm:text-sm"
                    />
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => remove(draft.id)}
                  aria-label={uiText("Remove {0}", { 0: draft.label.trim() || `line ${index + 1}` })}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--fc-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--fc-cane-soft)] hover:text-[var(--fc-text)] active:scale-[0.94] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                >
                  <IconClose aria-hidden className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUOTE_LINE_CHIPS.filter((chip) => !used.has(chip)).map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => add(chip)}
            disabled={drafts.length >= MAX_QUOTE_LINES}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--fc-border)] px-2.5 py-1 text-xs font-semibold text-[var(--fc-text)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--fc-accent)] hover:bg-[var(--fc-cane-soft)] active:scale-[0.97] disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
          >
            <IconPlus aria-hidden className="h-3 w-3" />
            {uiText(chip)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => add()}
          disabled={drafts.length >= MAX_QUOTE_LINES}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--fc-border)] px-2.5 py-1 text-xs font-semibold text-[var(--fc-muted)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--fc-accent)] hover:text-[var(--fc-text)] active:scale-[0.97] disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
        >
          <IconPlus aria-hidden className="h-3 w-3" />{uiText("Other line")}</button>
      </div>
    </div>
  );
}
