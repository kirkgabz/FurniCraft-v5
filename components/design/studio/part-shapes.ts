import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartDef, PartRole } from "./studio-config";

/**
 * The shapes a part can be rebuilt as, and the geometry that builds them.
 *
 * Everything else in the studio changes a part's *finish* or its *size*: the
 * mesh the model shipped with is stretched, lifted and tinted, but it stays
 * the mesh it was. This file is the third axis -- what the part actually is.
 * A commission is not a choice between a walnut Victorian leg and a darker
 * Victorian leg; a customer who wants that chair on tapered square legs is
 * asking an ordinary question, and until now the studio had no way to hear it.
 *
 * ---------------------------------------------------------------------------
 * Why the shapes are generated rather than modelled
 *
 * The obvious alternative is a second GLB per variant, authored by hand. Eight
 * models times ten parts times ten shapes is eight hundred meshes nobody is
 * going to model, and every one of them would have to be re-segmented, re-
 * classified and re-measured by the pipeline that currently runs once per
 * model. Generating instead means a shape is a function of the space the
 * original part occupied, so it fits any model that has that part -- including
 * the ones a shop uploads later that nobody here has ever seen.
 *
 * The cost is honesty about what a generated shape is: it is joinery, not
 * sculpture. A turned leg here is a lathe profile, not a carved one, and the
 * catalogue says so in its blurbs rather than promising detail it cannot cut.
 *
 * ---------------------------------------------------------------------------
 * How a shape is fitted
 *
 * A builder is handed the size of the box the original shells occupied and
 * returns geometry centred on the origin. The rig translates it into place.
 * That contract is what keeps the shapes independent of the model: a leg
 * builder never needs to know it is building for a side chair rather than a
 * dining table, only that it has been given a tall thin box to fill.
 *
 * Panels are the exception that proves it. A door is thin front-to-back, a
 * tabletop is thin top-to-bottom, and a shelf can be either depending on how
 * the model was authored -- so panel builders work in a canonical frame (the
 * plan in XY, the thickness along Z) and are rotated onto whichever axis of
 * the real box turns out to be the thin one. See `panel`.
 */

/** The space a shape has to fill, in rig units. */
export type ShapeSize = { w: number; h: number; d: number };

export type PartShape = {
  id: string;
  label: string;
  /** One line in the picker: what this is, in a furniture shop's words. */
  blurb: string;
  /**
   * Whether the edge-radius control does anything to this shape.
   *
   * False for the shapes that are already round everywhere (a turned leg, a
   * drum, a knob): there is no arris left to break, so the slider would move
   * and nothing would happen, which is worse than a slider plainly not
   * offered at all.
   */
  radiusable: boolean;
  /**
   * Whether a hole can be cut through this shape.
   *
   * True only for the shapes that are a single extruded outline, because that
   * is the one case where a hole is exact rather than approximated: a
   * THREE.Shape carries its holes natively and the triangulator cuts them as
   * it builds the face. Everything else here -- a turned leg, a run of slats,
   * a frame assembled from separate rails -- would need the hole subtracted
   * from finished geometry, which is a different and far less reliable
   * operation, and in most cases would be asking for a hole through something
   * that is mostly hole already.
   */
  apertured?: boolean;
  /**
   * The plan outline this shape extrudes, for an `apertured` shape only.
   *
   * Published because a hole has to be clamped against the shape it is cut
   * into, not against the box the shape sits in. A round top fills only the
   * inscribed circle of its box; a hole placed by the box's corners lands in
   * thin air off the edge of the timber, and an ExtrudeGeometry hole outside
   * its own outline triangulates into a tangle rather than failing. The
   * insert is built from the same outline, in a different file, which is the
   * other reason it has to be reachable rather than closed over.
   */
  outlineFor?: (size: ShapeSize) => THREE.Shape;
  /**
   * `apertures` is only ever passed to a shape that declared `apertured`.
   * Every other builder ignores the argument, which is why adding it did not
   * touch the eighty builders below.
   */
  build: (size: ShapeSize, radius: number, apertures?: Aperture[]) => THREE.BufferGeometry;
};

/* -------------------------------------------------------------------------
   Apertures

   A hole cut through a part, and optionally filled with something else: the
   glass round in a coffee table, the cane panel let into a cabinet door, the
   cutout a cable drops through at the back of a desk.

   Two things come out of one description. The part's own outline gets the
   hole, and -- when a material is chosen for it -- a separate insert is built
   to sit in it. The insert is its own mesh with its own finish precisely
   because that is the point of the feature: a glass round in a narra top is
   two materials, and a furniture shop quoting it has to see both.

   Everything is a fraction of the face rather than a measurement in
   centimetres, so a hole keeps its proportions when the size sliders move. A
   hole dialled to a third of a tabletop stays a third of it.
   ------------------------------------------------------------------------- */

export type ApertureShape = "round" | "square" | "rounded";

export type Aperture = {
  shape: ApertureShape;
  /** Across the short side of the face, 0..1 before clamping. See `placeAperture`. */
  size: number;
  /** Where it sits on the face, -1..1 of the travel that keeps a rim all round. */
  x: number;
  y: number;
  /**
   * Catalogue finish id for the piece let into the hole, or null for an open
   * hole. Held with the hole rather than in `materials` because it is not a
   * part -- it has no PartId, and inventing one would put it in the size
   * sliders, the blueprint schedule and the hide control, none of which could
   * say anything true about it.
   */
  fill?: string | null;
};

/**
 * The most holes one part may carry.
 *
 * Four is past anything two sliders can usefully place, and the cap exists
 * mainly so a malformed stored design cannot ask the rig for four hundred
 * inserts.
 */
export const MAX_APERTURES = 4;

/** The smallest a hole may be, as a fraction of the face's short side. */
const MIN_APERTURE = 0.08;
/** The largest, before the rim rule below takes over. */
const MAX_APERTURE = 0.8;
/**
 * The rim the hole must leave, as a fraction of the face's short side.
 *
 * Not decoration. An ExtrudeGeometry hole that touches or crosses its outline
 * does not fail -- it triangulates into a tangle. Guaranteeing a rim is what
 * makes every (size, x, y) combination safe to build, so the three sliders
 * never have to know about each other.
 */
const APERTURE_RIM = 0.06;

export const APERTURE_SHAPES: Array<{ id: ApertureShape; label: string; blurb: string }> = [
  { id: "round", label: "Round", blurb: "A true circle -- the usual cut for a glass round or a planter." },
  { id: "square", label: "Square", blurb: "Straight sides and sharp corners, cut with a router and a fence." },
  { id: "rounded", label: "Soft square", blurb: "A square with its corners eased, kinder on a hand reaching in." },
];

/** Which way a panel lies and the face it presents; anything that has to agree with `panel` reads it here. */
function panelFrame(size: ShapeSize): { axis: "x" | "y" | "z"; faceW: number; faceH: number; thickness: number } {
  const axis = thinAxis(size);
  if (axis === "z") return { axis, faceW: size.w, faceH: size.h, thickness: size.d };
  if (axis === "y") return { axis, faceW: size.w, faceH: size.d, thickness: size.h };
  return { axis, faceW: size.d, faceH: size.h, thickness: size.w };
}

/** Lays a plan-frame geometry (XY face, Z thickness) onto the box's real axes. */
function planToReal(geometry: THREE.BufferGeometry, axis: "x" | "y" | "z"): THREE.BufferGeometry {
  if (axis === "y") geometry.rotateX(-Math.PI / 2);
  else if (axis === "x") geometry.rotateY(Math.PI / 2);
  return geometry;
}

/**
 * Where a hole actually lands, in the plan frame, after clamping.
 *
 * The clamping is the whole function. `size` is squeezed between a minimum
 * worth cutting and whatever still leaves a rim; the offsets are then scaled
 * by the travel THAT size leaves, so x = 1 means "as far over as it goes"
 * rather than a fixed distance a large hole would overshoot. Every
 * combination of the three sliders is therefore buildable, and dragging the
 * size slider slides a cornered hole inwards instead of bursting it through
 * the edge.
 */
export function placeAperture(
  size: ShapeSize,
  aperture: Aperture,
  outline?: THREE.Shape
): {
  cx: number;
  cy: number;
  half: number;
  faceW: number;
  faceH: number;
  thickness: number;
  axis: "x" | "y" | "z";
} {
  const { axis, faceW, faceH, thickness } = panelFrame(size);

  // The face the hole is placed on is the SHAPE's, not the box's, whenever the
  // shape can say. They differ for every top that is not a rectangle -- a
  // round top fills the inscribed circle of a box that may be half as long
  // again -- and using the box would put a hole in the corner off the timber.
  const polygon = outline ? outline.getPoints(24) : null;
  let planW = faceW;
  let planH = faceH;
  if (polygon?.length) {
    const box = new THREE.Box2().setFromPoints(polygon);
    planW = Math.max(1e-4, box.max.x - box.min.x);
    planH = Math.max(1e-4, box.max.y - box.min.y);
  }

  const base = Math.min(planW, planH);
  const rim = base * APERTURE_RIM;

  const wanted = Math.min(MAX_APERTURE, Math.max(MIN_APERTURE, aperture.size));
  // Never wider than the face less a rim on both sides, whatever was asked.
  const half = Math.max(1e-4, Math.min((wanted * base) / 2, base / 2 - rim));

  const travelX = Math.max(0, planW / 2 - half - rim);
  const travelY = Math.max(0, planH / 2 - half - rim);
  const clamp1 = (value: number) => Math.min(1, Math.max(-1, Number.isFinite(value) ? value : 0));

  const wantX = clamp1(aperture.x) * travelX;
  const wantY = clamp1(aperture.y) * travelY;

  // The rectangle above is necessary and not sufficient on a shape that is
  // not one: it keeps a hole inside the bounding box, and this keeps it
  // inside the board.
  const fitted = polygon?.length
    ? fitAperture(wantX, wantY, half, circumradius(aperture.shape), polygon)
    : { cx: wantX, cy: wantY, half };

  return { cx: fitted.cx, cy: fitted.cy, half: fitted.half, faceW: planW, faceH: planH, thickness, axis };
}

/** Whether a point is inside a closed polygon. Ray casting, the ordinary way. */
function inside(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      within = !within;
    }
  }
  return within;
}

/**
 * Whether a hole of this radius at this centre is wholly inside the outline.
 *
 * Tested against the hole's circumcircle rather than its own outline, which
 * is conservative for a square (whose corners reach further than its sides)
 * and exact for a circle. Being conservative is the right way to be wrong
 * here: the cost is a hole that stops travelling a millimetre early, and the
 * alternative cost is a hole cut through the edge of the board.
 */
function fitsInside(cx: number, cy: number, radius: number, polygon: THREE.Vector2[]): boolean {
  for (let i = 0; i < APERTURE_FIT_SAMPLES; i += 1) {
    const angle = (i / APERTURE_FIT_SAMPLES) * Math.PI * 2;
    const point = new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    if (!inside(point, polygon)) return false;
  }
  return true;
}

/** Points round the hole's rim to test. Enough to catch a waney edge between two of them. */
const APERTURE_FIT_SAMPLES = 32;
/** Halvings of the search below. Ten gets within a thousandth of the travel. */
const APERTURE_FIT_STEPS = 10;

/**
 * Slides a hole back towards the middle until it fits inside the outline, and
 * shrinks it only if sliding is not enough.
 *
 * Sliding first is deliberate: a customer dragging a hole towards the edge of
 * a round top should watch it stop at the edge of the timber, not watch it
 * shrink. Shrinking is the fallback for a hole that would not fit anywhere,
 * which is what a wide hole in a boat-shaped top asks for.
 */
function fitAperture(
  cx: number,
  cy: number,
  half: number,
  circum: number,
  polygon: THREE.Vector2[]
): { cx: number; cy: number; half: number } {
  if (fitsInside(cx, cy, half * circum, polygon)) return { cx, cy, half };

  // Slide: binary search the fraction of the way out that still fits.
  let low = 0;
  let high = 1;
  for (let i = 0; i < APERTURE_FIT_STEPS; i += 1) {
    const mid = (low + high) / 2;
    if (fitsInside(cx * mid, cy * mid, half * circum, polygon)) low = mid;
    else high = mid;
  }
  if (low > 0 || fitsInside(0, 0, half * circum, polygon)) {
    return { cx: cx * low, cy: cy * low, half };
  }

  // Centred and still too big: shrink instead.
  let small = 0;
  let large = half;
  for (let i = 0; i < APERTURE_FIT_STEPS; i += 1) {
    const mid = (small + large) / 2;
    if (fitsInside(0, 0, mid * circum, polygon)) small = mid;
    else large = mid;
  }
  return { cx: 0, cy: 0, half: Math.max(1e-4, small) };
}

/** How far a hole's furthest point is from its centre, as a multiple of `half`. */
function circumradius(shape: ApertureShape): number {
  // A square reaches its corners; a soft square stops a little short of them.
  return shape === "round" ? 1 : shape === "rounded" ? 1.3 : Math.SQRT2;
}

/** The hole's outline in the plan frame, already positioned. */
function apertureOutline(aperture: Aperture, cx: number, cy: number, half: number): THREE.Path {
  const path = new THREE.Path();
  if (aperture.shape === "round") {
    path.absarc(cx, cy, half, 0, Math.PI * 2, false);
    return path;
  }
  const corner = aperture.shape === "rounded" ? half * 0.3 : 0;
  const points = roundedRect(half * 2, half * 2, corner).getPoints(16);
  path.moveTo(points[0].x + cx, points[0].y + cy);
  for (let i = 1; i < points.length; i += 1) path.lineTo(points[i].x + cx, points[i].y + cy);
  path.closePath();
  return path;
}

/** Cuts the holes into an outline, in place, and hands it back. */
function punch(outline: THREE.Shape, size: ShapeSize, apertures: Aperture[] | undefined): THREE.Shape {
  if (!apertures?.length) return outline;
  // Sampled once, before any hole is added, because `getPoints` on a Shape
  // walks only its outer curves -- but taking it up front also means each
  // hole is placed against the board, not against the board as already
  // holed, so two holes are independent of the order they were added in.
  const board = new THREE.Shape();
  board.curves = outline.curves;
  for (const aperture of apertures.slice(0, MAX_APERTURES)) {
    const { cx, cy, half } = placeAperture(size, aperture, board);
    outline.holes.push(apertureOutline(aperture, cx, cy, half));
  }
  return outline;
}

/**
 * The piece that sits in a hole, in the box's real frame and centred on the
 * origin like a shape builder's output, so the rig can place it the same way.
 *
 * Drawn a hair smaller than the hole and a hair thinner than the panel. Cut
 * to exactly the same outline it would z-fight along the whole rim, which
 * reads as a flickering black hairline round the glass -- a rendering fault
 * rather than a join.
 */
