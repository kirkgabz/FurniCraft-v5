/**
 * The terms a customer should have read before commissioning a piece, and what
 * to show when a shop has not written any yet.
 *
 * The distinction between the two is the whole point of this file. A shop's own
 * policies are a commercial commitment by that business. The fallback below is
 * not: it is FurniCraft's standard terms, and it is always labelled as such
 * wherever it appears. Rendering it under a shop's name as though the shop had
 * agreed to a 50% deposit and a four-week lead time would be inventing a
 * contract for a real furniture shop, and a customer who acted on it would have been
 * misled by us. So the fallback is presented as the platform's baseline, and a
 * shop adopts it only by opening the editor and saving it as their own.
 */

/**
 * The baseline shown when a shop has published nothing.
 *
 * Written to be true of nearly any made-to-order furniture shop and deliberately
 * unspecific where a real shop must decide: it gives ranges and "unless the
 * shop states otherwise" rather than numbers a customer could hold anyone to.
 * A shop that wants firm terms is expected to replace it.
 */
export const DEFAULT_SHOP_POLICIES = `Deposit
A deposit is usually required before work begins on a made-to-order piece, with the balance due before delivery or collection. The shop confirms the amount with you in your quote.

Lead time
Custom furniture is built to order, so it is not held in stock. Expect several weeks between an accepted quote and a finished piece, depending on the design and the shop's current queue.

Changes and cancellation
You may cancel without charge until you have paid. Once payment is made and work has started, materials may already be cut — from that point a cancellation may not be refundable in full. Ask before requesting a change mid-build.

Materials
Timber, cane and fabric are natural materials. Grain, colour and figure vary between pieces, so the finished item will differ slightly from the render you approved. That variation is normal and is not a defect.

Delivery
Delivery, collection and any assembly are arranged directly with the shop.

Warranty
Workmanship is generally covered against defects for a period the shop will state. Damage from misuse, alteration or ordinary wear is not covered.`;

/** True when the shop has published terms of its own. */
export function hasOwnPolicies(policies: string | null | undefined): boolean {
  return typeof policies === "string" && policies.trim().length > 0;
}

/**
 * What to display, and whether it belongs to the shop.
 *
 * Callers must use `isShopAuthored` to label the text. It is the only thing
 * standing between "these are the terms this furniture shop offers" and "these are
 * the terms the platform suggests when a furniture shop has not said".
 */
export function resolveShopPolicies(policies: string | null | undefined): {
  text: string;
  isShopAuthored: boolean;
} {
  return hasOwnPolicies(policies)
    ? { text: policies!.trim(), isShopAuthored: true }
    : { text: DEFAULT_SHOP_POLICIES, isShopAuthored: false };
}

/**
 * Which shops the customer has recently been shown terms for, kept per browser.
 *
 * Deliberately local rather than a column on the account. Getting this wrong in
 * the annoying direction -- showing the dialog again after a cache clear --
 * costs one dismissal; getting it wrong in the other direction would mean
 * writing a row on every shop a customer merely clicked. It is a courtesy that
 * suppresses a repeat popup, not a record that anyone agreed to anything.
 *
 * It expires. Suppressing the dialog forever was wrong in a way that only
 * showed up once customers started shopping around: someone who compared four
 * shops in one sitting saw four different sets of deposits and lead times,
 * then went back to the second shop a week later with the third shop's terms
 * in their head and nothing on screen to correct them. Deposits and lead times
 * are the terms that decide whether you want a shop at all, so on returning to
 * a shop after a break they are worth a second look -- while a customer still
 * mid-comparison, clicking between shops minutes apart, is not told the same
 * thing twice.
 *
 * An hour is the line between those two. It is long enough to cover a single
 * sitting of browsing and short enough that a later visit counts as a return.
 */
const SEEN_KEY = "furnicraft:policies-seen";

/** How long an acknowledgement suppresses the dialog for that shop. */
export const POLICIES_SEEN_TTL_MS = 60 * 60 * 1000;

type SeenMap = Record<string, number>;

/**
 * Reads the store, tolerating anything.
 *
 * The value used to be a plain array of shop ids with no times. Those are read
 * as "seen, but we do not know when", which expires them immediately -- the
 * customer sees the terms once more on their next visit to that shop, which is
 * the harmless direction and is what this change is for anyway.
 */
function readSeen(): SeenMap {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const seen: SeenMap = {};
    for (const [shopId, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) seen[shopId] = at;
    }
    return seen;
  } catch {
    // A blocked or full localStorage must not stop a shop being selected.
    return {};
  }
}

export function hasSeenPolicies(shopId: string, now: number = Date.now()): boolean {
  const at = readSeen()[shopId];
  if (typeof at !== "number") return false;
  // A clock that has moved backwards (a timezone fix, a manual correction)
  // would otherwise suppress the dialog for as long as the clock is wrong.
  if (at > now) return false;
  return now - at < POLICIES_SEEN_TTL_MS;
}

export function markPoliciesSeen(shopId: string, now: number = Date.now()): void {
  try {
    const seen = readSeen();
    seen[shopId] = now;

    // Capped, so a customer who browses hundreds of shops does not grow this
    // without bound. The oldest acknowledgement is the one worth forgetting,
    // and anything already expired is dropped on the way past.
    const kept = Object.entries(seen)
      .filter(([, at]) => now - at < POLICIES_SEEN_TTL_MS)
      .sort((a, b) => a[1] - b[1])
      .slice(-200);

    window.localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Nothing to do: the dialog simply shows again next time.
  }
}
