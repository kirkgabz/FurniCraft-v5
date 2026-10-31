import * as THREE from "three";
import type { PartId, Surface } from "./studio-config";

/**
 * Recovers individually selectable parts from a furniture GLTF.
 *
 * The shipped model contains only two meshes -- `victorian_chair_wood_wood_0`
 * and `victorian_chair_cloth_cloth_0` -- so clicking it raw would only ever
 * select "all the wood" or "all the fabric". Those two meshes are, however,
 * built from surfaces that never touch each other, so a connected-component
 * pass over the triangle graph recovers the real pieces: 33 wood shells (four
 * legs, four seat rails, the back frame, and 24 leg carvings) and 2 cloth
 * shells (seat pad, back panel).
 *
 * Shells are classified in the meshes' own local space, where +Z is up and +Y
 * is the rear of the chair. Every threshold below was measured off the shipped
 * geometry rather than guessed; the comment on each records the span it splits.
 */

/** Only the four legs reach the floor -- measured min.z is 0.000 for all four. */
const LEG_FLOOR_MAX_Z = 0.05;
/** The back frame starts at z=0.593; the highest seat rail tops out at z=0.499. */
const BACK_FRAME_MIN_Z = 0.55;
/** Seat rails carry 981-3689 verts; the carvings carry 132-160. */
const SEAT_RAIL_MIN_VERTS = 500;
/** Back cushion starts at z=0.634, seat cushion at z=0.490. */
const CLOTH_BACK_MIN_Z = 0.6;

/**
 * Positions are welded at 1e-5 so UV seams don't tear one surface into many
 * -- for a model whose own coordinates stay within about a unit of the
 * origin, which every model shipped so far does. That precision is
 * absolute, not relative, and float32 cannot represent two points closer
 * together than roughly their own magnitude times 1.19e-7: a model whose
 * raw coordinates run into the hundreds (an unnormalized scan, say) can
 * have genuinely duplicate vertices that differ by more than 1e-5 purely
 * from export round-tripping, so they never land in the same weld bucket
 * and a solid mesh fragments into thousands of spurious shells instead of
 * the real ones. weldVertices scales this precision down by the mesh's own
 * largest coordinate magnitude, floored at 1 -- every model shipped today
 * has max magnitude at or under that floor, so this is unchanged from a
 * flat 1e-5 for all of them; it only loosens for a mesh that actually
 * needs it.
 */
const WELD_PRECISION = 1e5;

export type Shell = {
  geometry: THREE.BufferGeometry;
  /** Bounds in world space, after the GLTF node transforms are baked in. */
  box: THREE.Box3;
  vertexCount: number;
};