export function buildApertureInsert(
  size: ShapeSize,
  aperture: Aperture,
  outline?: THREE.Shape
): THREE.BufferGeometry {
  const { cx, cy, half, thickness, axis } = placeAperture(size, aperture, outline);
  const plan = new THREE.Shape();
  plan.curves = apertureOutline(aperture, 0, 0, Math.max(1e-4, half * 0.985)).curves;
  const geometry = extrude(plan, Math.max(1e-4, thickness * 0.92), 0, 24);
  geometry.translate(cx, cy, 0);
  return planToReal(geometry, axis);
}

/**
 * The shape every part starts in: the mesh the model was authored with.
 *
 * Its builder is never called -- the rig keeps the original geometry aside and
 * puts it back. It is first in every list, and it is the only entry that is
 * guaranteed to be exactly what the photograph showed.
 */
export const ORIGINAL_SHAPE_ID = "original";

const ORIGINAL: PartShape = {
  id: ORIGINAL_SHAPE_ID,
  label: "As modelled",
  blurb: "The piece exactly as it was drawn, with no part substituted.",
  radiusable: false,
  build: () => new THREE.BoxGeometry(1, 1, 1),
};

/* -------------------------------------------------------------------------
   Primitives

   Deliberately few. Nearly every shape below is one of five moves -- a
   frustum, a lathe, an extruded outline, a row of slats, or a frame around a
   recessed panel -- given different numbers. Writing eighty separate mesh
   generators would hide that, and would leave eighty places for the same
   off-by-one in a bevel to be fixed independently.
   ------------------------------------------------------------------------- */

/**
 * How much of a part the edge-radius slider is allowed to eat at 100%.
 *
 * Not a half (which would be a full bullnose on the smallest dimension)
 * because a fully rounded rail stops reading as a rail, and because on a thin
 * panel the bevel at the corners starts walking into the opposite face. Just
 * under half leaves a flat on every face at every setting.
 */
const MAX_RADIUS_FRACTION = 0.46;

/**
 * The most repeats any shape may derive from a part's proportions.
 *
 * Several shapes work out their own count -- reeds across a door, slats down
 * a louvre, teeth along a dentil run -- by dividing one dimension by another.
 * That is the right way round, because a reed is a fixed width and a wider
 * door takes more of them. It is also a division, and a part thin enough on
 * the divisor turns "how many reeds" into a five-figure number and the studio
 * into a slideshow. The ceiling is well above anything a real part asks for.
 */
const MAX_REPEATS = 24;

/** A derived repeat count, floored at something recognisable and capped. */
function repeats(count: number, least: number): number {
  if (!Number.isFinite(count)) return least;
  return Math.max(least, Math.min(MAX_REPEATS, Math.round(count)));
}

/** Turns the 0..1 the slider hands over into a radius this box can carry. */
function radiusFor(size: ShapeSize, radius: number, smallest = Math.min(size.w, size.h, size.d)): number {
  const clamped = Math.min(1, Math.max(0, radius));
  return clamped * smallest * MAX_RADIUS_FRACTION;
}

/** A rounded rectangle centred on the origin, in the XY plane. */
function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = w / 2;
  const y = h / 2;
  const c = Math.min(r, Math.min(w, h) / 2 - 1e-4);
  if (c <= 1e-5) {
    shape.moveTo(-x, -y);
    shape.lineTo(x, -y);
    shape.lineTo(x, y);
    shape.lineTo(-x, y);
    shape.closePath();
    return shape;
  }
  shape.moveTo(-x + c, -y);
  shape.lineTo(x - c, -y);
  shape.quadraticCurveTo(x, -y, x, -y + c);
  shape.lineTo(x, y - c);
  shape.quadraticCurveTo(x, y, x - c, y);
  shape.lineTo(-x + c, y);
  shape.quadraticCurveTo(-x, y, -x, y - c);
  shape.lineTo(-x, -y + c);
  shape.quadraticCurveTo(-x, -y, -x + c, -y);
  shape.closePath();
  return shape;
}

/**
 * Extrudes an outline to a thickness, optionally breaking the two rims.
 *
 * three ships a RoundedBoxGeometry and this is used in preference to it,
 * because that one subdivides the whole box to get its corners and produces
 * UVs to match -- fine for an untextured prop, wrong here, where every
 * surface carries a grain whose tiling is computed from the part's real size.
 * An extrusion keeps the faces flat and the UVs in world units, which is what
 * `tiled()` in texture-loader.ts expects.
 */
function extrude(outline: THREE.Shape, thickness: number, bevel: number, curveSegments = 12): THREE.BufferGeometry {
  // Capped against the outline's own smallest span as well as the extrusion
  // depth. A bevel is drawn by insetting the outline by the radius and then
  // sweeping back out to it, so a radius wider than half the shape insets it
  // past its own far side: the polygon turns inside out and the result is a
  // burst of geometry several times the size of the part, pointing the wrong
  // way. It does not throw, and it is not obviously a bevel problem when you
  // see it -- it just looks like a builder that was written wrong.
  const r = Math.min(bevel, thickness * 0.49, outlineMin(outline) * 0.49);
  if (r <= 1e-5) {
    const geometry = new THREE.ExtrudeGeometry(outline, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments,
    });
    geometry.translate(0, 0, -thickness / 2);
    return geometry;
  }
  // The bevel adds to the extrusion depth, so the core is drawn short by
  // twice the radius and the bevel puts it back. Without this a "rounded"
  // part is fractionally bigger than the square one it replaced, and a leg
  // visibly grows as the slider moves.
  const core = Math.max(1e-4, thickness - r * 2);
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: core,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: -r,
    bevelSegments: 3,
    curveSegments,
  });
  geometry.translate(0, 0, -core / 2);
  return geometry;
}

/**
 * The smaller of an outline's two spans, for capping a bevel against it.
 *
 * Reads the outer edge only. A holed outline never reaches here with a bevel
 * to cap -- see topShape, which extrudes a panel with cutouts square -- so a
 * cap that also measured the holes would be a guarantee no test could
 * exercise and no caller could rely on.
 */
function outlineMin(outline: THREE.Shape): number {
  // Eight divisions per curve: enough that a circle is not read as its
  // inscribed octagon, cheap enough to run on every drag of the radius slider.
  const points = outline.getPoints(8);
  if (!points.length) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return Math.min(maxX - minX, maxY - minY);
}

/** A box, rounded on every edge once the slider is off zero. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  if (r <= 1e-5) return new THREE.BoxGeometry(w, h, d);
  const safe = Math.min(r, Math.min(w, h, d) * 0.49);
  return extrude(roundedRect(w, h, safe), d, safe, 6);
}

/** A box standing on Y with its plan in XZ -- the orientation rails and legs want. */
function uprightBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const geometry = roundedBox(w, d, h, r);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * A frustum standing on Y, with `sides` around it.
 *
 * Four sides is a square post or a tapered square leg, six a hexagonal
 * column, thirty-two a turned cylinder. The rotation offset on the low counts
 * is not cosmetic: a four-sided cylinder in three arrives corner-on, so a
 * "square" leg would otherwise stand diamond-wise to the chair it belongs to.
 */
function frustum(
  topW: number,
  topD: number,
  bottomW: number,
  bottomD: number,
  h: number,
  sides: number
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, h, sides, 1, false);
  if (sides <= 8) geometry.rotateY(Math.PI / sides);
  // Scaled per ring rather than built to size, so a taper stays one primitive
  // instead of a lathe with two points. The vertex ring above y = 0 is the top.
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const top = position.getY(i) > 0;
    position.setX(i, position.getX(i) * (top ? topW : bottomW) * 2);
    position.setZ(i, position.getZ(i) * (top ? topD : bottomD) * 2);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A turned profile revolved about Y.
 *
 * Points are given normalised -- x as a fraction of the part's half-width, y
 * as a fraction of its height from the floor -- so one profile describes a
 * baluster on a dining leg and on a stool leg without being rewritten.
 */
function turned(profile: Array<[number, number]>, size: ShapeSize, segments = 20): THREE.BufferGeometry {
  const rx = size.w / 2;
  const rz = size.d / 2;
  const points = profile.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x * rx), (y - 0.5) * size.h));
  const geometry = new THREE.LatheGeometry(points, segments);
  // A lathe is round; an oval footprint is the same lathe squashed on Z.
  if (Math.abs(rz - rx) > 1e-5) geometry.scale(1, 1, rz / rx);
  geometry.computeVertexNormals();
  return geometry;
}

/** Which axis of a box is its thickness -- the one a panel is thin along. */
function thinAxis(size: ShapeSize): "x" | "y" | "z" {
  const min = Math.min(size.w, size.h, size.d);
  if (min === size.h) return "y";
  return min === size.d ? "z" : "x";
}

/**
 * Builds a panel in the canonical frame and lays it onto the box's real one.
 *
 * `plan` is handed the panel's face dimensions and its thickness, and works
 * in XY with the thickness running along Z. This is the whole reason a single
 * "Shaker frame" entry can serve a cabinet door that is thin front-to-back
 * and a shelf that is thin top-to-bottom.
 */
function panel(
  size: ShapeSize,
  plan: (faceW: number, faceH: number, thickness: number) => THREE.BufferGeometry
): THREE.BufferGeometry {
  // Both halves of this -- which face a panel presents, and how the plan is
  // laid onto it -- are shared with the aperture maths above rather than
  // written twice. They have to agree exactly: a hole placed in one frame and
  // an insert built in the other would sit at right angles to each other, on
  // a horizontal panel, in a way that looks like a modelling error rather
  // than a disagreement between two copies of the same rotation.
  //
  // A horizontal panel's face is width by depth, lying down, and the rotation
  // puts the plan's +Y (its "up" when drawn) at the model's -Z, which is what
  // puts the front edge of a tabletop at the front of the table.
  const { axis, faceW, faceH, thickness } = panelFrame(size);
  return planToReal(plan(faceW, faceH, thickness), axis);
}

/** The two horizontal dimensions of a box, longest first, with the axis named. */
function longHorizontal(size: ShapeSize): { long: number; short: number; alongX: boolean } {
  return size.w >= size.d
    ? { long: size.w, short: size.d, alongX: true }
    : { long: size.d, short: size.w, alongX: false };
}

/**
 * Merges a set of already-positioned geometries, disposing the pieces.
 *
 * Everything is flattened to non-indexed first, and that is not an
 * optimisation -- it is the only way the merge succeeds. three's primitives
 * are indexed and its ExtrudeGeometry is not, `mergeGeometries` refuses a
 * mixture of the two, and it refuses it by returning null rather than by
 * throwing. So a shape that merged a rounded slab with a turned boss produced
 * the fallback box below, silently, and looked from the outside like a
 * builder that had simply been written wrong. Un-indexing costs vertices on
 * shapes that are a few hundred triangles to begin with.
 */
function assemble(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (pieces.length === 1) return pieces[0];
  const flat = pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece));
  const merged = mergeGeometries(flat, false);
  for (const piece of flat) if (!pieces.includes(piece)) piece.dispose();
  for (const piece of pieces) piece.dispose();
  // mergeGeometries returns null only when the attribute sets disagree, which
  // cannot happen here -- every piece comes out of this file. Falling back to
  // a box rather than throwing keeps one bad shape from taking the studio down.
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

/* -------------------------------------------------------------------------
   Legs

   Used where the base role arrived as several separate shells, which is the
   signal that the model really has legs rather than a moulded shell -- the
   same signal generic-rig.ts uses to decide whether to call the part "Legs"
   or "Base". Each builder fills ONE leg's box; the rig calls it once per leg,
   so a four-legged chair gets four and a three-legged stool three, with no
   count anywhere in this file.
   ------------------------------------------------------------------------- */

