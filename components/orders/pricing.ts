import { formatPeso } from "@/components/orders/order-status";
import { FALLBACK_COST_GROUP, lineTotal, type CostLine } from "@/components/orders/costing";
import type { QuoteLine } from "@/components/orders/quote-lines";

/**
 * How a shop turns what a piece costs it into the price it quotes.
 *
 * Shops do not all price the same way. One adds a markup to the total; Sir
 * Mark adds up materials, labour and miscellaneous and doubles it; another
 * doubles materials but charges labour at cost. The cost sheet used to know
 * only the first, as a percentage typed on every order. This is all three, set
 * once per shop (shop_pricing) and overridable on one order (order_costings).
 *
 * Private. Nothing here reaches the customer except the prices it produces:
 * the multiplier is the shop's margin, and lives in shop-only tables.
 */
export type PricingFormula =
  | { method: "markup"; percent: number }
  | { method: "multiply"; factor: number }
  | { method: "per_group"; factors: Record<string, number>; otherFactor: number };

/** What the customer's breakdown lists: one line per group, or every cost line. */
export type BreakdownView = "groups" | "lines";

/** The groups every sheet offers; a shop can add its own beside them. */
export const DEFAULT_COST_GROUPS = ["Materials", "Labour", "Miscellaneous"] as const;

export const DEFAULT_FORMULA: PricingFormula = { method: "markup", percent: 35 };

/** Pesos as written on paper: no centavos when there are none. */
function peso(value: number): string {
  return formatPeso(value).replace(/\.00$/, "");
}

function finite(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Reads a stored formula without trusting its shape; null when unusable. */
export function parseFormula(value: unknown): PricingFormula | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.method === "markup") {
    const percent = finite(row.percent, Number.NaN);
    return Number.isFinite(percent) && percent >= 0 ? { method: "markup", percent } : null;
  }
  if (row.method === "multiply") {
    const factor = finite(row.factor, Number.NaN);
    return Number.isFinite(factor) && factor > 0 ? { method: "multiply", factor } : null;
  }
  if (row.method === "per_group") {
    const factors: Record<string, number> = {};
    if (row.factors && typeof row.factors === "object") {
      for (const [group, raw] of Object.entries(row.factors as Record<string, unknown>)) {
        const factor = finite(raw, Number.NaN);
        if (group.trim() && Number.isFinite(factor) && factor > 0) factors[group.trim()] = factor;
      }
    }
    const otherFactor = finite(row.otherFactor, 1);
    return { method: "per_group", factors, otherFactor: otherFactor > 0 ? otherFactor : 1 };
  }
  return null;
}

export function parseBreakdownView(value: unknown): BreakdownView {
  return value === "lines" ? "lines" : "groups";
}

/** The multiplier a group's cost is charged at under this formula. */
export function factorFor(formula: PricingFormula, group: string): number {
  if (formula.method === "markup") return 1 + formula.percent / 100;
  if (formula.method === "multiply") return formula.factor;
  return formula.factors[group] ?? formula.otherFactor;
}

/** "× 2", "× 1.5" -- how a shop says it out loud. */
export function factorLabel(factor: number): string {
  return `× ${Number(factor.toFixed(2))}`;
}

/** One line in a few words, for "Your shop prices by …". */
export function describeFormula(formula: PricingFormula): string {
  if (formula.method === "markup") return `${Number(formula.percent.toFixed(2))}% markup on the cost`;
  if (formula.method === "multiply") return `Cost ${factorLabel(formula.factor)}`;
  const parts = Object.entries(formula.factors).map(([group, factor]) => `${group} ${factorLabel(factor)}`);
  return parts.length ? `${parts.join(", ")}; anything else ${factorLabel(formula.otherFactor)}` : `Each group ${factorLabel(formula.otherFactor)}`;
}

/** The sheet's groups in a stable order: the defaults first, then the shop's own, as they appear. */
export function groupsOf(lines: CostLine[]): string[] {
  const seen = new Set<string>(DEFAULT_COST_GROUPS);
  const extra: string[] = [];
  for (const line of lines) {
    const group = line.group || FALLBACK_COST_GROUP;
    if (!seen.has(group)) {
      seen.add(group);
      extra.push(group);
    }
  }
  return [...DEFAULT_COST_GROUPS, ...extra];
}