export type SegmentedPart = {
  id: PartId;
  surface: Surface;
  shells: Shell[];
  /** Union of every shell's world-space bounds. */
  box: THREE.Box3;
  /** The material the GLTF supplied for this surface, textures included. */
  sourceMaterial: THREE.MeshStandardMaterial;
};

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function weldVertices(position: AnyAttribute) {
  let maxAbs = 0;
  for (let i = 0; i < position.count; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(position.getX(i)), Math.abs(position.getY(i)), Math.abs(position.getZ(i)));
  }
  const precision = WELD_PRECISION / Math.max(1, maxAbs);

  const lookup = new Map<string, number>();
  const welded = new Int32Array(position.count);
  let next = 0;

  for (let i = 0; i < position.count; i++) {
    const key =
      `${Math.round(position.getX(i) * precision)}|` +
      `${Math.round(position.getY(i) * precision)}|` +
      `${Math.round(position.getZ(i) * precision)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = next++;
      lookup.set(key, id);
    }
    welded[i] = id;
  }

  return { welded, count: next };
}

function createUnionFind(size: number) {
  const parent = new Int32Array(size);
  for (let i = 0; i < size; i++) parent[i] = i;

  function find(x: number): number {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    // path-compress so repeated lookups over 37k triangles stay flat
    let walk = x;
    while (parent[walk] !== root) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  }

  function union(a: number, b: number) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  return { find, union };
}

/**
 * Builds a standalone geometry from a subset of triangles, remapping vertices so
 * the result carries only what it uses. That keeps each shell's bounding box
 * honest -- THREE computes bounds from the whole position attribute and ignores
 * the index, so a shell that merely re-indexed the shared buffer would report
 * the entire chair's bounds and break every pivot derived from it.
 */
function extractShell(source: THREE.BufferGeometry, triangles: number[]): THREE.BufferGeometry {
  const sourceIndex = source.getIndex();
  if (!sourceIndex) throw new Error("chair segmentation expects indexed geometry");

  const remap = new Map<number, number>();
  const index = new Uint32Array(triangles.length * 3);
  let cursor = 0;

  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner++) {
      const original = sourceIndex.getX(triangle * 3 + corner);
      let mapped = remap.get(original);
      if (mapped === undefined) {
        mapped = remap.size;
        remap.set(original, mapped);
      }
      index[cursor++] = mapped;
    }
  }

  const geometry = new THREE.BufferGeometry();

  for (const name of Object.keys(source.attributes)) {
    const attribute = source.attributes[name] as AnyAttribute;
    const { itemSize } = attribute;
    const values = new Float32Array(remap.size * itemSize);
    remap.forEach((mapped, original) => {
      for (let component = 0; component < itemSize; component++) {
        values[mapped * itemSize + component] = attribute.getComponent(original, component);
      }
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
  }

  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * Every shipped model's geometry is indexed, but a converted foreign upload
 * is not guaranteed to be: `GLTFExporter` writes non-indexed primitives for
 * geometry that had no shared vertices to begin with (an FBX conversion, in
 * particular). Non-indexed geometry is legal glTF -- every three consecutive
 * vertices form a triangle -- so a synthetic identity index (`[0,1,2,...]`)
 * is indistinguishable from a real one to everything below this. Returns the
 * geometry unchanged when it already has an index, so every shipped model
 * takes this function's original path with no behaviour change.
 */
function ensureIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry.getIndex()) return geometry;
  const vertexCount = geometry.getAttribute("position").count;
  const index = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) index[i] = i;
  const indexed = geometry.clone();
  indexed.setIndex(new THREE.BufferAttribute(index, 1));
  return indexed;
}

function splitIntoShells(rawSource: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const source = ensureIndexed(rawSource);
  const index = source.getIndex();
  if (!index) throw new Error("chair segmentation expects indexed geometry");

  const position = source.getAttribute("position") as AnyAttribute;
  const { welded, count } = weldVertices(position);
  const unionFind = createUnionFind(count);

  const triangleCount = index.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = welded[index.getX(triangle * 3)];
    const b = welded[index.getX(triangle * 3 + 1)];
    const c = welded[index.getX(triangle * 3 + 2)];
    unionFind.union(a, b);
    unionFind.union(b, c);
  }

  const groups = new Map<number, number[]>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = unionFind.find(welded[index.getX(triangle * 3)]);
    const bucket = groups.get(root);
    if (bucket) bucket.push(triangle);
    else groups.set(root, [triangle]);
  }

  return Array.from(groups.values(), (triangles) => extractShell(source, triangles));
}

/**
 * What a classifier is told about one shell. Classification runs in the mesh's
 * own local space, before transforms are baked, so `modelBox` is supplied as
 * well: a classifier can then express thresholds as fractions of the model's
 * own size rather than as raw coordinates, which keeps it working if the asset
 * is ever re-exported at a different scale.
 */
export type ShellInfo = {
  localBox: THREE.Box3;
  vertexCount: number;
  surface: Surface;
  /**
   * The name of the material the shell's mesh carried.
   *
   * Two shells can be geometrically alike and still be different things: the
   * rattan chair's woven seat and its timber frame interleave in height and in
   * depth, and only the material tells them apart. Surface alone cannot -- both
   * of those take wood finishes, so both resolve to the same surface.
   */
  materialName: string;
  /** Union of every shell in the model, in the same local space. */
  modelBox: THREE.Box3;
};

export type ShellClassifier = (shell: ShellInfo) => PartId;

/** Which finish palette a shell gets, from the material the GLTF gave it. */
export type SurfaceResolver = (material: THREE.Material) => Surface;

// ----------------------------------------------------------------- Victorian

export const classifyVictorianShell: ShellClassifier = ({ localBox, vertexCount, surface }) => {
  if (surface === "cloth") {
    return localBox.min.z > CLOTH_BACK_MIN_Z ? "backCushion" : "seatCushion";
  }
  if (localBox.min.z < LEG_FLOOR_MAX_Z) return "legs";
  if (localBox.min.z > BACK_FRAME_MIN_Z) return "backFrame";
  return vertexCount >= SEAT_RAIL_MIN_VERTS ? "seatFrame" : "ornaments";
};

export const victorianSurface: SurfaceResolver = (material) =>
  material.name === "cloth" ? "cloth" : "wood";

// ------------------------------------------------------------- cushion chair
/**
 * The cushion chair ships as a single mesh with one material, which splits into
 * exactly five shells. Local +Y is up here (the Victorian's is +Z) and the raw
 * coordinates are tiny -- the whole chair is 0.078 units wide -- so every
 * threshold below is a fraction of the model's own bounding box.
 *
 * Measured off the shipped geometry, as fractions of that box:
 *
 *   shell         verts   min.y   |centre.x|   max.z
 *   frame          5902   0.000        0.00     0.91
 *   seat cushion   2188   0.334        0.00     1.00
 *   back cushion   1598   0.447        0.00     0.44
 *   arm (x2)        721   0.601        0.92     0.83
 */
const CUSHION_FLOOR_MAX_Y = 0.15;
const CUSHION_ARM_MIN_OFF_CENTRE = 0.5;
const CUSHION_BACK_MAX_Z = 0.7;

function fraction(value: number, min: number, size: number) {
  return size > 0 ? (value - min) / size : 0;
}

export const classifyCushionShell: ShellClassifier = ({ localBox, modelBox }) => {
  const size = modelBox.getSize(new THREE.Vector3());
  const modelCentre = modelBox.getCenter(new THREE.Vector3());
  const centre = localBox.getCenter(new THREE.Vector3());

  // Only the moulded shell reaches the floor; it carries everything else.
  if (fraction(localBox.min.y, modelBox.min.y, size.y) < CUSHION_FLOOR_MAX_Y) return "frame";

  // The arms are the only shells sitting away from the centre line.
  const halfWidth = size.x / 2;
  const offCentre = halfWidth > 0 ? Math.abs(centre.x - modelCentre.x) / halfWidth : 0;
  if (offCentre > CUSHION_ARM_MIN_OFF_CENTRE) return "armrests";

  // What is left is the two pads; the back one never reaches the front edge.
  if (fraction(localBox.max.z, modelBox.min.z, size.z) < CUSHION_BACK_MAX_Z) return "backCushion";
  return "seatCushion";
};

/** The cushion chair has a single upholstery material for every shell. */
export const cushionSurface: SurfaceResolver = () => "cloth";

// -------------------------------------------------------------- rattan chair
/**
 * The rattan armchair ships as two meshes -- a timber frame and a woven cane
 * panel -- which split into 19 frame shells and just over 400 weave shells,
 * because every strand of the weave is its own closed surface.
 *
 * That count is why this classifier reads the material name first. A woven
 * strand and a seat rail sit at the same height and the same depth, so no
 * bounding box separates them; the mesh they came from does.
 *
 * Both surfaces are wood: cane and the frame take the same stains, and there is
 * no upholstery on this chair at all.
 *
 * Measured off the shipped geometry, as fractions of the model's own box:
 *
 *   material  shells  min.y band   what it is
 *   frame          4  0.00         the four legs, the only shells on the floor
 *   frame          5  0.30 - 0.49  front stretcher and the four seat rails
 *   frame         10  0.60 - 0.89  back rail, and the arm-and-back hoop
 *   weave        314  0.40 - 0.59  the woven seat
 *   weave         87  0.60 - 0.99  the woven back
 */
/** Only the four legs reach the floor; the next frame shell up starts at 0.30. */
const RATTAN_FLOOR_MAX_Y = 0.15;
/** Seat structure tops out at 0.49; back structure starts at 0.60. */
const RATTAN_BACK_MIN_Y = 0.55;

export const classifyRattanShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  const size = modelBox.getSize(new THREE.Vector3());
  const height = fraction(localBox.min.y, modelBox.min.y, size.y);

  // The weave is two panels and nothing else, so it only has to be cut in half.
  if (materialName === "weave") {
    return height < RATTAN_BACK_MIN_Y ? "seatCushion" : "backCushion";
  }

  if (height < RATTAN_FLOOR_MAX_Y) return "legs";
  return height < RATTAN_BACK_MIN_Y ? "seatFrame" : "backFrame";
};

/**
 * The frame is timber and the panels are woven, and the two cannot be swapped:
 * a turned leg cannot be made of strands and a caned panel cannot be milled
 * from a plank. So they draw from different palettes, and the studio never
 * offers Ebony for a weave or a woven finish for a leg.
 */
export const rattanSurface: SurfaceResolver = (material) =>
  material.name === "weave" ? "cane" : "wood";

// --------------------------------------------------------- patio armchair
/**
 * A woven outdoor armchair, and the first model here whose weave is a texture
 * rather than geometry -- the whole chair is 1,033 vertices because the cane
 * pattern is painted on a plain shell. That makes it the lightest model in the
 * studio by a wide margin and changes nothing about how it is segmented.
 *
 * Like the Victorian export, its local space is Z-up: the node transform that
 * makes it Y-up is applied after classification, so every threshold below is a
 * fraction of the model's own box with **z as height**.
 *
 * Measured off the shipped geometry:
 *
 *   material       shells  centre z   what it is
 *   rattan              3  0.48-0.49  the woven shell and its two arm panels
 *   beige/border        4  0.47-0.52  the seat cushion and its piping
 *   beige/border        4  0.75       the back cushion and its piping
 *
 * The arms are panels of the same woven box rather than separate rests, so all
 * three rattan shells are one part: there is no arm here that could take a
 * different finish, and pretending otherwise would let the customer stain a
 * seam that does not exist.
 */
/** Seat cushions centre at 0.52 and below; the back cushion sits at 0.75. */
const PATIO_BACK_MIN_Z = 0.62;

export const classifyPatioShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  if (materialName === "rattan") return "frame";

  const size = modelBox.getSize(new THREE.Vector3());
  const centre = localBox.getCenter(new THREE.Vector3());
  const height = fraction(centre.z, modelBox.min.z, size.z);
  return height < PATIO_BACK_MIN_Z ? "seatCushion" : "backCushion";
};

/**
 * One material is the weave and the rest are upholstery, so the split is by
 * name. The piping carries its own material but is part of a cushion, and is
 * bucketed with one by the classifier above.
 */
export const patioSurface: SurfaceResolver = (material) =>
  material.name === "rattan" ? "rattan" : "cloth";

// ----------------------------------------------------------- rattan stool
/**
 * A caned stool, and the only model here whose parts were not in the file.
 *
 * It arrived as one welded mesh with one material, so the connected-component
 * pass returned a single shell and there was no cushion to select. The split
 * was recovered from the baseColor instead -- the pad is off-white and the cane
 * is saturated yellow -- and baked into the shipped .glb as two named
 * materials. So this classifier reads a name, like the others, and the
 * texture-sampling that produced it is a conversion-time concern rather than
 * something the studio repeats on every load.
 *
 * The name alone is not enough, though: the shipped asset carries 97 shells
 * named "cushion", not one pad. 93 of them are individual cane strands the
 * baseColor split mistagged (their sampled colour must have read closer to
 * the pad's off-white than the cane's yellow) -- measured at 3-41 vertices
 * each, a strand's worth. The other 4, at 192-1210 vertices, are the actual
 * pad and its trim. That gap is wide and clean (nothing falls between 41 and
 * 192), so vertex count recovers what the name alone cannot: a "cushion"
 * shell only earns the seat if it is actually pad-sized. Left uncorrected,
 * a customer recolouring "seat cushion" would have recoloured most of the
 * visible cane base along with it.
 *
 * The frame carries the rest: the one large welded cane body (20,478 verts)
 * plus a handful of degenerate specks, and all 93 misnamed strands once the
 * threshold below reclaims them. A stool has no part that moves
 * independently of another, so -- as before -- everything in a bucket is
 * kept whole.
 */
const STOOL_PAD_MIN_VERTS = 100;

export const classifyStoolShell: ShellClassifier = ({ materialName, vertexCount }) =>
  materialName === "cushion" && vertexCount >= STOOL_PAD_MIN_VERTS ? "seatCushion" : "frame";

/**
 * Bent rattan poles take the cane palette rather than the timber one: they are
 * solid cane, so a finish tints the photographed weave instead of replacing it,
 * and no planar weave map is ever laid over geometry that is already round.
 */
export const stoolSurface: SurfaceResolver = (material) =>
  material.name === "cushion" ? "cloth" : "cane";

// ------------------------------------------------------------- cabinet
/**
 * The storage cabinet is the first casegood here, and the first asset the
 * project generated rather than sourced (see scripts/make-cabinet.mts). That
 * changes what this classifier can honestly rely on: the material names are
 * ours, so they are meaningful and stable in a way a scraped model's
 * "material_0" never is.
 *
 * So this reads the material name first, exactly as the rattan and stool
 * classifiers do, and for the same reason -- a door panel and a drawer front
 * are the same slab at different heights, and no bounding box tells them
 * apart as reliably as the name that shipped with them.
 *
 * The geometric fallback underneath is not decoration. A shop owner's own
 * cabinet will not use our material names, and the day this classifier is
 * pointed at one, the height bands are what is left. They are written as
 * fractions of the model's own box so they survive a differently-scaled
 * asset.
 *
 * Modelled Y-up in metres, origin on the floor, so local space is world
 * space. Measured off the generated geometry, as fractions of the model box
 * (x 0.90, y 1.80, z 0.50 including the handle projection):
 *
 *   part           shells   min.y band   front face (max.z)
 *   plinth              1   0.00               0.85
 *   carcass             2   0.06               0.90
 *   drawer fronts       2   0.07 - 0.24        0.94
 *   doors               2   0.43               0.94
 *   shelves             2   0.58 - 0.78        0.88
 *   handles             4   0.14 - 0.64        1.00
 */
/** Only the plinth reaches the floor; the carcass sits on top of it at 0.056. */
const CABINET_FLOOR_MAX_Y = 0.03;
/** Handles are the only parts standing proud of the door/drawer faces at 0.94. */
const CABINET_HARDWARE_MIN_Z = 0.97;
/** Door and drawer faces reach 0.94; the carcass front stops at 0.90. */
const CABINET_FRONT_MIN_Z = 0.92;
/** A shelf is 0.011 of the piece's height; the thinnest structural panel is 0.94. */
const CABINET_SHELF_MAX_THICKNESS = 0.05;

export const classifyCabinetShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Cabinet_")) {
    if (materialName.includes("Handle")) return "handles";
    if (materialName.includes("Plinth")) return "plinth";
    if (materialName.includes("Drawer")) return "drawers";
    if (materialName.includes("Door")) return "doors";
    if (materialName.includes("Shelf")) return "shelves";
    return "carcass";
  }

  // A foreign cabinet: fall back to where the shell sits in the piece.
  const size = modelBox.getSize(new THREE.Vector3());
  const floorGap = fraction(localBox.min.y, modelBox.min.y, size.y);
  const front = fraction(localBox.max.z, modelBox.min.z, size.z);

  if (floorGap < CABINET_FLOOR_MAX_Y) return "plinth";
  // Checked before the door/drawer split: a pull sits ON a front panel and
  // shares its height band, so height alone would call it a door.
  if (front > CABINET_HARDWARE_MIN_Z) return "handles";
  if (front > CABINET_FRONT_MIN_Z) {
    // Shape, not height. Height only separates these two on a cabinet laid
    // out like ours -- doors above, drawer bank below -- and inverts on the
    // many that are not (a dresser's drawers run the full height; a sideboard
    // puts drawers above its doors). Proportion holds either way: a door is a
    // tall panel and a drawer front is a wide, short one.
    const panelWidth = localBox.max.x - localBox.min.x;
    const panelHeight = localBox.max.y - localBox.min.y;
    return panelHeight >= panelWidth ? "doors" : "drawers";
  }
  // What is left is inside the box: a shelf is a thin horizontal slab, and
  // the carcass is everything structural around it. Thinness is measured
  // against the piece's own height so a tall wardrobe's shelf still reads as
  // one.
  const thickness = fraction(localBox.max.y, localBox.min.y, size.y);
  return thickness < CABINET_SHELF_MAX_THICKNESS ? "shelves" : "carcass";
};

/**
 * Brass pulls take the hardware list; everything else on the cabinet is
 * timber. Hardware is the reason `Surface` gained "metal" -- see the comment
 * on that type in studio-config.ts.
 */
export const cabinetSurface: SurfaceResolver = (material) =>
  material.name.includes("Handle") || material.name.includes("Brass") ? "metal" : "wood";

// ---------------------------------------------------------------- bookshelf
/**
 * The open bookcase, generated by scripts/make-bookshelf.mts.
 *
 * Measured off that asset, as fractions of the model's own box (x 0.80,
 * y 1.80, z 0.30):
 *
 *   part           shells   min.y band   notes
 *   plinth              1   0.000        a recessed toe kick, inset all round
 *   carcass             1   0.044        sides, decks and back, welded
 *   shelves             4   0.176-0.782  evenly through the bay
 *
 * The fallback below has an easier job than the cabinet's: with no doors,
 * drawers or pulls, everything is either on the floor, a thin horizontal
 * board, or the case around them.
 */
/** Only the plinth reaches the floor; the carcass starts on top of it at 0.044. */
const SHELF_FLOOR_MAX_Y = 0.025;
/** A shelf is 0.011 of the piece's height; the thinnest carcass panel is thicker. */
const SHELF_MAX_THICKNESS = 0.05;

export const classifyBookshelfShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Bookshelf_")) {
    if (materialName.includes("Plinth")) return "plinth";
    if (materialName.includes("Shelf")) return "shelves";
    return "carcass";
  }

  // A foreign bookcase: where the shell sits, and how thin it is.
  const size = modelBox.getSize(new THREE.Vector3());
  const floorGap = fraction(localBox.min.y, modelBox.min.y, size.y);
  if (floorGap < SHELF_FLOOR_MAX_Y) return "plinth";

  // A shelf is a thin horizontal board; the sides and back are not. Measured
  // against the piece's own height, so a shelf in a taller case still reads
  // as one -- and checked on Y alone, because a back panel is thin too but
  // thin the other way.
  const thickness = fraction(localBox.max.y, localBox.min.y, size.y);
  const width = localBox.max.x - localBox.min.x;
  const height = localBox.max.y - localBox.min.y;
  return thickness < SHELF_MAX_THICKNESS && width > height ? "shelves" : "carcass";
};

/** Every part of the bookcase is timber; there is no hardware on it at all. */
export const bookshelfSurface: SurfaceResolver = () => "wood";

// ---------------------------------------------------------------------- sofa
/**
 * The sofa, generated by scripts/make-sofa.mts.
 *
 * Measured off that asset, as fractions of the model's own bounding box:
 *
 *   part            shells   min y        max y      notes
 *   legs                 4   0.000        0.188      show-wood, inset at the corners
 *   base rail            1   0.188        0.306      rail and deck, welded
 *   arms                 2   0.306        0.729      full depth, at each end
 *   seat cushions        3   0.306        0.494      three across the inner span
 *   back                 1   0.306        1.000      between the arms, at the rear
 *   back cushions        3   0.494        0.918      above the seat
 *   pillows              2   0.494        0.894      in the corners
 *
 * Height alone cannot sort these -- the arms, the back and the seat cushions
 * all start at the same 0.306, because they all stand on the same deck. That
 * is what a sofa IS, and it is why the fallback below reads position and
 * proportion rather than height bands the way the table's does. Our own asset
 * never reaches that code: the material name is authoritative.
 */
/** Legs stop at 0.188; everything else starts at 0.306. */
const SOFA_LEG_MAX_Y = 0.24;
/** The base rail tops out at 0.306; the seat cushions at 0.494. */
const SOFA_BASE_MAX_Y = 0.36;
/** An arm occupies the outer eighth of the width, and the full depth with it. */
const SOFA_ARM_MIN_X = 0.78;
/** A back sits in the rear third; a seat cushion reaches past it. */
const SOFA_BACK_MAX_Z = 0.45;

export const classifySofaShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Sofa_")) {
    if (materialName.includes("Legs")) return "legs";
    if (materialName.includes("Rail")) return "seatFrame";
    if (materialName.includes("Arms")) return "armrests";
    if (materialName.includes("BackCushion")) return "backCushion";
    if (materialName.includes("Back")) return "backFrame";
    if (materialName.includes("Seat")) return "seatCushion";
    if (materialName.includes("Pillows")) return "pillows";
    return "seatFrame";
  }

  // A foreign sofa. Read in the order the piece is built: what stands on the
  // floor, what the cushions stand on, then what is loose.
  const size = modelBox.getSize(new THREE.Vector3());
  const top = fraction(localBox.max.y, modelBox.min.y, size.y);
  if (top < SOFA_LEG_MAX_Y) return "legs";
  if (top < SOFA_BASE_MAX_Y) return "seatFrame";

  // An arm is the piece that lives at the outside edge. Checked before the
  // back, because an arm runs the full depth and would otherwise read as one.
  const outer = Math.max(
    fraction(localBox.max.x, modelBox.min.x, size.x),
    1 - fraction(localBox.min.x, modelBox.min.x, size.x)
  );
  const width = (localBox.max.x - localBox.min.x) / size.x;
  if (outer > SOFA_ARM_MIN_X && width < 0.3) return "armrests";

  // Then front to back: anything that stays behind the seat is the back, and
  // the taller of those two is the back proper rather than a cushion on it.
  const frontEdge = fraction(localBox.max.z, modelBox.min.z, size.z);
  if (frontEdge < SOFA_BACK_MAX_Z) {
    return top > 0.95 ? "backFrame" : "backCushion";
  }
  return "seatCushion";
};

/**
 * Timber below the deck, cloth above it.
 *
 * The split a sofa is actually made along: a joiner builds what stands on the
 * floor and an upholsterer covers what you sit on, and no part is both.
 */
export const sofaSurface: SurfaceResolver = (material) =>
  /narra|rail|leg|timber|wood/i.test(material.name) ? "wood" : "cloth";

// ------------------------------------------------------------------ sofa bed
/**
 * The sofa bed, generated by scripts/make-sofa-bed.mts, and the only piece in
 * this studio that is drawn mid-mechanism -- open, with its bed out.
 *
 * That is what makes it awkward to sort by measurement. Every other piece here
 * has a footprint the size of itself; this one reaches 125cm forward of its own
 * centre while its body stops at 50, so more than half the model's depth is one
 * part. Height bands cannot help either, because the deck, the arms, the back
 * and the pull-out all begin within a few centimetres of each other.
 *
 * Measured off that asset, as fractions of the model's own bounding box:
 *
 *   part            shells   min y   max y   front z   notes
 *   legs                 4   0.000   0.119     0.34    short feet, inset
 *   frame                1   0.119   0.321     0.57    deck, rear wall, runners
 *   pull-out             1   0.024   0.321     1.00    reaches past the body
 *   arms                 2   0.119   0.738     0.57    full depth, at each end
 *   mattress             1   0.321   0.512     0.99    one mass, spans the fold
 *   back                 1   0.321   1.000     0.14    between the arms, rear
 *   back cushion         1   0.512   0.940     0.23    one mass, not tufted
 *   bolsters             2   0.512   0.738     0.26    capsules on the mattress
 *
 * So the fallback below reads depth FIRST, which none of the others do: on a
 * sofa bed, "does this part reach out past the body" is a question with only
 * one answer, and it separates the mechanism from the furniture before
 * anything ambiguous is asked. Our own asset never reaches that code -- the
 * material name is authoritative.
 */
/** Feet stop at 0.119; everything else starts at 0.119 or above. */
const SOFA_BED_LEG_MAX_Y = 0.16;
/** The deck and the pull-out top out at 0.321; the mattress at 0.512. */
const SOFA_BED_DECK_MAX_Y = 0.4;
/** The body ends at z fraction 0.571. Past that, only the bed exists. */
const SOFA_BED_BODY_FRONT = 0.62;
/** An arm occupies the outer eighth of the width. */
const SOFA_BED_ARM_MIN_X = 0.78;
/** The back and its cushions stay inside the rear sixth. */
const SOFA_BED_BACK_MAX_Z = 0.3;

export const classifySofaBedShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring. Cushion
  // before back, and pull-out before legs, because "SofaBed_Back" is a prefix
  // of "SofaBed_BackCushion" and a name test in the wrong order is a silent
  // mis-sort rather than an error.
  if (materialName.startsWith("SofaBed_")) {
    if (materialName.includes("BackCushion")) return "backCushion";
    if (materialName.includes("Back")) return "backFrame";
    if (materialName.includes("Legs")) return "legs";
    if (materialName.includes("Frame")) return "seatFrame";
    if (materialName.includes("Arms")) return "armrests";
    if (materialName.includes("Mattress")) return "mattress";
    if (materialName.includes("PullOut")) return "mattressSupport";
    if (materialName.includes("Bolsters")) return "pillows";
    return "seatFrame";
  }

  // A foreign sofa bed. Depth first, for the reason in the note above.
  const size = modelBox.getSize(new THREE.Vector3());
  const top = fraction(localBox.max.y, modelBox.min.y, size.y);
  const frontEdge = fraction(localBox.max.z, modelBox.min.z, size.z);

  // Anything reaching past the body is the mechanism or the bed on it, and
  // the two are separated by a single question: is it under the sleeping
  // height or at it.
  if (frontEdge > SOFA_BED_BODY_FRONT) {
    return top < SOFA_BED_DECK_MAX_Y ? "mattressSupport" : "mattress";
  }

  if (top < SOFA_BED_LEG_MAX_Y) return "legs";
  if (top < SOFA_BED_DECK_MAX_Y) return "seatFrame";

  // An arm is the piece that lives at the outside edge. Checked before the
  // back, because an arm runs the full depth and would otherwise read as one.
  const outer = Math.max(
    fraction(localBox.max.x, modelBox.min.x, size.x),
    1 - fraction(localBox.min.x, modelBox.min.x, size.x)
  );
  const width = (localBox.max.x - localBox.min.x) / size.x;
  if (outer > SOFA_BED_ARM_MIN_X && width < 0.3) return "armrests";

  // Then front to back. What stays right at the rear is the back or a cushion
  // on it; the taller of the two is the back proper. A bolster sits forward of
  // both, on the mattress, which is what the last test catches.
  if (frontEdge < SOFA_BED_BACK_MAX_Z) {
    return top > 0.95 ? "backFrame" : "backCushion";
  }
  return top > SOFA_BED_DECK_MAX_Y && localBox.min.y / size.y > 0.45 ? "pillows" : "mattress";
};

/**
 * Timber under it, cloth over it.
 *
 * The same split as the three-seater's, and for the same reason -- a joiner
 * builds what stands on the floor and an upholsterer covers everything else.
 * On this piece the joinery is only the four feet: the frame, the deck and
 * the pull-out are all covered, because on a sofa bed they are all on show
 * the moment the bed is out.
 */
export const sofaBedSurface: SurfaceResolver = (material) =>
  /kamagong|timber|wood|leg/i.test(material.name) ? "wood" : "cloth";

// --------------------------------------------------------------------- table
/**
 * The dining table, generated by scripts/make-table.mts.
 *
 * Measured off that asset, as fractions of the model's own bounding box, so
 * the fallback thresholds below are read from the piece rather than guessed:
 *
 *   part            shells   min y        max y      notes
 *   legs                 4   0.000        0.853      inset 5cm from the edge
 *   stretchers           3   0.240        0.300      an H between the legs
 *   top rim              1   0.853        1.000      20cm wide, 11cm deep
 *   drop leaves          4   0.963        1.000      one per side, authored level
 *   top inset            1   0.953        0.993      the woven panel
 *
 * The bands do not overlap, which is what makes height alone enough to sort a
 * foreign table into roles -- with one exception the name test above handles:
 * the leaves sit in the same band as the rim, because a leaf IS the top's
 * height. A foreign table's leaves, if it had any, would be read as part of
 * its top, which is the harmless way to be wrong: they would still be built
 * and finished, just not hinged.
 */
/** Only the legs reach the floor; the lowest stretcher starts at 0.240. */
const TABLE_FLOOR_MAX_Y = 0.05;
/** The woven panel starts at 0.953; the rim it sits in starts at 0.853. */
const TABLE_TOP_MIN_Y = 0.9;
/** Splits a rim or apron hanging under the top from the stretchers at 0.240. */
const TABLE_APRON_MIN_Y = 0.6;

export const classifyTableShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Table_")) {
    if (materialName.includes("Inset")) return "tabletop";
    // Before the rim test, not after: a leaf is authored at the rim's own
    // height and in the same timber, so anything keyed on position or colour
    // would read it as more rim. The name is the only thing that separates
    // them, and it is ours to rely on.
    if (materialName.includes("Leaf")) return "leaves";
    if (materialName.includes("Rim")) return "tabletopBorder";
    if (materialName.includes("Stretcher")) return "stretchers";
    return "legs";
  }

  // A foreign table: sort by the height band the shell sits in. A table is
  // unusually legible this way -- everything that reaches the floor is a leg,
  // everything at the very top is the top, and the two bands between are the
  // apron under the top and the stretchers down near the feet.
  const size = modelBox.getSize(new THREE.Vector3());
  const bottom = fraction(localBox.min.y, modelBox.min.y, size.y);

  if (bottom < TABLE_FLOOR_MAX_Y) return "legs";
  // Deliberately never `tabletopBorder` here. A bordered top is the rarer
  // form and cannot be told from a plain slab by one shell's bounds -- the rim
  // and a whole top have the same extent, and only the presence of a second
  // shell inside the first distinguishes them, which a per-shell classifier
  // cannot see. Calling every foreign top a `tabletop` is wrong on the few
  // bordered ones; calling every one a border would be wrong on most tables.
  if (bottom > TABLE_TOP_MIN_Y) return "tabletop";
  return bottom > TABLE_APRON_MIN_Y ? "apron" : "stretchers";
};

/**
 * The woven panel set into the top takes the weave palette; the narra frame
 * around it takes timber. "rattan" rather than "cane" is the load-bearing
 * choice: the panel is a flat box whose weave lives entirely in the texture,
 * which is exactly the distinction those two surfaces draw (see the comment on
 * `Surface` in studio-config.ts). Marked "cane" it would render as a flat tint
 * with no weave at all.
 */
export const tableSurface: SurfaceResolver = (material) =>
  material.name.includes("Inset") ? "rattan" : "wood";

// ---------------------------------------------------------------- side table
/**
 * The rattan side table: four wrapped poles, a framed woven top, a brace ring
 * under it and a woven shelf near the floor.
 *
 * The source split it into sixteen anonymous "model_part" meshes, so the
 * materials were renamed when it was prepared for the studio and this reads
 * those names, as the generated table's classifier does. The shelf is a
 * stretcher here, frame and panel alike, rather than a `shelf`: that role is
 * the cabinet's adjustable stack and only exists inside a carcass.
 */
export const classifySideTableShell: ShellClassifier = ({ materialName }) => {
  if (materialName.includes("Inset")) return "tabletop";
  if (materialName.includes("Rim")) return "tabletopBorder";
  if (materialName.includes("Stretcher") || materialName.includes("ShelfPanel")) return "stretchers";
  return "legs";
};

/**
 * Wrapped poles take the cane palette -- the binding is modelled in the mesh,
 * so a finish is a colour and a sheen over it -- and the flat top panel takes
 * the woven one. The shelf panel rides with the stretchers it belongs to, so
 * it is finished with them.
 */
export const sideTableSurface: SurfaceResolver = (material) =>
  material.name.includes("Inset") ? "rattan" : "cane";

// ---------------------------------------------------------------------- desk
/**
 * The writing desk, generated by scripts/make-desk.mts.
 *
 * Measured off that asset, as fractions of the model's own bounding box, so
 * the fallback thresholds below are read from the piece rather than guessed:
 *
 *   part            shells   min y   max y   front z   notes
 *   legs                 4   0.000   0.953   --        inset 4.5cm from the edge
 *   foot rail            3   0.173   0.227   --        an H between the legs
 *   modesty panel        1   0.400   0.773   0.121     a board across the back
 *   drawer box           1   0.787   0.947   0.786     the carcass, under the top
 *   drawer fronts        2   0.803   0.931   0.821     proud of the box
 *   handles              2   0.855   0.879   0.853     proud of the fronts
 *   desktop              1   0.953   1.000   --        the top itself
 *
 * This is the first piece here that is a table and a casegood at once, and the
 * bands say why that is not a problem: the drawer box, its fronts and their
 * pulls all sit in one narrow height band under the top and are separated from
 * each other by DEPTH instead -- exactly the split the cabinet's classifier
 * already makes, and for the same reason. A pull sits ON a front and shares
 * its height, so height alone would call it a drawer.
 */
/** Only the legs reach the floor; the foot rail starts at 0.173. */
const DESK_FLOOR_MAX_Y = 0.05;
/** The desktop starts at 0.953; the drawer box below it stops at 0.947. */
const DESK_TOP_MIN_Y = 0.95;
/** A pull stands proud of the drawer front it is fitted to. */
const DESK_HARDWARE_MIN_Z = 0.84;
/** A drawer front stands proud of the box it closes. */
const DESK_FRONT_MIN_Z = 0.8;
/** Below this is understructure -- the foot rail, not the drawer box. */
const DESK_UNDERFRAME_MIN_Y = 0.7;

export const classifyDeskShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Desk_")) {
    if (materialName.includes("Handle")) return "handles";
    if (materialName.includes("Drawer")) return "drawers";
    if (materialName.includes("Case")) return "carcass";
    if (materialName.includes("Modesty")) return "backFrame";
    if (materialName.includes("Stretcher")) return "stretchers";
    if (materialName.includes("Top")) return "tabletop";
    return "legs";
  }

  // A foreign desk. Height sorts most of it, exactly as on the dining table;
  // depth sorts the three parts stacked under the top, exactly as on the
  // cabinet. Neither signal alone is enough on a piece that is both.
  const size = modelBox.getSize(new THREE.Vector3());
  const bottom = fraction(localBox.min.y, modelBox.min.y, size.y);
  const front = fraction(localBox.max.z, modelBox.min.z, size.z);

  if (bottom < DESK_FLOOR_MAX_Y) return "legs";
  if (bottom > DESK_TOP_MIN_Y) return "tabletop";

  // Checked before anything else in this band: a pull shares its front's
  // height and can only be told from it by standing further forward.
  if (front > DESK_HARDWARE_MIN_Z) return "handles";
  if (front > DESK_FRONT_MIN_Z) return "drawers";
  if (bottom > DESK_UNDERFRAME_MIN_Y) return "carcass";

  // What is left is between the foot rail and the drawer box. A modesty panel
  // is the one thing that belongs there, and it is identifiable without a
  // threshold of its own: it is at the BACK, which is the one place a rail
  // spanning the legs is not.
  return front < 0.5 ? "backFrame" : "stretchers";
};

/**
 * Brass pulls take the hardware list; everything else on the desk is timber.
 * Same rule as the cabinet, and for the same reason -- see `cabinetSurface`.
 */
export const deskSurface: SurfaceResolver = (material) =>
  material.name.includes("Handle") || material.name.includes("Brass") ? "metal" : "wood";

// ----------------------------------------------------------------------- bed
/**
 * The platform bed, generated by scripts/make-bed.mts.
 *
 * Measured off that asset, as fractions of the model's own bounding box, so
 * the fallback thresholds below are read from the piece rather than guessed:
 *
 *   part              shells   min y   max y   back z  front z  notes
 *   legs                   6   0.000   0.286   --      --       4 corners + 2 centre
 *   frame                  1   0.210   0.362   0.000   0.998    rails + slat deck
 *   mattress               1   0.250   0.488   0.025   0.973    inset in the rails
 *   foot rail              1   0.362   0.533   0.979   1.000    across the foot
 *   headboard              1   0.210   1.000   0.007   0.035    posts + two rails
 *   headboard panel        1   0.414   0.871   0.035   0.054    proud of the frame
 *
 * The bands overlap in a way a desk's do not, and the fallback has to be
 * ordered around that rather than thresholded harder. Height alone cannot
 * separate anything here: the headboard runs from the rails all the way to the
 * top of the piece, so it shares a band with the frame, the mattress, the foot
 * rail and the panel at once.
 *
 * DEPTH does the work instead, and the key is to read where a shell ENDS
 * rather than where it starts. The mattress and the frame both begin near the
 * head of the bed, so "starts at the back" would call all three of them a
 * headboard; what is true only of the head assembly is that it also FINISHES
 * there. Within that assembly the padded panel is then told from the frame it
 * fills exactly as a drawer pull is told from its front on the desk: it stands
 * proud.
 */
/** Only the legs reach the floor; the frame's rails start at 0.210. */
const BED_FLOOR_MAX_Y = 0.06;
/** A shell that both starts AND ends at the head is part of the headboard. */
const BED_HEAD_MAX_Z = 0.12;
/** Within the headboard, the upholstered insert stands proud of its frame. */
const BED_PANEL_MIN_Z = 0.045;
/** A shell out at the far end is the foot rail rather than part of the deck. */
const BED_FOOT_MIN_Z = 0.9;
/** Above the rails' own band: the mattress resting in them, not the frame. */
const BED_DECK_MIN_Y = 0.24;

export const classifyBedShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Bed_")) {
    if (materialName.includes("Mattress")) return "tabletop";
    if (materialName.includes("Panel")) return "backCushion";
    if (materialName.includes("Headboard")) return "backFrame";
    if (materialName.includes("FootRail")) return "stretchers";
    if (materialName.includes("Frame")) return "apron";
    return "legs";
  }

  // A foreign bed.
  const size = modelBox.getSize(new THREE.Vector3());
  const bottom = fraction(localBox.min.y, modelBox.min.y, size.y);
  const back = fraction(localBox.min.z, modelBox.min.z, size.z);
  const front = fraction(localBox.max.z, modelBox.min.z, size.z);

  if (bottom < BED_FLOOR_MAX_Y) return "legs";

  // Ends at the head, so it is the headboard or the panel filling it -- and
  // the panel is the one standing forward of the frame's own face.
  if (front < BED_HEAD_MAX_Z) return front > BED_PANEL_MIN_Z ? "backCushion" : "backFrame";

  // Checked before the deck, because a foot rail sits above the rails and
  // would otherwise pass the mattress's height test.
  if (back > BED_FOOT_MIN_Z) return "stretchers";

  if (bottom > BED_DECK_MIN_Y) return "tabletop";
  return "apron";
};

/**
 * The mattress and the headboard panel are upholstered; the rest is timber.
 *
 * Named rather than measured, and generously enough to catch a foreign asset:
 * whoever modelled a bed elsewhere called the soft parts something, and every
 * word below is one of the things they would have called them. Getting this
 * wrong is not cosmetic -- a mattress marked "wood" is offered plank timbers
 * as finishes and no fabric at all.
 */
export const bedSurface: SurfaceResolver = (material) =>
  /cloth|fabric|mattress|uphol|linen|cushion|pad/i.test(material.name) ? "cloth" : "wood";

// -------------------------------------------------------------- rocking chair
/**
 * The rocking chair, generated by scripts/make-rocking-chair.mts.
 *
 * Measured off that asset, as fractions of the model's own bounding box:
 *
 *   part            shells   min y        max y      notes
 *   runners              2   0.000        0.135      the two arcs, on the floor
 *   legs                 4   0.058        0.421      standing on the runners
 *   seat rails           1   0.395        0.442      a frame around the seat
 *   seat panel           1   0.416        0.447      woven, inside the rails
 *   back frame           1   0.442        1.000      posts, crest and lower rail
 *   back panel           1   0.537        0.937      woven, inside the frame
 *   arms                 2   0.442        0.679      a bar and its front post
 *
 * The bands overlap here in a way a table's do not -- the arms, the back frame
 * and the seat rails all start at the same height -- so the fallback below
 * cannot sort a foreign rocker on height alone and uses depth and width too.
 */
/** Only the runners touch the floor; the legs start at 0.058. */
const ROCKER_FLOOR_MAX_Y = 0.03;
/** The seat sits at 0.42 of the way up; everything below it is understructure. */
const ROCKER_SEAT_MAX_Y = 0.44;
/** Behind this is the back assembly rather than an arm. */
const ROCKER_BACK_MAX_Z = 0.3;

export const classifyRockerShell: ShellClassifier = ({ localBox, materialName, modelBox }) => {
  // Our own asset: the name is authoritative and needs no measuring.
  if (materialName.startsWith("Rocker_")) {
    if (materialName.includes("Runners")) return "stretchers";
    if (materialName.includes("SeatPanel")) return "seatCushion";
    if (materialName.includes("SeatRails")) return "seatFrame";
    if (materialName.includes("BackPanel")) return "backCushion";
    if (materialName.includes("BackFrame")) return "backFrame";
    if (materialName.includes("Arms")) return "armrests";
    return "legs";
  }

  // A foreign rocking chair. Height alone is not enough -- the arms, the back
  // and the seat frame all begin at seat level -- so this sorts by where a
  // shell sits front to back once height has separated the understructure.
  const size = modelBox.getSize(new THREE.Vector3());
  const bottom = fraction(localBox.min.y, modelBox.min.y, size.y);
  const back = fraction(localBox.max.z, modelBox.min.z, size.z);

  // A runner is the only thing on the floor, and it is long front to back.
  if (bottom < ROCKER_FLOOR_MAX_Y) return "stretchers";
  if (bottom < ROCKER_SEAT_MAX_Y) {
    // Under the seat: the rails are the wide flat thing at the top of that
    // band, and the legs are what reaches down toward the runners.
    const top = fraction(localBox.max.y, modelBox.min.y, size.y);
    return top > ROCKER_SEAT_MAX_Y * 0.9 && bottom > ROCKER_SEAT_MAX_Y * 0.85 ? "seatFrame" : "legs";
  }
  // Above the seat. Anything held at the back of the piece belongs to the
  // back; anything reaching forward over the seat is an arm.
  if (back < ROCKER_BACK_MAX_Z) {
    // The panel is inset from the frame on every side, so it is the narrower
    // of the two in x.
    const width = fraction(localBox.max.x, localBox.min.x, size.x);
    return width < 0.8 ? "backCushion" : "backFrame";
  }
  return "armrests";
};

/**
 * The woven seat and back panels take the weave palette; the narra frame,
 * runners, legs and arms take timber. "rattan" rather than "cane" for the same
 * reason the table's inset uses it: these are flat panels whose weave lives in
 * the texture, not modelled strand by strand.
 */
export const rockerSurface: SurfaceResolver = (material) =>
  material.name.includes("Panel") ? "rattan" : "wood";

/**
 * One connected-component shell before classification: still in local
 * (mesh) space, not yet baked into world space or bucketed by part.
 *
 * This is the seam `segmentChair` used to hide -- split and classify ran as
 * one inseparable pass. An AI-driven classifier needs to split first (to
 * build a grouping/render/prompt step), get an answer back asynchronously,
 * and only then classify -- so the two halves are exported separately below,
 * with `segmentChair` kept as a thin wrapper over both for the 5 shipped
 * models, unchanged.
 */
export type RawShell = {
  geometry: THREE.BufferGeometry;
  /** Local-space bounds, same meaning as `ShellInfo.localBox`. What the 5 shipped classifiers read. */
  localBox: THREE.Box3;
  /**
   * World-space bounds (the local box with the mesh's own node transform
   * applied). A hand-written classifier never reads this -- each shipped
   * model's local space is already known Y-up, confirmed by measurement. An
   * AI-driven classifier for an arbitrary upload has no such guarantee: a
   * converted FBX can carry its axis correction only in the node's rotation,
   * never baked into the vertex data itself, leaving local space genuinely
   * Z-up while world space (which the app already treats as canonically
   * Y-up everywhere else) is correct. So the generic/foreign-model path
   * reads this instead of `localBox`.
   */
  worldBox: THREE.Box3;
  vertexCount: number;
  materialName: string;
  material: THREE.MeshStandardMaterial;
  /** Owning mesh, needed at bake time to apply its node transform. */
  mesh: THREE.Mesh;
};

/**
 * Splits every mesh under `root` into shells, in local space, with no
 * classification yet. Callers that need the whole-model box before
 * classifying (relative thresholds, or an AI prompt) read it from here
 * rather than re-deriving it.
 */
export function splitMeshesIntoShells(
  root: THREE.Object3D
): { rawShells: RawShell[]; modelBox: THREE.Box3; worldModelBox: THREE.Box3 } {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });

  const split = meshes.map((mesh) => ({
    mesh,
    material: (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial,
    shells: splitIntoShells(mesh.geometry as THREE.BufferGeometry),
  }));

  const modelBox = new THREE.Box3();
  const worldModelBox = new THREE.Box3();
  const rawShells: RawShell[] = [];
  for (const { mesh, material, shells } of split) {
    for (const geometry of shells) {
      const localBox = geometry.boundingBox;
      if (!localBox) continue;
      const worldBox = localBox.clone().applyMatrix4(mesh.matrixWorld);
      modelBox.union(localBox);
      worldModelBox.union(worldBox);
      rawShells.push({
        geometry,
        localBox,
        worldBox,
        vertexCount: geometry.getAttribute("position").count,
        materialName: material.name ?? "",
        material,
        mesh,
      });
    }
  }

  return { rawShells, modelBox, worldModelBox };
}

/**
 * Classifies already-split shells and bakes each into world space. The
 * `index` a classifier receives is `rawShells`'s own index -- this function
 * visits shells in that exact order, single pass, so an AI-driven classifier
 * can answer by position in the same array it was asked about rather than by
 * re-deriving identity from geometry.
 *
 * `classify` is typed to accept an index so that caller; the 5 hand-written
 * `ShellClassifier`s (which take only a shell) remain assignable here
 * unchanged -- a function declaring fewer parameters than a call site
 * provides is always a valid substitute, the same rule that lets a plain
 * `(x) => y` stand in for `Array.prototype.map`'s three-argument callback.
 */
export function classifyAndBakeShells(
  rawShells: RawShell[],
  modelBox: THREE.Box3,
  classify: (shell: ShellInfo, index: number) => PartId,
  resolveSurface: SurfaceResolver
): SegmentedPart[] {
  const buckets = new Map<PartId, SegmentedPart>();

  rawShells.forEach((raw, index) => {
    const { geometry, localBox, vertexCount, materialName, material, mesh } = raw;
    const surface = resolveSurface(material);
    const id = classify({ localBox, vertexCount, surface, materialName, modelBox }, index);

    // Classify first, then bake -- the thresholds above are local-space values.
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const worldBox = geometry.boundingBox!.clone();

    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        id,
        surface,
        shells: [],
        box: worldBox.clone(),
        sourceMaterial: material,
      };
      buckets.set(id, bucket);
    }

    bucket.shells.push({ geometry, box: worldBox, vertexCount });
    bucket.box.union(worldBox);
  });

  return Array.from(buckets.values());
}

/**
 * Splits every mesh under `root` into classified parts, with each part's
 * geometry baked into world space (Y up, +Z toward the front of the chair).
 */
export function segmentChair(
  root: THREE.Object3D,
  classify: ShellClassifier,
  resolveSurface: SurfaceResolver
): SegmentedPart[] {
  const { rawShells, modelBox } = splitMeshesIntoShells(root);
  return classifyAndBakeShells(rawShells, modelBox, classify, resolveSurface);
}
