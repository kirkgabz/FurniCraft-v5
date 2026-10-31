import { isStudioDesign, stageStudioDesignForOpen } from "./studio/studio-design-state";

export type CadDim = { w?: number; h?: number; d?: number };

export type CadStateItem = {
  id?: number;
  name?: string;
  type?: string;
  dims?: Record<string, CadDim>;
  materialNames?: Record<string, string>;
  /**
   * What shape each part was ordered in, where it was not the model's own.
   *
   * Distinct from the legacy `shapes` field below, which belonged to the old
   * chair configurator and keyed a style name per part. This one is written
   * by the studio and is already formatted for reading -- see
   * `buildStudioDesignItem`.
   */
  shapeNames?: Record<string, string>;
  score?: { durability: number; quality: number } | null;
  globalScale?: { x: number; y: number; z: number };
  /** How many to build. Absent means one; read it with quantityOf. */
  quantity?: number;
  /** The template shop this piece belongs to; see StudioDesignItem.originShopId. */
  originShopId?: string;
  originShopName?: string;
  selections?: Record<string, string>;
  carvings?: Record<string, string>;
  shapes?: Record<string, string>;
  holes?: Record<string, string>;
  isLeftArmVisible?: boolean;
  isRightArmVisible?: boolean;
  // Older rows (before the full item snapshot) only carried this summary.
  config?: { style?: string; leftArm?: boolean; rightArm?: boolean; isRocking?: boolean };
  // Present only on chair-studio designs; identifies them and carries the rig
  // parameters, finishes and measurements needed to reopen and redraw them.
  kind?: string;
  studio?: unknown;
};

/** Present on designs authored in the chair studio; absent on legacy designs. */
export type StudioMarker = { kind?: string; studio?: unknown };

/**
 * Every piece a design describes, in the order they were added.
 *
 * cad_state has always stored `{ items: [...] }` -- an array -- while the app
 * only ever wrote one and every reader took `items[0]`. This is the reader
 * that does not, and it exists before anything can produce a second item on
 * purpose: a one-item list renders exactly as the single item did, so the
 * change is invisible today and is verified while every row in the database is
 * still guaranteed to hold one piece. Doing it the other way round means
 * debugging list rendering against real multi-piece orders.
 *
 * Returns an empty array rather than null for "nothing here", so callers map
 * over it without a null branch.
 */
export function resolveDesignItems(cadState: unknown): CadStateItem[] {
  if (!cadState) return [];

  let parsed: unknown = cadState;
  if (typeof cadState === "string") {
    try {
      parsed = JSON.parse(cadState);
    } catch {
      return [];
    }
  }

  const items = (parsed as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  // A malformed entry is dropped rather than rendered as a blank row: a design
  // is a record of what to build, and a row that says nothing is worse than a
  // row that is absent.
  return items.filter((entry): entry is CadStateItem => typeof entry === "object" && entry !== null);
}

/**
 * The piece that represents a design on its own.
 *
 * Not a deprecated alias for the plural version -- it is what the six callers
 * that open a design in the studio actually want, because the studio edits one
 * piece at a time. Anything that *displays* what an order contains must use
 * `resolveDesignItems` instead, or a customer ordering a chair and a stool
 * would be shown, and quoted for, only the chair.
 */
export function resolveDesignItem(cadState: unknown): CadStateItem | null {
  return resolveDesignItems(cadState)[0] ?? null;
}

/** Total pieces across every item, honouring each item's own quantity. */
export function totalPieceCount(cadState: unknown): number {
  return resolveDesignItems(cadState).reduce(
    (sum, item) => sum + Math.min(50, Math.max(1, Math.round(Number(item.quantity) || 1))),
    0
  );
}

/**
 * Stages a saved design (from an order or a shop template) so the chair studio
 * picks it up as an editable copy on its next load.
 *
 * Returns false for designs authored in the retired parametric designer: they
 * describe a chair built from shape names the studio has no equivalent for, so
 * there is nothing faithful to reopen. Callers should leave those read-only
 * rather than navigating to a studio that would silently show a default chair.
 * Their stored preview, specification table and blueprint all still render.
 */
export function openItemInDesigner(
  item: CadStateItem,
  displayName: string,
  /** A template's permitted finishes; omitted for an ordinary saved design. */
  allowedMaterials?: string[] | null,
  /** Present only when reopening a row from "My templates" -- see stageStudioDesignForOpen. */
  customerDesign?: { id: string; kind: "draft" | "saved" } | null,
  /** Present when editing a piece that is already in the cart. */
  cartLineId?: string | null,
  /**
   * The shop whose published template this is. Pass it from every surface that
   * opens a template -- a storefront, the marketplace feed, a shop's template
   * list -- so the piece reaches the cart already addressed to the shop that
   * designed it and cannot be redirected away from them.
   */
  originShop?: { id: string; name: string } | null
): boolean {
  return stageStudioDesignForOpen(item, displayName, allowedMaterials, customerDesign, cartLineId, originShop);
}

/** True when a stored design can be reopened in the studio. */
export function canOpenInDesigner(item: CadStateItem | null): boolean {
  return item !== null && isStudioDesign(item);
}