const LEG_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "leg-square-taper",
    label: "Tapered square",
    blurb: "A square post narrowing toward the floor — the plainest joinery there is.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius, Math.min(size.w, size.d));
      // Tapered by scaling the post rather than by a frustum, so the edge
      // radius still applies: a frustum has no outline to bevel.
      const post = uprightBox(size.w, size.h, size.d, r);
      const position = post.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 1) {
        // 1 at the top of the leg, 0.62 at the foot.
        const t = (position.getY(i) + size.h / 2) / size.h;
        const scale = 0.62 + 0.38 * t;
        position.setX(i, position.getX(i) * scale);
        position.setZ(i, position.getZ(i) * scale);
      }
      position.needsUpdate = true;
      post.computeVertexNormals();
      return post;
    },
  },
  {
    id: "leg-square-post",
    label: "Square post",
    blurb: "A straight post, the same section top to bottom. Heavy and quiet.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius, Math.min(size.w, size.d))),
  },
  {
    id: "leg-chamfered",
    label: "Chamfered post",
    blurb: "A square post with its four arrises cut back to an octagon.",
    radiusable: false,
    build: (size) => frustum(size.w * 0.5, size.d * 0.5, size.w * 0.5, size.d * 0.5, size.h, 8),
  },
  {
    id: "leg-round-taper",
    label: "Tapered round",
    blurb: "A dowel leg narrowing to the floor, as a mid-century chair takes.",
    radiusable: false,
    build: (size) => frustum(size.w * 0.5, size.d * 0.5, size.w * 0.3, size.d * 0.3, size.h, 20),
  },
  {
    id: "leg-column",
    label: "Round column",
    blurb: "A plain cylinder, the same diameter all the way down.",
    radiusable: false,
    build: (size) => frustum(size.w * 0.46, size.d * 0.46, size.w * 0.46, size.d * 0.46, size.h, 20),
  },
  {
    id: "leg-turned",
    label: "Turned baluster",
    blurb: "Lathe-turned, with a collar under the rail and a swell at mid height.",
    radiusable: false,
    build: (size) =>
      turned(
        [
          [0.0, 0.0],
          [0.42, 0.0],
          [0.44, 0.04],
          [0.34, 0.08],
          [0.36, 0.2],
          [0.5, 0.34],
          [0.46, 0.5],
          [0.3, 0.66],
          [0.34, 0.74],
          [0.3, 0.78],
          [0.46, 0.86],
          [0.46, 0.97],
          [0.4, 1.0],
          [0.0, 1.0],
        ],
        size
      ),
  },
  {
    id: "leg-bobbin",
    label: "Bobbin turned",
    blurb: "A run of repeated beads down the whole leg, as on a country chair.",
    radiusable: false,
    build: (size) => {
      const beads = 6;
      const profile: Array<[number, number]> = [[0, 0]];
      for (let i = 0; i < beads; i += 1) {
        const base = i / beads;
        profile.push([0.24, base + 0.02 / beads]);
        profile.push([0.48, base + 0.5 / beads]);
        profile.push([0.24, base + 0.98 / beads]);
      }
      profile.push([0.3, 1]);
      profile.push([0, 1]);
      return turned(profile, size);
    },
  },
  {
    id: "leg-fluted",
    label: "Fluted column",
    blurb: "A straight column with flutes run down it — a classical dining leg.",
    radiusable: false,
    build: (size) => {
      const flutes = 10;
      // A straight core, not a tapered one. The ribs below are parallel to
      // the axis, so against a taper they are buried at the wide end and
      // proud at the narrow one -- which is to say the flutes disappear over
      // the top half of the leg, where they are most looked at. A fluted
      // column is a classical form and is not tapered anyway.
      const core = frustum(size.w * 0.36, size.d * 0.36, size.w * 0.36, size.d * 0.36, size.h, 24);
      const pieces = [core];
      for (let i = 0; i < flutes; i += 1) {
        const angle = (i / flutes) * Math.PI * 2;
        // A flute is cut, not added -- but a boolean subtraction on every
        // frame is far more than this is worth, so the relief is read the
        // other way round: thin ribs standing between the hollows, which
        // catches the light the same way at the distance a studio is viewed.
        const rib = new THREE.BoxGeometry(size.w * 0.1, size.h * 0.88, size.d * 0.1);
        rib.translate(Math.cos(angle) * size.w * 0.4, 0, Math.sin(angle) * size.d * 0.4);
        pieces.push(rib);
      }
      return assemble(pieces);
    },
  },
  {
    id: "leg-cabriole",
    label: "Cabriole",
    blurb: "The S-curve of a Queen Anne leg: knee out, ankle in, foot forward.",
    radiusable: false,
    build: (size) => {
      // Stacked ellipsoids along a curve rather than a swept tube, because a
      // cabriole's section changes as much as its path does -- thick at the
      // knee, drawn in at the ankle, swelling again into the foot -- and
      // three's TubeGeometry carries one radius the whole way.
      //
      // The path is stated as the four points a cabinetmaker would set out
      // and interpolated between them, rather than as a sum of sines. The
      // sines were the first version and the curve they made was neither an
      // S nor anything else: a leg has a knee at a height and an ankle at a
      // height, and those are the numbers worth being able to read here.
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.5, 0), // the rail
        new THREE.Vector3(0, 0.22, 0.5), // the knee, thrown forward
        new THREE.Vector3(0, -0.18, -0.24), // the ankle, drawn back under
        new THREE.Vector3(0, -0.5, 0.2), // the foot, forward again
      ]);
      // Section width at the same four heights, as a fraction of the box.
      const girth = [0.9, 1.0, 0.44, 0.72];
      const rings = 24;
      const pieces: THREE.BufferGeometry[] = [];

      const girthAt = (t: number) => {
        const span = (1 - t) * (girth.length - 1);
        const low = Math.min(girth.length - 2, Math.floor(span));
        const mix = span - low;
        return girth[low] * (1 - mix) + girth[low + 1] * mix;
      };
      const pointAt = (t: number) =>
        new THREE.Vector3(0, path.getPoint(t).y * size.h, path.getPoint(t).z * size.d * 0.5);

      // A frustum per segment, aligned to the segment it spans. Stacking
      // ellipsoids instead was the first attempt and it produced a beaded
      // stick -- each sphere's silhouette bulges between its neighbours, so
      // a smooth leg came out looking like a bobbin. A cone's side is
      // straight, so consecutive ones meet flush at the radius they share.
      for (let i = 0; i < rings; i += 1) {
        const t0 = i / rings;
        const t1 = (i + 1) / rings;
        const from = pointAt(t0);
        const to = pointAt(t1);
        const length = from.distanceTo(to);
        if (length < 1e-6) continue;

        const segment = new THREE.CylinderGeometry(
          (size.w * girthAt(t1)) / 2,
          (size.w * girthAt(t0)) / 2,
          // Overlapped by a tenth so the joints between cones cannot open
          // into hairline gaps as the curve bends.
          length * 1.1,
          12
        );
        segment.scale(1, 1, size.d / size.w);
        segment.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            to.clone().sub(from).normalize()
          )
        );
        segment.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
        pieces.push(segment);
      }
      return assemble(pieces);
    },
  },
  {
    id: "leg-splayed",
    label: "Splayed dowel",
    blurb: "A round leg raked outward at the foot, the Scandinavian answer.",
    radiusable: false,
    build: (size) => {
      const leg = frustum(size.w * 0.42, size.d * 0.42, size.w * 0.26, size.d * 0.26, size.h * 1.02, 18);
      // Raked rather than translated, so the foot leaves the centreline and
      // the top stays where the rail expects to meet it.
      leg.rotateZ(-0.13);
      leg.rotateX(0.09);
      return leg;
    },
  },
  {
    id: "leg-hairpin",
    label: "Hairpin",
    blurb: "Two bent steel rods off a small plate. Best ordered in metal.",
    radiusable: false,
    build: (size) => {
      // A quarter of the leg's own section. The first version was a sixth
      // and rendered as a sewing needle: a hairpin leg is thin steel, but
      // "thin" is relative to a chair, not to the timber leg it replaces.
      const rod = Math.min(size.w, size.d) * 0.26;
      const pieces: THREE.BufferGeometry[] = [];
      const plate = new THREE.BoxGeometry(size.w * 0.9, size.h * 0.03, size.d * 0.9);
      pieces.push(at(plate, 0, size.h * 0.485, 0));
      for (const sign of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([
          // Splayed across the whole footprint rather than a fraction of it.
          // The two rods of a hairpin are what hold it up: drawn close
          // together they read as one bent wire, which is what they did.
          new THREE.Vector3(0, size.h * 0.47, sign * size.d * 0.3),
          new THREE.Vector3(0, size.h * 0.05, sign * size.d * 0.85),
          new THREE.Vector3(0, -size.h * 0.32, sign * size.d * 0.5),
          new THREE.Vector3(0, -size.h * 0.5, 0),
        ]);
        pieces.push(new THREE.TubeGeometry(curve, 16, rod / 2, 8, false));
      }
      return assemble(pieces);
    },
  },
  {
    id: "leg-sled",
    label: "Sled runner",
    blurb: "An upright meeting a runner on the floor instead of a foot.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius, Math.min(size.w, size.d));
      const post = at(uprightBox(size.w * 0.55, size.h * 0.9, size.d * 0.3, r), 0, size.h * 0.05, 0);
      const runner = at(uprightBox(size.w * 0.5, size.h * 0.1, size.d * 1.9, r), 0, -size.h * 0.45, 0);
      return assemble([post, runner]);
    },
  },
  {
    id: "leg-block",
    label: "Block foot",
    blurb: "A plain cube foot under a short post — the heaviest of the options.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius, Math.min(size.w, size.d));
      const post = at(uprightBox(size.w * 0.62, size.h * 0.72, size.d * 0.62, r), 0, size.h * 0.14, 0);
      const foot = at(uprightBox(size.w, size.h * 0.28, size.d, r), 0, -size.h * 0.36, 0);
      return assemble([post, foot]);
    },
  },
];

/* -------------------------------------------------------------------------
   Solid bases

   The same role as the legs above, reached when the base arrived as a single
   connected shell: the cushion chair's moulded frame, the patio chair's woven
   box, the stool's caned drum. Offering "Tapered square leg" for one of those
   would replace a whole shell with a single post, which is why the two lists
   are separate rather than one list with a warning on half of it.
   ------------------------------------------------------------------------- */

const SOLID_BASE_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "base-box",
    label: "Plain box",
    blurb: "A straight-sided shell standing flat on the floor.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius)),
  },
  {
    id: "base-drum",
    label: "Drum",
    blurb: "A cylinder the full height, as a caned stool is built.",
    radiusable: false,
    build: (size) => frustum(size.w / 2, size.d / 2, size.w / 2, size.d / 2, size.h, 28),
  },
  {
    id: "base-drum-taper",
    label: "Tapered drum",
    blurb: "A drum drawn in toward the floor so it does not read as a barrel.",
    radiusable: false,
    build: (size) => frustum(size.w / 2, size.d / 2, size.w * 0.38, size.d * 0.38, size.h, 28),
  },
  {
    id: "base-waisted",
    label: "Waisted drum",
    blurb: "A turned shell pinched at the middle and flared at both ends.",
    radiusable: false,
    build: (size) =>
      turned(
        [
          [0, 0],
          [1, 0],
          [0.98, 0.08],
          [0.72, 0.32],
          [0.66, 0.5],
          [0.72, 0.68],
          [0.98, 0.92],
          [1, 1],
          [0, 1],
        ],
        size,
        28
      ),
  },
  {
    id: "base-plinth",
    label: "Recessed plinth",
    blurb: "A box set back from the piece above, so it reads as floating.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w * 0.82, size.h, size.d * 0.82, radiusFor(size, radius)),
  },
  {
    id: "base-panel-ends",
    label: "Panelled ends",
    blurb: "Two solid end panels bridged low down, with the middle left open.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius, Math.min(size.w, size.d) * 0.4);
      const t = size.w * 0.14;
      const pieces = [
        at(uprightBox(t, size.h, size.d, r), -(size.w - t) / 2, 0, 0),
        at(uprightBox(t, size.h, size.d, r), (size.w - t) / 2, 0, 0),
        at(uprightBox(size.w - t * 2, size.h * 0.14, size.d * 0.3, r), 0, -size.h * 0.28, 0),
      ];
      return assemble(pieces);
    },
  },
  {
    id: "base-arcaded",
    label: "Arched apron box",
    blurb: "A box whose lower edge is cut away in an arch on all four sides.",
    radiusable: false,
    build: (size) => {
      const outline = new THREE.Shape();
      const x = size.w / 2;
      const y = size.h / 2;
      outline.moveTo(-x, y);
      outline.lineTo(x, y);
      outline.lineTo(x, -y);
      outline.lineTo(x * 0.72, -y);
      outline.quadraticCurveTo(0, -y + size.h * 0.42, -x * 0.72, -y);
      outline.lineTo(-x, -y);
      outline.closePath();
      const geometry = extrude(outline, size.d, 0);
      return geometry;
    },
  },
  {
    id: "base-bracket-feet",
    label: "Bracket feet",
    blurb: "Four corner brackets with a shaped apron between them -- the classic base under a bookcase.",
    radiusable: false,
    build: (size) => {
      const rail = size.h * 0.34;
      const foot = Math.min(size.w, size.d) * 0.22;
      const pieces: THREE.BufferGeometry[] = [
        // The rail the case actually stands on.
        at(uprightBox(size.w, rail, size.d, 0), 0, (size.h - rail) / 2, 0),
      ];
      // Each foot is two boards meeting at the corner, which is how a bracket
      // foot is made -- not a solid block.
      const board = Math.min(size.w, size.d) * 0.08;
      const drop = size.h - rail;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          pieces.push(
            at(uprightBox(foot, drop, board, 0), sx * (size.w / 2 - foot / 2), -rail / 2, sz * (size.d / 2 - board / 2))
          );
          pieces.push(
            at(uprightBox(board, drop, foot, 0), sx * (size.w / 2 - board / 2), -rail / 2, sz * (size.d / 2 - foot / 2))
          );
        }
      }
      return assemble(pieces);
    },
  },
  {
    id: "base-bun-feet",
    label: "Turned bun feet",
    blurb: "Four squat turned buns under a plain rail, lifting the piece clear of the floor.",
    radiusable: false,
    build: (size) => {
      const rail = size.h * 0.4;
      const bun = size.h - rail;
      const width = Math.min(size.w, size.d) * 0.26;
      const pieces: THREE.BufferGeometry[] = [
        at(uprightBox(size.w, rail, size.d, 0), 0, (size.h - rail) / 2, 0),
      ];
      // A squashed sphere with a flat at the floor and a neck at the top,
      // which is what a bun actually is off the lathe.
      const profile: Array<[number, number]> = [
        [0.02, 0],
        [0.68, 0.12],
        [1, 0.45],
        [0.78, 0.8],
        [0.46, 1],
        [0.02, 1],
      ];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const shape = turned(profile, { w: width, h: bun, d: width }, 14);
          pieces.push(
            at(shape, sx * (size.w / 2 - width / 2), -rail / 2, sz * (size.d / 2 - width / 2))
          );
        }
      }
      return assemble(pieces);
    },
  },
  {
    id: "base-scalloped",
    label: "Scalloped apron",
    blurb: "The lower edge cut into a run of shallow scallops, carved from the solid.",
    radiusable: false,
    build: (size) => {
      // A front elevation, extruded through the depth, with the bottom edge
      // taken out in a row of arcs. Distinct from the single arch of the
      // arcaded base: a scallop repeats, and the repeat is the ornament.
      const x = size.w / 2;
      const y = size.h / 2;
      const bays = repeats(size.w / (size.h * 1.2), 3);
      const rise = size.h * 0.42;

      const outline = new THREE.Shape();
      outline.moveTo(-x, y);
      outline.lineTo(x, y);
      outline.lineTo(x, -y + rise);
      for (let i = 0; i < bays; i += 1) {
        const from = x - (i * 2 * x) / bays;
        const to = x - ((i + 1) * 2 * x) / bays;
        outline.quadraticCurveTo((from + to) / 2, -y, to, -y + rise);
      }
      outline.lineTo(-x, y);
      outline.closePath();
      return extrude(outline, size.d, 0, 16);
    },
  },
  {
    id: "base-splay-shell",
    label: "Splayed shell",
    blurb: "A box whose four sides lean outward as it rises.",
    radiusable: false,
    build: (size) => frustum(size.w * 0.5, size.d * 0.5, size.w * 0.36, size.d * 0.36, size.h, 4),
  },
];

/* -------------------------------------------------------------------------
   Rails

   Seat frames, aprons, tabletop borders and stretchers: everything that is a
   length of timber tying other things together. They share one list because a
   furniture shop makes them the same way -- what changes is where the rail goes,
   which the rig already knows and this file does not need to.
   ------------------------------------------------------------------------- */

