import {
  DEFAULT_PART_COLORS,
  DEFAULT_RIG_PARAMS,
  isPartRole,
  surfacesForPart,
  type PartDef,
  type PartId,
  type RigParams,
  type Surface,
} from "./studio-config";
import {
  GENERATED_SOURCE_VERSION,
  findStudioModel,
  studioModel,
  type GeneratedSource,
  type StudioModel,
} from "./studio-models";
import {
  materialById,
  materialsForSurface,
  varnishById,
  supportsVarnish,
  VARNISHES,
  DEFAULT_VARNISH_ID,
  type MaterialProfile,
  type VarnishId,
} from "./materials-db";
import {
  CARVING_NONE_ID,
  MAX_APERTURES,
  ORIGINAL_SHAPE_ID,
  apertureName,
  carvingById,
  carvingName,
  readAperture,
  shapeAcceptsApertures,
  shapeById,
  type Aperture,
} from "./part-shapes";
import { type ChairMeasurement } from "./studio-dimensions";
import { stockColorLabel, stockMaterialGroup } from "../../../lib/shops/material-stock";
import type { Silhouettes } from "./studio-silhouette";

/**
 * The shape a studio design takes once it leaves the studio -- staged for an
 * order, saved as a shop template, or read back to be re-edited.
 *
 * It deliberately satisfies two audiences at once. The `dims` / `materialNames`
 * / `globalScale` fields are the vocabulary the existing order and template
 * previews already speak, so a studio design shows up in the shop's order queue
 * with a filled-in specification table and needs no special-casing there. The
 * `studio` block alongside them carries the exact rig parameters and finishes,
 * which is what lets a design be reopened later as a real editable copy rather
 * than a picture of one.
 */
/**
 * Unchanged from when the studio drove only the Victorian chair, so designs
 * saved before the studio became multi-model still load. Which model a design
 * belongs to is recorded separately, in `studio.modelId`.
 */
export const STUDIO_DESIGN_KIND = "victorian-chair-studio";

/** localStorage key used to hand a saved design back into the studio for editing. */
export const STUDIO_OPEN_KEY = "furnicraft_studio_open_design";
const STUDIO_RETURN_KEY = "furnicraft_studio_return_design";

export type StudioBlock = {
  /** Which model this design was built from; see studio-models.ts. */
  modelId: string;
  /**
   * How to rebuild the model, for a piece generated from a photograph.
   *
   * Absent for the five shipped models, whose `modelId` is enough to find
   * them, and absent for every design saved before generated pieces existed.
   * Present means `modelId` names nothing in `STUDIO_MODELS` and this is the
   * only way to reconstruct the piece -- see `GeneratedSource`.
   *
   * It rides here, inside cad_state, rather than in a column of its own,
   * because cad_state is the copy that already travels the whole journey:
   * template, staged for a customer, written onto an order, read back for
   * editing. `design_templates.model_path` duplicates one field of it purely
   * so a storage policy can be indexed; this is the source of truth.
   */
  source?: GeneratedSource;
  params: RigParams;
  colors: Record<PartId, string>;
  /**
   * The varnish chosen per part. Optional because every design saved before
   * the second tier existed has none, and those must keep loading -- an absent
   * entry means the default, not a broken design.
   */
  varnishes?: Partial<Record<PartId, VarnishId>>;
  /**
   * Which catalogue finish each part was actually given, by id.
   *
   * `colors` cannot answer this, and the difference reaches the furniture shop. A
   * colour is not an identity: two finishes may share a hex and several do --
   * every "Original" entry is #ffffff, so a piece built in natural bamboo and
   * one built in plain hardwood were recorded identically, and the order named
   * whichever the catalogue happened to list first. That was already wrong
   * before the catalogue grew; with eighty-odd finishes across eight families
   * it would be wrong routinely.
   *
   * Optional, because every design saved before this field existed has none.
   * Those still resolve the old way -- by matching the hex -- so a stored
   * design keeps naming the finish it always did. See `resolveFinish`.
   */
  materials?: Partial<Record<PartId, string>>;
  /**
   * Which shape each part was rebuilt as, by id; see part-shapes.ts.
   *
   * Optional, and an absent entry means the model's own geometry -- which is
   * exactly what every design saved before shapes existed should reopen as,
   * so those keep loading unchanged rather than needing a migration.
   *
   * Ids rather than geometry, and this is the reason the shapes are a fixed
   * catalogue rather than a free-form parameter set: a stored design has to
   * rebuild to the same piece months later, and a builder that changed in the
   * meantime would silently rebuild someone's ordered chair as something else.
   */
  shapes?: Partial<Record<PartId, string>>;
  /**
   * How hard each part's edges are broken, 0 (sharp) to 1, per part.
   *
   * Separate from `shapes` rather than folded into the id, because it is a
   * different kind of answer: the shape is a choice from a list the furniture shop
   * publishes, the radius is a continuous quantity the customer dials. Folding
   * them together would mean either a shape id per radius setting or a
   * catalogue that cannot be extended without invalidating stored designs.
   */
  edgeRadii?: Partial<Record<PartId, number>>;
  /**
   * Holes cut through a part, and what fills them; see part-shapes.ts.
   *
   * Optional, and absent means a solid part, so every design saved before
   * holes existed reopens exactly as it was rather than needing a migration.
   *
   * Stored per part rather than folded into `shapes` for the same reason the
   * edge radius is not folded in: a shape is a choice from a catalogue the
   * furniture shop publishes and a hole is a continuous thing the customer places.
   * Putting them together would mean a shape id per hole position, which is
   * not a catalogue anyone could publish.
   *
   * The insert's finish lives on the hole (`fill`) rather than in `materials`
   * because it is not a part -- it has no PartId, no dimensions of its own in
   * the measurement, and nothing to say in the hide control.
   */
  apertures?: Partial<Record<PartId, Aperture[]>>;
  /**
   * Relief worked into each part's face, by id; see part-shapes.ts.
   *
   * Optional, and an absent entry means plain -- which is what every design
   * saved before carving existed should reopen as, so those keep loading
   * unchanged rather than needing a migration.
   *
   * Separate from `shapes` because it is a different question about the same
   * part: the shape is the whole silhouette, the carving is what is worked
   * into its face. Folding them together would need a catalogue entry for
   * every combination of the two, which is a catalogue nobody can publish.
   */
  carvings?: Partial<Record<PartId, string>>;
  measurement: ChairMeasurement;
  /**
   * Traced outlines of the posed chair. Optional because they are only worth
   * computing when a drawing is actually wanted; without them the blueprint
   * falls back to drawing component envelopes.
   */
  silhouettes?: Silhouettes;
};

