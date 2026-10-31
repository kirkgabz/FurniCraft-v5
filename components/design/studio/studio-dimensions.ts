import * as THREE from "three";
import type { ChairRig } from "./chair-rig";
import type { PartId, PartRole } from "./studio-config";
import { MODEL_CATEGORY, type FurnitureCategoryId, type StudioModel, type StudioModelId } from "./studio-models";

/**
 * Real-world measurement for the furniture studio.
 *
 * A GLTF ships without units, so every downstream consumer -- the order table,
 * the blueprint, the price estimate -- needs one anchor to convert from. The rig
 * normalizes every model to exactly 1.0 unit tall (see chair-rig.ts), so one
 * number per model does the whole conversion; it lives on the model definition
 * (StudioModel.cmPerUnit) because a tub chair and a dining chair are not the
 * same height.
 */

export type Dimension = { w: number; h: number; d: number };

/** One entry in a part's cutting list: how many to make, and how big each is. */
export type ComponentMeasurement = Dimension & { qty: number };

/**
 * A part's live size at two scopes, because the studio's sliders need both.
 *
 * `part` is the whole thing -- the span of all four legs, which is what a
 * "Width" slider widens. `component` is one piece of it -- a single leg,
 * which is what a "Thickness" slider thickens. Reading the wrong one puts a
 * chair's full 46cm width beside a control that moves a 9.7cm leg.
 */
export type PartSizes = { part: Dimension; component: Dimension };

/**
 * Two shells belong on the same schedule row when every dimension agrees
 * within this much of the larger. Relative rather than absolute, so it is
 * scale-free: 2mm between two 5cm rails is a real difference, 2mm between two
 * 2m ones is the same board twice.
 *
 * At 5% the four Victorian legs resolve into the two pairs they actually are
 * (front 51.9cm, back 63.7cm) rather than four separate rows or one wrong
 * one, and its two pairs of seat rails do the same. Loosening to 10% changes
 * nothing on any model measured.
 */
const COMPONENT_SIZE_TOLERANCE = 0.05;

/**
 * A part that resolves into more rows than this keeps its old single summary
 * row instead.
 *
 * Expanding a part is only worth doing when the result reads as a cutting
 * list. The photoscanned rattan stool's "frame" is 98 separate fragments of
 * 98 different sizes; the Victorian chair's carvings are 24 shells in 11
 * sizes. Listing those would bury the five rows a joiner actually needs. Two
 * is where the measured line falls: it takes every genuine case seen here (a
 * bed's two post lengths, a chair's front and back legs, its side and end
 * rails) while rejecting the noise -- at three, the patio armchair starts
 * listing 0.2cm slivers of its cushion facing as if they were components.
 */
const MAX_COMPONENT_ROWS = 2;