export type PricedGroup = { group: string; cost: number; factor: number; price: number };

export type PricedSheet = {
  cost: number;
  price: number;
  /** Groups with something in them, in groupsOf order. */
  groups: PricedGroup[];
  /** The sum written the way the shop would write it on paper. */
  workingOut: string;
};

/**
 * The sheet priced by the formula.
 *
 * Whole pesos, rounded up, as the markup-only sheet always did: a suggestion a
 * few centavos under the margin asked for invites a quote that misses it. A
 * single-factor formula is applied to the total and the groups are then
 * shared out of it, with the last group taking the rounding, so the groups add
 * up to exactly the price; per-group pricing rounds each group up on its own.
 */
export function priceSheet(lines: CostLine[], formula: PricingFormula): PricedSheet | null {
  const byGroup = new Map<string, number>();
  for (const line of lines) {
    const cost = lineTotal(line);
    if (!(cost > 0)) continue;
    const group = line.group || FALLBACK_COST_GROUP;
    byGroup.set(group, (byGroup.get(group) ?? 0) + cost);
  }
  const ordered = groupsOf(lines).filter((group) => (byGroup.get(group) ?? 0) > 0);
  if (!ordered.length) return null;
  const cost = ordered.reduce((sum, group) => sum + (byGroup.get(group) ?? 0), 0);

  if (formula.method === "per_group") {
    const groups = ordered.map((group) => {
      const groupCost = byGroup.get(group) ?? 0;
      const factor = factorFor(formula, group);
      return { group, cost: groupCost, factor, price: Math.ceil(groupCost * factor) };
    });
    const price = groups.reduce((sum, group) => sum + group.price, 0);
    const working = groups.map((group) => `${peso(group.cost)} ${factorLabel(group.factor)}`).join(" + ");
    return { cost, price, groups, workingOut: `${working} = ${peso(price)}` };
  }

  const factor = factorFor(formula, "");
  const price = Math.ceil(cost * factor);
  const groups = ordered.map((group) => {
    const groupCost = byGroup.get(group) ?? 0;
    return { group, cost: groupCost, factor, price: Math.round(groupCost * factor) };
  });
  groups[groups.length - 1].price += price - groups.reduce((sum, group) => sum + group.price, 0);
  const sum = ordered.map((group) => peso(byGroup.get(group) ?? 0)).join(" + ");
  const summed = ordered.length > 1 ? `(${sum})` : sum;
  const workingOut =
    formula.method === "multiply"
      ? `${summed} ${factorLabel(formula.factor)} = ${peso(price)}`
      : `${summed} + ${Number(formula.percent.toFixed(2))}% = ${peso(price)}`;
  return { cost, price, groups, workingOut };
}

/**
 * The customer's breakdown for a priced sheet: one line per group (Sir Mark's
 * "Materials, Labour, Miscellaneous"), or every cost line at its group's rate.
 * Either way the lines add up to exactly the sheet's price.
 */
export function quoteLinesFromSheet(
  lines: CostLine[],
  priced: PricedSheet,
  view: BreakdownView
): QuoteLine[] {
  if (view === "groups") {
    return priced.groups.filter((group) => group.price !== 0).map((group) => ({ label: group.group, amount: group.price }));
  }
  const costed = lines.filter((line) => lineTotal(line) > 0);
  const out: QuoteLine[] = [];
  for (const group of priced.groups) {
    const members = costed.filter((line) => (line.group || FALLBACK_COST_GROUP) === group.group);
    const share = group.price / group.cost;
    const priced_ = members.map((line) => ({
      label: (line.qty !== 1 ? `${line.label.trim() || group.group} × ${line.qty}` : line.label.trim() || group.group).slice(0, 80),
      amount: Math.round(lineTotal(line) * share),
    }));
    if (priced_.length) priced_[priced_.length - 1].amount += group.price - priced_.reduce((sum, line) => sum + line.amount, 0);
    out.push(...priced_);
  }
  return out.filter((line) => line.amount !== 0);
}