export type StudioDesignItem = {
  kind: typeof STUDIO_DESIGN_KIND;
  type: string;
  name: string;
  dims: Record<string, { w: number; h: number; d: number }>;
  materialNames: Record<string, string>;
  /**
   * What shape each part was ordered in, by the same part labels `dims` uses.
   *
   * Kept out of `materialNames` rather than appended to it, even though the
   * two are read side by side. That field is the finish and only the finish:
   * the order summary collects its values to say what a piece is made of, and
   * "Narra, Tapered square" in that list would read as a second timber.
   *
   * Only the parts actually substituted appear. A design built entirely from
   * the model's own geometry has no entry here at all, which is what keeps
   * every order placed before this feature existed rendering as it did.
   */
  shapeNames?: Record<string, string>;
  score: null;
  globalScale: { x: number; y: number; z: number };
  /**
   * How many of this piece to build. Optional, and absent means one.
   *
   * Optional rather than defaulted, because every design saved before bulk
   * ordering existed has no quantity and must keep reading as a single piece
   * rather than as a zero. Readers should use `quantityOf`, never the raw field.
   *
   * It lives on the item rather than on the order row so it survives the same
   * journey the rest of the design does -- staged to localStorage, written to
   * cad_state, reopened in the studio for editing -- without a second source of
   * truth that could disagree with it.
   */
  quantity?: number;
  /**
   * The shop whose published template this piece was made from. Absent for a
   * design the customer started themselves.
   *
   * On the item, like quantity, so it travels everywhere the design does --
   * cart, checkout, the order's cad_state, back into the studio from an order
   * -- and the piece stays the template shop's however it is reopened. The
   * studio will not save such a piece to My templates or address it to any
   * other shop, and the cart keeps it locked to this shop. Read it with
   * originShopOf.
   */
  originShopId?: string;
  originShopName?: string;
  studio: StudioBlock;
};

/** The template shop a design piece belongs to, or null for the customer's own. */
export function originShopOf(item: unknown): { id: string; name: string } | null {
  if (!isRecord(item)) return null;
  const id = typeof item.originShopId === "string" && item.originShopId ? item.originShopId : null;
  const name = typeof item.originShopName === "string" && item.originShopName ? item.originShopName : null;
  return id && name ? { id, name } : null;
}

/** The lower and upper bounds a furniture shop can realistically be asked for. */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 50;

/**
 * How many pieces an item represents.
 *
 * Everything that prices, counts or displays an order goes through this, so a
 * missing, fractional or hostile value can never become "build 0 chairs" or
 * "build 10,000 chairs" downstream.
 */
export function quantityOf(item: { quantity?: number } | null | undefined): number {
  const raw = item?.quantity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.round(raw)));
}

/**
 * What to call a stock when the finish itself does not say.
 *
 * Only reached by the "Original" entries, which belong to no family because
 * they belong to no particular stock -- they are the model as photographed.
 */
const SURFACE_STOCK: Record<Surface, string> = {
  wood: "Hardwood",
  cloth: "Upholstery",
  rattan: "Rattan",
  cane: "Cane",
  glass: "Glass",
  metal: "Metal",
  stone: "Stone",
  plastic: "Polymer",
};

