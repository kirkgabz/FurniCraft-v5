/**
 * A shop's photo-to-3D allowance, as the shop should read it.
 *
 * Shared by the server page, which reads the subscription row, and the client,
 * which re-reads it after a refund -- so it cannot live in either one's
 * module. Display only: the database decides what a shop may actually spend
 * (consume_generation), whatever this says.
 */

/** The columns of `shop_subscriptions` this reads. */
export type SubscriptionRow = {
  tier?: string | null;
  period_end?: string | null;
  generations_used?: number | null;
  generations_limit?: number | null;
  trial_used?: boolean | null;
};

export const SUBSCRIPTION_COLUMNS = "tier, period_end, generations_used, generations_limit, trial_used";

/**
 * What each kind of photo-to-3D generation takes from a Pro shop's allowance.
 *
 * Mirrors `generation_cost` in the database (20260927000100), which is what
 * actually charges the shop. High detail is 3 because its Meshy bill is
 * nearly three times a quick one's: 40 credits textured against 15.
 */
export const GENERATION_COST = { quick: 1, detailed: 3 } as const;

export type Allowance = {
  /** Pro and not lapsed -- derived, never stored; see 20260910000100. */
  onPro: boolean;
  used: number;
  limit: number;
  periodEnd: string | null;
  trialUsed: boolean;
};

export function toAllowance(row: SubscriptionRow, now: number): Allowance {
  const periodEnd = row.period_end ?? null;
  return {
    onPro: row.tier === "pro" && periodEnd !== null && new Date(periodEnd).getTime() > now,
    used: row.generations_used ?? 0,
    limit: row.generations_limit ?? 0,
    periodEnd,
    trialUsed: row.trial_used === true,
  };
}

/**
 * Pinned to the shops' own time zone, so the server's render and the
 * browser's hydration print the same date and cannot disagree across
 * midnight UTC.
 */
const RESET_DATE = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" });

export function describeAllowance(allowance: Allowance | null): { text: string; canGenerate: boolean } {
  if (!allowance) {
    // Unknown, not zero: refusing here would stop a shop over a failed read,
    // and the generation route enforces the real allowance regardless.
    return { text: "Your allowance couldn't be read just now, but you can still try.", canGenerate: true };
  }
  if (allowance.onPro) {
    const left = Math.max(0, allowance.limit - allowance.used);
    const resets = allowance.periodEnd ? ` Resets ${RESET_DATE.format(new Date(allowance.periodEnd))}.` : "";
    return {
      text: `${left} of ${allowance.limit} photo generations left this period.${resets}`,
      canGenerate: left > 0,
    };
  }
  return allowance.trialUsed
    ? { text: "Your free trial generation has been used. Pro adds 15 generations every 30 days.", canGenerate: false }
    : { text: "You have one free trial generation.", canGenerate: true };
}
