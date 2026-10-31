import type { StudioDesignItem } from "./studio-design-state";
import { originShopOf, quantityOf } from "./studio-design-state";

/**
 * The pieces a customer has designed but not yet sent to a shop.
 *
 * A commission is rarely one object, and it is not always one furniture shop.
 * Someone furnishing a room designs a table, six chairs to match it, and a
 * sideboard -- and the shop that does the best rattan is not the shop that
 * mills narra. So a line carries the furniture shop it is destined for, the cart
 * groups itself by that, and checkout sends one order per shop.
 *
 * One order per shop rather than one order spanning several is not a
 * simplification: every stage after this point -- the quote, the downpayment,
 * production, the chat thread, a refund -- is a conversation with one
 * furniture shop about its own work. An order belonging to two shops would have to
 * be quoted twice and paid twice, which is two orders wearing one name.
 *
 * It lives in localStorage rather than the database on purpose. A cart is not a
 * commitment: nothing here has been offered to a shop, nothing has been priced
 * by anyone, and a half-designed chair abandoned on a Tuesday should not become
 * a row somebody has to clean up. It becomes real at checkout, in one insert.
 */

const CART_KEY = "furnicraft:design-cart";

/** The pre-cart key. Folded in once, so an in-flight order is not stranded. */
const LEGACY_PENDING_KEY = "pending-furniture-order";

/**
 * Enough for a dining set and a sideboard, and far short of what would fill the
 * storage quota with preview images.
 */
export const MAX_CART_LINES = 12;

export type CartLine = {
  /** Stable per line, so removing one does not disturb the identity of the rest. */
  id: string;
  /** What to build. Carries its own quantity; read it with quantityOf. */
  item: StudioDesignItem;
  /** Shown in the cart and at checkout, e.g. "Victorian Chair". */
  modelName: string;
  /** A render of this piece. May be empty if the canvas could not be read. */
  previewUrl: string;
  /** Estimate for one, so a line can show its own subtotal without re-measuring. */
  unitPrice: number;
  /**
   * The piece as built, e.g. "49 × 110 × 58.5 cm".
   *
   * Written at the moment of adding, because that is the only moment it is
   * cheap to know: the studio has the loaded rig and measures the real
   * geometry. The cart holds serialised per-part dimensions and no rig, so
   * working an overall size out here would mean loading every model in the
   * list, or guessing from parts that overlap in space. Lines added before
   * this existed carry no size and their row simply leaves it out.
   */
  sizeLabel?: string;
  /**
   * The furniture shop this piece is destined for, or null while undecided.
   *
   * Null is a real and expected state, not a defect: someone designs a chair
   * before they have browsed a single shop, and forcing the choice at that
   * moment would be asking a question they cannot yet answer. Checkout is
   * where it has to be resolved, and it refuses to send until it is.
   */
  shopId: string | null;
  /**
   * Held beside the id so the cart can name its groups without a round trip.
   * The cart lives in localStorage and is read before any query resolves; a
   * lane headed "Loading..." would be worse than one headed with a name that
   * is a few days stale.
   */
  shopName: string;
  /**
   * True when this design came out of that shop's own published template.
   *
   * A shop publishes a template as an invitation to commission that piece
   * from them. Carrying it to a cheaper furniture shop would be taking their design
   * work and paying someone else to execute it, so the destination is fixed
   * at the moment the template is opened and cannot be reassigned here.
   * Designs the customer authored themselves are never locked.
   */
  shopLocked: boolean;
  /** Template material limits travel with cart edits; [] means none permitted. */
  allowedMaterials?: string[] | null;
  addedAt: string;
};

function isLine(value: unknown): value is CartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.id === "string" &&
    typeof line.item === "object" &&
    line.item !== null &&
    typeof line.unitPrice === "number"
  );
}

/**
 * Fills in the destination fields on a line written before they existed.
 *
 * A cart is in someone's browser, not in a migration's reach, so a customer
 * mid-commission when this shipped has lines with no shop on them. They read
 * back as undecided, which is exactly what they are, and checkout asks. The
 * alternative -- rejecting them in isLine -- would silently empty a cart that
 * had real work in it.
 */
function withDestination(line: CartLine): CartLine {
  // A piece made from a shop's template is addressed to that shop whatever the
  // stored line says -- a line folded in from an older order, or one edited
  // by hand, cannot move it somewhere else.
  const origin = originShopOf(line.item);
  if (origin) return { ...line, shopId: origin.id, shopName: origin.name, shopLocked: true };
  return {
    ...line,
    shopId: typeof line.shopId === "string" && line.shopId ? line.shopId : null,
    shopName: typeof line.shopName === "string" ? line.shopName : "",
    shopLocked: line.shopLocked === true,
  };
}