/**
 * The catalogue finish a part is wearing.
 *
 * By id where one was recorded, which is every design saved since the studio
 * began writing them. The hex fallback below is for the ones saved before
 * that, and it is a fallback rather than the rule for a concrete reason: a
 * colour does not identify a finish. Several entries share one -- every
 * "Original" is #ffffff -- so matching on it can only ever return the first
 * of them, which is how a bamboo piece came to be written onto orders as
 * plain hardwood.
 *
 * The fallback searches every surface the part accepts rather than only its
 * own, and in that order, so a legacy design still resolves to what it always
 * did while a design that has since been re-finished in glass or steel still
 * resolves at all.
 */
export function resolveFinish(def: PartDef, hex: string, materialId?: string): MaterialProfile | null {
  const wanted = hex.toLowerCase();
  const byId = materialId ? materialById(materialId) : null;
  // The id is only the answer while the colour still agrees with it -- the
  // same test the renderer applies to decide whether to lay on a finish's
  // relief or merely tint (see furniture-studio.tsx). Picking a custom colour
  // leaves the last swatch's id in state, so trusting the id alone would
  // write that swatch onto the order and send the furniture shop off to buy narra
  // for a piece the customer had just painted some colour of their own.
  if (materialId) return byId?.hex.toLowerCase() === wanted ? byId : null;
  for (const surface of surfacesForPart(def)) {
    const match = materialsForSurface(surface).find(
      (material) => material.hex.toLowerCase() === wanted
    );
    if (match) return match;
  }
  return null;
}

/**
 * Resolves a finish back to its catalogue name, so orders read "Narra", not
 * "#9c6437" -- and name the seal over it, because "Hardwood - Narra, satin
 * polyurethane" and the same timber left raw are different jobs at different
 * prices.
 *
 * The stock half of that name comes from the finish rather than from the part
 * once a part can be built in more than one family. `def.stock` describes the
 * part as the model authored it -- "Cane", "Solid brass" -- so it is still
 * right when the customer kept that family and plainly wrong when they did
 * not: a marble top on a timber frame is not "Hardwood - Carrara marble", and
 * a build sheet saying so is a phone call at best.
 */
function stockLabel(def: PartDef, material: MaterialProfile): string {
  if (material.family === "Synthetic rattan") return material.family;
  if (def.stock && material.surface === def.surface) return def.stock;
  return material.family ?? SURFACE_STOCK[material.surface];
}

/**
 * The finish as the shop listed it: the material, then the colour, in the
 * words of the storefront's own stock list (lib/shops/material-stock.ts).
 *
 * The old name joined the model's authored stock word to the finish, which
 * was wrong whenever the customer changed the finish within the same surface:
 * steel picked for a brass-legged model read "Solid brass - Matte black", and
 * painted MDF on a timber part read "Hardwood - White painted MDF". The build
 * sheet now names exactly the material and colour the shop said it supplies.
 */
function stockFinishName(material: MaterialProfile): string {
  const group = stockMaterialGroup(material).label;
  const colour = stockColorLabel(material);
  return colour === group ? group : `${group} - ${colour}`;
}

/**
 * Whose finish a part wears. Every part its own, except drop leaves, which
 * take the board they unfold from -- the same host the renderer and the stock
 * check use.
 */
function finishHostFor(model: StudioModel, id: PartId): PartId {
  if (id !== "leaves") return id;
  return (
    model.parts.find((part) => part.role === "tabletopBorder" || part.role === "apron" || part.role === "seatFrame")?.id ??
    model.parts.find((part) => part.role === "tabletop")?.id ??
    id
  );
}

function finishName(
  model: StudioModel,
  id: PartId,
  hex: string,
  varnishId?: VarnishId,
  materialId?: string
): string {
  const def = model.parts.find((entry) => entry.id === id);
  if (!def) return "Custom Finish";
  const match = resolveFinish(def, hex, materialId);
  if (!match) return "Custom Finish";
  const named = match.name === "Original" ? `${stockLabel(def, match)} (as shown)` : stockFinishName(match);
  // Only a sealed surface is worth naming; "raw" is the absence of a finish and
  // saying so on every line would be noise.
  if (!supportsVarnish(match) || !varnishId || varnishId === DEFAULT_VARNISH_ID) return named;
  return `${named}, ${varnishById(varnishId).name.toLowerCase()}`;
}

/**
 * Estimates a build price from the finished piece rather than a flat rate.
 *
 * Material cost tracks the volume of the bounding envelope relative to the
 * reference chair, and the carvings carry a separate labour premium because
 * hand-detailing is the expensive part of a Victorian piece. This is an
 * estimate for the customer to react to -- the shop confirms the real figure.
 */
const REFERENCE_PRICE = 4500;
const REFERENCE_VOLUME_CM3 = 49 * 110 * 58;
const ORNAMENT_LABOUR = 900;