export type PartMeasurement = Dimension & {
  id: PartId;
  label: string;
  /**
   * The individual pieces this part is built from, when they can be resolved
   * into a short enough list to be useful -- otherwise empty, and W/H/D is
   * all there is. See MAX_COMPONENT_ROWS.
   *
   * OPTIONAL because a measurement is PERSISTED with the design: every order
   * placed before this field existed has a `parts` array without it, and the
   * dashboard renders those saved measurements straight into a blueprint. A
   * reader must treat it as possibly absent and fall back to the part's own
   * W/H/D, which is exactly what those older designs always showed.
   */
  components?: ComponentMeasurement[];
  /**
   * How many of this part the piece has.
   *
   * One for almost everything, and the reason it exists is the few that are
   * not: a cabinet's shelves and doors are now a count the customer chooses,
   * and "Shelves, 62 x 2 x 40cm" on a build sheet is the same line whether
   * three were ordered or none. The dimensions above stay per piece, which is
   * what a furniture shop cuts to; this says how many to cut.
   */
  count: number;
  /** Axis-aligned bounds in centimetres, origin at floor level, centred on x/z. */
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

export type ChairMeasurement = {
  overall: Dimension;
  /**
   * Height of the surface a person actually meets: a chair's seat, a bed's
   * mattress, a table's top.
   *
   * The field keeps its original name because saved designs carry it, but the
   * number is no longer only a seat -- read `seatHeightLabel` for what this
   * particular piece's number is of, and never print the word "seat" beside
   * it unhedged.
   */
  seatHeight: number;
  /**
   * What that height is the height OF, for this piece -- "Seat height",
   * "Mattress height", "Table height", "Rail height".
   *
   * It exists because the number is derived from whichever surface the piece
   * turns out to have (see SURFACE_HEIGHT_SOURCES), and labelling every one
   * of them "seat height" put a seat on a bed's shop drawing. Absent on
   * designs saved before this existed, so callers default it.
   */
  seatHeightLabel?: string;
  /**
   * Live size of every part currently drawn, keyed by id -- staging parts
   * included, unlike `parts`.
   *
   * The studio's size sliders read this so they can show a real dimension
   * instead of a percentage of an invisible baseline. Absent on designs saved
   * before it existed, so callers must tolerate it being undefined.
   */
  sizes?: Partial<Record<PartId, PartSizes>>;
  parts: PartMeasurement[];
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

/**
 * Which part gives the piece its headline height, most specific first, and
 * what that height is called on this kind of piece.
 *
 * One number, several names. "Seat height" is the right words for a chair and
 * plainly wrong on a bed, which is how a shop drawing came to state a seat
 * height for a double bed. The label travels with the number so that no
 * caller has to guess, and so a piece whose real sleeping surface was never
 * identified says "Rail height" -- which is honest about what was actually
 * measured -- rather than calling the rails a mattress.
 *
 * Read off each part's ROLE, not its id. Ids are only names: the shipped
 * bed keeps its mattress under the id `tabletop`, and keying on ids is how a
 * bed's drawing came to state a "Table height". The one role that needs the
 * kind of piece as well is the top: the same slab is a table's top, a desk's
 * worktop, and on the shipped bed the mattress.
 *
 * `carcass` closes the last gap: a cabinet has no seat, top or mattress, so it
 * matched nothing and reported "Seat height 0 cm". What a person measures a
 * cabinet by is where its top stands.
 */
const SURFACE_HEIGHT_ROLES: PartRole[] = [
  "seatCushion",
  "mattress",
  "tabletop",
  "seatFrame",
  "bedRail",
  "mattressSupport",
  "carcass",
];

function surfaceHeightLabel(role: PartRole, category: FurnitureCategoryId | undefined): string {
  switch (role) {
    case "seatCushion":
    case "seatFrame":
      return "Seat height";
    case "mattress":
      return "Mattress height";
    case "tabletop":
      return category === "bed" ? "Mattress height" : category === "desk" ? "Desk height" : "Table height";
    case "bedRail":
      return "Rail height";
    case "mattressSupport":
      return "Base height";
    default:
      return "Top height";
  }
}

/** For designs saved before the label existed -- every one of those was a chair. */
export const DEFAULT_SURFACE_HEIGHT_LABEL = "Seat height";

/**
 * What a piece with no recognisable surface reports, alongside a height of
 * zero. Nothing draws a surface line for it; the drawing's title block states
 * the overall height under this name instead of a seat that is not there.
 */
export const NO_SURFACE_HEIGHT_LABEL = "Height";

/**
 * Resolves a part into its individual pieces, in centimetres, collapsing ones
 * of the same size into a single row with a quantity.
 *
 * Two sources, because the rig draws a part in one of two ways. A part with a
 * mesh per shell (legs, arms, carvings -- the ones that move independently)
 * is measured directly from those meshes. A part welded into one mesh for
 * performance has its pieces recovered from the fractions the rig recorded
 * before welding, applied to the live posed size, which is exact because a
 * merged part is scaled as a unit.
 *
 * Returns an empty list when the part is a single piece (nothing to add) or
 * when it resolves into too many rows to be a cutting list.
 */
function componentsFor(
  rig: ChairRig,
  id: PartId,
  meshBoxes: THREE.Box3[],
  partSize: THREE.Vector3,
  cmPerUnit: number
): ComponentMeasurement[] {
  const sizes: THREE.Vector3[] =
    meshBoxes.length > 1
      ? meshBoxes.map((box) => box.getSize(new THREE.Vector3()))
      : (rig.componentFractions(id) ?? []).map(
          ([fx, fy, fz]) => new THREE.Vector3(partSize.x * fx, partSize.y * fy, partSize.z * fz)
        );

  if (sizes.length < 2) return [];

  const rows: ComponentMeasurement[] = [];
  for (const size of sizes) {
    const w = size.x * cmPerUnit;
    const h = size.y * cmPerUnit;
    const d = size.z * cmPerUnit;
    const match = rows.find((row) =>
      ([[row.w, w], [row.h, h], [row.d, d]] as Array<[number, number]>).every(([a, b]) => {
        const larger = Math.max(a, b);
        return larger <= 0 ? true : Math.abs(a - b) / larger <= COMPONENT_SIZE_TOLERANCE;
      })
    );
    if (match) {
      // Keep the largest of the pair, so a row never under-states what has to
      // be cut.
      match.w = Math.max(match.w, w);
      match.h = Math.max(match.h, h);
      match.d = Math.max(match.d, d);
      match.qty++;
    } else {
      rows.push({ qty: 1, w, h, d });
    }
  }

  if (rows.length > MAX_COMPONENT_ROWS) return [];
  return rows.map((row) => ({ qty: row.qty, w: round(row.w), h: round(row.h), d: round(row.d) }));
}

/**
 * Measures the rig *as currently posed*, in centimetres. Reading the live world
 * bounds rather than re-deriving sizes from the rig parameters means the numbers
 * on an order always match what the customer actually saw on screen, with no
 * second copy of the rig maths to drift out of sync.
 */
export function measureRig(rig: ChairRig, model: StudioModel): ChairMeasurement {
  const cmPerUnit = model.cmPerUnit;
  rig.root.updateMatrixWorld(true);

  // Parts that are shown but never built -- an uploaded bed's duvet and
  // pillows. See PartDef.staging: excluding them here is what keeps them off
  // the blueprint's drawn views, out of its component schedule and out of the
  // overall dimensions, since all three read this one measurement.
  const staging = new Set<PartId>(model.parts.filter((part) => part.staging).map((part) => part.id));

  // Every mesh of a part, kept apart as well as unioned: the union is the
  // part's overall extent, the individual boxes are what the cutting list
  // needs. A part drawn as one merged mesh has its components recovered from
  // the rig's recorded fractions instead -- see componentFractions.
  const meshBoxesByPart = new Map<PartId, THREE.Box3[]>();

  const byPart = new Map<PartId, THREE.Box3>();
  const countByPart = new Map<PartId, number>();
  for (const mesh of rig.pickables) {
    const id = mesh.userData.partId as PartId | undefined;
    if (!id) continue;
    // Only a part a size control removed (ornaments or arm pads at zero) is
    // out of the finished piece. A part merely hidden from view still counts.
    if (rig.isRemoved(id)) continue;
    // A mesh the rig has switched off individually is surplus to the count the
    // customer chose -- the fourth shelf on a three-shelf cabinet. The part is
    // still in the design; this particular board is not, so it must not be
    // measured, or the shelves would be reported spanning a bay they no longer
    // reach. Asked of the rig rather than read off `mesh.visible`: a part the
    // customer hid is not drawn either, and hiding a part to see past it does
    // not remove it from the piece.
    if (rig.isMeshInactive(mesh)) continue;
    countByPart.set(id, (countByPart.get(id) ?? 0) + 1);

    const box = new THREE.Box3().setFromObject(mesh);
    const perMesh = meshBoxesByPart.get(id);
    if (perMesh) perMesh.push(box.clone());
    else meshBoxesByPart.set(id, [box.clone()]);

    const existing = byPart.get(id);
    if (existing) existing.union(box);
    else byPart.set(id, box);
  }

  // Live size of every part on screen, staging included -- what the studio's
  // size sliders read out, so a customer sees "56.9 cm" rather than "100%".
  // Kept apart from `parts` on purpose: a duvet has a real size worth showing
  // beside its own slider, and still has no business on a build sheet.
  const sizes: Partial<Record<PartId, PartSizes>> = {};
  const componentsById = new Map<PartId, ComponentMeasurement[]>();
  byPart.forEach((box, id) => {
    const size = box.getSize(new THREE.Vector3());
    const part: Dimension = {
      w: round(size.x * cmPerUnit),
      h: round(size.y * cmPerUnit),
      d: round(size.z * cmPerUnit),
    };
    const components = componentsFor(rig, id, meshBoxesByPart.get(id) ?? [], size, cmPerUnit);
    componentsById.set(id, components);
    // Element-wise largest across the component rows, so a set of four legs
    // reports ONE leg's cross-section rather than the span of all four. A part
    // that is a single piece has no components, and its own size is already
    // the answer.
    const meshBoxes = meshBoxesByPart.get(id) ?? [];
    const component: Dimension =
      components.length > 0
        ? {
            w: Math.max(...components.map((c) => c.w)),
            h: Math.max(...components.map((c) => c.h)),
            d: Math.max(...components.map((c) => c.d)),
          }
        : meshBoxes.length > 1
          ? // The cutting list gave up on this part -- two dozen carvings in
            // eleven sizes is not a schedule anyone can use. A slider still
            // needs a number for ONE of them, though, and the largest single
            // mesh is that number. Without this the readout falls back to the
            // part's span and a 12cm carving is labelled 47.9cm, which is the
            // distance between the outermost two.
            meshBoxes.reduce(
              (largest, box) => {
                const s = box.getSize(new THREE.Vector3());
                return {
                  w: Math.max(largest.w, round(s.x * cmPerUnit)),
                  h: Math.max(largest.h, round(s.y * cmPerUnit)),
                  d: Math.max(largest.d, round(s.z * cmPerUnit)),
                };
              },
              { w: 0, h: 0, d: 0 }
            )
          : part;
    sizes[id] = { part, component };
  });

  const overallBox = new THREE.Box3();
  byPart.forEach((box, id) => {
    if (staging.has(id)) return;
    overallBox.union(box);
  });

  const parts: PartMeasurement[] = [];
  byPart.forEach((box, id) => {
    if (staging.has(id)) return;
    const size = box.getSize(new THREE.Vector3());
    parts.push({
      id,
      label: model.parts.find((part) => part.id === id)?.label ?? id,
      components: componentsById.get(id) ?? [],
      count: countByPart.get(id) ?? 1,
      w: round(size.x * cmPerUnit),
      h: round(size.y * cmPerUnit),
      d: round(size.z * cmPerUnit),
      min: {
        x: round(box.min.x * cmPerUnit),
        y: round(box.min.y * cmPerUnit),
        z: round(box.min.z * cmPerUnit),
      },
      max: {
        x: round(box.max.x * cmPerUnit),
        y: round(box.max.y * cmPerUnit),
        z: round(box.max.z * cmPerUnit),
      },
    });
  });

  // Keep the model's own part order rather than mesh traversal order.
  const order: PartId[] = model.parts.map((part) => part.id);
  parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  // The surface a person meets, and what to call it -- see
  // SURFACE_HEIGHT_SOURCES. Bedding is deliberately absent from that list as
  // well as from byPart: the height a customer cares about is the top of the
  // mattress they climb onto, not the crown of whatever duvet the model
  // happened to ship with.
  const category = MODEL_CATEGORY[model.id as StudioModelId] as FurnitureCategoryId | undefined;
  const surface = SURFACE_HEIGHT_ROLES.map((role) => {
    const part = model.parts.find((candidate) => candidate.role === role && !candidate.staging);
    const box = part ? byPart.get(part.id) : undefined;
    return box ? { box, label: surfaceHeightLabel(role, category) } : null;
  }).find((entry): entry is { box: THREE.Box3; label: string } => entry !== null);

  const overallSize = overallBox.getSize(new THREE.Vector3());

  return {
    overall: {
      w: round(overallSize.x * cmPerUnit),
      h: round(overallSize.y * cmPerUnit),
      d: round(overallSize.z * cmPerUnit),
    },
    seatHeight: surface ? round(surface.box.max.y * cmPerUnit) : 0,
    seatHeightLabel: surface?.label ?? NO_SURFACE_HEIGHT_LABEL,
    sizes,
    parts,
  };
}

/** Bounding box of the posed chair in world units, for the on-screen ruler. */
export function measureBounds(rig: ChairRig): THREE.Box3 {
  rig.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.root);
}