const RAIL_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "rail-square",
    label: "Square rail",
    blurb: "A plain rectangular section, cut square on every edge.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius)),
  },
  {
    id: "rail-chamfered",
    label: "Chamfered rail",
    blurb: "A rail with its lower arrises cut off, so the edge catches light.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const thin = alongX ? size.d : size.w;
      const outline = new THREE.Shape();
      const x = thin / 2;
      const y = size.h / 2;
      const c = Math.min(thin, size.h) * 0.3;
      outline.moveTo(-x, y);
      outline.lineTo(x, y);
      outline.lineTo(x, -y + c);
      outline.lineTo(x - c, -y);
      outline.lineTo(-x + c, -y);
      outline.lineTo(-x, -y + c);
      outline.closePath();
      const geometry = extrude(outline, long, 0);
      geometry.rotateY(Math.PI / 2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-dowel",
    label: "Round dowel",
    blurb: "A turned rod rather than a sawn rail — light, and quick to make.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const r = Math.min(alongX ? size.d : size.w, size.h) / 2;
      const geometry = new THREE.CylinderGeometry(r, r, long, 16);
      geometry.rotateZ(Math.PI / 2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-reeded",
    label: "Reeded rail",
    blurb: "Parallel beads run along the face, in the Regency manner.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const reeds = 5;
      // Sized by the rail's thickness as well as by its height. A reed is a
      // bead standing off the FACE, so on a rail thinner than one fifth of
      // its own height -- which a door panel or a drawer front is -- a radius
      // taken from the height alone stands further off the face than the
      // whole part is deep.
      const bead = Math.min(size.h / reeds, short) / 2;
      const pieces: THREE.BufferGeometry[] = [new THREE.BoxGeometry(long, size.h, short * 0.8)];
      for (let i = 0; i < reeds; i += 1) {
        const t = (i + 0.5) / reeds;
        const reed = new THREE.CylinderGeometry(bead, bead, long, 8);
        reed.rotateZ(Math.PI / 2);
        reed.translate(0, (t - 0.5) * size.h, short * 0.4);
        pieces.push(reed);
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-beaded",
    label: "Beaded edge",
    blurb: "A square rail with a single bead run along its lower edge.",
    radiusable: true,
    build: (size, radius) => {
      const { long, short, alongX } = longHorizontal(size);
      const r = radiusFor(size, radius);
      const body = uprightBox(long, size.h * 0.82, short, r);
      body.translate(0, size.h * 0.09, 0);
      // Against the rail's height as well as its thickness: on a board -- a
      // shelf, a wide top -- the thickness is the long way round, and a bead
      // taken from it alone stands taller than the part it is run along.
      const beadR = Math.min(short, size.h) * 0.3;
      const bead = new THREE.CylinderGeometry(beadR, beadR, long, 10);
      bead.rotateZ(Math.PI / 2);
      bead.translate(0, -size.h * 0.38, 0);
      const geometry = assemble([body, bead]);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-scalloped",
    label: "Scalloped apron",
    blurb: "The lower edge cut in a run of shallow curves.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const bays = 5;
      const outline = new THREE.Shape();
      const x = long / 2;
      const y = size.h / 2;
      outline.moveTo(-x, y);
      outline.lineTo(x, y);
      outline.lineTo(x, -y + size.h * 0.1);
      for (let i = 0; i < bays; i += 1) {
        const from = x - (i * long) / bays;
        const to = x - ((i + 1) * long) / bays;
        outline.quadraticCurveTo((from + to) / 2, -y - size.h * 0.22, to, -y + size.h * 0.1);
      }
      outline.lineTo(-x, y);
      outline.closePath();
      const geometry = extrude(outline, short, 0);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-arched",
    label: "Arched apron",
    blurb: "One long arch swept out of the lower edge, from end to end.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const outline = new THREE.Shape();
      const x = long / 2;
      const y = size.h / 2;
      outline.moveTo(-x, y);
      outline.lineTo(x, y);
      outline.lineTo(x, -y);
      outline.quadraticCurveTo(0, -y + size.h * 1.1, -x, -y);
      outline.closePath();
      const geometry = extrude(outline, short, 0);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-bowed",
    label: "Bowed rail",
    blurb: "A rail bent gently outward along its length, as a bow-front takes.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const segments = 12;
      const pieces: THREE.BufferGeometry[] = [];
      for (let i = 0; i < segments; i += 1) {
        const t = (i + 0.5) / segments;
        const bow = Math.sin(t * Math.PI) * short * 0.7;
        const slice = new THREE.BoxGeometry(long / segments + 0.001, size.h, short);
        slice.translate((t - 0.5) * long, 0, bow);
        pieces.push(slice);
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "rail-splat",
    label: "Slatted",
    blurb: "Several thin slats with air between them instead of one solid rail.",
    radiusable: true,
    build: (size, radius) => {
      const { long, short, alongX } = longHorizontal(size);
      const slats = 4;
      const r = radiusFor(size, radius, short);
      const pitch = size.h / slats;
      const pieces: THREE.BufferGeometry[] = [];
      for (let i = 0; i < slats; i += 1) {
        const slat = roundedBox(long, pitch * 0.62, short, r);
        slat.translate(0, (i + 0.5) * pitch - size.h / 2, 0);
        pieces.push(slat);
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
];

/* -------------------------------------------------------------------------
   Cushions
   ------------------------------------------------------------------------- */

const CUSHION_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "cushion-box",
    label: "Box cushion",
    blurb: "Square-edged and piped, the way a loose seat pad is made.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius, size.h)),
  },
  {
    id: "cushion-waterfall",
    label: "Waterfall front",
    blurb: "The cover carried over the front edge in one unbroken curve.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const outline = roundedRect(faceW, faceH, Math.min(faceW, faceH) * 0.06);
        return extrude(outline, thickness, thickness * 0.48, 10);
      }),
  },
  {
    id: "cushion-plump",
    label: "Plump pad",
    blurb: "Domed in the middle and drawn in at the seams, as feather fill sits.",
    radiusable: false,
    build: (size) => {
      const geometry = new THREE.SphereGeometry(0.5, 24, 16);
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      // Squared off toward the rim so it reads as a cushion rather than a ball:
      // the plan is pushed out to the corners, the section left domed.
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const z = position.getZ(i);
        const spread = 1 + 0.36 * (1 - Math.abs(position.getY(i)) * 2);
        position.setX(i, x * spread);
        position.setZ(i, z * spread);
      }
      position.needsUpdate = true;
      geometry.scale(size.w * 0.78, size.h, size.d * 0.78);
      geometry.computeVertexNormals();
      return geometry;
    },
  },
  {
    id: "cushion-tufted",
    label: "Buttoned",
    blurb: "Drawn down at regular buttons, the classic buttoned pad.",
    radiusable: false,
    build: (size) => {
      const pad = uprightBox(size.w, size.h, size.d, size.h * 0.3);
      const pieces: THREE.BufferGeometry[] = [pad];
      const cols = 3;
      const rows = 2;
      for (let i = 0; i < cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
          const button = new THREE.SphereGeometry(Math.min(size.w / cols, size.d / rows) * 0.12, 10, 8);
          button.scale(1, 0.5, 1);
          button.translate(
            ((i + 0.5) / cols - 0.5) * size.w * 0.8,
            size.h * 0.36,
            ((j + 0.5) / rows - 0.5) * size.d * 0.8
          );
          pieces.push(button);
        }
      }
      return assemble(pieces);
    },
  },
  {
    id: "cushion-channel",
    label: "Channelled",
    blurb: "Stitched into parallel channels so the fill cannot migrate.",
    radiusable: false,
    build: (size) => {
      const channels = 4;
      const pieces: THREE.BufferGeometry[] = [];
      const pitch = size.w / channels;
      // Each channel is exactly one pitch wide, then squashed to the pad's
      // thickness. Built round and capped at the thickness instead -- which
      // is what this did first -- the channels come out narrower than their
      // own spacing on any pad wider than it is deep, and the cushion
      // arrives as four separate logs with daylight between them.
      for (let i = 0; i < channels; i += 1) {
        const tube = new THREE.CylinderGeometry(pitch / 2, pitch / 2, size.d * 0.98, 14);
        tube.rotateX(Math.PI / 2);
        tube.scale(1, size.h / pitch, 1);
        tube.translate((i + 0.5) * pitch - size.w / 2, 0, 0);
        pieces.push(tube);
      }
      return assemble(pieces);
    },
  },
  {
    id: "cushion-bolster",
    label: "Bolster",
    blurb: "A single long roll rather than a flat pad — a back cushion's answer.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const r = Math.min(size.h, alongX ? size.d : size.w) / 2;
      const geometry = new THREE.CapsuleGeometry(r, Math.max(1e-3, long - r * 2), 6, 16);
      geometry.rotateZ(Math.PI / 2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "cushion-wedge",
    label: "Wedge",
    blurb: "Thicker at the back than the front, so the seat tips you backward.",
    radiusable: false,
    build: (size) => {
      const geometry = new THREE.BoxGeometry(size.w, size.h, size.d, 1, 1, 1);
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i += 1) {
        if (position.getY(i) > 0) continue;
        // The underside is lifted at the front, which thins the wedge there
        // without moving the surface anyone actually sits on.
        const front = position.getZ(i) > 0 ? 1 : 0;
        position.setY(i, position.getY(i) + front * size.h * 0.55);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      return geometry;
    },
  },
  {
    id: "cushion-slab",
    label: "Flat slab",
    blurb: "A thin firm pad with no crown at all — foam, not feather.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h * 0.74, size.d, radiusFor(size, radius, size.h * 0.74)),
  },
];

/* -------------------------------------------------------------------------
   Tops and shelves

   The one group where the shape is a plan rather than a section, so these are
   drawn as outlines and extruded. The edge radius here is the bullnose a
   furniture shop would actually run round a top, which is why nearly all of them
   take it.
   ------------------------------------------------------------------------- */

function topShape(
  id: string,
  label: string,
  blurb: string,
  outline: (w: number, h: number) => THREE.Shape,
  segments = 20
): PartShape {
  return {
    id,
    label,
    blurb,
    radiusable: true,
    // Every entry built through here is one extruded outline, which is the
    // condition for cutting an exact hole. See `apertured` on PartShape.
    apertured: true,
    outlineFor: (size) => {
      const { faceW, faceH } = panelFrame(size);
      return outline(faceW, faceH);
    },
    build: (size, radius, apertures) =>
      panel(size, (faceW, faceH, thickness) =>
        extrude(
          punch(outline(faceW, faceH), size, apertures),
          thickness,
          // A panel with a hole in it is extruded square, whatever the edge
          // slider says. ExtrudeGeometry bevels a hole's rim as well as the
          // outer edge, and past a certain radius -- which varies by outline,
          // starting as low as 0.2 on a racetrack top -- the hole's bevel ring
          // sweeps across the opening and caps it at both faces. The hole is
          // still there inside the slab; it just is not a hole any more, and
          // nothing throws to say so.
          //
          // Clamping to the largest radius that happens to work today would be
          // a number with no reason behind it that a future three.js could
          // move. Square edges on a top with a cutout is a thing a furniture shop
          // actually does, and it is the same every time -- so the studio
          // says so in the control rather than quietly producing a solid top.
          // See `apertures` in furniture-studio.tsx, which disables the
          // slider and explains it rather than leaving it moving with no
          // effect.
          apertures?.length ? 0 : radiusFor(size, radius, thickness),
          segments
        )
      ),
  };
}

const TOP_SHAPES: PartShape[] = [
  ORIGINAL,
  topShape("top-rect", "Rectangular", "Square corners, square edges -- the default board.", (w, h) =>
    roundedRect(w, h, 0)
  ),
  topShape("top-soft-rect", "Softened corners", "A rectangle with the four corners taken off gently.", (w, h) =>
    roundedRect(w, h, Math.min(w, h) * 0.08)
  ),
  topShape("top-rounded", "Rounded corners", "Generously rounded corners, safer around a small child.", (w, h) =>
    roundedRect(w, h, Math.min(w, h) * 0.22)
  ),
  topShape("top-racetrack", "Racetrack", "Straight sides closed with a half-round at each end.", (w, h) =>
    roundedRect(w, h, Math.min(w, h) / 2)
  ),
  topShape(
    "top-oval",
    "Oval",
    "A true ellipse — no corners anywhere, and seats an extra guest.",
    (w, h) => {
      const outline = new THREE.Shape();
      outline.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
      return outline;
    },
    32
  ),
  topShape(
    "top-round",
    "Round",
    "A circle on the smaller of the two spans, centred on the frame.",
    (w, h) => {
      const outline = new THREE.Shape();
      outline.absarc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2, false);
      return outline;
    },
    32
  ),
  topShape(
    "top-clipped",
    "Clipped corners",
    "The corners cut off flat, giving an elongated octagon.",
    (w, h) => {
      const c = Math.min(w, h) * 0.2;
      const x = w / 2;
      const y = h / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x + c, -y);
      outline.lineTo(x - c, -y);
      outline.lineTo(x, -y + c);
      outline.lineTo(x, y - c);
      outline.lineTo(x - c, y);
      outline.lineTo(-x + c, y);
      outline.lineTo(-x, y - c);
      outline.lineTo(-x, -y + c);
      outline.closePath();
      return outline;
    },
    4
  ),
  topShape(
    "top-boat",
    "Boat shaped",
    "Bowed out at the middle and drawn in at the ends, as a board room takes.",
    (w, h) => {
      const x = w / 2;
      const y = h / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -y * 0.72);
      outline.quadraticCurveTo(0, -y * 1.16, x, -y * 0.72);
      outline.lineTo(x, y * 0.72);
      outline.quadraticCurveTo(0, y * 1.16, -x, y * 0.72);
      outline.closePath();
      return outline;
    },
    24
  ),
  topShape(
    "top-d-end",
    "D-end",
    "Square at the back and half-round at the front, for a table against a wall.",
    (w, h) => {
      const x = w / 2;
      const y = h / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -y);
      outline.lineTo(x, -y);
      outline.lineTo(x, y * 0.2);
      outline.quadraticCurveTo(x, y, 0, y);
      outline.quadraticCurveTo(-x, y, -x, y * 0.2);
      outline.closePath();
      return outline;
    },
    24
  ),
  topShape(
    "top-reeded-edge",
    "Reeded edge",
    "A row of fine beads run along the front edge, so the board reads as a moulding.",
    (w, h) => {
      // Carved into the OUTLINE rather than applied as separate beads: on a
      // board this thin a bead standing off the face would be thicker than
      // the board, and a scalloped plan reads as reeding from every angle a
      // shelf is actually seen from.
      const x = w / 2;
      const y = h / 2;
      const reeds = Math.max(6, Math.min(MAX_REPEATS, Math.round(w / (h * 0.18))));
      const depth = Math.min(h * 0.05, w / (reeds * 4));

      const outline = new THREE.Shape();
      outline.moveTo(-x, -y);
      outline.lineTo(x, -y);
      outline.lineTo(x, y);
      for (let i = 0; i < reeds; i += 1) {
        const from = x - (i * 2 * x) / reeds;
        const to = x - ((i + 1) * 2 * x) / reeds;
        outline.quadraticCurveTo((from + to) / 2, y - depth, to, y);
      }
      outline.closePath();
      return outline;
    },
    24
  ),
  topShape(
    "top-live-edge",
    "Live edge",
    "One long side left as the tree grew it, waney and irregular.",
    (w, h) => {
      const x = w / 2;
      const y = h / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -y);
      outline.lineTo(x, -y);
      // A fixed wander rather than a random one: a shape that redraws itself
      // differently every time the slider moves is not a design decision the
      // customer can agree to, and the furniture shop has to match whatever the
      // picture showed.
      //
      // Shallow on purpose. The first numbers here were three times this and
      // the "waney" edge came out as a ridge line -- a board with that much
      // movement in it would be cut down before it reached a bench.
      const wander = [0.045, -0.07, 0.03, -0.1, 0.06, -0.04];
      for (let i = 0; i < wander.length; i += 1) {
        const t = (i + 1) / wander.length;
        outline.quadraticCurveTo(
          x - (t - 0.5 / wander.length) * w,
          y + wander[i] * h,
          x - t * w,
          y + (wander[i] / 2) * h
        );
      }
      outline.closePath();
      return outline;
    },
    12
  ),
  {
    id: "top-planked",
    label: "Planked",
    blurb: "Separate boards laid side by side with the joints left visible.",
    radiusable: true,
    build: (size, radius) =>
      panel(size, (faceW, faceH, thickness) => {
        const planks = 5;
        const pitch = faceH / planks;
        const r = Math.min(radiusFor(size, radius, thickness), pitch * 0.2);
        const pieces: THREE.BufferGeometry[] = [];
        for (let i = 0; i < planks; i += 1) {
          const board = extrude(roundedRect(faceW, pitch * 0.96, r), thickness, r, 6);
          board.translate(0, (i + 0.5) * pitch - faceH / 2, 0);
          pieces.push(board);
        }
        return assemble(pieces);
      }),
  },
  {
    id: "top-inset",
    label: "Framed inset",
    blurb: "A border around a panel dropped slightly below it — glass or stone sits here.",
    radiusable: true,
    build: (size, radius) =>
      panel(size, (faceW, faceH, thickness) => {
        const border = Math.min(faceW, faceH) * 0.12;
        const r = radiusFor(size, radius, thickness);
        const frame = extrude(roundedRect(faceW, faceH, r), thickness, r, 8);
        const inset = extrude(
          roundedRect(faceW - border * 2, faceH - border * 2, r),
          thickness * 0.6,
          0,
          8
        );
        inset.translate(0, 0, -thickness * 0.2);
        return assemble([frame, inset]);
      }),
  },
];