export function estimatePrice(
  measurement: ChairMeasurement,
  params: RigParams,
  model: StudioModel
): number {
  const volume = measurement.overall.w * measurement.overall.h * measurement.overall.d;
  const materialFactor = Math.max(0.55, volume / REFERENCE_VOLUME_CM3);
  // Only charge carving labour on a model that actually has carvings; the
  // parameter sits at its default on models with no ornament part.
  const hasOrnaments = model.parts.some((part) => part.role === "accessory");
  const carving =
    hasOrnaments && params.ornamentScale > 0.02
      ? ORNAMENT_LABOUR * Math.min(params.ornamentScale, 1.6)
      : 0;
  return Math.round((REFERENCE_PRICE * materialFactor + carving) / 50) * 50;
}

export function buildStudioDesignItem(input: {
  model: StudioModel;
  name: string;
  params: RigParams;
  colors: Record<PartId, string>;
  varnishes?: Partial<Record<PartId, VarnishId>>;
  materials?: Partial<Record<PartId, string>>;
  shapes?: Partial<Record<PartId, string>>;
  edgeRadii?: Partial<Record<PartId, number>>;
  apertures?: Partial<Record<PartId, Aperture[]>>;
  carvings?: Partial<Record<PartId, string>>;
  quantity?: number;
  measurement: ChairMeasurement;
  silhouettes?: Silhouettes;
}): StudioDesignItem {
  const {
    model,
    name,
    params,
    colors,
    varnishes,
    materials,
    shapes,
    edgeRadii,
    apertures,
    carvings,
    quantity,
    measurement,
    silhouettes,
  } = input;

  const dims: StudioDesignItem["dims"] = {};
  const materialNames: StudioDesignItem["materialNames"] = {};
  const shapeNames: Record<string, string> = {};
  for (const part of measurement.parts) {
    dims[part.label] = { w: part.w, h: part.h, d: part.d };
    const shape = shapeById(shapes?.[part.id]);
    if (shape) {
      // The radius is said in words beside the shape rather than as a second
      // column, because it is a property OF the shape and means nothing on
      // its own -- and because it is the sort of thing a furniture shop reads once
      // and then works to, not a number anyone sorts by.
      const radius = edgeRadii?.[part.id] ?? 0;
      shapeNames[part.label] =
        radius > 0.02 ? `${shape.label} — edges eased ${Math.round(radius * 100)}%` : shape.label;
    }

    // Holes go in the same column as the shape, and read after it, because a
    // hole is a fact about the shape: "Rectangular, with a round cutout" is
    // one sentence a maker reads once. A separate column would be a second
    // thing to cross-reference, and on a part with no hole -- which is nearly
    // all of them -- an empty one.
    // Carving reads after the shape and before the cutouts, which is the
    // order a maker would work: cut the part, work its face, then bore it.
    const carvingId = carvings?.[part.id];
    if (carvingById(carvingId)) {
      const said = carvingName(carvingId) + " carving";
      shapeNames[part.label] = shapeNames[part.label] ? shapeNames[part.label] + " \u2014 " + said : said;
    }

    const holes = apertures?.[part.id];
    if (holes?.length) {
      const said = holes
        .slice(0, MAX_APERTURES)
        .map((hole) => {
          // Named by the insert's own colour. Passing the PART's colour with
          // the insert's id could never agree (a glass round in a narra top),
          // so every insert used to print as "Custom Finish".
          const fill = hole.fill ? materialById(hole.fill) : null;
          return apertureName(hole, fill ? finishName(model, part.id, fill.hex, undefined, fill.id) : null);
        })
        .join("; ");
      shapeNames[part.label] = shapeNames[part.label] ? `${shapeNames[part.label]} — ${said}` : said;
    }
    // Drop leaves have no picker: the studio paints them in the top's finish
    // (see the finishes effect in furniture-studio.tsx), so that is what the
    // build sheet names. Naming their own untouched entry printed a finish
    // the leaves were never shown in.
    const finishPart = finishHostFor(model, part.id);
    materialNames[part.label] = finishName(
      model,
      finishPart,
      colors[finishPart] ?? "#ffffff",
      varnishes?.[finishPart],
      materials?.[finishPart]
    );
  }

  return {
    kind: STUDIO_DESIGN_KIND,
    type: model.id.replace(/-/g, "_"),
    name,
    dims,
    materialNames,
    ...(Object.keys(shapeNames).length ? { shapeNames } : {}),
    // No durability/quality figure is published: every finish in the studio is
    // the same physical timber and fabric, only tinted, so there is nothing
    // real to score them against. Inventing a number here would be worse than
    // omitting it -- the preview simply hides the section when score is null.
    score: null,
    globalScale: { x: params.seatWidth, y: params.legHeight, z: params.seatDepth },
    // Only written when it is more than one, so a single-piece design produces
    // the same record it always did.
    ...(quantityOf({ quantity }) > MIN_QUANTITY ? { quantity: quantityOf({ quantity }) } : {}),
    studio: {
      modelId: model.id,
      // Only a generated piece carries one, so a design built on a shipped
      // model produces exactly the record it always did.
      ...(model.source ? { source: model.source } : {}),
      params,
      colors,
      ...(varnishes && Object.keys(varnishes).length ? { varnishes } : {}),
      // Written only when something was actually chosen, so a design finished
      // entirely in its model's own stock produces the record it always did.
      ...(materials && Object.keys(materials).length ? { materials } : {}),
      // Both written only when something was actually chosen, so a design
      // left entirely as the model was drawn produces the record it always did.
      ...(shapes && Object.keys(shapes).length ? { shapes } : {}),
      ...(edgeRadii && Object.keys(edgeRadii).length ? { edgeRadii } : {}),
      ...(apertures && Object.keys(apertures).length ? { apertures } : {}),
      ...(carvings && Object.keys(carvings).length ? { carvings } : {}),
      measurement,
      ...(silhouettes ? { silhouettes } : {}),
    },
  };
}

