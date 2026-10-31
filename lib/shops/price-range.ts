/**
 * A shop's price range and a customer's budget against it.
 *
 * The shop sets the range in its storefront (shops.price_range_min/max,
 * 20261101100000); the checkout and the database apply the same rule here:
 * a budget that reaches into the range is fine, one entirely below the shop's
 * lowest or entirely above its highest is sent back to be adjusted.
 */

export type PriceRange = { min: number; max: number };

/** Ranges keyed by shop id, from shops_public rows. A shop with no range is left out. */
export function rangesFrom(rows: ReadonlyArray<{ id: unknown; price_range_min?: unknown; price_range_max?: unknown }>): Record<string, PriceRange> {
  const ranges: Record<string, PriceRange> = {};
  for (const row of rows) {
    const min = Number(row.price_range_min);
    const max = Number(row.price_range_max);
    if (row.price_range_min == null || row.price_range_max == null) continue;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) continue;
    ranges[String(row.id)] = { min, max };
  }
  return ranges;
}

/** True when not one figure of the budget falls inside the shop's range. */
export function budgetMissesRange(budgetMin: number, budgetMax: number, range: PriceRange): boolean {
  if (!Number.isFinite(budgetMin) || !Number.isFinite(budgetMax)) return false;
  return budgetMax < range.min || budgetMin > range.max;
}

export function formatRange(range: PriceRange): string {
  const peso = (value: number) => `₱${Math.round(value).toLocaleString("en-PH")}`;
  return `${peso(range.min)} to ${peso(range.max)}`;
}

/** What the customer is told, the same wherever the budget is checked. */
export function rangeMessage(shopName: string, range: PriceRange): string {
  return `Your budget doesn't match ${shopName}'s price range of ${formatRange(range)}. Adjust your budget range so it reaches into it.`;
}
