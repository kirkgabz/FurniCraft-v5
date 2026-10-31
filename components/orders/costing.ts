/**
 * The arithmetic behind a shop's cost sheet for one order.
 *
 * Kept apart from the component so it can be tested without a browser, and
 * because the two numbers this produces are the ones a shop makes decisions
 * on. A cost sheet that quietly rounds the wrong way, or calls a markup a
 * margin, is worse than no cost sheet: it is wrong with authority.
 *
 * Nothing here is stored. The lines the owner typed are; every total below is
 * worked out at the moment it is shown, so a summary can never disagree with
 * the lines above it.
 */

export type CostLine = {
  id: string;
  /** What the money went on. Free text -- see the migration for why. */
  label: string;
  qty: number;
  unitCost: number;
  /**
   * Which part of the price this cost belongs to -- Materials, Labour,
   * Miscellaneous, or a heading the shop made up. The pricing formula can
   * charge each group at its own rate (see pricing.ts). Lines saved before
   * groups existed read back under Materials.
   */
  group: string;
};

/** Where a line saved before groups existed goes. */
export const FALLBACK_COST_GROUP = "Materials";

/** The headings most shops reach for, offered as a starting point only. */
export const COMMON_COST_LABELS = [
  "Materials",
  "Hardware",
  "Labour",
  "Finishing",
  "Delivery",
  "Other",
] as const;

/** Guards against a stray Infinity or NaN reaching a total. */
function finite(value: unknown): number {
  const asNumber = typeof value === "number" ? value : Number(value);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

/**
 * Reads whatever came back from jsonb into lines that can be added up.
 *
 * Defensive because this is a jsonb column: the shape is whatever was written
 * the last time, including by a version of this file that no longer exists.
 * Anything unrecognisable becomes an empty sheet rather than a crash on a page
 * the shop needs for something else.
 */
export function parseLines(value: unknown): CostLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    return [
      {
        id: typeof row.id === "string" && row.id ? row.id : cryptoId(),
        label: typeof row.label === "string" ? row.label : "",
        qty: finite(row.qty),
        unitCost: finite(row.unitCost),
        group: typeof row.group === "string" && row.group.trim() ? row.group.trim() : FALLBACK_COST_GROUP,
      },
    ];
  });
}

/** Ids only have to be unique within one sheet, and never leave it. */
export function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyLine(label = "", group: string = FALLBACK_COST_GROUP): CostLine {
  return { id: cryptoId(), label, qty: 1, unitCost: 0, group };
}

export function lineTotal(line: CostLine): number {
  return finite(line.qty) * finite(line.unitCost);
}

export function costTotal(lines: CostLine[]): number {
  return lines.reduce((total, line) => total + lineTotal(line), 0);
}

/**
 * What the shop keeps, against the price the customer was actually quoted.
 *
 * `marginPercent` is a margin -- profit as a share of the PRICE -- not a
 * markup, which is profit as a share of the cost. They are different numbers
 * for the same job (a piece costing 10,000 sold at 15,000 is a 50% markup and
 * a 33% margin) and confusing them is how a shop talks itself into a price
 * that does not cover its own wages. The two are named apart everywhere here
 * for that reason.
 *
 * Null when there is no quote yet, or when the quote is zero: there is no
 * share of nothing, and 0 would read as "no profit" rather than "not priced".
 */
export function marginOf(
  quotedTotal: number | null | undefined,
  cost: number
): { profit: number; marginPercent: number | null } | null {
  if (quotedTotal == null) return null;
  const price = finite(quotedTotal);
  const profit = price - cost;
  return { profit, marginPercent: price === 0 ? null : (profit / price) * 100 };
}

/**
 * A price that would earn `markupPercent` on top of what the piece costs.
 *
 * Rounded up to the peso: a suggestion that lands on 12,499.60 invites the
 * shop to quote 12,499 and be a few centavos short of the margin it just
 * asked for.
 */
export function suggestPrice(cost: number, markupPercent: number | null | undefined): number | null {
  if (markupPercent == null) return null;
  const markup = finite(markupPercent);
  if (markup < 0) return null;
  return Math.ceil(cost * (1 + markup / 100));
}

/**
 * Whether a sheet is worth saving.
 *
 * A line with no label and no money in it is a row the owner tabbed past, not
 * a cost. Saving those would fill the sheet with blanks on every reopen.
 */
export function isMeaningful(line: CostLine): boolean {
  return line.label.trim().length > 0 || lineTotal(line) !== 0;
}