export function buildStudioCadState(item: StudioDesignItem) {
  return { items: [item] };
}

const VARNISH_IDS = new Set(VARNISHES.map((v) => v.id as string));

/**
 * Reads back the per-part varnish, keeping only ids the catalogue still has.
 *
 * A design saved against a varnish that has since been renamed or dropped would
 * otherwise reopen carrying a value nothing can resolve; falling back to the
 * default loses a preference, which is the smaller loss.
 */
function readVarnishes(value: unknown): Partial<Record<PartId, VarnishId>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, VarnishId>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    const entry = value[key];
    if (typeof entry === "string" && VARNISH_IDS.has(entry)) out[key] = entry as VarnishId;
  }
  return out;
}

/**
 * Reads back the per-part finish ids, keeping only ones the catalogue still
 * has -- the same rule `readVarnishes` applies, for the same reason. A finish
 * that has since been withdrawn resolves to nothing, and the design falls back
 * to its stored hex, which is a tint of the right colour rather than a
 * dangling reference to stock no shop can supply.
 */
function readMaterials(value: unknown): Partial<Record<PartId, string>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, string>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    const entry = value[key];
    // Keep retired IDs so an old design can be flagged without substituting stock.
    if (typeof entry === "string" && entry.length > 0) out[key] = entry;
  }
  return out;
}

/**
 * The stored shape ids, dropping any this build no longer has a builder for.
 *
 * Dropping rather than keeping is the whole point. An unknown id would
 * otherwise sit in the design being neither built nor visible, and the piece
 * would quietly render as the original while the record claimed something
 * else. Falling back to the model's own geometry is at least a shape the
 * customer can see, and one the furniture shop can make.
 */
function readShapes(value: unknown): Partial<Record<PartId, string>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, string>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    const entry = value[key];
    if (typeof entry === "string" && (entry === ORIGINAL_SHAPE_ID || shapeById(entry))) out[key] = entry;
  }
  return out;
}

/** The stored carvings, dropping any id this build does not know. */
function readCarvings(value: unknown): Partial<Record<PartId, string>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, string>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    const entry = value[key];
    if (typeof entry !== "string" || entry === CARVING_NONE_ID) continue;
    if (carvingById(entry)) out[key] = entry;
  }
  return out;
}

/**
 * The stored holes, re-validated part by part.
 *
 * Two rules beyond the per-hole clamping `readAperture` does. A hole on a
 * part whose shape cannot carry one is dropped, because it could never be
 * built and showing it would offer a control that does nothing -- that
 * happens when a design is reopened and its shape has been changed to "As
 * modelled" since. And the list is capped, so a hand-edited record cannot ask
 * the rig for four hundred inserts.
 */
function readApertures(value: unknown, shapes: Partial<Record<PartId, string>>): Partial<Record<PartId, Aperture[]>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, Aperture[]>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    if (!shapeAcceptsApertures(shapes[key])) continue;
    const entry = value[key];
    if (!Array.isArray(entry)) continue;
    const holes = entry
      .slice(0, MAX_APERTURES)
      .map((hole) => readAperture(hole))
      .filter((hole): hole is Aperture => hole !== null);
    if (holes.length) out[key] = holes;
  }
  return out;
}

