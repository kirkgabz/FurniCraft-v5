/**
 * A quote's breakdown: what the customer is shown the price is made of.
 *
 * Stored on design_orders.quote_lines, which the customer can read -- unlike
 * the shop's cost sheet (order_costings), which they cannot. The two are kept
 * apart on purpose: this is the shop's PRICE, line by line, never what it
 * paid its supplier or the margin it is taking. "Use as quote" prices the
 * cost sheet with the shop's formula on the way across (pricing.ts), and the
 * shop sees and can edit every line before it is sent.
 *
 * Optional. A quote without lines is just a total, as every quote sent before
 * this existed is. When there are lines, the database insists they add up to
 * the quoted total (see the migration), so the two can never disagree.
 */
export type QuoteLine = { label: string; amount: number };

/** One-tap starting labels. Free text otherwise: a weaver and a joiner do not price under the same headings. */
export const QUOTE_LINE_CHIPS = ["Materials", "Labour", "Miscellaneous", "Finishing", "Delivery", "Discount"] as const;

/** Matches the database check. */
export const MAX_QUOTE_LINES = 20;
export const MAX_QUOTE_LABEL = 80;

/** Reads a stored or event payload value without trusting its shape. */
export function parseQuoteLines(value: unknown): QuoteLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { label, amount } = entry as { label?: unknown; amount?: unknown };
    const number = typeof amount === "number" ? amount : Number(amount);
    if (typeof label !== "string" || !label.trim() || !Number.isFinite(number)) return [];
    return [{ label: label.trim(), amount: number }];
  });
}

/** To the centavo, so 0.1 + 0.2 never shows as a peso amount nobody typed. */
export function quoteLinesTotal(lines: QuoteLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
}

/** A breakdown line while it is being typed: the amount stays text until sent. */
export type QuoteLineDraft = { id: string; label: string; amount: string };

let draftCounter = 0;
export function newQuoteLineDraft(label = "", amount = ""): QuoteLineDraft {
  draftCounter += 1;
  return { id: `ql-${Date.now().toString(36)}-${draftCounter}`, label, amount };
}

export function draftsFromLines(lines: QuoteLine[]): QuoteLineDraft[] {
  return lines.map((line) => newQuoteLineDraft(line.label, String(line.amount)));
}

/** "-1,500.50" or "₱ 2,000" to a number; NaN for anything else. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[₱,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/**
 * The drafts as lines ready to send, or what is wrong with them. Rows left
 * completely empty are ignored, so an extra blank row is never an error.
 */
export function linesFromDrafts(drafts: QuoteLineDraft[]): { lines: QuoteLine[] } | { error: string } {
  const filled = drafts.filter((draft) => draft.label.trim() || draft.amount.trim());
  if (filled.length > MAX_QUOTE_LINES) return { error: `A breakdown can have at most ${MAX_QUOTE_LINES} lines.` };
  const lines: QuoteLine[] = [];
  for (const draft of filled) {
    const label = draft.label.trim();
    const amount = parseAmount(draft.amount);
    if (!label) return { error: "Every breakdown line needs a name, like Materials or Labour." };
    if (label.length > MAX_QUOTE_LABEL) return { error: `"${label.slice(0, 24)}…" is too long for a line name.` };
    if (!Number.isFinite(amount) || amount === 0) return { error: `"${label}" needs an amount in pesos.` };
    lines.push({ label, amount: Math.round(amount * 100) / 100 });
  }
  return { lines };
}

/**
 * What a quote form sends: the breakdown's sum when it has lines, the typed
 * total when it has none. With lines the total box is read-only in the forms,
 * so the two cannot disagree on screen either.
 */
export function resolveQuote(
  typedTotal: string,
  drafts: QuoteLineDraft[]
): { total: number; lines: QuoteLine[] | null } | { error: string } {
  const parsed = linesFromDrafts(drafts);
  if ("error" in parsed) return parsed;
  if (parsed.lines.length) {
    const total = quoteLinesTotal(parsed.lines);
    if (!(total > 0)) return { error: "The breakdown has to add up to more than ₱0." };
    return { total, lines: parsed.lines };
  }
  const total = Number(typedTotal.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(total) || total <= 0) return { error: "Enter the total price for this build." };
  return { total, lines: null };
}

/**
 * Whether the quote form still says exactly what was sent: same total, same
 * downpayment, same breakdown lines in the same order. Update quote stays
 * pressed until it does not. A form that does not add up is never "the same"
 * -- that is a change, and pressing it shows what is wrong.
 */
export function quoteFormUnchanged(
  form: { typedTotal: string; drafts: QuoteLineDraft[]; percentText: string },
  sent: { quotedTotal: number | null; quoteLines: unknown; downpaymentPercent: number | null }
): boolean {
  if (sent.quotedTotal == null) return false;
  const resolved = resolveQuote(form.typedTotal, form.drafts);
  if ("error" in resolved) return false;
  const percent = Number(form.percentText.replace(/[^0-9.]/g, ""));
  if (percent !== Number(sent.downpaymentPercent)) return false;
  if (Math.round(resolved.total * 100) !== Math.round(Number(sent.quotedTotal) * 100)) return false;
  const before = parseQuoteLines(sent.quoteLines);
  const after = resolved.lines ?? [];
  return (
    before.length === after.length &&
    before.every(
      (line, index) =>
        line.label.trim() === after[index].label.trim() &&
        Math.round(line.amount * 100) === Math.round(after[index].amount * 100)
    )
  );
}

/** The total the form shows as it is being typed; null while it does not add up. */
export function draftTotal(typedTotal: string, drafts: QuoteLineDraft[]): number | null {
  const resolved = resolveQuote(typedTotal, drafts);
  return "error" in resolved ? null : resolved.total;
}