/* -------------------------------------------------------------------------
   Doors and drawer fronts
   ------------------------------------------------------------------------- */

/** A frame of four rails around an opening, in the canonical panel frame. */
function frameRails(faceW: number, faceH: number, thickness: number, rail: number, r: number): THREE.BufferGeometry[] {
  return [
    at(extrude(roundedRect(faceW, rail, r), thickness, r, 6), 0, (faceH - rail) / 2, 0),
    at(extrude(roundedRect(faceW, rail, r), thickness, r, 6), 0, -(faceH - rail) / 2, 0),
    at(extrude(roundedRect(rail, faceH - rail * 2, r), thickness, r, 6), -(faceW - rail) / 2, 0, 0),
    at(extrude(roundedRect(rail, faceH - rail * 2, r), thickness, r, 6), (faceW - rail) / 2, 0, 0),
  ];
}

/** The arched door's plan outline, shared by its builder and its hole placement. */
function archedDoorOutline(faceW: number, faceH: number): THREE.Shape {
  const x = faceW / 2;
  const y = faceH / 2;
  const outline = new THREE.Shape();
  outline.moveTo(-x, -y);
  outline.lineTo(x, -y);
  outline.lineTo(x, y - faceH * 0.22);
  outline.quadraticCurveTo(0, y + faceH * 0.06, -x, y - faceH * 0.22);
  outline.closePath();
  return outline;
}

const DOOR_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "door-slab",
    label: "Flat slab",
    blurb: "One unbroken face, with no frame and no panel. Modern and quiet.",
    radiusable: true,
    apertured: true,
    outlineFor: (size) => {
      const { faceW, faceH } = panelFrame(size);
      return roundedRect(faceW, faceH, 0);
    },
    build: (size, radius, apertures) =>
      panel(size, (faceW, faceH, thickness) => {
        const r = radiusFor(size, radius, thickness);
        // A holed panel is extruded square, for the reason set out on
        // topShape: ExtrudeGeometry bevels the hole's rim too, and past a
        // point that closes it over.
        const outline = punch(roundedRect(faceW, faceH, apertures?.length ? 0 : r), size, apertures);
        return extrude(outline, thickness, apertures?.length ? 0 : r, 8);
      }),
  },
  {
    id: "door-shaker",
    label: "Shaker frame",
    blurb: "A square frame around a flat panel set back from it.",
    radiusable: true,
    build: (size, radius) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.16;
        const r = radiusFor(size, radius, thickness);
        const back = extrude(roundedRect(faceW, faceH, r), thickness * 0.5, 0, 6);
        back.translate(0, 0, -thickness * 0.25);
        return assemble([back, ...frameRails(faceW, faceH, thickness, rail, r)]);
      }),
  },
  {
    id: "door-raised",
    label: "Raised panel",
    blurb: "A frame around a panel that stands proud and is chamfered to it.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.16;
        const back = extrude(roundedRect(faceW, faceH, 0), thickness * 0.5, 0, 4);
        back.translate(0, 0, -thickness * 0.25);
        const field = frustum(
          (faceW - rail * 2.6) / 2,
          (faceH - rail * 2.6) / 2,
          (faceW - rail * 1.4) / 2,
          (faceH - rail * 1.4) / 2,
          thickness * 0.5,
          4
        );
        field.rotateX(Math.PI / 2);
        field.translate(0, 0, thickness * 0.25);
        return assemble([back, field, ...frameRails(faceW, faceH, thickness, rail, 0)]);
      }),
  },
  {
    id: "door-two-panel",
    label: "Two panel",
    blurb: "A centre rail dividing the door into an upper and a lower panel.",
    radiusable: true,
    build: (size, radius) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.14;
        const r = radiusFor(size, radius, thickness);
        const back = extrude(roundedRect(faceW, faceH, r), thickness * 0.5, 0, 6);
        back.translate(0, 0, -thickness * 0.25);
        const mid = at(extrude(roundedRect(faceW, rail, r), thickness, r, 6), 0, 0, 0);
        return assemble([back, mid, ...frameRails(faceW, faceH, thickness, rail, r)]);
      }),
  },
  {
    id: "door-beaded",
    label: "Beaded frame",
    blurb: "A framed door with a bead run around the inside of the opening.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.15;
        const bead = rail * 0.22;
        const back = extrude(roundedRect(faceW, faceH, 0), thickness * 0.55, 0, 4);
        back.translate(0, 0, -thickness * 0.22);
        const inner = extrude(
          roundedRect(faceW - rail * 2 + bead * 2, faceH - rail * 2 + bead * 2, bead),
          thickness * 0.9,
          bead,
          8
        );
        return assemble([back, inner, ...frameRails(faceW, faceH, thickness, rail, 0)]);
      }),
  },
  {
    id: "door-louvred",
    label: "Louvred",
    blurb: "Angled slats in a frame, so the bay behind can breathe.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.14;
        const open = faceH - rail * 2;
        const slats = repeats(open / (thickness * 1.8), 4);
        const pitch = open / slats;
        const pieces = frameRails(faceW, faceH, thickness, rail, 0);
        for (let i = 0; i < slats; i += 1) {
          const slat = new THREE.BoxGeometry(faceW - rail * 2, pitch * 0.86, thickness * 0.32);
          slat.rotateX(-0.7);
          slat.translate(0, (i + 0.5) * pitch - open / 2, 0);
          pieces.push(slat);
        }
        return assemble(pieces);
      }),
  },
  {
    id: "door-glazed",
    label: "Glazed grid",
    blurb: "A frame divided by glazing bars, for a door meant to be seen through.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const rail = Math.min(faceW, faceH) * 0.13;
        const bar = rail * 0.34;
        const pieces = frameRails(faceW, faceH, thickness, rail, 0);
        // A thin pane of its own across the opening: without it the door is a
        // hole, and the finish list offers glass here precisely so it can be
        // ordered clear or reeded.
        const pane = extrude(roundedRect(faceW - rail * 2, faceH - rail * 2, 0), thickness * 0.2, 0, 4);
        pieces.push(pane);
        for (let i = 1; i < 3; i += 1) {
          pieces.push(
            at(
              extrude(roundedRect(faceW - rail * 2, bar, 0), thickness * 0.8, 0, 4),
              0,
              (i / 3 - 0.5) * (faceH - rail * 2),
              0
            )
          );
        }
        pieces.push(at(extrude(roundedRect(bar, faceH - rail * 2, 0), thickness * 0.8, 0, 4), 0, 0, 0));
        return assemble(pieces);
      }),
  },
  {
    id: "door-reeded",
    label: "Reeded",
    blurb: "Half-round beads run the full height of the face, side by side.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const reeds = repeats(faceW / (thickness * 1.6), 5);
        const pitch = faceW / reeds;
        // A cylinder already stands on Y, which is the way a reed runs, so
        // there is nothing to rotate. Half of each one is buried in the
        // backing panel behind it, which is what makes it read as a bead
        // proud of the face rather than a rod lying on it -- and it is why
        // the radius is capped against the door's thickness.
        const reed = Math.min(pitch * 0.46, thickness * 0.8);
        const pieces: THREE.BufferGeometry[] = [
          at(extrude(roundedRect(faceW, faceH, 0), thickness * 0.6, 0, 4), 0, 0, -thickness * 0.2),
        ];
        for (let i = 0; i < reeds; i += 1) {
          const bead = new THREE.CylinderGeometry(reed, reed, faceH, 10);
          bead.translate((i + 0.5) * pitch - faceW / 2, 0, thickness * 0.1);
          pieces.push(bead);
        }
        return assemble(pieces);
      }),
  },
  {
    id: "door-slatted",
    label: "Slatted",
    blurb: "Flat horizontal boards with a shadow gap between each one.",
    radiusable: true,
    build: (size, radius) =>
      panel(size, (faceW, faceH, thickness) => {
        const slats = 7;
        const pitch = faceH / slats;
        const r = Math.min(radiusFor(size, radius, thickness), pitch * 0.25);
        const pieces: THREE.BufferGeometry[] = [];
        for (let i = 0; i < slats; i += 1) {
          const slat = extrude(roundedRect(faceW, pitch * 0.8, r), thickness, r, 6);
          slat.translate(0, (i + 0.5) * pitch - faceH / 2, 0);
          pieces.push(slat);
        }
        return assemble(pieces);
      }),
  },
  {
    id: "door-arched",
    label: "Arched head",
    blurb: "A framed door whose top rail is swept into an arch.",
    radiusable: false,
    apertured: true,
    outlineFor: (size) => {
      const { faceW, faceH } = panelFrame(size);
      return archedDoorOutline(faceW, faceH);
    },
    build: (size, radius, apertures) =>
      panel(size, (faceW, faceH, thickness) =>
        extrude(punch(archedDoorOutline(faceW, faceH), size, apertures), thickness, 0, 18)
      ),
  },
  {
    id: "door-fielded-round",
    label: "Round panel",
    blurb: "A circular field set into a square frame — a display cabinet's door.",
    radiusable: false,
    build: (size) =>
      panel(size, (faceW, faceH, thickness) => {
        const back = extrude(roundedRect(faceW, faceH, 0), thickness * 0.55, 0, 4);
        back.translate(0, 0, -thickness * 0.22);
        const disc = new THREE.Shape();
        disc.absarc(0, 0, Math.min(faceW, faceH) * 0.36, 0, Math.PI * 2, false);
        const field = extrude(disc, thickness * 0.9, thickness * 0.2, 28);
        return assemble([back, field]);
      }),
  },
];

/* -------------------------------------------------------------------------
   Armrests
   ------------------------------------------------------------------------- */