/** The stored edge radii, clamped to the range the slider can actually produce. */
function readEdgeRadii(value: unknown): Partial<Record<PartId, number>> {
  if (!isRecord(value)) return {};
  const out: Partial<Record<PartId, number>> = {};
  for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
    const entry = value[key];
    if (typeof entry === "number" && Number.isFinite(entry)) out[key] = Math.min(1, Math.max(0, entry));
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads back the seed for a generated model, or nothing if it cannot be
 * trusted.
 *
 * Every check here guards the same failure: `shellRoles` is positional, so a
 * seed that is subtly wrong does not error, it relabels the furniture. A
 * chair whose arms come back as legs is rigged, measured, priced and put on a
 * build sheet exactly as confidently as a correct one -- which is why this
 * refuses anything it is not sure of instead of repairing it.
 *
 * `undefined` therefore means "this design cannot be reopened", not "carry on
 * with defaults". Callers must treat a design whose modelId resolves to
 * nothing AND whose source is undefined as broken, and say so.
 */
function readGeneratedSource(value: unknown): GeneratedSource | undefined {
  if (!isRecord(value)) return undefined;

  // A future version may number shells differently, at which point these
  // labels describe a split this build no longer produces.
  if (value.v !== GENERATED_SOURCE_VERSION) return undefined;

  const { storagePath, shellRoles, shellCount, cmPerUnit, name } = value;
  if (typeof storagePath !== "string" || storagePath.length === 0) return undefined;
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (typeof cmPerUnit !== "number" || !Number.isFinite(cmPerUnit) || cmPerUnit <= 0) return undefined;
  if (!Array.isArray(shellRoles) || shellRoles.length === 0) return undefined;
  // A single unknown role would shift nothing, but it means this seed was
  // written by a build that knew a role this one does not -- so the labels as
  // a whole are not this build's to interpret.
  if (!shellRoles.every(isPartRole)) return undefined;
  // Redundant with shellRoles.length by construction, which is the point:
  // disagreement means the record was edited or written by something that did
  // not understand it.
  if (typeof shellCount !== "number" || shellCount !== shellRoles.length) return undefined;

  return {
    v: GENERATED_SOURCE_VERSION,
    storagePath,
    shellRoles,
    shellCount,
    cmPerUnit,
    name,
  };
}

/** What to call a design that never recorded a name of its own. */
function fallbackName(modelId: string | null, source: GeneratedSource | undefined): string {
  if (source) return source.name;
  if (modelId === null) return studioModel(null).name;
  return findStudioModel(modelId)?.name ?? "Untitled piece";
}

/**
 * Which model a design needs, decided in exactly one place.
 *
 * Three outcomes, and the point is that they are all explicit:
 *
 *   - `shipped`: one of the models compiled into the app, looked up by id.
 *     Also the answer for a design with NO id, which predates multi-model
 *     support and was always the chair.
 *   - `generated`: an id the app does not know, with a valid seed to rebuild
 *     it from -- see generated-model.ts. Rebuilding is async and can still
 *     fail, so this is a promise to try, not a model.
 *   - `missing`: an id the app does not know and nothing to rebuild it from.
 *     There is no correct model to show. The caller must say so.
 *
 * What it replaces is `studioModel(id)`, which collapsed the last case into
 * the first by answering any unknown id with the Victorian chair.
 */
export type ModelResolution =
  | { kind: "shipped"; model: StudioModel }
  | { kind: "generated"; id: string; source: GeneratedSource }
  | { kind: "missing"; id: string };

export function resolveStudioModel(modelId: string | null, source: GeneratedSource | undefined): ModelResolution {
  if (modelId === null) return { kind: "shipped", model: studioModel(null) };
  const shipped = findStudioModel(modelId);
  if (shipped) return { kind: "shipped", model: shipped };
  if (source) return { kind: "generated", id: modelId, source };
  return { kind: "missing", id: modelId };
}

/**
 * Which model the staged design needs, WITHOUT consuming it.
 *
 * Two readers, deliberately at different times: the picker has to know which
 * model to mount before the studio exists, and the studio applies the design
 * only once that model has loaded (`consumeStagedStudioDesign`, which clears
 * it). Clearing here would leave the studio nothing to apply.
 *
 * Null means nothing is staged, or storage is blocked -- show the picker.
 */
export function peekStagedModel(): ModelResolution | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STUDIO_OPEN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Falls through to the default below.
  }
  // Unreadable staging opens the default piece, as it always has. Nothing is
  // applied to it: consumeStagedStudioDesign cannot read the payload either.
  if (!isRecord(parsed)) return { kind: "shipped", model: studioModel(null) };

  const modelId = typeof parsed.modelId === "string" ? parsed.modelId : null;
  return resolveStudioModel(modelId, readGeneratedSource(parsed.source));
}

/** Drops a staged design without applying it -- for one that cannot be opened. */
export function discardStagedStudioDesign(): void {
  try {
    window.localStorage.removeItem(STUDIO_OPEN_KEY);
  } catch {
    // Blocked storage has nothing staged in it to drop.
  }
}

/**
 * The stored file a design is built on, if it is a generated piece.
 *
 * Every insert of a design_templates row that carries a design must write
 * this into `model_path` alongside `cad_state`. The storage policy that lets
 * a customer read a published model looks only at that column (see
 * 20260910000300_generated_model_templates.sql), so a template published
 * without it opens for its shop and fails for everyone else.
 */
export function generatedModelPath(cadState: unknown): string | null {
  return parseStudioDesign(cadState)?.source?.storagePath ?? null;
}