/**
 * "Buy now": one piece checked out straight from the studio, held apart from
 * the cart so buying it never adds it to, empties or reorders the cart.
 *
 * The checkout page reads whichever list is in scope (setCartScope). It works
 * on the buy-now list while opened as /order-summary?buy=now and puts the
 * scope back when it closes, so everything else -- the studio's cart badge,
 * the cart page -- always reads the real cart.
 */
const BUY_NOW_KEY = "furnicraft:buy-now";
export const BUY_NOW_PATH = "/order-summary?buy=now";
let activeKey = CART_KEY;

export type CartScope = "cart" | "buy-now";

export function setCartScope(scope: CartScope): void {
  activeKey = scope === "buy-now" ? BUY_NOW_KEY : CART_KEY;
}

/** Puts one piece in the buy-now slot, replacing whatever was there. */
export function stageBuyNow(line: Omit<CartLine, "id" | "addedAt">): AddResult {
  const previous = activeKey;
  activeKey = BUY_NOW_KEY;
  try {
    const next: CartLine[] = [
      { ...line, id: `buy-${Date.now().toString(36)}`, addedAt: new Date().toISOString() },
    ];
    return writeCart(next) ? { ok: true, lines: next } : { ok: false, reason: "storage" };
  } finally {
    activeKey = previous;
  }
}

/**
 * The cart, with anything unreadable dropped.
 *
 * A malformed line is discarded rather than surfaced, because the only thing a
 * customer can do with a line that has no design in it is be confused by it.
 */
export function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(activeKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLine).map(withDestination) : [];
  } catch {
    return [];
  }
}

function writeCart(lines: CartLine[]): boolean {
  try {
    window.localStorage.setItem(activeKey, JSON.stringify(lines));
    return true;
  } catch {
    // Almost always the storage quota: previews are images, and a long cart of
    // them adds up. Retry once without them -- a cart that has lost its
    // thumbnails still knows what to build, which is the part that matters.
    try {
      window.localStorage.setItem(
        activeKey,
        JSON.stringify(lines.map((line) => ({ ...line, previewUrl: "" })))
      );
      return true;
    } catch {
      return false;
    }
  }
}

export type AddResult = { ok: true; lines: CartLine[] } | { ok: false; reason: "full" | "storage" };

export function addToCart(line: Omit<CartLine, "id" | "addedAt">): AddResult {
  const lines = readCart();
  if (lines.length >= MAX_CART_LINES) return { ok: false, reason: "full" };

  const next: CartLine[] = [
    ...lines,
    {
      ...line,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      addedAt: new Date().toISOString(),
    },
  ];
  return writeCart(next) ? { ok: true, lines: next } : { ok: false, reason: "storage" };
}

/**
 * Changes how many of one line to build.
 *
 * Clamped here as well as at the input, because this is the door the value
 * actually comes through -- a stepper is a convenience, not a guarantee.
 */
export function updateLineQuantity(id: string, quantity: number): CartLine[] {
  const next = readCart().map((line) =>
    line.id === id
      ? { ...line, item: { ...line.item, quantity: quantityOf({ quantity }) } }
      : line
  );
  writeCart(next);
  return next;
}

/**
 * Puts an edited design back where it was.
 *
 * Keeps the line's id and position so a piece sent back to the studio and
 * returned lands in the same row it left, rather than appearing at the
 * bottom as a second copy of itself while the stale one sits above it.
 */
export function replaceLine(id: string, patch: Omit<CartLine, "id" | "addedAt">): CartLine[] {
  const lines = readCart();
  if (!lines.some((line) => line.id === id)) {
    // The line was removed while the studio had it open. Adding it back is
    // closer to what was asked for than silently discarding the work.
    const added = addToCart(patch);
    return added.ok ? added.lines : lines;
  }
  const next = lines.map((line) =>
    line.id === id
      ? {
          ...line,
          ...patch,
          // The studio only knows a destination when the design came out of a
          // shop's template. For everything else it returns null, and applying
          // that would quietly un-assign a line the customer had already
          // addressed at checkout -- they would come back from a small edit to
          // find their piece sitting in the unassigned lane. So the line's own
          // destination stands, and only a locked design overrides it.
          ...(patch.shopLocked
            ? { shopId: patch.shopId, shopName: patch.shopName, shopLocked: true }
            : { shopId: line.shopId, shopName: line.shopName, shopLocked: line.shopLocked }),
        }
      : line
  );
  writeCart(next);
  return next;
}

/**
 * Sends one line to a furniture shop, or back to undecided with a null id.
 *
 * A locked line refuses, and says so by returning the cart unchanged. The UI
 * disables its picker too, but this is the door the value actually comes
 * through and a disabled control is a suggestion, not a rule.
 */
export function assignLineShop(id: string, shopId: string | null, shopName: string): CartLine[] {
  const lines = readCart();
  const next = lines.map((line) =>
    line.id === id && !line.shopLocked
      ? { ...line, shopId: shopId || null, shopName: shopId ? shopName : "" }
      : line
  );
  writeCart(next);
  return next;
}