const ARM_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "arm-flat",
    label: "Flat pad",
    blurb: "A straight board along the top of the arm, square at both ends.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius)),
  },
  {
    id: "arm-rounded",
    label: "Rounded pad",
    blurb: "The same board with its whole edge bullnosed over.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const geometry = extrude(roundedRect(long, short, Math.min(long, short) * 0.45), size.h, size.h * 0.45, 16);
      geometry.rotateX(-Math.PI / 2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "arm-scroll",
    label: "Scroll arm",
    blurb: "Rolled over at the front in a scroll, as a Victorian arm is shaped.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const outline = new THREE.Shape();
      const x = long / 2;
      const y = size.h / 2;
      // The curl is set out over the front third of the arm. Confined to the
      // last few per cent -- which is where it was -- a scroll on a long
      // shallow arm is a bump, because the height it has to turn through is
      // a fraction of the length it is drawn across.
      outline.moveTo(-x, -y);
      outline.lineTo(x * 0.34, -y);
      outline.quadraticCurveTo(x, -y, x, y * 0.1);
      outline.quadraticCurveTo(x, y * 1.5, x * 0.4, y);
      outline.quadraticCurveTo(x * 0.1, y * 0.55, x * 0.06, y);
      outline.lineTo(-x, y);
      outline.closePath();
      const geometry = extrude(outline, short, short * 0.2, 16);
      geometry.rotateY(alongX ? 0 : Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "arm-tapered",
    label: "Tapered",
    blurb: "Wide where it meets the back and narrowing toward the front.",
    radiusable: true,
    build: (size, radius) => {
      const { alongX } = longHorizontal(size);
      const geometry = uprightBox(size.w, size.h, size.d, radiusFor(size, radius));
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const span = alongX ? size.w : size.d;
      for (let i = 0; i < position.count; i += 1) {
        const t = ((alongX ? position.getX(i) : position.getZ(i)) + span / 2) / span;
        const scale = 1 - 0.4 * t;
        if (alongX) position.setZ(i, position.getZ(i) * scale);
        else position.setX(i, position.getX(i) * scale);
        position.setY(i, position.getY(i) * (1 - 0.2 * t));
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      return geometry;
    },
  },
  {
    id: "arm-dowel",
    label: "Turned rail",
    blurb: "A round rail rather than a flat pad, resting on the uprights.",
    radiusable: false,
    build: (size) => {
      const { long, short, alongX } = longHorizontal(size);
      const r = Math.min(short, size.h) / 2;
      const geometry = new THREE.CapsuleGeometry(r, Math.max(1e-3, long - r * 2), 6, 14);
      geometry.rotateZ(Math.PI / 2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "arm-flared",
    label: "Flared",
    blurb: "Sprung outward away from the seat, so the arm sits wider than the base.",
    radiusable: true,
    build: (size, radius) => {
      const geometry = uprightBox(size.w, size.h, size.d, radiusFor(size, radius));
      // Rolled about the arm's own length, not across it. Tilting the far end
      // upward is what a rotation about the other axis does, and that is a
      // ramp rather than a flare -- it also lifts a long arm clear of the box
      // it was given, which is how it was caught.
      if (longHorizontal(size).alongX) geometry.rotateX(0.16);
      else geometry.rotateZ(0.16);
      return geometry;
    },
  },
];

/* -------------------------------------------------------------------------
   Carcasses
   ------------------------------------------------------------------------- */

const CARCASS_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "carcass-box",
    label: "Square box",
    blurb: "Flat sides, square corners — the plainest casework.",
    radiusable: true,
    build: (size, radius) => uprightBox(size.w, size.h, size.d, radiusFor(size, radius)),
  },
  {
    id: "carcass-chamfer",
    label: "Chamfered corners",
    blurb: "The two front uprights cut back at forty-five degrees.",
    radiusable: false,
    build: (size) => {
      const c = Math.min(size.w, size.d) * 0.16;
      const x = size.w / 2;
      const z = size.d / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -z);
      outline.lineTo(x, -z);
      outline.lineTo(x, z - c);
      outline.lineTo(x - c, z);
      outline.lineTo(-x + c, z);
      outline.lineTo(-x, z - c);
      outline.closePath();
      const geometry = extrude(outline, size.h, 0, 4);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "carcass-bowed",
    label: "Bow front",
    blurb: "The front swept forward in a shallow curve across the whole width.",
    radiusable: false,
    build: (size) => {
      const x = size.w / 2;
      const z = size.d / 2;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -z);
      outline.lineTo(x, -z);
      outline.lineTo(x, z * 0.7);
      outline.quadraticCurveTo(0, z * 1.5, -x, z * 0.7);
      outline.closePath();
      const geometry = extrude(outline, size.h, 0, 24);
      geometry.rotateX(-Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "carcass-tapered",
    label: "Tapered case",
    blurb: "Slightly narrower at the top than the bottom, so it sits down well.",
    radiusable: false,
    build: (size) => frustum(size.w * 0.45, size.d * 0.45, size.w * 0.5, size.d * 0.5, size.h, 4),
  },
  {
    id: "carcass-panelled",
    label: "Panelled sides",
    blurb: "Framed and panelled ends rather than a flat board on each side.",
    radiusable: false,
    build: (size) => {
      const rail = Math.min(size.h, size.d) * 0.12;
      const core = uprightBox(size.w * 0.98, size.h, size.d * 0.98, 0);
      const pieces: THREE.BufferGeometry[] = [core];
      for (const sign of [-1, 1]) {
        for (const piece of frameRails(size.d, size.h, size.w * 0.06, rail, 0)) {
          piece.rotateY(Math.PI / 2);
          piece.translate((sign * size.w) / 2, 0, 0);
          pieces.push(piece);
        }
      }
      return assemble(pieces);
    },
  },
  {
    id: "carcass-arched",
    label: "Arched pediment",
    blurb: "The top swept up into an arch over the case, the way a library bookcase is capped.",
    radiusable: false,
    build: (size) => {
      // Drawn as a front elevation and extruded back through the depth, so
      // the arch is a real silhouette rather than a moulding stuck on a box.
      const x = size.w / 2;
      const y = size.h / 2;
      const shoulder = size.h * 0.34;
      const outline = new THREE.Shape();
      outline.moveTo(-x, -y);
      outline.lineTo(x, -y);
      outline.lineTo(x, y - shoulder);
      outline.quadraticCurveTo(x * 0.55, y, 0, y);
      outline.quadraticCurveTo(-x * 0.55, y, -x, y - shoulder);
      outline.closePath();
      const geometry = extrude(outline, size.d, 0, 20);
      return geometry;
    },
  },
  {
    id: "carcass-fluted",
    label: "Fluted uprights",
    blurb: "Shallow vertical flutes carved down the two front stiles, as on a classical pilaster.",
    radiusable: false,
    build: (size) => {
      const core = uprightBox(size.w, size.h, size.d, 0);
      const pieces: THREE.BufferGeometry[] = [core];

      // Three flutes per upright, run as half-round beads standing off the
      // face. Sized against the DEPTH as well as the width, for the reason
      // rail-reeded gives: a bead taken from the width alone stands further
      // off a shallow case than the case is deep.
      const stile = size.w * 0.13;
      const flutes = 3;
      const bead = Math.min(stile / (flutes * 2), size.d * 0.06);
      for (const side of [-1, 1]) {
        for (let i = 0; i < flutes; i += 1) {
          const t = (i + 0.5) / flutes;
          const flute = new THREE.CylinderGeometry(bead, bead, size.h * 0.94, 8);
          pieces.push(
            at(
              flute,
              side * (size.w / 2 - stile + (t - 0.5) * stile * 0.9),
              0,
              size.d / 2
            )
          );
        }
      }
      return assemble(pieces);
    },
  },
  {
    id: "carcass-dentil",
    label: "Dentil cornice",
    blurb: "A run of small square teeth carved under the top edge, with a moulded cap above them.",
    radiusable: false,
    build: (size) => {
      const cap = size.h * 0.05;
      const toothH = size.h * 0.035;
      const core = uprightBox(size.w, size.h - cap - toothH, size.d, 0);
      const pieces: THREE.BufferGeometry[] = [
        at(core, 0, -(cap + toothH) / 2, 0),
        // The cap oversails the case on three sides, which is what makes a
        // cornice read as a cornice rather than as a lid.
        at(uprightBox(size.w * 1.06, cap, size.d * 1.06, 0), 0, (size.h - cap) / 2, 0),
      ];

      const tooth = Math.max(size.w * 0.035, 1e-3);
      const count = repeats(size.w / (tooth * 2), 4);
      const y = size.h / 2 - cap - toothH / 2;
      for (let i = 0; i < count; i += 1) {
        const t = (i + 0.5) / count;
        pieces.push(
          at(
            new THREE.BoxGeometry(tooth, toothH, tooth),
            (t - 0.5) * (size.w - tooth),
            y,
            size.d / 2
          )
        );
      }
      return assemble(pieces);
    },
  },
  {
    id: "carcass-graduated",
    label: "Graduated case",
    blurb: "Three stages, each shallower than the one below, so the case steps back as it rises.",
    radiusable: false,
    build: (size) => {
      // The old library form: the bottom stage takes folios, the top takes
      // octavos, and the piece leans away from the room instead of over it.
      const stages = 3;
      const stageH = size.h / stages;
      const pieces: THREE.BufferGeometry[] = [];
      for (let i = 0; i < stages; i += 1) {
        const shrink = 1 - i * 0.16;
        const depth = size.d * shrink;
        pieces.push(
          at(
            uprightBox(size.w, stageH, depth, 0),
            0,
            -size.h / 2 + stageH * (i + 0.5),
            // Held to the back, so the steps all fall on the front face.
            (size.d - depth) / -2
          )
        );
      }
      return assemble(pieces);
    },
  },
  {
    id: "carcass-open",
    label: "Open shelving",
    blurb: "Two sides and a top with the back and front left open.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius, Math.min(size.w, size.d) * 0.2);
      const t = Math.min(size.w, size.d) * 0.08;
      return assemble([
        at(uprightBox(t, size.h, size.d, r), -(size.w - t) / 2, 0, 0),
        at(uprightBox(t, size.h, size.d, r), (size.w - t) / 2, 0, 0),
        at(uprightBox(size.w, t, size.d, r), 0, (size.h - t) / 2, 0),
        at(uprightBox(size.w, t, size.d, r), 0, -(size.h - t) / 2, 0),
      ]);
    },
  },
];

/* -------------------------------------------------------------------------
   Hardware

   The one group that must NOT fill the box it is given. A pull is a bought
   component at a fixed size, and the rig already refuses to stretch hardware
   when the piece is resized (see the `hardware` role in studio-config.ts) --
   so these builders work off the smallest sensible dimension rather than
   spreading to the corners of whatever space the original knob occupied.
   ------------------------------------------------------------------------- */

const HARDWARE_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "pull-bar",
    label: "Bar pull",
    blurb: "A straight round bar on two posts — the commonest modern pull.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const r = Math.min(size.h, long) * 0.16;
      const bar = new THREE.CylinderGeometry(r, r, long, 14);
      bar.rotateZ(Math.PI / 2);
      bar.translate(0, 0, size.d * 0.3);
      const pieces = [bar];
      for (const sign of [-1, 1]) {
        const post = new THREE.CylinderGeometry(r * 0.6, r * 0.6, size.d * 0.6, 10);
        post.rotateX(Math.PI / 2);
        post.translate((sign * long) / 2.6, 0, 0);
        pieces.push(post);
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-square-bar",
    label: "Square bar pull",
    blurb: "The same pull in square section, for a squarer piece.",
    radiusable: true,
    build: (size, radius) => {
      const { long, alongX } = longHorizontal(size);
      const t = Math.min(size.h, long) * 0.3;
      const r = radiusFor(size, radius, t);
      const bar = at(roundedBox(long, t, t, r), 0, 0, size.d * 0.3);
      const pieces = [bar];
      for (const sign of [-1, 1]) {
        pieces.push(at(roundedBox(t * 0.6, t * 0.6, size.d * 0.6, r), (sign * long) / 2.6, 0, 0));
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-knob",
    label: "Round knob",
    blurb: "A turned knob on a short stem. Sits on a door or a small drawer.",
    radiusable: false,
    build: (size) =>
      turned(
        [
          [0, 0],
          [0.3, 0],
          [0.24, 0.3],
          [0.5, 0.5],
          [0.5, 0.8],
          [0.34, 1],
          [0, 1],
        ],
        { w: Math.min(size.w, size.d), h: size.h, d: Math.min(size.w, size.d) },
        20
      ),
  },
  {
    id: "pull-mushroom",
    label: "Mushroom knob",
    blurb: "A flatter, wider knob with a domed face and a hollow underside.",
    radiusable: false,
    build: (size) =>
      turned(
        [
          [0, 0],
          [0.22, 0],
          [0.2, 0.36],
          [0.5, 0.52],
          [0.44, 0.9],
          [0.2, 1],
          [0, 1],
        ],
        { w: Math.min(size.w, size.d), h: size.h, d: Math.min(size.w, size.d) },
        20
      ),
  },
  {
    id: "pull-cup",
    label: "Cup pull",
    blurb: "A shell you hook your fingers under — a chest of drawers' pull.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const outer = new THREE.CylinderGeometry(size.h * 0.5, size.h * 0.5, long, 16, 1, false, 0, Math.PI);
      outer.rotateZ(Math.PI / 2);
      const back = new THREE.BoxGeometry(long, size.h, size.d * 0.2);
      back.translate(0, 0, -size.d * 0.2);
      const geometry = assemble([outer, back]);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-ring",
    label: "Ring pull",
    blurb: "A hanging ring on a backplate, as a period piece takes.",
    radiusable: false,
    build: (size) => {
      const r = Math.min(size.w, size.h) * 0.34;
      const ring = new THREE.TorusGeometry(r, r * 0.22, 8, 22);
      ring.translate(0, -r * 0.5, size.d * 0.2);
      const plate = new THREE.CylinderGeometry(r * 0.5, r * 0.5, size.d * 0.4, 14);
      plate.rotateX(Math.PI / 2);
      plate.translate(0, r * 0.4, 0);
      return assemble([ring, plate]);
    },
  },
  {
    id: "pull-t-bar",
    label: "T-bar",
    blurb: "A single short bar on one central post, for a narrow drawer.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const r = Math.min(size.h, long) * 0.18;
      const bar = new THREE.CylinderGeometry(r, r, long * 0.7, 12);
      bar.rotateZ(Math.PI / 2);
      bar.translate(0, 0, size.d * 0.34);
      const post = new THREE.CylinderGeometry(r * 0.7, r * 0.7, size.d * 0.7, 10);
      post.rotateX(Math.PI / 2);
      const geometry = assemble([bar, post]);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-recessed",
    label: "Recessed pull",
    blurb: "A slot let into the front itself, with nothing standing proud.",
    radiusable: true,
    build: (size, radius) => {
      const { long, alongX } = longHorizontal(size);
      const r = radiusFor(size, radius, size.h * 0.5);
      const geometry = roundedBox(long, size.h * 0.5, size.d * 0.4, r);
      geometry.translate(0, 0, -size.d * 0.2);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-edge",
    label: "Edge pull",
    blurb: "A lip along the top of the front, gripped from above.",
    radiusable: true,
    build: (size, radius) => {
      const { long, alongX } = longHorizontal(size);
      const r = radiusFor(size, radius, size.h * 0.4);
      const lip = at(roundedBox(long, size.h * 0.4, size.d, r), 0, size.h * 0.3, 0);
      const web = at(roundedBox(long, size.h * 0.6, size.d * 0.3, r), 0, -size.h * 0.2, -size.d * 0.2);
      const geometry = assemble([lip, web]);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "pull-drop",
    label: "Drop handle",
    blurb: "A swinging bail between two rosettes, on a traditional chest.",
    radiusable: false,
    build: (size) => {
      const { long, alongX } = longHorizontal(size);
      const rod = Math.min(size.h, long) * 0.1;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-long * 0.38, size.h * 0.2, size.d * 0.1),
        new THREE.Vector3(-long * 0.3, -size.h * 0.32, size.d * 0.3),
        new THREE.Vector3(long * 0.3, -size.h * 0.32, size.d * 0.3),
        new THREE.Vector3(long * 0.38, size.h * 0.2, size.d * 0.1),
      ]);
      const pieces: THREE.BufferGeometry[] = [new THREE.TubeGeometry(curve, 20, rod, 8, false)];
      for (const sign of [-1, 1]) {
        const rosette = new THREE.CylinderGeometry(rod * 2.2, rod * 2.6, size.d * 0.4, 14);
        rosette.rotateX(Math.PI / 2);
        rosette.translate(sign * long * 0.38, size.h * 0.2, 0);
        pieces.push(rosette);
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
];

/* -------------------------------------------------------------------------
   Applied ornament
   ------------------------------------------------------------------------- */

const ORNAMENT_SHAPES: PartShape[] = [
  ORIGINAL,
  {
    id: "orn-rosette",
    label: "Rosette",
    blurb: "A carved flower on a round ground, applied where two members meet.",
    radiusable: false,
    build: (size) => {
      const petals = 8;
      // Built round at unit size and squashed to the part's plan afterwards,
      // rather than given a radius off one dimension. A rosette on a wide
      // shallow ground is an oval rosette, which is right; a round one sized
      // off the width alone is simply taller than the part it sits on.
      const ground = new THREE.CylinderGeometry(0.5, 0.46, 1, 20);
      ground.rotateX(Math.PI / 2);
      ground.scale(size.w, size.h, size.d * 0.4);
      const pieces: THREE.BufferGeometry[] = [ground];
      for (let i = 0; i < petals; i += 1) {
        const angle = (i / petals) * Math.PI * 2;
        const petal = new THREE.SphereGeometry(0.5, 10, 8);
        petal.scale(size.w * 0.34, size.h * 0.34, size.d * 0.4);
        petal.translate(Math.cos(angle) * size.w * 0.3, Math.sin(angle) * size.h * 0.3, size.d * 0.22);
        pieces.push(petal);
      }
      const boss = new THREE.SphereGeometry(0.5, 12, 8);
      boss.scale(size.w * 0.3, size.h * 0.3, size.d * 0.6);
      boss.translate(0, 0, size.d * 0.3);
      pieces.push(boss);
      return assemble(pieces);
    },
  },
  {
    id: "orn-bead",
    label: "Bead",
    blurb: "A single turned bead — the quietest way to mark a joint.",
    radiusable: false,
    build: (size) => {
      const geometry = new THREE.SphereGeometry(0.5, 16, 12);
      geometry.scale(size.w, size.h, size.d);
      return geometry;
    },
  },
  {
    id: "orn-dentil",
    label: "Dentil run",
    blurb: "A row of small square blocks, as under a classical cornice.",
    radiusable: true,
    build: (size, radius) => {
      const { long, short, alongX } = longHorizontal(size);
      const teeth = repeats(long / Math.max(size.h, 1e-4) / 0.9, 4);
      const pitch = long / teeth;
      const r = radiusFor(size, radius, Math.min(pitch, size.h));
      const pieces: THREE.BufferGeometry[] = [];
      for (let i = 0; i < teeth; i += 1) {
        pieces.push(at(roundedBox(pitch * 0.55, size.h, short, r), (i + 0.5) * pitch - long / 2, 0, 0));
      }
      const geometry = assemble(pieces);
      if (!alongX) geometry.rotateY(Math.PI / 2);
      return geometry;
    },
  },
  {
    id: "orn-fluted-block",
    label: "Fluted block",
    blurb: "A square block with short flutes cut in its face.",
    radiusable: true,
    build: (size, radius) => {
      const r = radiusFor(size, radius);
      const block = roundedBox(size.w, size.h, size.d * 0.7, r);
      const pieces: THREE.BufferGeometry[] = [block];
      for (let i = 0; i < 3; i += 1) {
        const rib = new THREE.CylinderGeometry(size.w * 0.08, size.w * 0.08, size.h * 0.8, 8);
        rib.translate(((i - 1) * size.w) / 3.2, 0, size.d * 0.32);
        pieces.push(rib);
      }
      return assemble(pieces);
    },
  },
  {
    id: "orn-cabochon",
    label: "Cabochon",
    blurb: "A raised oval boss, domed like a polished stone.",
    radiusable: false,
    build: (size) => {
      // A whole ellipsoid, not a hemisphere. An open half-sphere has no back,
      // and applied ornament is looked at from every angle a chair is: from
      // slightly behind it read as a bowl. The lower half is buried in the
      // ground it is applied to, so nothing is lost by closing it.
      const geometry = new THREE.SphereGeometry(0.5, 18, 12);
      geometry.scale(size.w, size.h, size.d * 1.4);
      return geometry;
    },
  },
  {
    id: "orn-scroll",
    label: "Scroll",
    blurb: "A carved volute, turning in on itself the way a bracket does.",
    radiusable: false,
    build: (size) => {
      const turns = 22;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= turns; i += 1) {
        const t = i / turns;
        const angle = t * Math.PI * 2.6;
        const r = (1 - t * 0.78) * 0.5;
        points.push(new THREE.Vector3(Math.cos(angle) * r * size.w, Math.sin(angle) * r * size.h, 0));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 40, Math.min(size.w, size.h) * 0.1, 8, false);
    },
  },
  {
    id: "orn-pyramid",
    label: "Pyramid stud",
    blurb: "A four-sided point, the sharpest of the applied marks.",
    radiusable: false,
    build: (size) => {
      // Rotated so the point leaves the FACE. Applied ornament is fitted to a
      // surface and the rest of this list is built facing +Z; a stud left
      // standing on Y points along the rail it is applied to rather than out
      // of it, which is a spike lying on its side.
      const geometry = frustum(0.01, 0.01, size.w * 0.5, size.h * 0.5, size.d, 4);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    },
  },
];

/* -------------------------------------------------------------------------
   Which list a part draws from
   ------------------------------------------------------------------------- */

/**
 * The shape list for each role, before the base/legs split below.
 *
 * Roles share a list wherever a furniture shop would make the two things the same
 * way -- a seat rail, an apron, a tabletop border and a stretcher are all a
 * length of timber, so they get one list rather than four copies of it. A
 * shelf shares the tops list for the same reason: it is a board, and the
 * question ("what plan, what edge?") has the same answers.
 */
const ROLE_SHAPES: Record<PartRole, PartShape[]> = {
  // A leaf is a flat board, so it takes the same outlines a top does -- and
  // with them the cutouts, since both are single extruded outlines.
  leaf: TOP_SHAPES,
  base: LEG_SHAPES,
  seatFrame: RAIL_SHAPES,
  apron: RAIL_SHAPES,
  // A border is a TOP, not a rail, and this was rail shapes until a table's
  // own top turned out to have no flat shape to become and so no way to take
  // a hole. The distinction the two lists draw is between a stick and a
  // board: a seat rail and an apron really are sticks, and a scalloped or
  // dowelled one is a thing a furniture shop cuts. A tabletopBorder is the visible
  // top surface -- on the dining table it is 180 x 90cm of timber framing the
  // inset panel -- and offering it a dowel profile was offering to turn a
  // table top into a broom handle. Substituting ANY shape here already
  // replaces the frame with a solid slab (that is what a shape substitution
  // does), so the only question is whether the slab is shaped like a top or
  // like a rail.
  tabletopBorder: TOP_SHAPES,
  stretcher: RAIL_SHAPES,
  backFrame: RAIL_SHAPES,
  seatCushion: CUSHION_SHAPES,
  backCushion: CUSHION_SHAPES,
  armrest: ARM_SHAPES,
  tabletop: TOP_SHAPES,
  shelf: TOP_SHAPES,
  door: DOOR_SHAPES,
  drawer: DOOR_SHAPES,
  carcass: CARCASS_SHAPES,
  // A bed's parts are made the way their chair and table counterparts are:
  // rails and boards are lengths of timber like a seat rail or a back frame,
  // the mattress base spans the rails as a stretcher does, and the mattress
  // and a headboard insert are pads.
  bedRail: RAIL_SHAPES,
  headboard: RAIL_SHAPES,
  footboard: RAIL_SHAPES,
  mattressSupport: RAIL_SHAPES,
  mattress: CUSHION_SHAPES,
  headboardPanel: CUSHION_SHAPES,
  // Bedlinen is staging, not something a furniture shop builds, so it has no
  // shapes to offer beyond the one it was modelled with.
  bedding: [ORIGINAL],
  pillows: [ORIGINAL],
  hardware: HARDWARE_SHAPES,
  accessory: ORNAMENT_SHAPES,
};

/**
 * How many separate shells a base needs before its shapes are leg shapes.
 *
 * Three, because that is the fewest legs anything here stands on, and because
 * the alternative reading -- a moulded shell that happened to be exported in
 * two pieces -- is common enough that two is not evidence of anything. This
 * is the same signal `buildGenericPartDefs` uses to decide whether to call
 * the part "Legs" or "Base", and it must stay the same signal: a part labelled
 * "Legs" that offers drum shapes, or one labelled "Woven shell" that offers a
 * hairpin, is the interface contradicting itself.
 */
const LEGS_SHELL_THRESHOLD = 3;

/**
 * The shapes this part can actually be rebuilt as.
 *
 * `shellCount` is how many separate shells the rig ended up with for this
 * part, and it is only consulted for the base role -- see above. Callers that
 * do not have it yet (a panel drawn before the model has finished loading)
 * may leave it out, and get the solid-base list, which is the safer of the two
 * to show briefly: every entry in it fills the space the part occupied,
 * whereas a leg shape shown for a woven shell would promise a piece nobody
 * would want built.
 */
export function shapesForPart(part: PartDef, shellCount = 1): PartShape[] {
  if (part.role === "base") {
    return shellCount >= LEGS_SHELL_THRESHOLD ? LEG_SHAPES : SOLID_BASE_SHAPES;
  }
  return ROLE_SHAPES[part.role] ?? [ORIGINAL];
}

/** One shape by id, from any list -- for naming a stored design's choice. */
export function shapeById(id: string | undefined): PartShape | null {
  if (!id || id === ORIGINAL_SHAPE_ID) return null;
  for (const list of ALL_LISTS) {
    const hit = list.find((shape) => shape.id === id);
    if (hit) return hit;
  }
  return null;
}

const ALL_LISTS = [
  LEG_SHAPES,
  SOLID_BASE_SHAPES,
  RAIL_SHAPES,
  CUSHION_SHAPES,
  TOP_SHAPES,
  DOOR_SHAPES,
  ARM_SHAPES,
  CARCASS_SHAPES,
  HARDWARE_SHAPES,
  ORNAMENT_SHAPES,
];

/** What to call a part's shape on an order or a drawing. */
export function shapeName(id: string | undefined): string {
  return shapeById(id)?.label ?? "As modelled";
}

/* -------------------------------------------------------------------------
   Carving

   Relief worked into the broad face of a part, on top of whatever shape it is
   already wearing.

   A third axis again, and it has to be one: a shape is the whole silhouette of
   a part, a cutout removes material through it, and carving is neither. A
   fluted case and a plain case are the same case -- same outline, same box,
   same joinery -- and folding "fluted" into the shape catalogue would mean an
   entry for every combination of silhouette and ornament, which is a
   catalogue nobody can publish and a stored design nobody can reopen.

   So carving is generated against the part's own box and merged onto whatever
   the shape built. That is what lets a bow-fronted case be reeded, a
   graduated case be dentilled, and the piece as modelled be carved without
   any of them needing an entry of their own.

   Which face gets it: the broad one, the face perpendicular to the part's
   thinnest axis. On an upright case that is the front; on a shelf it is the
   top. Both are the face you actually see.
   ------------------------------------------------------------------------- */

export type Carving = {
  id: string;
  label: string;
  blurb: string;
  /**
   * Relief for a face of `faceW` x `faceH`, drawn in the plan frame (XY, with
   * the face at z = 0) and standing off it by `relief`. The caller rotates it
   * onto whichever axis the part is actually thin on.
   */
  build: (faceW: number, faceH: number, relief: number) => THREE.BufferGeometry[];
};

/** The absence of carving, stored as an absence. See `carvingById`. */
export const CARVING_NONE_ID = "none";

/**
 * How far carving stands off the face, as a fraction of the part's thickness.
 *
 * Shallow on purpose, and capped against the thinnest dimension rather than
 * the widest: relief is cut INTO stock a joiner has to have left, so ornament
 * standing a quarter of the part's own depth off its face is not carving, it
 * is a second part glued on. A 30cm-deep case gets 9mm of relief, which is
 * about what a router actually takes out.
 */
const CARVING_RELIEF = 0.03;

/**
 * How much carveable area a face needs, as a share of the largest one, before
 * it is worked too.
 *
 * Carving used to go on the single best face, which on a bookcase carcass is
 * the back panel -- so the case came back with relief only on the inside,
 * seen through the opening, and its sides and top left plain. A case is one
 * piece of furniture and reads as one: whatever is worked into it belongs on
 * every face of it you can see.
 *
 * A share rather than an absolute size, because parts differ by two orders of
 * magnitude -- a 1.7m case side and a 20mm shelf edge. A tenth keeps every
 * face that reads as a face (the sides, back and top of a case) and drops the
 * ones that are really edges: on a shelf, the two broad faces are carved and
 * its 20mm rim is not, which is right -- a flute squeezed across 20mm is a
 * scratch, not a flute.
 *
 * An open front needs no rule of its own. A face's area is already multiplied
 * by how much of it has timber behind it, and any piece that still lands over
 * a hole is dropped when it is probed individually.
 *
 * A separate minimum on coverage was tried here and taken out again: it
 * excluded nothing. The relief that hung in a bookcase's opening turned out to
 * be caused by relief depth, not by which faces were chosen -- and a rule that
 * cannot change an outcome is one no test can hold to account.
 */
const CARVING_FACE_SHARE = 0.1;


export const CARVINGS: Carving[] = [
  {
    id: CARVING_NONE_ID,
    label: "Plain",
    blurb: "No ornament at all -- the face left as it was cut.",
    build: () => [],
  },
  {
    id: "carve-fluted",
    label: "Fluted",
    blurb: "Vertical half-round flutes run the height of the face, as on a classical pilaster.",
    build: (faceW, faceH, relief) => {
      const count = repeats(faceW / (faceH * 0.08), 5);
      const bead = Math.min(faceW / (count * 2.6), relief);
      return Array.from({ length: count }, (_, i) => {
        const t = (i + 0.5) / count;
        const flute = new THREE.CylinderGeometry(bead, bead, faceH * 0.92, 8);
        flute.translate((t - 0.5) * faceW * 0.94, 0, 0);
        return flute;
      });
    },
  },
  {
    id: "carve-reeded",
    label: "Reeded",
    blurb: "Fine beads run across the face the short way, in the Regency manner.",
    build: (faceW, faceH, relief) => {
      const count = repeats(faceH / (faceW * 0.08), 5);
      const bead = Math.min(faceH / (count * 2.6), relief);
      return Array.from({ length: count }, (_, i) => {
        const t = (i + 0.5) / count;
        const reed = new THREE.CylinderGeometry(bead, bead, faceW * 0.94, 8);
        reed.rotateZ(Math.PI / 2);
        reed.translate(0, (t - 0.5) * faceH * 0.92, 0);
        return reed;
      });
    },
  },
  {
    id: "carve-dentil",
    label: "Dentil band",
    blurb: "A row of small square teeth carved across the head of the face.",
    build: (faceW, faceH, relief) => {
      const tooth = Math.max(faceW * 0.04, 1e-3);
      const count = repeats(faceW / (tooth * 2), 4);
      const band = Math.min(tooth, faceH * 0.06);
      return Array.from({ length: count }, (_, i) => {
        const t = (i + 0.5) / count;
        const block = new THREE.BoxGeometry(tooth, band, relief * 2);
        block.translate((t - 0.5) * (faceW - tooth), faceH / 2 - band, 0);
        return block;
      });
    },
  },
  {
    id: "carve-lattice",
    label: "Solihiya lattice",
    blurb: "A diagonal criss-cross worked across the whole face, the caned weave cut in timber.",
    build: (faceW, faceH, relief) => {
      // The app's own pattern, in relief. Two diagonal runs crossing at right
      // angles, which is what the weave is before the octagons open up.
      //
      // Each slat is cut to the chord it actually spans, not run out to the
      // full diagonal and left to overhang. A diagonal across a rectangle is
      // long in the middle and short at the corners, and a first version that
      // ignored that produced a lattice standing off every edge of the face --
      // ornament in mid-air, on a part it was supposed to be carved into.
      const diagonal = Math.hypot(faceW, faceH);
      const bar = Math.min(relief * 1.4, Math.min(faceW, faceH) * 0.04);
      const spacing = Math.max(bar * 4.5, Math.min(faceW, faceH) / 7);
      const count = repeats(diagonal / spacing, 3);
      const pieces: THREE.BufferGeometry[] = [];

      for (const angle of [Math.PI / 4, -Math.PI / 4]) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        // The normal, along which the slats are spaced.
        const nx = -dy;
        const ny = dx;

        for (let i = 0; i < count; i += 1) {
          const offset = ((i + 0.5) / count - 0.5) * diagonal;
          const cx = offset * nx;
          const cy = offset * ny;

          // How far along the slat's own direction it may run before leaving
          // the face, on each axis; the tighter pair is the chord.
          //
          // Clipped against a face inset by the bar's own width rather than
          // against the face itself. A slat is a box, not a line: cut its
          // CENTRE line exactly to the boundary and the two corners on the
          // outside of it still cross, which at forty-five degrees is the
          // whole bar's width of ornament hanging off the edge.
          const halfW = Math.max(1e-4, faceW / 2 - bar);
          const halfH = Math.max(1e-4, faceH / 2 - bar);
          const spanX = [(-halfW - cx) / dx, (halfW - cx) / dx].sort((a, b) => a - b);
          const spanY = [(-halfH - cy) / dy, (halfH - cy) / dy].sort((a, b) => a - b);
          const from = Math.max(spanX[0], spanY[0]);
          const to = Math.min(spanX[1], spanY[1]);
          const length = to - from;
          // Shorter than its own width is a corner nick, not a slat.
          if (length <= bar) continue;

          const middle = (from + to) / 2;
          const slat = new THREE.BoxGeometry(length, bar, relief * 1.6);
          slat.rotateZ(angle);
          slat.translate(cx + dx * middle, cy + dy * middle, 0);
          pieces.push(slat);
        }
      }
      return pieces;
    },
  },
  {
    id: "carve-beaded-frame",
    label: "Beaded margin",
    blurb: "A single bead run round the edge of the face, framing it.",
    build: (faceW, faceH, relief) => {
      const inset = Math.min(faceW, faceH) * 0.07;
      const w = faceW - inset * 2;
      const h = faceH - inset * 2;
      const bead = Math.min(relief, inset * 0.5);
      const pieces: THREE.BufferGeometry[] = [];

      for (const sign of [-1, 1]) {
        const run = new THREE.CylinderGeometry(bead, bead, w, 8);
        run.rotateZ(Math.PI / 2);
        run.translate(0, (sign * h) / 2, 0);
        pieces.push(run);

        const stile = new THREE.CylinderGeometry(bead, bead, h, 8);
        stile.translate((sign * w) / 2, 0, 0);
        pieces.push(stile);
      }
      return pieces;
    },
  },
  {
    id: "carve-chequer",
    label: "Chequered",
    blurb: "A grid of raised squares, cut like a draught board across the face.",
    build: (faceW, faceH, relief) => {
      const across = repeats(faceW / (Math.min(faceW, faceH) * 0.22), 3);
      const down = repeats(faceH / (Math.min(faceW, faceH) * 0.22), 3);
      const cellW = (faceW * 0.94) / across;
      const cellH = (faceH * 0.94) / down;
      const pieces: THREE.BufferGeometry[] = [];

      for (let ix = 0; ix < across; ix += 1) {
        for (let iy = 0; iy < down; iy += 1) {
          // Every other one, so the pattern reads as a chequer rather than a
          // field of identical bumps.
          if ((ix + iy) % 2 !== 0) continue;
          const block = new THREE.BoxGeometry(cellW * 0.82, cellH * 0.82, relief * 2);
          block.translate(
            ((ix + 0.5) / across - 0.5) * faceW * 0.94,
            ((iy + 0.5) / down - 0.5) * faceH * 0.94,
            0
          );
          pieces.push(block);
        }
      }
      return pieces;
    },
  },
];

/** The carving with this id, or null for "Plain" and for anything unknown. */
export function carvingById(id: string | undefined): Carving | null {
  if (!id || id === CARVING_NONE_ID) return null;
  return CARVINGS.find((carving) => carving.id === id) ?? null;
}

/** What to call a part's carving on an order or a drawing. */
export function carvingName(id: string | undefined): string {
  return CARVINGS.find((carving) => carving.id === id)?.label ?? "Plain";
}

/**
 * Merges carving onto a part's built geometry.
 *
 * Takes the geometry it is given and returns a new one, leaving the original
 * untouched -- which matters more than it looks: on "As modelled" the geometry
 * passed in is the mesh that came out of the GLB, and the rig keeps that as
 * the one real way back to the piece as drawn. Carving it in place would mean
 * the model's own geometry could never be recovered.
 */
/** One of the six outward faces of a part's box, and how it is oriented. */
type CarveFace = {
  axis: "x" | "y" | "z";
  sign: 1 | -1;
  faceW: number;
  faceH: number;
  thickness: number;
  /** Outward normal. */
  normal: THREE.Vector3;
  /** Lays a plan-frame geometry (XY face, +Z out) onto this face. */
  orient: (geometry: THREE.BufferGeometry) => THREE.BufferGeometry;
};

function facesOf(size: ThreeSize): CarveFace[] {
  const { x, y, z } = size;
  return [
    {
      axis: "z",
      sign: 1,
      faceW: x,
      faceH: y,
      thickness: z,
      normal: new THREE.Vector3(0, 0, 1),
      orient: (g) => g,
    },
    {
      axis: "z",
      sign: -1,
      faceW: x,
      faceH: y,
      thickness: z,
      normal: new THREE.Vector3(0, 0, -1),
      orient: (g) => g.rotateY(Math.PI),
    },
    {
      axis: "x",
      sign: 1,
      faceW: z,
      faceH: y,
      thickness: x,
      normal: new THREE.Vector3(1, 0, 0),
      orient: (g) => g.rotateY(Math.PI / 2),
    },
    {
      axis: "x",
      sign: -1,
      faceW: z,
      faceH: y,
      thickness: x,
      normal: new THREE.Vector3(-1, 0, 0),
      orient: (g) => g.rotateY(-Math.PI / 2),
    },
    {
      axis: "y",
      sign: 1,
      faceW: x,
      faceH: z,
      thickness: y,
      normal: new THREE.Vector3(0, 1, 0),
      orient: (g) => g.rotateX(-Math.PI / 2),
    },
    {
      axis: "y",
      sign: -1,
      faceW: x,
      faceH: z,
      thickness: y,
      normal: new THREE.Vector3(0, -1, 0),
      orient: (g) => g.rotateX(Math.PI / 2),
    },
  ];
}

type ThreeSize = { x: number; y: number; z: number };

/** The two in-plane axes of a face, in world terms. */
function axesOf(face: CarveFace): { across: THREE.Vector3; up: THREE.Vector3 } {
  if (face.axis === "z") return { across: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };
  if (face.axis === "x") return { across: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) };
  return { across: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) };
}

/**
 * Where the surface visible from this direction actually is, at a point on
 * the face, as a signed distance from the part's own middle.
 *
 * Not the bounding box's plane. A bookcase's back panel is half a metre
 * behind the front of its box, and it is the surface you see through the open
 * front -- so ornament belongs on it, at its own depth, rather than floating
 * out on the plane of the opening. Returns null where the direction sees
 * straight through the part.
 */
function surfaceDepth(
  probe: THREE.Mesh,
  face: CarveFace,
  centre: THREE.Vector3,
  offset: THREE.Vector3,
  span: number
): number | null {
  const margin = span * 0.05 + 1e-4;
  const from = centre
    .clone()
    .add(offset)
    .addScaledVector(face.normal, span / 2 + margin);
  const raycaster = new THREE.Raycaster(from, face.normal.clone().negate(), 0, span + margin * 2);
  const hit = raycaster.intersectObject(probe, false)[0];
  if (!hit) return null;
  return face.normal.dot(hit.point.clone().sub(centre));
}

/** How much of a face has a surface facing this way at all, 0 to 1. */
function coverageOf(probe: THREE.Mesh, face: CarveFace, centre: THREE.Vector3): number {
  const { across, up } = axesOf(face);
  const STEPS = 7;
  let hits = 0;
  for (let i = 0; i < STEPS; i += 1) {
    for (let j = 0; j < STEPS; j += 1) {
      const u = ((i + 0.5) / STEPS - 0.5) * face.faceW * 0.94;
      const v = ((j + 0.5) / STEPS - 0.5) * face.faceH * 0.94;
      const offset = across.clone().multiplyScalar(u).addScaledVector(up, v);
      if (surfaceDepth(probe, face, centre, offset, face.thickness) !== null) hits += 1;
    }
  }
  return hits / (STEPS * STEPS);
}

/**
 * Merges carving onto a part's built geometry.
 *
 * Returns a new geometry, leaving the original untouched -- which matters
 * more than it looks: on "As modelled" the geometry passed in is the mesh
 * that came out of the GLB, and the rig keeps that as the one real way back
 * to the piece as drawn.
 *
 * Two things here were learned the hard way and are the reason this is not
 * three lines long.
 *
 * WHERE it goes. Relief is built about the origin and a part's geometry sits
 * wherever it sits in the model, so the two have to be brought together --
 * without that the studio drew a full-size lattice across the floor of the
 * scene, sprawling out from under the bookcase it belonged to. The box is
 * read back off the geometry, so this is right for the mesh as modelled, for
 * a substituted shape already moved into place, and for one shell of a part
 * that has several.
 *
 * WHICH FACES. Every outward face is probed for timber actually behind it,
 * and each one with a real share of the carveable area is worked -- see
 * CARVING_FACE_SHARE. Not simply the broadest: a bookcase carcass is broadest
 * across its open front, and relief laid there alone would hang across the
 * opening like a screen with the shelves behind it. And not only the best,
 * which was the previous rule and left a case carved on its back panel with
 * plain sides and top -- ornament on the one face you see least.
 */
export function carveFace(
  geometry: THREE.BufferGeometry,
  carvingId: string | undefined
): THREE.BufferGeometry | null {
  const carving = carvingById(carvingId);
  if (!carving) return null;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;

  const extent = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const size: ThreeSize = {
    x: Math.max(extent.x, 1e-4),
    y: Math.max(extent.y, 1e-4),
    z: Math.max(extent.z, 1e-4),
  };

  const probe = new THREE.Mesh(geometry);
  probe.updateMatrixWorld(true);

  // Area actually worth carving, per face: one that sees straight through
  // most of the part contributes only the fraction of it that is solid.
  const scored = facesOf(size).map((face) => ({
    face,
    score: face.faceW * face.faceH * coverageOf(probe, face, centre),
  }));

  const bestScore = scored.reduce((most, entry) => Math.max(most, entry.score), 0);
  if (bestScore <= 0) return null;

  const worked = scored.filter((entry) => entry.score >= bestScore * CARVING_FACE_SHARE);
  // Every face was a hole or a sliver. Better to carve the best one than to
  // return a part the studio offered to carve and then did not.
  if (!worked.length) worked.push(scored.reduce((best, entry) => (entry.score > best.score ? entry : best)));

  const backed: THREE.BufferGeometry[] = [];

  /*
   * How far the relief stands proud, the same on every face of a part.
   *
   * Taken from the part's THINNEST extent, which for anything made of boards
   * is the board. It used to be a fraction of the span through each face,
   * which reads as relief only on the one thin axis of a panel: carving the
   * carcass that way asked for 3% of the case's 1.8m height, and stood 54mm
   * of ornament off its top -- a plinth, not a carving. It is also one depth
   * rather than six, so a flute is the same flute wherever it runs.
   */
  const relief = Math.max(1e-4, Math.min(size.x, size.y, size.z) * CARVING_RELIEF);

  for (const { face } of worked) {
    const pieces = carving.build(face.faceW, face.faceH, relief);

    for (const piece of pieces) {
      // Turned onto the face FIRST, and only then asked where it sits.
      //
      // The orientation of a face that points the other way mirrors an
      // in-plane axis -- the back of a box is the front rotated a half turn --
      // so a position read before turning is the mirror of where the piece
      // ends up. Probing at that mirrored point sampled the wrong half of the
      // part, and on a bookcase it culled one of the lattice's two diagonals
      // and left the other: a criss-cross with no cross.
      face.orient(piece);
      piece.computeBoundingBox();
      // Relative to the part's middle, because the relief was built about the
      // origin. Its component along the normal is zero: the piece is still on
      // the centre plane until the translate below moves it out.
      const offset = piece.boundingBox!.getCenter(new THREE.Vector3());

      // Onto the surface that is actually there, at its own depth -- so a
      // fretted back panel is carved on the back panel, not on the plane of
      // the opening in front of it. Where the part is open there is no
      // surface and nothing is carved: relief with nothing under it is
      // ornament in a hole.
      const depth = surfaceDepth(probe, face, centre, offset, face.thickness);
      if (depth === null) {
        piece.dispose();
        continue;
      }

      piece.translate(
        centre.x + face.normal.x * depth,
        centre.y + face.normal.y * depth,
        centre.z + face.normal.z * depth
      );
      backed.push(piece);
    }
  }

  if (!backed.length) return null;

  const flat = [geometry, ...backed].map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat, false);
  for (const piece of backed) piece.dispose();
  for (const part of flat) if (part !== geometry && !backed.includes(part)) part.dispose();

  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Whether the shape a part is currently wearing can have a hole cut in it.
 *
 * The answer is a property of the SHAPE, not of the part, and that is why the
 * studio asks a customer to choose a shape before offering holes. "As
 * modelled" is a mesh that came out of a GLB; cutting an exact hole in it
 * would mean subtracting one solid from another on arbitrary imported
 * geometry, and the honest version of that is not a slider. Choosing any
 * flat, single-outline shape puts the part on geometry this file generates,
 * where a hole is simply part of the outline.
 */
export function shapeAcceptsApertures(shapeId: string | undefined): boolean {
  return Boolean(shapeById(shapeId)?.apertured);
}

/** A hole in a part's default state: a modest circle in the middle, open. */
export function defaultAperture(): Aperture {
  return { shape: "round", size: 0.33, x: 0, y: 0, fill: null };
}

/**
 * Reads a hole out of stored JSON, or returns null.
 *
 * Every field is re-clamped here rather than trusted, because this data has
 * been out of the app -- through localStorage, through cad_state, through a
 * shop's copy of a customer's design -- and an out-of-range hole does not
 * throw, it builds a tangle. `placeAperture` clamps again at build time; this
 * is the layer that stops nonsense being stored and shown back as if it were
 * a real choice.
 */
export function readAperture(value: unknown): Aperture | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const shape = APERTURE_SHAPES.find((entry) => entry.id === raw.shape)?.id;
  if (!shape) return null;
  const num = (input: unknown, fallback: number) =>
    typeof input === "number" && Number.isFinite(input) ? input : fallback;
  const clamp1 = (input: number) => Math.min(1, Math.max(-1, input));
  return {
    shape,
    size: Math.min(MAX_APERTURE, Math.max(MIN_APERTURE, num(raw.size, 0.33))),
    x: clamp1(num(raw.x, 0)),
    y: clamp1(num(raw.y, 0)),
    fill: typeof raw.fill === "string" && raw.fill.length > 0 ? raw.fill : null,
  };
}

/** What to call a hole on an order or a drawing. `fillName` is the insert's finish, if it has one. */
export function apertureName(aperture: Aperture, fillName?: string | null): string {
  const shape = APERTURE_SHAPES.find((entry) => entry.id === aperture.shape)?.label ?? "Round";
  const across = `${Math.round(aperture.size * 100)}% across`;
  return fillName ? `${shape} cutout, ${across}, filled with ${fillName}` : `${shape} cutout, ${across}, open`;
}

/**
 * The default edge radius for a part that has never had one set.
 *
 * Zero, so choosing a shape changes the shape and nothing else. A default
 * anywhere above zero would mean that picking "Square rail" silently produced
 * a rounded one, and the customer would have to notice a slider they never
 * touched to get back what the label promised.
 */
export const DEFAULT_EDGE_RADIUS = 0;