/** Recovers the editable studio state from a stored design, if it is one. */
export function parseStudioDesign(cadState: unknown): {
  name: string;
  modelId: string;
  params: RigParams;
  colors: Record<PartId, string>;
  varnishes: Partial<Record<PartId, VarnishId>>;
  materials: Partial<Record<PartId, string>>;
  shapes: Partial<Record<PartId, string>>;
  edgeRadii: Partial<Record<PartId, number>>;
  apertures: Partial<Record<PartId, Aperture[]>>;
  carvings: Partial<Record<PartId, string>>;
  quantity: number;
  /**
   * Present only for a generated piece, and only when the seed validated.
   *
   * A caller that can rebuild a generated model should branch on this BEFORE
   * doing anything with `modelId` -- see the note on modelId below.
   */
  source?: GeneratedSource;
} | null {
  let parsed: unknown = cadState;
  if (typeof cadState === "string") {
    try {
      parsed = JSON.parse(cadState);
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;

  const items = parsed.items;
  const item = Array.isArray(items) ? items[0] : parsed;
  if (!isRecord(item) || item.kind !== STUDIO_DESIGN_KIND) return null;

  const studio = item.studio;
  if (!isRecord(studio)) return null;

  const params = { ...DEFAULT_RIG_PARAMS };
  if (isRecord(studio.params)) {
    for (const key of Object.keys(DEFAULT_RIG_PARAMS) as Array<keyof RigParams>) {
      const value = studio.params[key];
      if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
    }
  }

  const colors = { ...DEFAULT_PART_COLORS };
  if (isRecord(studio.colors)) {
    for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
      const value = studio.colors[key];
      if (typeof value === "string") colors[key] = value;
    }
  }

  const source = readGeneratedSource(studio.source);
  const storedModelId = typeof studio.modelId === "string" ? studio.modelId : null;
  const studioShapes = readShapes(studio.shapes);

  return {
    name: typeof item.name === "string" ? item.name : fallbackName(storedModelId, source),
    // The id as stored, never a substitute. An unknown id used to be answered
    // with the Victorian chair's, which is how a generated bed reopened as a
    // chair with nothing on screen to say so. Which model this actually is --
    // shipped, rebuildable from `source`, or gone -- is decided once, by
    // `resolveStudioModel`, at the moment something tries to open it.
    //
    // An ABSENT id still means the default: designs saved before the studio
    // was multi-model record none, and every one of them was the chair.
    modelId: storedModelId ?? studioModel(null).id,
    ...(source ? { source } : {}),
    params,
    colors,
    varnishes: readVarnishes(studio.varnishes),
    materials: readMaterials(studio.materials),
    shapes: studioShapes,
    edgeRadii: readEdgeRadii(studio.edgeRadii),
    apertures: readApertures(studio.apertures, studioShapes),
    carvings: readCarvings(studio.carvings),
    quantity: quantityOf(item as { quantity?: number }),
  };
}

export function isStudioDesign(cadState: unknown): boolean {
  return parseStudioDesign(cadState) !== null;
}

/**
 * Stages a saved design so the studio picks it up on its next load.
 *
 * `allowedMaterials` rides along because it belongs to the template, not to
 * the design: a customer opening a shop's template must be held to the
 * finishes that shop will actually build it in, and the studio has no other
 * way to learn that -- it is handed a design, not a template row.
 * Undefined means unrestricted, which is every design that is not a template.
 */
function serializeStudioDesignForOpen(
  cadState: unknown,
  displayName: string,
  allowedMaterials?: string[] | null,
  /**
   * Present only when reopening a row from customer_designs. Lets the studio
   * keep autosaving into that same row instead of starting a fresh draft --
   * without it, reopening a saved design and editing it would silently fork
   * into a second, unnamed copy the customer never asked for.
   */
  customerDesign?: { id: string; kind: "draft" | "saved" } | null,
  /**
   * Present when the design came out of the cart to be edited. The studio
   * puts it back into that same line instead of appending a second copy.
   */
  cartLineId?: string | null,
  /**
   * The shop whose published template this design came out of.
   *
   * Rides along for the same reason allowedMaterials does: it belongs to the
   * template, not to the design, and the studio is handed a design rather than
   * a template row. A shop publishes a template as an invitation to commission
   * that piece from them, so a design opened from one is fixed to that shop and
   * the cart will not let it be reassigned. Undefined for every design the
   * customer authored themselves, which is most of them.
   */
  originShop?: { id: string; name: string } | null
): string | null {
  const design = parseStudioDesign(cadState);
  if (!design) return null;
  // A caller that does not know the design came from a template -- an order
  // reopened from its detail page -- still finds it on the piece itself.
  originShop = originShop ?? originShopOf(cadState);
  return JSON.stringify({
    ...design,
    name: displayName || design.name,
    allowedMaterials: allowedMaterials ?? null,
    customerDesignId: customerDesign?.id ?? null,
    customerDesignKind: customerDesign?.kind ?? null,
    cartLineId: cartLineId ?? null,
    originShopId: originShop?.id ?? null,
    originShopName: originShop?.name ?? null,
  });
}

/** Stage an explicit open request; it takes precedence over return snapshots. */
export function stageStudioDesignForOpen(...args: Parameters<typeof serializeStudioDesignForOpen>): boolean {
  try {
    const raw = serializeStudioDesignForOpen(...args);
    if (!raw) return false;
    window.localStorage.setItem(STUDIO_OPEN_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** Tab-local copy for Back from Review after the live model has been released. */
export function rememberStudioDesignForReturn(...args: Parameters<typeof serializeStudioDesignForOpen>): void {
  try {
    const raw = serializeStudioDesignForOpen(...args);
    if (raw) window.sessionStorage.setItem(STUDIO_RETURN_KEY, raw);
  } catch {
    // Disabled storage must not stop editing or saving through the usual flow.
  }
}

export function restoreStudioDesignForReturn(expectedModelId?: string): void {
  try {
    if (window.localStorage.getItem(STUDIO_OPEN_KEY)) return;
    const raw = window.sessionStorage.getItem(STUDIO_RETURN_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.modelId !== "string") return;
    if (expectedModelId && parsed.modelId !== expectedModelId) return;
    window.localStorage.setItem(STUDIO_OPEN_KEY, raw);
  } catch {
    // The normal picker remains available if the return snapshot is gone.
  }
}

/**
 * Reads and clears a staged design. A studio may only consume its own model;
 * a cached studio must leave another piece staged for the picker to resolve.
 */
export function consumeStagedStudioDesign(expectedModelId?: string): {
  name: string;
  modelId: string;
  params: RigParams;
  colors: Record<PartId, string>;
  varnishes: Partial<Record<PartId, VarnishId>>;
  materials: Partial<Record<PartId, string>>;
  shapes: Partial<Record<PartId, string>>;
  edgeRadii: Partial<Record<PartId, number>>;
  apertures: Partial<Record<PartId, Aperture[]>>;
  carvings: Partial<Record<PartId, string>>;
  allowedMaterials: string[] | null;
  cartLineId: string | null;
  customerDesignId: string | null;
  customerDesignKind: "draft" | "saved" | null;
  quantity: number;
  /** Set only for a design opened from a shop's template. See stageStudioDesignForOpen. */
  originShop: { id: string; name: string } | null;
} | null {
  try {
    const raw = window.localStorage.getItem(STUDIO_OPEN_KEY);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      window.localStorage.removeItem(STUDIO_OPEN_KEY);
      return null;
    }
    if (!isRecord(parsed)) {
      window.localStorage.removeItem(STUDIO_OPEN_KEY);
      return null;
    }
    const storedModelId = typeof parsed.modelId === "string" ? parsed.modelId : null;
    if (expectedModelId && (storedModelId ?? studioModel(null).id) !== expectedModelId) return null;
    window.localStorage.removeItem(STUDIO_OPEN_KEY);

    const params = { ...DEFAULT_RIG_PARAMS };
    if (isRecord(parsed.params)) {
      for (const key of Object.keys(DEFAULT_RIG_PARAMS) as Array<keyof RigParams>) {
        const value = parsed.params[key];
        if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
      }
    }
    const colors = { ...DEFAULT_PART_COLORS };
    if (isRecord(parsed.colors)) {
      for (const key of Object.keys(DEFAULT_PART_COLORS) as PartId[]) {
        const value = parsed.colors[key];
        if (typeof value === "string") colors[key] = value;
      }
    }
    // Preserve an empty intersection: it means no permitted materials.
    const rawAllowed = parsed.allowedMaterials;
    const allowedMaterials =
      Array.isArray(rawAllowed)
        ? rawAllowed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        : null;

    // Both halves or neither: a shop id with no name would render a lane
    // headed with a UUID, and a name with no id could not address an order.
    const originShopId = typeof parsed.originShopId === "string" && parsed.originShopId ? parsed.originShopId : null;
    const originShopName = typeof parsed.originShopName === "string" && parsed.originShopName ? parsed.originShopName : null;
    const originShop = originShopId && originShopName ? { id: originShopId, name: originShopName } : null;

    const customerDesignId = typeof parsed.customerDesignId === "string" ? parsed.customerDesignId : null;
    const customerDesignKind = parsed.customerDesignKind === "draft" || parsed.customerDesignKind === "saved" ? parsed.customerDesignKind : null;
    const stagedShapes = readShapes(parsed.shapes);

    return {
      name: typeof parsed.name === "string" ? parsed.name : fallbackName(storedModelId, readGeneratedSource(parsed.source)),
      // As stored, for the same reason as in parseStudioDesign. The studio
      // compares this against the model it actually mounted, and refuses to
      // apply a design to a piece it was not made for.
      modelId: storedModelId ?? studioModel(null).id,
      allowedMaterials: allowedMaterials ?? null,
      customerDesignId,
      customerDesignKind,
      params,
      colors,
      varnishes: readVarnishes(parsed.varnishes),
      materials: readMaterials(parsed.materials),
      shapes: stagedShapes,
      edgeRadii: readEdgeRadii(parsed.edgeRadii),
      apertures: readApertures(parsed.apertures, stagedShapes),
      carvings: readCarvings(parsed.carvings),
      quantity: quantityOf(parsed as { quantity?: number }),
      cartLineId: typeof parsed.cartLineId === "string" ? parsed.cartLineId : null,
      originShop,
    };
  } catch {
    return null;
  }
}