/**
 * Moves every undecided line to one furniture shop at once.
 *
 * The common cart is several pieces for one room from one shop, and clicking
 * through a picker per line to say the same thing five times is the kind of
 * tax that makes people abandon a basket. Locked lines and lines already
 * addressed elsewhere are left exactly as they are.
 */
export function assignAllUnassigned(shopId: string, shopName: string): CartLine[] {
  const next = readCart().map((line) =>
    line.shopId === null && !line.shopLocked ? { ...line, shopId, shopName } : line
  );
  writeCart(next);
  return next;
}

/** One furniture shop's share of the cart: what it will receive as a single order. */
export type ShopGroup = {
  shopId: string;
  /** The name as the line recorded it; checkout refreshes it from the live list. */
  shopName: string;
  lines: CartLine[];
};

/**
 * The cart as it will actually be sent: one group per furniture shop, plus whatever
 * has not been addressed yet.
 *
 * Groups keep the order their first piece was added in, rather than sorting by
 * name. The cart is a record of how someone shopped, and a lane that jumps up
 * the page because a shop's name starts with B is a lane that is hard to
 * follow while you are editing it.
 */
export function groupCartByShop(lines: CartLine[] = readCart()): {
  groups: ShopGroup[];
  unassigned: CartLine[];
} {
  const groups: ShopGroup[] = [];
  const unassigned: CartLine[] = [];

  for (const line of lines) {
    if (!line.shopId) {
      unassigned.push(line);
      continue;
    }
    const existing = groups.find((group) => group.shopId === line.shopId);
    if (existing) existing.lines.push(line);
    else groups.push({ shopId: line.shopId, shopName: line.shopName, lines: [line] });
  }

  return { groups, unassigned };
}

/** How many separate orders this cart would send. */
export function orderCount(lines: CartLine[] = readCart()): number {
  return groupCartByShop(lines).groups.length;
}

export function removeFromCart(id: string): CartLine[] {
  const next = readCart().filter((line) => line.id !== id);
  writeCart(next);
  return next;
}

export function clearCart(): void {
  try {
    // Whichever list is in scope: sending a buy-now piece empties only that.
    window.localStorage.removeItem(activeKey);
  } catch {
    // Nothing to do. The cart is a convenience, not a record.
  }
}

/** Distinct designs in the cart. */
export function cartLineCount(): number {
  return readCart().length;
}

/**
 * Total pieces to build, which is not the same as the number of lines.
 *
 * A cart holding one line of six chairs is one design and six pieces, and the
 * six is what a customer is deciding on and a furniture shop is quoting.
 */
export function cartPieceCount(lines: CartLine[] = readCart()): number {
  return lines.reduce((sum, line) => sum + quantityOf(line.item), 0);
}

export function cartTotal(lines: CartLine[] = readCart()): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * quantityOf(line.item), 0);
}

/** What one line is worth: its own estimate times how many of it. */
export function lineTotal(line: CartLine): number {
  return line.unitPrice * quantityOf(line.item);
}

/**
 * Moves a design staged by the pre-cart flow into the cart, once.
 *
 * Someone who pressed the old button and then reloaded into the new one would
 * otherwise find their design gone. Called on the cart's first read at
 * checkout; the old key is removed either way so this cannot run twice.
 */
export function absorbLegacyPendingOrder(): CartLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LEGACY_PENDING_KEY);
    if (!raw) return readCart();
    window.localStorage.removeItem(LEGACY_PENDING_KEY);
  } catch {
    return readCart();
  }

  try {
    const pending = JSON.parse(raw) as {
      cadState?: string;
      previewUrl?: string;
      furnitureType?: string;
      projectName?: string;
      estimatedPrice?: number;
      shopId?: string;
      shopName?: string;
    };
    const cad = pending.cadState ? JSON.parse(pending.cadState) : null;
    const item = Array.isArray(cad?.items) ? cad.items[0] : null;
    if (!item) return readCart();

    const quantity = quantityOf(item);
    const result = addToCart({
      item,
      modelName: pending.furnitureType || pending.projectName || "Design",
      previewUrl: pending.previewUrl ?? "",
      // The pre-cart flow chose the shop in the studio and recorded it here,
      // so an order staged by an older build arrives already addressed and the
      // customer is not asked a question they have already answered. Not
      // locked: they chose it themselves, and may still change their mind.
      shopId: pending.shopId || null,
      shopName: pending.shopId ? pending.shopName || "" : "",
      shopLocked: false,
      // The old flow stored the total; a line stores what one costs.
      unitPrice: Math.round((pending.estimatedPrice ?? 0) / Math.max(1, quantity)),
    });
    return result.ok ? result.lines : readCart();
  } catch {
    return readCart();
  }
}
