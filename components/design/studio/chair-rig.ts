import * as THREE from "three";
import type { PartId, PartRole, RigParams } from "./studio-config";
import { varnishForMaterial, type MaterialProfile, type Varnish } from "./materials-db";
import { loadMaterialMaps, tiled } from "./texture-loader";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEFAULT_PART_COLORS, DEFAULT_RIG_PARAMS } from "./studio-config";
import {
  ORIGINAL_SHAPE_ID,
  buildApertureInsert,
  carveFace,
  shapeById,
  type Aperture,
} from "./part-shapes";
import type { SegmentedPart } from "./chair-segmentation";
import { CONTACT_TOLERANCE_OF_HEIGHT, groupTouchingShells } from "./shell-contact";

/**
 * Assembles segmented shells into a posable chair.
 *
 * The hard part of "resize one piece" is that a chair is not a pile of
 * independent meshes -- stretching the legs without lifting the seat just drops
 * the seat through them. So every size parameter here drives a small rig rather
 * than a single mesh: taller legs lift the seat and back by exactly the distance
 * their own attachment points travelled, a wider seat spreads the legs to the
 * new corners, and a deeper seat carries the backrest rearward with it.
 *
 * Pivots use an outer/inner group pair (see `pivotGroup`), which lets every
 * child keep plain world-space coordinates while the outer group scales about
 * an arbitrary point.
 */

/** The normalized chair is exactly this tall, so camera framing is model-independent. */
const TARGET_HEIGHT = 1;

/**
 * Emphasis is deliberately faint. Emissive adds light on top of the material,
 * so a strong value hides the very finish the customer is there to choose: at
 * the previous 0.42 a seat cushion painted pure black still read as tan while
 * it was selected. These values read as a glow without repainting the part.
 */
const HOVER_EMISSIVE = 0x2a4a7a;
const SELECT_EMISSIVE = 0x8b5a2b;
const HOVER_INTENSITY = 0.09;
const SELECT_INTENSITY = 0.16;

export type ChairRig = {
  root: THREE.Group;
  /** Meshes to raycast against; each carries `userData.partId`. */
  pickables: THREE.Mesh[];
  availableParts: PartId[];
  /** Bounds of the chair at default parameters, for camera framing. */
  bounds: THREE.Box3;
  applyParams(params: RigParams): void;
  setColor(id: PartId, hex: string): void;
  /**
   * Applies a finish: its tint immediately, its surface relief when the maps
   * arrive. Passing a profile with no `pbr` folder clears any relief a
   * previous finish left behind, so switching narra -> Original does not
   * leave wood grain embossed on a plain surface.
   */
  setMaterialProfile(id: PartId, profile: MaterialProfile, varnish?: Varnish): void;
  /**
   * Rebuilds a part as one of the shapes in part-shapes.ts, or puts the
   * model's own geometry back when given `ORIGINAL_SHAPE_ID`.
   *
   * Per shell rather than per part, which is what makes a leg shape a leg
   * shape: the base role is the one role the rig never merges (see
   * `PER_SHELL_ROLES`), so a four-legged chair asks for "Tapered square" once
   * and gets four tapered legs, each built into the box its own leg occupied.
   *
   * `radius` is the 0..1 the edge-radius slider hands over. A shape that
   * declares `radiusable: false` ignores it.
   */
  setPartShape(id: PartId, shapeId: string, radius: number): void;
  /**
   * Works relief into a part's broad face, on top of whatever shape it is
   * wearing. `CARVING_NONE_ID` takes it off again.
   *
   * Recorded rather than applied here: the geometry has three owners now
   * -- the shape picker, the cutouts and this -- and whichever one fires
   * has to rebuild with what the other two last said. setPartShape does
   * the rebuilding; this only says what to rebuild with.
   */
  setPartCarving(id: PartId, carvingId: string): void;
  /**
   * Cuts holes through a part, and fills them.
   *
   * Two things at once because they are one description: the hole is cut into
   * the part's own outline (so the geometry has to be rebuilt) and the insert
   * that sits in it is a separate mesh with a separate finish. Splitting them
   * into two calls would mean a frame where the glass was in place and the
   * hole was not, which on a tabletop reads as a pane floating on the surface.
   *
   * `fills` is positional against `apertures`; a null entry leaves the hole
   * open. Passing an empty array removes every hole and every insert.
   *
   * Only does anything on a part wearing a shape that declared `apertured`.
   * The rebuild is driven through setPartShape, which is what keeps holes,
   * shape and edge radius from fighting over the same geometry.
   */
  setPartApertures(
    id: PartId,
    shapeId: string,
    apertures: Aperture[],
    fills: Array<{ profile: MaterialProfile; varnish?: Varnish } | null>
  ): void;
  /**
   * How many separate shells each part ended up with.
   *
   * Published for one reason: the base role covers both a chair's four legs
   * and a stool's single caned drum, and the shape list has to differ between
   * them. See `shapesForPart`.
   */
  shellCounts: Partial<Record<PartId, number>>;
  /**
   * How far a leaf reaches out past the top's edge as authored, in rig units.
   *
   * Published so the studio can say "26 cm" rather than "1.0". Measured off
   * the asset rather than declared on the model, so a generator that changes
   * the leaf's proportions does not leave the interface quoting a number the
   * geometry stopped agreeing with. Zero on a piece with no leaves.
   */
  leafReach: number;
  /**
   * Takes a part out of the 3D view completely -- not drawn at all -- and
   * drops it from the blueprint's drawn views. Earlier this ghosted the part
   * at a partial opacity so its outline stayed visible; hiding now means
   * hiding, so looking past a part actually clears the view of what is
   * behind it.
   *
   * The design still contains it -- see isRemoved -- so it is still built,
   * still measured, and still listed in the blueprint's component schedule
   * with its finish and size, exactly as if it were shown. Invisible here
   * means "not in the way", never "not in the piece".
   */
  setPartHidden(id: PartId, hidden: boolean): void;
  /** True when `setPartHidden` last set this part hidden. */
  isHidden(id: PartId): boolean;
  /**
   * True when the rig has switched this one mesh off -- a shelf beyond the
   * count chosen, a drawer the run no longer holds -- as opposed to a whole
   * part being hidden or removed.
   *
   * `mesh.visible` cannot answer this: a part the customer hid is invisible
   * too, and is still built, measured and priced. Anything that decides what
   * is IN the piece reads this; only what is drawn reads visibility.
   */
  isMeshInactive(mesh: THREE.Mesh): boolean;
  /**
   * For a part whose shells were welded into one mesh, each original shell's
   * size as a fraction of the whole part's -- null for parts that still have
   * a mesh per shell, since those can simply be measured directly.
   *
   * It exists so a build sheet can quote a component rather than a group. A
   * part like a pair of bed rails or a set of seat rails is drawn as one
   * merged mesh for performance (see mergeMovedTogether), so measuring the
   * live rig alone yields the box enclosing both rails -- 86.6cm across for
   * two rails 3.8cm wide, which is not a dimension anyone can cut to. A
   * merged part is moved and scaled as a unit, so these fractions stay valid
   * against the live posed part and give back the real component size.
   */
  componentFractions(id: PartId): Array<[number, number, number]> | null;
  /**
   * True when a size control has taken the part out of the design entirely
   * (ornaments or arm pads at zero). Distinct from setPartHidden: a part the
   * customer has merely hidden is still built, still measured, and still on
   * the blueprint's schedule -- only a part that is actually removed drops
   * off the design altogether.
   */
  isRemoved(id: PartId): boolean;
  setEmphasis(selected: PartId | null, hovered: PartId | null): void;
  /** True when this model has a door that can be swung open. */
  hasDoors: boolean;
  /**
   * The opening the doors close over, as the model authored it, in rig units
   * (the rig normalises every model to exactly 1.0 tall).
   *
   * Published because the count controls have to be narrowed against a real
   * measurement -- how wide a leaf would be, how much clear height a shelf
   * would leave -- and the studio cannot get that from the live measurement:
   * once the customer drops the doors to zero, the doors stop being measured
   * at all, and the limit that would let them add doors back would vanish
   * with them. This is the authored span, so it never moves; multiply it by
   * the piece's own width and height parameters to get where things stand.
   */
  baySpan: { width: number; height: number };
  /**
   * The run the drawer fronts divide, in rig units, as the model authored it.
   *
   * Published for the same reason `baySpan` is: the drawer count has to be
   * narrowed against a real measurement -- how wide each front would end up --
   * and the studio cannot take that from the live piece, because dropping the
   * count to zero stops the drawers being measured at all and the limit that
   * would let them be added back would vanish with them. Zero when the model
   * has no drawers.
   */
  drawerSpan: { width: number; height: number };
  /** Swings the doors open or shut. The move itself is eased; see advance(). */
  setDoorsOpen(open: boolean): void;
  /** Slides the drawers out or back in, eased like the doors; see advance(). */
  setDrawersOpen(open: boolean): void;
  /**
   * When true, doors and drawers jump to where they are going instead of
   * travelling there -- the visitor's prefers-reduced-motion, passed in.
   */
  setReducedMotion(reduce: boolean): void;
  /**
   * Runs `fn` with every door shut and every drawer in, then puts them back.
   *
   * Measurement, outlines and the product shot all read the posed geometry,
   * and an open door or drawer is not part of a piece's size: measured with
   * its doors swung out, a cabinet came out deeper than it is.
   */
  withShut<T>(fn: () => T): T;
  /**
   * Advances anything that moves under its own steam, given the seconds since
   * the last frame.
   *
   * Time-based rather than per-frame so the swing takes the same half second
   * on a 144Hz laptop as on a 30Hz one. Cheap to call every frame: it returns
   * immediately once the doors have settled.
   */
  advance(deltaSeconds: number): void;
  dispose(): void;
};

/**
 * How far a door swings, and how fast it settles.
 *
 * 105 degrees rather than 90: square to the carcass still hides the inside of
 * the bay from anyone looking from slightly off-axis, which is where the
 * camera usually is, and past square is where a real door rests anyway. The
 * rate is an exponential settle -- fast away from shut, easing as it arrives
 * -- which is the same shape as the interface's own cubic-bezier(0.16, 1,
 * 0.3, 1) and reads as weight rather than as a slide.
 */
const DOOR_OPEN_RADIANS = (105 * Math.PI) / 180;
const DOOR_SETTLE_RATE = 5.2;

/**
 * How far a drawer slides, how fast it settles, and how long each waits after
 * the one before it.
 *
 * Out by 45% of the carcass's depth: far enough to see into, and still well on
 * its runners -- a drawer pulled all the way reads as one about to fall. A
 * touch quicker than the doors, because a slide covers less of the screen than
 * a 105-degree swing. The stagger keeps a stack from moving as one slab, which
 * reads as the whole front coming away.
 */
const DRAWER_TRAVEL_OF_DEPTH = 0.45;
const DRAWER_SETTLE_RATE = 6.5;
const DRAWER_STAGGER_SECONDS = 0.06;

/**
 * How many shelf instances the rig builds, whatever the count is set to.
 *
 * Matches the ceiling on the `shelfCount` control in studio-models.ts, and has
 * to: the rig can only switch on what it built, so a control allowed past this
 * would silently stop adding shelves partway along its own range.
 *
 * Six rather than four since the bookshelf arrived. A cabinet's bay is one
 * compartment of a taller carcass and four shelves fill it; an open case is
 * the whole 168cm and six is still a 24cm compartment, which is a paperback
 * with room to spare. The two spare groups on a cabinet cost nothing -- they
 * are built once and switched off.
 */
const MAX_SHELVES = 6;

/**
 * How many drawer fronts the rig builds, whatever the count is set to.
 *
 * Six, and the same contract as MAX_SHELVES: the rig can only switch on what
 * it built, so a control allowed past this would silently stop adding drawers
 * partway along its own range. Six across a desk's 104cm run is a 17cm drawer,
 * already under the 20cm floor in BUILDABLE -- so the buildability rule bites
 * before this ceiling does on any piece here, which is the right way round.
 */
const MAX_DRAWERS = 6;

/**
 * Returns a pair of groups that together scale about `pivot` while letting
 * children stay in world coordinates: add children to `inner`, transform `outer`.
 */
function pivotGroup(pivot: THREE.Vector3) {
  const outer = new THREE.Group();
  outer.position.copy(pivot);
  const inner = new THREE.Group();
  inner.position.copy(pivot).negate();
  outer.add(inner);
  return { outer, inner };
}

/**
 * The box of a drawer -- two sides, a bottom and a back -- behind its front.
 *
 * `front` is the authored front's bounds, with +Z toward the front of the
 * piece. The box runs back from the front's rear face by `depth`, a little
 * narrower and shorter than the face it hangs on, the way a real drawer sits
 * behind its front.
 */
function buildDrawerBody(front: THREE.Box3, depth: number): THREE.BufferGeometry {
  const size = front.getSize(new THREE.Vector3());
  const centre = front.getCenter(new THREE.Vector3());
  const width = size.x * 0.9;
  const height = size.y * 0.75;
  const wall = Math.max(Math.min(size.x, size.y) * 0.04, size.z * 0.5);
  const rear = front.min.z;
  const bottom = centre.y - height / 2;
  const midZ = rear - depth / 2;
  const pieces = [
    new THREE.BoxGeometry(wall, height, depth).translate(centre.x - width / 2 + wall / 2, bottom + height / 2, midZ),
    new THREE.BoxGeometry(wall, height, depth).translate(centre.x + width / 2 - wall / 2, bottom + height / 2, midZ),
    new THREE.BoxGeometry(width, wall, depth).translate(centre.x, bottom + wall / 2, midZ),
    new THREE.BoxGeometry(width, height, wall).translate(centre.x, bottom + height / 2, rear - depth + wall / 2),
  ];
  const merged = mergeGeometries(pieces) ?? pieces[0].clone();
  for (const piece of pieces) piece.dispose();
  return merged;
}

function boxCenter(box: THREE.Box3) {
  return box.getCenter(new THREE.Vector3());
}

/** The whole piece's bounds, in the space its shells were baked into. */
function pieceBounds(parts: SegmentedPart[]) {
  const box = new THREE.Box3();
  for (const part of parts) box.union(part.box);
  return box;
}

/**
 * A base group at least this wide or deep, as a share of the whole piece, is
 * a frame or a pedestal rather than a leg. A leg is a small fraction of the
 * width; a chair frame or a pedestal is most of it.
 */
const SPANNING_BASE_FRACTION = 0.5;

/** The whole piece's height, in the space its shells were baked into. */
function pieceHeight(parts: SegmentedPart[]) {
  const box = new THREE.Box3();
  for (const part of parts) box.union(part.box);
  return box.isEmpty() ? 0 : box.max.y - box.min.y;
}

/**
 * The roles that pivot each of their shells separately.
 *
 * A leg needs its own slot so the four of them spread as the seat widens, a
 * carving is parented to the leg it sits on, and an arm moves outward rather
 * than stretching. A shelf needs one so it thickens about its own middle
 * rather than the stack's, and a pull needs one so it can be counter-scaled
 * against the carcass and keep its real size. Every other role drops all of
 * its shells into one pivot and moves them as a unit, so those shells only
 * ever cost a draw call each.
 */
const PER_SHELL_ROLES = new Set<PartRole>([
  "base",
  "accessory",
  "armrest",
  // Throw pillows, for exactly the reason armrests do: they are a small
  // number of repeated shells that each keep their own place, spread apart
  // as the piece widens, and scale where they sit. Merged into one shell a
  // pair of pillows is a single object spanning the gap between them, so
  // widening the sofa stretched both pillows and the air between them into
  // one wider pillow -- and a pillow does not get wider because the sofa
  // did. The arm slot has handled them all along; this is what makes there
  // be two of them to hand it.
  "pillows",
  "shelf",
  // A door earns its own shell for the plainest reason on this list: the
  // leaves genuinely move independently, swinging away from each other on
  // opposite hinges. Merged, a pair of doors is one slab that can only pivot
  // about one edge, which is what it did before this -- the whole front of
  // the cabinet swinging open as a single panel.
  "door",
  // A drawer front earns its own shell for the same reason a door does, and
  // it did not until the count control arrived. Merged, a pair of fronts is
  // one slab: the rig reads the row's axis and its slot size off the authored
  // shells, and a single merged shell says the row is one drawer as wide as
  // two. That is exactly what it said -- the desk reported a 98cm front and
  // the cabinet reported its VERTICAL drawer stack as running horizontally,
  // because the merged box is wider than it is tall.
  "drawer",
  "hardware",
  // For the same reason a door does, and more so: the four leaves hinge on
  // four different edges about two different axes. Merged into one shell they
  // could only rotate about a single line, which on a table means the top and
  // three of its leaves swinging off together.
  "leaf",
]);

/**
 * Collapses each part's shells into one geometry where the rig moves them
 * together anyway.
 *
 * This is invisible on the Victorian chair, whose seat rails are four shells,
 * and decisive on the rattan chair, whose woven seat and back are 401 separate
 * strands -- one mesh each would be 401 draw calls a frame to move two panels
 * that never move independently.
 *
 * Shells are merged before normalize() rather than after, so the merged
 * geometry is translated and scaled once instead of per strand.
 */
function mergeMovedTogether(parts: SegmentedPart[], roles: Record<string, PartRole>, fractions: Map<PartId, Array<[number, number, number]>>) {
  for (const part of parts) {
    if (PER_SHELL_ROLES.has(roles[part.id])) continue;
    if (part.shells.length < 2) continue;

    // Record each shell's size as a fraction of the part's own, BEFORE the
    // shells are welded into one geometry and their individual sizes are
    // gone for good. A merged part moves and scales as a single unit, so
    // those fractions stay true however the piece is later posed -- which is
    // what lets the component schedule quote one bed rail at 3.8cm wide
    // instead of quoting the 86.6cm box that encloses both of them.
    const partSize = part.box.getSize(new THREE.Vector3());
    fractions.set(
      part.id,
      part.shells.map((shell) => {
        const size = shell.box.getSize(new THREE.Vector3());
        return [0, 1, 2].map((axis) => {
          const whole = partSize.getComponent(axis);
          return whole > 0 ? size.getComponent(axis) / whole : 1;
        }) as [number, number, number];
      })
    );

    const merged = mergeGeometries(part.shells.map((shell) => shell.geometry));
    // mergeGeometries returns null if the attribute sets disagree. They come
    // from one split of one mesh here, so they never should -- but a part drawn
    // as many shells is still correct, and losing it would not be.
    if (!merged) continue;

    for (const shell of part.shells) shell.geometry.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    part.shells = [
      {
        geometry: merged,
        box: merged.boundingBox!.clone(),
        vertexCount: merged.getAttribute("position").count,
      },
    ];
  }
}

/**
 * Where a finish's scanned maps take their texture coordinates from.
 *
 * "model" reads the asset's own unwrap (channel 0) -- right for the shipped
 * models, which a person unwrapped for exactly this. "projected" reads a
 * second set laid over each shell by withProjectedFinishUvs (channel 1),
 * which a generated model needs: an untextured Meshy file has no UVs at all,
 * so a grain has nothing to follow, and a textured one has a baking atlas --
 * measured at ~19 islands per shell, each rotated and scaled its own way and
 * packed into one square for the whole piece -- through which a tiling grain
 * runs in a different direction on every island and repeats barely once
 * across the chair. The model's own photographed colour stays on its atlas.
 */
export type FinishUv = "model" | "projected";

/**
 * UV units per unit of the finished piece's height. The shipped models' own
 * unwraps carry 1.0-1.3 (textures/README.md), and every finish's `repeat`
 * was tuned against those, so projected coordinates match them.
 */
const FINISH_UV_DENSITY = 1.15;

/**
 * Where smoothing stops and an edge stays an edge. A generated mesh's
 * neighbouring faces meet at a median of 6 degrees and 90% of them within
 * 30, measured on the stored models -- that is a curved surface cut into
 * facets, and wants smoothing. The genuine corners (a seat's front edge, the
 * end of a rail) sit above 60 and stay crisp.
 *
 * Measured on the two stored untextured models: 6-13% of points sit on an
 * edge sharper than this, and no normal splits anywhere else. 50 kept the
 * facets of thin many-sided legs as edges; 70 began rounding real corners.
 */
const CREASE_ANGLE = THREE.MathUtils.degToRad(60);

/**
 * Gives a shell normals if it arrived without any.
 *
 * Meshy's untextured output carries positions and nothing else. GLTFLoader
 * answers a primitive with no normals by switching its material to flat
 * shading, which lights every one of ~15,000 triangles as its own flat panel
 * -- the lumpy, faceted look -- however smooth the surface they describe.
 * Shipped models all carry normals, so this never touches them.
 */
function withSmoothNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geometry.getAttribute("normal")) return geometry;

  // One vertex per triangle corner, so every corner can take its own normal.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = flat.getAttribute("position");
  const corners = position.count;
  const triangles = Math.floor(corners / 3);

  // Corners at one point, whichever vertex copy each triangle used.
  const pointOf = new Int32Array(corners);
  const points = new Map<string, number>();
  for (let i = 0; i < corners; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    let id = points.get(key);
    if (id === undefined) {
      id = points.size;
      points.set(key, id);
    }
    pointOf[i] = id;
  }

  // Each triangle's normal, left unnormalised: its length is twice the
  // triangle's area, which is the weight it gets in the average below.
  const face = new Float32Array(triangles * 3);
  const faceLength = new Float32Array(triangles);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge = new THREE.Vector3();
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    c.sub(b).cross(edge.subVectors(a, b));
    face.set([c.x, c.y, c.z], t * 3);
    faceLength[t] = c.length();
  }

  // Corners around a point share a normal wherever the edge between their
  // triangles is smooth, and only a genuinely sharp edge separates them.
  // Deciding per EDGE is the point: toCreasedNormals decides per corner
  // against every triangle in the fan, which splits a smoothly curving
  // surface wherever the fan as a whole turns more than the crease -- a
  // seam of shading with no edge under it.
  const parent = new Int32Array(corners);
  for (let i = 0; i < corners; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const cosCrease = Math.cos(CREASE_ANGLE);
  const firstAlongEdge = new Map<string, number>();
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const start = t * 3 + k;
      const end = t * 3 + ((k + 1) % 3);
      const key = pointOf[start] < pointOf[end] ? `${pointOf[start]}_${pointOf[end]}` : `${pointOf[end]}_${pointOf[start]}`;
      const other = firstAlongEdge.get(key);
      if (other === undefined) {
        firstAlongEdge.set(key, start);
        continue;
      }
      const u = Math.floor(other / 3);
      const lengths = faceLength[t] * faceLength[u];
      const dot = face[t * 3] * face[u * 3] + face[t * 3 + 1] * face[u * 3 + 1] + face[t * 3 + 2] * face[u * 3 + 2];
      // A zero-area sliver has no direction of its own; it joins its
      // neighbours rather than being left with no normal at all.
      if (lengths > 0 && dot < cosCrease * lengths) continue;
      const otherEnd = u * 3 + (((other % 3) + 1) % 3);
      for (const mine of [start, end]) {
        for (const theirs of [other, otherEnd]) {
          if (pointOf[mine] === pointOf[theirs]) parent[find(mine)] = find(theirs);
        }
      }
    }
  }

  const sum = new Float32Array(corners * 3);
  for (let i = 0; i < corners; i++) {
    const root = find(i);
    const t = Math.floor(i / 3);
    sum[root * 3] += face[t * 3];
    sum[root * 3 + 1] += face[t * 3 + 1];
    sum[root * 3 + 2] += face[t * 3 + 2];
  }
  const normals = new Float32Array(corners * 3);
  for (let i = 0; i < corners; i++) {
    const root = find(i);
    const x = sum[root * 3];
    const y = sum[root * 3 + 1];
    const z = sum[root * 3 + 2];
    const length = Math.hypot(x, y, z);
    if (length > 0) normals.set([x / length, y / length, z / length], i * 3);
    else normals.set([0, 1, 0], i * 3);
  }
  flat.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  // Weld back into an indexed shell like every other. Only corners at one
  // point with the same normal merge, so the sharp edges survive it.
  const indexed = mergeVertices(flat);
  flat.dispose();
  geometry.dispose();
  indexed.computeBoundingBox();
  indexed.computeBoundingSphere();
  return indexed;
}

/**
 * Lays a second UV set (`uv1`) over a shell for a finish to tile through.
 *
 * Each triangle is projected flat along whichever axis it faces most, and its
 * U -- the direction the scans' grain runs -- is laid along the shell's own
 * longest side whenever that side lies in the triangle's plane. So the grain
 * runs down a leg, along a rail and around an arm, on every face of it,
 * rather than wherever an atlas happened to rotate that patch. Where a
 * shell's faces turn from one axis to the next the pattern restarts, but the
 * grain keeps its direction and its scale, which is what the eye reads.
 *
 * `unitScale` is the factor normalize() will apply, so the density is set
 * against the finished piece rather than the file's own units.
 */
function withProjectedFinishUvs(geometry: THREE.BufferGeometry, box: THREE.Box3, unitScale: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = flat.getAttribute("position");
  const size = box.getSize(new THREE.Vector3());
  const longest = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const density = unitScale * FINISH_UV_DENSITY;

  const uv = new Float32Array(position.count * 2);
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const normal = new THREE.Vector3();
  const edge = new THREE.Vector3();
  for (let first = 0; first + 2 < position.count; first += 3) {
    corners.forEach((corner, k) => corner.fromBufferAttribute(position, first + k));
    normal.subVectors(corners[2], corners[1]).cross(edge.subVectors(corners[0], corners[1]));
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    const facing = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const [p, q] = [0, 1, 2].filter((axis) => axis !== facing);
    // End grain -- a face across the shell's length -- takes its grain along
    // the larger of its own two sides instead.
    const grain = longest === p || longest === q ? longest : size.getComponent(p) >= size.getComponent(q) ? p : q;
    const across = grain === p ? q : p;
    corners.forEach((corner, k) => {
      uv[(first + k) * 2] = corner.getComponent(grain) * density;
      uv[(first + k) * 2 + 1] = corner.getComponent(across) * density;
    });
  }
  flat.setAttribute("uv1", new THREE.BufferAttribute(uv, 2));

  const indexed = mergeVertices(flat);
  flat.dispose();
  geometry.dispose();
  indexed.computeBoundingBox();
  indexed.computeBoundingSphere();
  return indexed;
}

/**
 * Readies every shell's surface before the shells are merged: normals where
 * the file had none, and projected finish UVs where the model asks for them.
 * Runs per shell, before mergeMovedTogether, because a seat frame's four
 * rails each run their own way -- once welded into one geometry, the grain
 * could only follow the frame's box, not each rail.
 */
function prepareSurfaces(parts: SegmentedPart[], finishUv: FinishUv) {
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(part.box);
  const height = bounds.max.y - bounds.min.y;
  const unitScale = height > 0 ? TARGET_HEIGHT / height : 1;

  for (const part of parts) {
    for (const shell of part.shells) {
      let geometry = withSmoothNormals(shell.geometry);
      if (finishUv === "projected") geometry = withProjectedFinishUvs(geometry, shell.box, unitScale);
      shell.geometry = geometry;
    }
  }
}

/** Moves the chair so it stands on y=0, centred on x/z, and is TARGET_HEIGHT tall. */
function normalize(parts: SegmentedPart[]) {
  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(part.box);

  const size = bounds.getSize(new THREE.Vector3());
  const center = boxCenter(bounds);
  const scale = TARGET_HEIGHT / size.y;

  for (const part of parts) {
    for (const shell of part.shells) {
      shell.geometry.translate(-center.x, -bounds.min.y, -center.z);
      shell.geometry.scale(scale, scale, scale);
      shell.geometry.computeBoundingBox();
      shell.geometry.computeBoundingSphere();
      shell.box.copy(shell.geometry.boundingBox!);
    }
    part.box.makeEmpty();
    for (const shell of part.shells) part.box.union(shell.box);
  }
}

/**
 * @param roles - the role each part id plays in this model, from its PartDef
 *   list. The rig is written against roles so one implementation assembles
 *   both a four-legged side chair and a moulded-shell cushion chair.
 */
export function buildChairRig(
  parts: SegmentedPart[],
  roles: Record<string, PartRole>,
  /** The model's own UV density; see StudioModel.uvScale. */
  uvScale = 1,
  /** Which UVs a finish tiles through; see FinishUv. */
  finishUv: FinishUv = "model"
): ChairRig {
  // Populated by mergeMovedTogether for parts whose shells it is about to
  // weld together; see componentFractions on ChairRig.
  const componentFractions = new Map<PartId, Array<[number, number, number]>>();
  prepareSurfaces(parts, finishUv);
  mergeMovedTogether(parts, roles, componentFractions);
  normalize(parts);

  const byRole = new Map<PartRole, SegmentedPart>();
  for (const part of parts) {
    const role = roles[part.id];
    if (role) byRole.set(role, part);
  }

  const materials = new Map<PartId, THREE.MeshPhysicalMaterial>();
  // The model's own photographed baseColor per part, kept so that a finish
  // which swaps in a scanned albedo is undoable. Without this, picking
  // Narra and then Original would leave the timber scan on the piece --
  // the model's texture is only reachable from the material we overwrite.
  const originalMaps = new Map<PartId, THREE.Texture | null>();
  // The same, for the model's own relief. A textured generation's normal map
  // is the detail its 15,000-face mesh was baked down from; dropping it the
  // first time a finish was picked is what left those pieces looking
  // low-poly. And like the colour map, it is shared with the cached GLTF, so
  // it must never be disposed along with a finish's maps.
  const originalRelief = new Map<PartId, { normal: THREE.Texture | null; roughness: THREE.Texture | null }>();
  const pickables: THREE.Mesh[] = [];
  // A part is drawn unless a size control removed it entirely.
  const removed = new Set<PartId>();
  // A hidden part is not drawn at all -- see setPartHidden on ChairRig.
  const hidden = new Set<PartId>();
  // Each part's own opacity: the model's shipped value by default, or
  // whatever a finish (glass, chiefly) set it to since. Tracked separately
  // from the material so a part's real transparency survives being hidden
  // and shown again.
  const realOpacity = new Map<PartId, number>();
  /**
   * The transparency the model itself shipped each part with, kept apart from
   * `realOpacity` because that one moves.
   *
   * Needed the moment a part can be finished in more than one family. Glass is
   * the only finish that sets an opacity, so before this a tabletop that went
   * timber -> Clear glass -> timber kept the pane's 0.18 and its `transparent`
   * flag for the rest of the session: the walnut top stayed see-through, with
   * nothing in the finish that was actually applied to explain it. A finish
   * that declares no opacity means "whatever the model shipped with", so that
   * value has to survive somewhere the glass finishes cannot overwrite.
   */
  const sourceOpacity = new Map<PartId, { opacity: number; transparent: boolean }>();
  const geometries: THREE.BufferGeometry[] = [];

  function materialFor(part: SegmentedPart) {
    let material = materials.get(part.id);
    if (!material) {
      // Physical rather than standard, so a varnish can lay a clearcoat over
      // the timber. A sealed surface reflects twice -- once off the wood and
      // once off the film above it -- and MeshStandardMaterial has only the one
      // lobe, so gloss could otherwise only be faked by making the wood itself
      // mirror-like, which reads as plastic. The GLTF's own maps are carried
      // across by hand because copy() between the two types is not safe.
      const source = part.sourceMaterial;
      material = new THREE.MeshPhysicalMaterial({
        map: source.map,
        normalMap: source.normalMap,
        roughnessMap: source.roughnessMap,
        metalnessMap: source.metalnessMap,
        aoMap: source.aoMap,
        color: source.color.clone(),
        roughness: source.roughness,
        metalness: source.metalness,
        side: source.side,
        transparent: source.transparent,
        opacity: source.opacity,
        alphaTest: source.alphaTest,
        // Never flat. GLTFLoader only sets it for geometry without normals,
        // and prepareSurfaces has given every shell normals by now -- see
        // withSmoothNormals.
        flatShading: false,
        // A generated model's vertex colours are never its paint. Meshy's
        // split marks each part it cut in a loud colour of its own -- built
        // for 3D printing, where that is the preview -- and the studio was
        // showing them as the finish: a chair in magenta arms, a yellow seat
        // and red legs. Its real paint, when it has any, is its texture.
        vertexColors: finishUv === "projected" ? false : source.vertexColors,
      });
      material.normalScale.copy(source.normalScale);
      material.name = part.id;
      // Honour the GLTF's own doubleSided flag rather than forcing FrontSide.
      // Back-face culling is only safe on closed solids, and not every model is
      // one: the cushion chair's frame and arm pads are open surfaces (268 and
      // 38 boundary edges), so culling their back faces made you see straight
      // through them. The Victorian chair is closed, which is why forcing
      // FrontSide looked fine until a second model arrived. The overdraw this
      // costs is not measurable on a chair-sized mesh.
      material.color.set(DEFAULT_PART_COLORS[part.id]);
      material.emissive = new THREE.Color(0x000000);
      material.emissiveIntensity = 0;
      materials.set(part.id, material);
      originalMaps.set(part.id, material.map ?? null);
      originalRelief.set(part.id, { normal: material.normalMap ?? null, roughness: material.roughnessMap ?? null });
      realOpacity.set(part.id, material.opacity);
      sourceOpacity.set(part.id, { opacity: material.opacity, transparent: material.transparent });
    }
    return material;
  }

  /**
   * One mesh the shape control can rebuild, with everything needed to do it.
   *
   * The original geometry is kept rather than regenerated because it cannot
   * be regenerated -- it came out of the GLB, and "As modelled" has to be a
   * real way back, not an approximation of one. The box is captured here, at
   * build time, for the same reason `bounds` is: it is the space the part
   * occupies at the model's own proportions, which is the space a substituted
   * shape should fill. Taking it later would measure whatever the size
   * sliders had done since, so a leg would be rebuilt to fit its stretched
   * self and then stretched again.
   */
  type ShapeSlot = {
    mesh: THREE.Mesh;
    original: THREE.BufferGeometry;
    centre: THREE.Vector3;
    size: { w: number; h: number; d: number };
    /**
     * Set on every shell of a touching base group except the first. A shape
     * stands in for the whole group -- the first shell is rebuilt into the
     * group's box, so a layered pedestal becomes one drum rather than a drum
     * per layer -- and these are switched off for as long as it does.
     */
    absorbed?: boolean;
  };
  const shapeSlots = new Map<PartId, ShapeSlot[]>();
  /** Geometry this rig generated, kept apart from the model's own so dispose can tell them apart. */
  const generated = new Set<THREE.BufferGeometry>();

  function meshFor(part: SegmentedPart, geometry: THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(geometry, materialFor(part));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.partId = part.id;
    pickables.push(mesh);
    geometries.push(geometry);

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const slots = shapeSlots.get(part.id) ?? [];
    slots.push({
      mesh,
      original: geometry,
      centre: boxCenter(box),
      // Floored well above zero: a shell can be a single flat face (a cabinet
      // back, a pane), and a builder handed a zero dimension produces either
      // degenerate triangles or a division by zero, depending on which one it
      // divides by first.
      size: { w: Math.max(size.x, 1e-4), h: Math.max(size.y, 1e-4), d: Math.max(size.z, 1e-4) },
    });
    shapeSlots.set(part.id, slots);
    return mesh;
  }

  /**
   * The shape each part is currently wearing, so a rebuild triggered by
   * something else can be skipped when nothing actually changed. Dragging the
   * radius slider fires on every tick, and regenerating four cabriole legs
   * per tick is not free.
   */
  const currentShape = new Map<PartId, string>();

  /**
   * How much of its own box the top's current shape actually fills.
   *
   * 1 x 1 for a rectangular top, which is what every model authors and what
   * the legs were positioned against. A round top on a 180 x 90 frame is a
   * 90cm circle, so it fills half the length -- and the legs, which stand at
   * the corners of the rectangle, were left standing 45cm outside the timber
   * holding nothing up. The stretcher between them spanned the same fresh
   * air, and a raised leaf hinged off an edge that was no longer there.
   *
   * Read from the shape's own outline rather than declared per shape, so a
   * shape added later is adapted to without anyone remembering to.
   */
  let topFootprint = { x: 1, z: 1 };

  function measureTopFootprint(id: PartId, shapeId: string) {
    // Only the part the legs are positioned against. A round SHELF does not
    // move a cabinet's feet.
    if (!seatFrame || id !== seatFrame.id) return;

    const shape = shapeId === ORIGINAL_SHAPE_ID ? null : shapeById(shapeId);
    const outline = shape?.outlineFor?.(shapeSizeOf(id));
    if (!outline) {
      // The model's own geometry, or a shape that does not publish an
      // outline: assume it fills its box, which is what the asset does.
      topFootprint = { x: 1, z: 1 };
      return;
    }

    const points = outline.getPoints(24);
    if (points.length < 3) {
      topFootprint = { x: 1, z: 1 };
      return;
    }
    const plan = new THREE.Box2().setFromPoints(points);
    const size = shapeSizeOf(id);
    // The outline is drawn in the plan frame: X across, Y along. Which of the
    // box's axes those are depends on how the panel lies, and for a tabletop
    // -- thin in Y -- the plan's Y is the box's Z.
    const planW = Math.max(1e-4, plan.max.x - plan.min.x);
    const planH = Math.max(1e-4, plan.max.y - plan.min.y);
    const thin = Math.min(size.w, size.h, size.d);
    if (thin === size.h) {
      topFootprint = { x: planW / size.w, z: planH / size.d };
    } else if (thin === size.d) {
      topFootprint = { x: planW / size.w, z: 1 };
    } else {
      topFootprint = { x: 1, z: planW / size.d };
    }
  }

  /** The box a part's shape is built into -- the first slot's, which is the part's own. */
  function shapeSizeOf(id: PartId): { w: number; h: number; d: number } {
    const slot = shapeSlots.get(id)?.[0];
    return slot ? slot.size : { w: 1, h: 1, d: 1 };
  }

  /**
   * The holes each part is currently carrying.
   *
   * Held here rather than passed in on every call because the geometry has
   * two independent owners -- the shape picker and the hole controls -- and
   * whichever one fires has to rebuild with what the OTHER one last said.
   * Dragging the edge-radius slider on a top with a glass round in it must
   * not quietly fill the hole back in.
   */
  const partApertures = new Map<PartId, Aperture[]>();
  /** The carving each part is wearing, by id. Absent means plain. */
  const partCarvings = new Map<PartId, string>();
  /** The insert meshes filling those holes, so they can be replaced and disposed. */
  const apertureInserts = new Map<PartId, THREE.Mesh[]>();

  /** Part of the rebuild key, so a change of holes rebuilds geometry that is otherwise identical. */
  function apertureKey(id: PartId): string {
    const holes = partApertures.get(id);
    if (!holes?.length) return "";
    return holes.map((h) => `${h.shape}/${h.size.toFixed(3)}/${h.x.toFixed(3)}/${h.y.toFixed(3)}`).join("|");
  }

  function setPartShape(id: PartId, shapeId: string, radius: number) {
    const slots = shapeSlots.get(id);
    if (!slots) return;

    const key = `${shapeId}:${radius.toFixed(3)}:${apertureKey(id)}:${partCarvings.get(id) ?? ""}`;
    if (currentShape.get(id) === key) {
      // Still measure: applyParams reads the footprint every frame and this
      // early return fires on the very next call after a rebuild.
      measureTopFootprint(id, shapeId);
      return;
    }
    currentShape.set(id, key);

    measureTopFootprint(id, shapeId);

    const shape = shapeId === ORIGINAL_SHAPE_ID ? null : shapeById(shapeId);
    const material = materials.get(id);
    let absorbedAny = false;

    for (const slot of slots) {
      if (slot.absorbed) {
        // Its group's first shell carries the shape for all of them; see ShapeSlot.
        absorbedAny = true;
        if (shape) inactive.add(slot.mesh);
        else inactive.delete(slot.mesh);
        continue;
      }

      const previous = slot.mesh.geometry;
      let next: THREE.BufferGeometry;

      if (!shape) {
        next = slot.original;
      } else {
        // Holes only reach a shape that said it can take them. A builder
        // that never declared `apertured` would ignore the argument anyway,
        // but passing them would leave the rebuild key claiming a hole the
        // geometry does not have.
        next = shape.build(slot.size, shape.radiusable ? radius : 0, shape.apertured ? partApertures.get(id) : undefined);
        next.translate(slot.centre.x, slot.centre.y, slot.centre.z);
        // Two attributes the generated geometry has no reason to carry and
        // the model's material may nonetheless be expecting.
        //
        // A GLB that baked its colour into the vertices leaves the material
        // with `vertexColors: true`, and a mesh with no colour attribute then
        // renders black -- not obviously a missing attribute, just a part
        // that went dark when its shape changed. White is the identity here.
        if (material?.vertexColors && !next.getAttribute("color")) {
          const count = next.getAttribute("position").count;
          next.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
        }
        // An ambient-occlusion map reads the second UV channel, which an
        // extrusion does not generate. Pointing it at the first is not
        // correct occlusion, but it is a defined lookup rather than an
        // undefined one, and the alternative is an unlit black part.
        if (material?.aoMap && next.getAttribute("uv") && !next.getAttribute("uv1")) {
          next.setAttribute("uv1", next.getAttribute("uv"));
        }
        next.computeBoundingBox();
        next.computeBoundingSphere();
        generated.add(next);
      }

      // Carving last, over whatever the shape produced -- including the
      // model's own geometry, which carveFace copies rather than touches.
      const carved = carveFace(next, partCarvings.get(id));
      if (carved) {
        if (generated.has(next)) {
          generated.delete(next);
          next.dispose();
        }
        next = carved;
        generated.add(next);
      }

      slot.mesh.geometry = next;
      if (generated.has(previous) && previous !== next) {
        generated.delete(previous);
        previous.dispose();
      }
    }
    if (absorbedAny) syncVisibility();
  }

  /**
   * Applies a finish to an insert.
   *
   * A trimmed-down copy of setMaterialProfile rather than a call to it, and
   * that is deliberate. That function is keyed by PartId throughout -- six
   * maps of per-part state, plus the hidden/ghosting rules and the emphasis
   * highlight -- and an insert has no PartId. Inventing one would put a pane
   * of glass into the size sliders, the hide control and the blueprint's
   * component schedule, none of which can say anything true about it.
   *
   * What it keeps is everything that decides how the surface READS: the tint,
   * the gain that lets a pale finish sit on a dark scan, the varnish's
   * roughness and clearcoat, metalness, and the transparency that is the
   * whole point of putting glass in a hole. What it drops is the scan-map
   * plumbing, which exists to marry a finish to a photographed mesh -- an
   * insert has no scan to marry it to.
   */
  function dressInsert(mesh: THREE.Mesh, profile: MaterialProfile, varnish?: Varnish) {
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    material.color.set(profile.hex);
    if (profile.gain) material.color.multiplyScalar(profile.gain);

    const seal = varnishForMaterial(profile, varnish);
    material.roughness = Math.min(1, Math.max(0.03, (profile.roughness ?? 0.7) * seal.roughnessScale));
    material.clearcoat = seal.clearcoat;
    material.clearcoatRoughness = seal.clearcoatRoughness;
    material.metalness = profile.metalness ?? 0;
    material.envMapIntensity = profile.type === "fabric" ? 0.35 : profile.type === "rattan" ? 0.62 : 1;

    // Glass is the finish this whole feature was asked for, so its
    // transparency is not an optional extra here: a pane that renders opaque
    // is indistinguishable from a solid top with a disc laid on it.
    const opacity = profile.opacity ?? 1;
    material.opacity = opacity;
    material.transparent = opacity < 1;
    // Drawn after the part it sits in, so a transparent pane blends over what
    // is under the table rather than over whatever happened to be drawn first.
    material.depthWrite = opacity >= 1;
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;

    if (!profile.pbr) return;
    const wanted = profile.pbr;
    void loadMaterialMaps(profile.pbr).then((maps) => {
      // The customer may have picked three more finishes while this loaded.
      if ((mesh.userData.pbr as string | undefined) !== wanted) return;
      const live = mesh.material as THREE.MeshPhysicalMaterial | undefined;
      if (!live) return;
      live.normalMap?.dispose();
      live.roughnessMap?.dispose();
      live.normalMap = tiled(maps.normal, profile.repeat ?? 2, profile.repeatY ?? profile.repeat ?? 2);
      live.roughnessMap = tiled(maps.roughness, profile.repeat ?? 2, profile.repeatY ?? profile.repeat ?? 2);
      if (profile.albedo) {
        live.map?.dispose();
        live.map = tiled(maps.diffuse, profile.repeat ?? 2, profile.repeatY ?? profile.repeat ?? 2);
      }
      live.needsUpdate = true;
    });
    mesh.userData.pbr = wanted;
  }

  /** Throws away the meshes, geometry and materials for one part's inserts. */
  function clearInserts(id: PartId) {
    const existing = apertureInserts.get(id);
    if (!existing) return;
    for (const mesh of existing) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshPhysicalMaterial;
      material.normalMap?.dispose();
      material.roughnessMap?.dispose();
      material.map?.dispose();
      material.dispose();
      const at = pickables.indexOf(mesh);
      if (at !== -1) pickables.splice(at, 1);
    }
    apertureInserts.delete(id);
  }

  function setPartCarving(id: PartId, carvingId: string) {
    // Recorded, and nothing else. The rebuild key in setPartShape carries the
    // carving, so changing it is enough to make the next call rebuild -- and
    // the studio calls setPartShape in the same pass.
    //
    // Deliberately NOT also clearing the cached key here. Two mechanisms for
    // one job means neither is tested: with both in place, deleting the
    // carving from the key changed nothing observable, because the cache
    // clear was quietly covering for it. One mechanism, and a failure in it
    // is a failure you can see.
    partCarvings.set(id, carvingId);
  }

  function setPartApertures(
    id: PartId,
    shapeId: string,
    apertures: Aperture[],
    fills: Array<{ profile: MaterialProfile; varnish?: Varnish } | null>
  ) {
    const slots = shapeSlots.get(id);
    if (!slots) return;

    partApertures.set(id, apertures);
    // Forces the rebuild: the key includes the holes, and clearing the cached
    // one makes setPartShape run even when the shape and radius are unchanged.
    // The studio calls setPartShape immediately after this, in the same pass.
    currentShape.delete(id);

    clearInserts(id);
    if (!apertures.length) return;

    const shape = shapeById(shapeId);

    const built: THREE.Mesh[] = [];
    for (const slot of slots) {
      if (slot.absorbed) continue;
      apertures.forEach((aperture, index) => {
        const fill = fills[index];
        // An open hole is a hole. Nothing is built for it, which is also what
        // makes "no material chosen yet" cost nothing.
        if (!fill) return;

        // The shape's own outline, so the insert is clamped against the same
        // board the hole was cut in. Without it a hole slid to the edge of a
        // round top stops at the timber while its glass carries on into the
        // air, and only on the tops that are not rectangles.
        const geometry = buildApertureInsert(slot.size, aperture, shape?.outlineFor?.(slot.size));
        geometry.translate(slot.centre.x, slot.centre.y, slot.centre.z);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: 0xffffff }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Selecting the glass selects the top it is let into. The insert is
        // not a part and has no controls of its own; sending the click
        // somewhere that does have them beats a click that does nothing.
        mesh.userData.partId = id;
        dressInsert(mesh, fill.profile, fill.varnish);
        // A child of the part's own mesh, so it inherits every transform the
        // size sliders apply. Anything else and the glass would stay put
        // while the table it sits in grew around it.
        slot.mesh.add(mesh);
        pickables.push(mesh);
        built.push(mesh);
      });
    }
    apertureInserts.set(id, built);
  }

  const root = new THREE.Group();

  // ---- reference heights: the points where each assembly rides the base
  // A table's "apron" (the under-frame tying the legs together, below the
  // top) and its "tabletopBorder" (a frame in the SAME plane as the top,
  // bordering an inset pane -- a different thing to a customer, but the
  // identical rig shape: a structural surface riding the base at a fixed
  // height) are both mechanically the same thing a seatFrame already is, so
  // all three ride the same pivot rather than needing their own assembly
  // block -- only its nested seatFrameThicknessPivot (below) is specific to
  // whichever of the three actually showed up, so `apronThickness` can grow
  // or shrink that rail in place without a separate code path per role.
  // Likewise a table's "tabletop" is the same shape as a seatCushion: it
  // nests inside whichever frame exists (or, absent all three, rides the
  // base directly via the seatAnchor fallback below) and pivots from its own
  // bottom face with its own thickness control. A model has one role from
  // each pair, never more than one.
  // A bed joins the same three chains rather than opening new ones: its
  // rails are a structural frame riding the base at one height exactly as a
  // seat frame or an apron is, its mattress nests inside that frame with its
  // own thickness exactly as a seat pad or a tabletop does, and its headboard
  // rides the base at the rear and grows upward exactly as a back frame does.
  // Only the footboard needed machinery of its own -- see the foot assembly
  // below. Each chain is still mutually exclusive: one role from each, never
  // two (generic-rig.ts's ALIASED_ROLE_GROUPS is what guarantees that for an
  // AI-labeled upload, where nothing else would).
  const seatFrame = byRole.get("seatFrame") ?? byRole.get("apron") ?? byRole.get("tabletopBorder") ?? byRole.get("bedRail");
  const backFrame = byRole.get("backFrame") ?? byRole.get("headboard");
  const seatCushion = byRole.get("seatCushion") ?? byRole.get("tabletop") ?? byRole.get("mattress");
  const backCushion = byRole.get("backCushion") ?? byRole.get("headboardPanel");

  // A model without a separate frame piece (the cushion chair has only pads)
  // rides on the cushion's own bounds instead, so the attachment points stay
  // meaningful rather than collapsing to the floor.
  const seatAnchor = seatFrame ?? seatCushion;
  const backAnchor = backFrame ?? backCushion;
  const seatAttachY = seatAnchor ? boxCenter(seatAnchor.box).y : 0;
  const backAttachY = backAnchor ? backAnchor.box.min.y : 0;
  const backAttachZ = backAnchor ? boxCenter(backAnchor.box).z : 0;

  // ---- legs (+ the carvings that ride on them)
  const legsPivot = pivotGroup(new THREE.Vector3(0, 0, 0));
  root.add(legsPivot.outer);

  const legs = byRole.get("base");
  const ornaments = byRole.get("accessory");
  // A bed's mattress support is the stretcher shape exactly: it spans the
  // base's footprint low down and thickens in place without moving what sits
  // on it -- true of a run of slats, a solid platform and a box spring
  // alike, which is why all three share the one role.
  const stretchers = byRole.get("stretcher") ?? byRole.get("mattressSupport");
  const legSlots: Array<{ outer: THREE.Group; inner: THREE.Group; base: THREE.Vector3; spans: boolean }> = [];

  // One slot per group of base shells that touch, not per shell. Four legs
  // standing apart are four groups and spread exactly as before; a pedestal
  // that arrived as layers (a face, the band behind it, the plinth under
  // both) is one group, and moves and thickens as the one object it is
  // instead of drifting apart into loose boards. See shell-contact.ts.
  const legGroups = legs ? groupTouchingShells(legs.shells, CONTACT_TOLERANCE_OF_HEIGHT * pieceHeight(parts)) : [];
  const pieceFootprint = pieceBounds(parts).getSize(new THREE.Vector3());

  if (legs) {
    for (const group of legGroups) {
      const groupBox = new THREE.Box3();
      for (const index of group) groupBox.union(legs.shells[index].box);
      const footprint = boxCenter(groupBox);
      footprint.y = 0;
      const slot = pivotGroup(footprint);
      legsPivot.inner.add(slot.outer);
      // A group reaching across most of the piece is a frame or a pedestal,
      // not a leg: it widens and deepens with the piece rather than only
      // moving, or a widened seat would hang off the frame it sits in.
      // Generated models only -- the shipped ones were tuned against the old
      // behaviour, and the stool's drum and the patio chair's shell are exactly
      // such groups.
      const groupSize = groupBox.getSize(new THREE.Vector3());
      const spans =
        finishUv === "projected" &&
        (groupSize.x >= SPANNING_BASE_FRACTION * pieceFootprint.x || groupSize.z >= SPANNING_BASE_FRACTION * pieceFootprint.z);
      legSlots.push({ outer: slot.outer, inner: slot.inner, base: footprint, spans });

      const meshes = group.map((index) => {
        const mesh = meshFor(legs, legs.shells[index].geometry);
        slot.inner.add(mesh);
        return mesh;
      });
      if (meshes.length > 1) {
        // The first shell stands in for the group when a shape replaces it.
        const shapeBox = new THREE.Box3();
        for (const mesh of meshes) shapeBox.union(mesh.geometry.boundingBox!);
        const size = shapeBox.getSize(new THREE.Vector3());
        for (const shapeSlot of shapeSlots.get(legs.id) ?? []) {
          if (shapeSlot.mesh === meshes[0]) {
            shapeSlot.centre = boxCenter(shapeBox);
            shapeSlot.size = { w: Math.max(size.x, 1e-4), h: Math.max(size.y, 1e-4), d: Math.max(size.z, 1e-4) };
          } else if (meshes.some((mesh) => mesh === shapeSlot.mesh)) {
            shapeSlot.absorbed = true;
          }
        }
      }
    }
  }

  /**
   * Parents every shell of `part` to the leg nearest its own centre, so it
   * travels and thickens with that leg instead of floating in place when
   * the base is resized. Right for an ornament: a carving genuinely belongs
   * to the one leg it is carved into.
   */
  function buildLegRiders(part: SegmentedPart | undefined): THREE.Group[] {
    const pivots: THREE.Group[] = [];
    if (!part) return pivots;
    for (const shell of part.shells) {
      const center = boxCenter(shell.box);
      const pivot = pivotGroup(center);
      pivot.inner.add(meshFor(part, shell.geometry));
      pivots.push(pivot.outer);

      let host: THREE.Group | null = null;
      let bestDistance = Infinity;
      for (const slot of legSlots) {
        const distance = (center.x - slot.base.x) ** 2 + (center.z - slot.base.z) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          host = slot.inner;
        }
      }
      (host ?? legsPivot.inner).add(pivot.outer);
    }
    return pivots;
  }

  const ornamentPivots: THREE.Group[] = buildLegRiders(ornaments);

  // ---- stretcher(s)
  // A stretcher bridges two legs, which single-leg parenting (see
  // `buildLegRiders`) cannot do -- tried first, it left the far end
  // rigidly fixed to whichever leg was nearest while the actual far leg
  // moved independently, crossing through geometry as the base resized.
  // Parenting to the base as a whole instead (an earlier fix, tried
  // second) stopped the crossing but stopped the stretcher from
  // resizing at all, leaving it visibly too small for a widened base and
  // no longer reaching the legs. What a stretcher actually needs is what
  // the seat/apron assembly already does: scale its own footprint by
  // `seatWidth`/`seatDepth`, exactly as if it were a low shelf riding the
  // base, so it stays exactly as wide as the base it spans.
  // `stretcherThickness` (see applyParams) scales its Y alone, in place --
  // never X/Z, so thinning it can never pull it back from the legs the way
  // folding thickness into the same footprint scale once did.
  const stretcherAttachY = stretchers ? boxCenter(stretchers.box).y : 0;
  const stretcherPivot = pivotGroup(new THREE.Vector3(0, stretcherAttachY, 0));
  if (stretchers) {
    root.add(stretcherPivot.outer);
    for (const shell of stretchers.shells) stretcherPivot.inner.add(meshFor(stretchers, shell.geometry));
  }

  // ---- seat assembly
  const seatPivot = pivotGroup(new THREE.Vector3(0, seatAttachY, 0));
  root.add(seatPivot.outer);
  // The frame's own shells sit inside a second, nested pivot centred on the
  // frame's own vertical middle, so `apronThickness` can grow or shrink the
  // rail's cross-section in place -- symmetrically, without shifting the
  // seat/tabletop it carries -- independently of `seatPivot`'s own Y, which
  // stays fixed at 1 and only ever repositions the whole assembly vertically.
  const seatFrameThicknessPivot = seatFrame
    ? pivotGroup(new THREE.Vector3(0, boxCenter(seatFrame.box).y, 0))
    : null;
  if (seatFrame && seatFrameThicknessPivot) {
    for (const shell of seatFrame.shells) seatFrameThicknessPivot.inner.add(meshFor(seatFrame, shell.geometry));
    seatPivot.inner.add(seatFrameThicknessPivot.outer);
  }

  /**
   * The drop leaves, one hinge each.
   *
   * Parented inside `seatPivot` rather than to the root, so a leaf rides the
   * top it is hinged to: it lifts with `legHeight` and moves outward as
   * `seatWidth`/`seatDepth` widen the table, without any of that being
   * restated here.
   *
   * The hinge line is read off the leaf's own bounding box -- the edge nearest
   * the middle of the table -- rather than declared by the model. That is what
   * lets this work on a leaf of any width: the asset can change its
   * proportions (and scripts/make-table.mts is the kind of file that does)
   * without the rig having to be told.
   *
   * Which way a leaf faces comes from where its centre sits relative to the
   * table's, and the sign of the fold follows from it: a leaf reaching out in
   * +X must fall the opposite way to the one reaching out in -X, or one of the
   * pair swings up through the top instead of down past the legs.
   */
  const leaves = byRole.get("leaf");
  type LeafHinge = {
    /** Rotates about the hinge line; identity when the leaf is level. */
    pivot: THREE.Group;
    /** Where the hinge sits as authored, before the top's shape moves it. */
    hinge: THREE.Vector3;
    /** Which side of the table this leaf is on. */
    side: "west" | "east" | "north" | "south";
    /** Radians to rotate at full droop, signed so the leaf falls downward. */
    droop: number;
    mesh: THREE.Mesh;
  };
  const leafHinges: LeafHinge[] = [];
  let leafReach = 0;

  if (leaves) {
    const table = new THREE.Box3();
    for (const shell of leaves.shells) table.union(shell.box);
    // The top's own middle, not the leaves' -- four leaves around a table
    // average out to the same centre, but three do not, and a model may well
    // ship with fewer than four.
    const middle = seatFrame ? boxCenter(seatFrame.box) : boxCenter(table);

    for (const shell of leaves.shells) {
      const centre = boxCenter(shell.box);
      const dx = centre.x - middle.x;
      const dz = centre.z - middle.z;
      // Whichever axis it stands off the table on is the axis it reaches
      // along; the other is the hinge.
      const alongX = Math.abs(dx) >= Math.abs(dz);

      const hinge = centre.clone();
      if (alongX) {
        hinge.x = dx >= 0 ? shell.box.min.x : shell.box.max.x;
      } else {
        hinge.z = dz >= 0 ? shell.box.min.z : shell.box.max.z;
      }
      // The hinge is the leaf's TOP edge -- a leaf hangs from the top face,
      // so rotating about its own middle would sink it into the rim.
      hinge.y = shell.box.max.y;

      const pivot = pivotGroup(hinge);
      const mesh = meshFor(leaves, shell.geometry);
      pivot.inner.add(mesh);
      seatPivot.inner.add(pivot.outer);

      leafReach = Math.max(
        leafReach,
        alongX ? shell.box.max.x - shell.box.min.x : shell.box.max.z - shell.box.min.z
      );
      leafHinges.push({
        pivot: pivot.outer,
        hinge: hinge.clone(),
        side: alongX ? (dx >= 0 ? "east" : "west") : dz >= 0 ? "south" : "north",
        // A quarter turn, signed so the far edge falls. Rotating about Z
        // drops a leaf that reaches along X; rotating about X drops one that
        // reaches along Z, and the two axes disagree about which sign is
        // "down", which is why this is worked out per leaf rather than shared.
        droop: alongX ? (dx >= 0 ? -1 : 1) * (Math.PI / 2) : (dz >= 0 ? 1 : -1) * (Math.PI / 2),
        mesh,
      });
    }
  }

  let seatCushionPivot: THREE.Group | null = null;
  if (seatCushion) {
    // Pad grows upward from where it rests on the frame.
    const base = boxCenter(seatCushion.box);
    base.y = seatCushion.box.min.y;
    const pivot = pivotGroup(base);
    for (const shell of seatCushion.shells) pivot.inner.add(meshFor(seatCushion, shell.geometry));
    seatPivot.inner.add(pivot.outer);
    seatCushionPivot = pivot.outer;
  }

  // ---- bedding (beds only)
  //
  // The layers over the mattress -- sheet, blanket, duvet. Its own pivot
  // rather than a share of the mattress's, because the two have to be able
  // to thicken independently: plumping a duvet should pile it higher on the
  // bed, not swell the mattress underneath it. Like the cushion it grows
  // upward from where it rests, so a thicker duvet rises off the mattress
  // instead of sinking through it, and it rides inside seatPivot so it
  // widens and lengthens with the bed exactly as the mattress does.
  const bedding = byRole.get("bedding");
  let beddingPivot: THREE.Group | null = null;
  if (bedding) {
    const base = boxCenter(bedding.box);
    base.y = bedding.box.min.y;
    const pivot = pivotGroup(base);
    for (const shell of bedding.shells) pivot.inner.add(meshFor(bedding, shell.geometry));
    seatPivot.inner.add(pivot.outer);
    beddingPivot = pivot.outer;
  }

  // ---- back assembly
  const backPivot = pivotGroup(new THREE.Vector3(0, backAttachY, 0));
  root.add(backPivot.outer);
  if (backFrame) {
    for (const shell of backFrame.shells) backPivot.inner.add(meshFor(backFrame, shell.geometry));
  }

  let backCushionPivot: THREE.Group | null = null;
  if (backCushion) {
    // Panel pads forward off the frame, so it pivots on its rear face (+z is front).
    const base = boxCenter(backCushion.box);
    base.z = backCushion.box.min.z;
    const pivot = pivotGroup(base);
    for (const shell of backCushion.shells) pivot.inner.add(meshFor(backCushion, shell.geometry));
    backPivot.inner.add(pivot.outer);
    backCushionPivot = pivot.outer;
  }

  // ---- foot assembly (beds only)
  //
  // The one genuinely new pivot the bed roles needed. Every other bed part
  // rides a slot some chair or table already established, but nothing in
  // this rig had an assembly at the FRONT of the piece: a chair's back is at
  // -z (see backCushion's pivot, which pads forward off its rear face), so a
  // footboard at +z has no existing pivot to borrow. It is otherwise an
  // exact mirror of the back assembly -- rises with the base, spreads with
  // the width, travels forward as the piece deepens -- and it carries its
  // own height control rather than sharing `backHeight`, because a footboard
  // is nearly always the shorter of the two and a customer sizes it apart
  // from the headboard.
  const footboard = byRole.get("footboard");
  const footAttachY = footboard ? footboard.box.min.y : 0;
  const footAttachZ = footboard ? boxCenter(footboard.box).z : 0;
  const footPivot = pivotGroup(new THREE.Vector3(0, footAttachY, 0));
  if (footboard) {
    root.add(footPivot.outer);
    for (const shell of footboard.shells) footPivot.inner.add(meshFor(footboard, shell.geometry));
  }

  // ---- armrests
  // Arms ride the base like the seat does, but each keeps its own pivot so a
  // wider seat moves them outward instead of stretching them sideways.
  // Pillows are the armrest shape: a small number of repeated shells that
  // each keep their own place, spread apart as the piece widens rather than
  // stretching, scale in place, and vanish at zero. Every one of those is
  // what a pair of pillows should do.
  //
  // Both roles, not one of the two. This was `armrest ?? pillows`, which is
  // right for every piece that has one or the other -- and silently drops the
  // second on a piece that has both. A sofa has both: arms at the ends and
  // throw pillows in the corners, and the pillows simply never appeared.
  //
  // They cannot share `accessory` instead: that role parents each shell to the
  // nearest leg, which is right for a carving cut into one and wrong for a
  // cushion resting on the seat.
  //
  // Each slot remembers which part it came from, so the two scale on their own
  // controls. Without that, "Arm size" and "Pillow size" would be two labels
  // on one slider, which is worse than one label.
  const armLike: Array<{ part: SegmentedPart; pillow: boolean }> = [];
  const armPart = byRole.get("armrest");
  const pillowPart = byRole.get("pillows");
  if (armPart) armLike.push({ part: armPart, pillow: false });
  if (pillowPart) armLike.push({ part: pillowPart, pillow: true });

  const armPivot = pivotGroup(new THREE.Vector3(0, seatAttachY, 0));
  const armSlots: Array<{ outer: THREE.Group; base: THREE.Vector3; pillow: boolean }> = [];
  if (armLike.length > 0) {
    root.add(armPivot.outer);
    for (const { part, pillow } of armLike) {
      for (const shell of part.shells) {
        const centre = boxCenter(shell.box);
        const slot = pivotGroup(centre);
        slot.inner.add(meshFor(part, shell.geometry));
        armPivot.inner.add(slot.outer);
        armSlots.push({ outer: slot.outer, base: centre, pillow });
      }
    }
  }

  // ---- casegood assembly (cabinet, chest, wardrobe)
  //
  // A carcass is not a seat. It is a box that stands on its plinth and grows
  // in all three directions, carrying doors, drawers and shelves that all
  // travel with it -- so everything below hangs inside one carcass pivot and
  // inherits its scale, rather than each part riding the base independently
  // the way a chair's seat and back assemblies do.
  //
  // The plinth is deliberately not handled here: it takes the `base` role and
  // is already built above, because "stands on the floor and lifts whatever it
  // carries" is exactly what that role has always meant, whether the piece is
  // a side chair or a chest.
  const carcass = byRole.get("carcass");
  const carcassAttachY = carcass ? carcass.box.min.y : 0;
  const carcassPivot = pivotGroup(new THREE.Vector3(0, carcassAttachY, 0));
  const shelfPivots: THREE.Group[] = [];
  const shelfMeshes: THREE.Mesh[] = [];
  /** The authored centre of the shelf every instance is a copy of. */
  const shelfBase = new THREE.Vector3();
  const handleSlots: THREE.Group[] = [];
  const drawerPivots: THREE.Group[] = [];
  const drawerMeshes: THREE.Mesh[] = [];
  /** Outside each drawer's pivot, carrying the drawer and its pull out and back. */
  const drawerSlides: THREE.Group[] = [];
  /** The box behind each front; see buildDrawerBody. */
  const drawerBodies: THREE.Mesh[] = [];
  let drawerBodyGeometry: THREE.BufferGeometry | null = null;
  let drawerTravel = 0;
  /**
   * The drawer pulls, one per drawer the rig built.
   *
   * Separate from `handleSlots` because they are the only hardware that has
   * to MOVE: a door's pull rides its leaf and a drawer's pull has to find
   * whichever slot its drawer ended up in once the count divided the run. The
   * offset is where the authored pull sat relative to its own authored front,
   * so a pull set low or off to one side stays there.
   */
  const drawerPulls: Array<{ pivot: THREE.Group; mesh: THREE.Mesh; offset: THREE.Vector3 }> = [];
  type DrawerRow = {
    axis: "x" | "y";
    /** The low end of the run the fronts divide. */
    min: number;
    run: number;
    /** How much of each slot a front fills; the remainder is the gap. */
    fill: number;
    /** The authored front's size along the axis, which the scale is measured against. */
    templateSize: number;
    /** The authored front's centre, which is where every instance pivots. */
    centre: THREE.Vector3;
    /** The authored fronts' own boxes, for deciding which pulls belong to a drawer. */
    authoredBoxes: THREE.Box3[];
  };
  let drawerRow: DrawerRow | null = null;
  /**
   * One entry per door leaf. Declared out here beside the other collections
   * because the swing, the compartment count and applyParams all read it, and
   * only the building of it belongs inside the carcass branch.
   */
  /**
   * Meshes switched off one at a time, rather than by their part being removed.
   *
   * The count controls need this and nothing else did. `removed` is per PART --
   * "this design has no ornaments" -- and cannot express "this design has three
   * shelves, so the fourth shelf we built is surplus". Both end in an invisible
   * mesh, but only one of them means the part is gone: shelves with a count of
   * three are very much still in the design, still measured and still on the
   * build sheet.
   */
  const inactive = new Set<THREE.Mesh>();
  /** The shelf opening read off the authored shelves, for a case with no doors. */
  let impliedBay: { low: number; high: number } | null = null;
  const doorLeaves: Array<{
    mount: THREE.Group;
    swing: THREE.Group;
    body: THREE.Group;
    hinge: THREE.Vector3;
    /** -1 swings to the left of the piece, +1 to the right. */
    sign: number;
    box: THREE.Box3;
    /** The leaf itself plus any pull fitted to it, so a count can switch the lot. */
    meshes: THREE.Mesh[];
  }> = [];

  if (carcass) {
    root.add(carcassPivot.outer);
    for (const shell of carcass.shells) carcassPivot.inner.add(meshFor(carcass, shell.geometry));

    // Drawer fronts are built as a row the count can divide, not as the
    // shells the mesh happened to contain.
    //
    // They used to be exactly those shells, dropped straight into the carcass
    // pivot: a front is the box's own face and stretches with it, so it needed
    // nothing else. That is still true of ONE drawer. It stops being enough
    // the moment the customer can ask for three, because the run the fronts
    // divide is a property of the opening and not of any one front.
    //
    // So the authored row is measured -- which way it runs, how long it is,
    // and how much of each slot the front actually fills -- and then rebuilt
    // from the first front as a template. Measured rather than declared,
    // because the two pieces with drawers run them in opposite directions:
    // the cabinet stacks two fronts vertically, the desk sets two side by
    // side. Reading the axis off the shells means neither model has to say so.
    //
    // At the authored count this reproduces the authored layout exactly, which
    // is what lets the cabinet -- which offers no drawer control and so never
    // leaves its default of two -- go through this path unchanged.
    const drawers = byRole.get("drawer");
    if (drawers && drawers.shells.length > 0) {
      const span = new THREE.Box3();
      for (const shell of drawers.shells) span.union(shell.box);
      const runSize = span.getSize(new THREE.Vector3());

      const template = drawers.shells[0];
      const templateSize = template.box.getSize(new THREE.Vector3());
      // The axis the row is longer on than one front is. With a single
      // authored front there is no row to read, so the wider of the two
      // in-plane axes is the one a second drawer would have to go along.
      const axis: "x" | "y" =
        drawers.shells.length > 1
          ? runSize.x - templateSize.x > runSize.y - templateSize.y
            ? "x"
            : "y"
          : runSize.x >= runSize.y
            ? "x"
            : "y";

      const run = axis === "x" ? runSize.x : runSize.y;
      const authoredPitch = run / drawers.shells.length;
      const frontSize = axis === "x" ? templateSize.x : templateSize.y;
      drawerRow = {
        axis,
        min: axis === "x" ? span.min.x : span.min.y,
        run,
        // The gap between fronts, kept as a proportion of the slot so it
        // scales with the drawers rather than swallowing them: four drawers
        // in the run a fixed 2cm gap was sized for would be mostly gap.
        fill: authoredPitch > 1e-6 ? Math.min(1, frontSize / authoredPitch) : 1,
        templateSize: frontSize,
        centre: boxCenter(template.box),
        authoredBoxes: drawers.shells.map((shell) => shell.box.clone()),
      };

      // The drawer behind each front, so an open drawer has sides and a bottom
      // instead of being a plank hanging off the face. Built once from the
      // authored front and scaled with it; shown only while the drawer is out,
      // and never pickable or measured -- it shows how the drawer works, it is
      // not a part the furniture shop quotes on its own.
      const carcassDepth = carcass ? carcass.box.getSize(new THREE.Vector3()).z : templateSize.z * 12;
      drawerTravel = carcassDepth * DRAWER_TRAVEL_OF_DEPTH;
      drawerBodyGeometry = buildDrawerBody(template.box, carcassDepth * 0.8);

      for (let i = 0; i < MAX_DRAWERS; i++) {
        const pivot = pivotGroup(drawerRow.centre);
        const mesh = meshFor(drawers, template.geometry);
        pivot.inner.add(mesh);
        const body = new THREE.Mesh(drawerBodyGeometry, materialFor(drawers));
        body.castShadow = true;
        body.receiveShadow = true;
        body.visible = false;
        pivot.inner.add(body);
        // The slide wraps the pivot rather than moving it, so the count layout
        // in applyParams and the slide never write the same transform.
        const slide = new THREE.Group();
        slide.add(pivot.outer);
        carcassPivot.inner.add(slide);
        drawerSlides.push(slide);
        drawerBodies.push(body);
        drawerPivots.push(pivot.outer);
        drawerMeshes.push(mesh);
      }
    }

    // A door is the one face that moves, so it gets a hinge.
    //
    // Three nested groups per leaf, which needs justifying because one would
    // be the obvious thing to write. The carcass scales NON-uniformly -- width,
    // depth and height are three separate controls -- and a rotation sitting
    // inside a non-uniform scale is sheared by it. A door swung ninety degrees
    // has its width running along the carcass's depth axis, so widening the
    // cabinet would have thickened the open door instead of widening it, and
    // the leaf would have gone visibly out of square as the slider moved.
    //
    // So the parent's scale is undone on the way in and re-applied inside the
    // rotation, where it acts along the door's own axes:
    //
    //   mount  T(hinge) S(1/s)   cancels the carcass scale, sits on the hinge
    //   swing  R(theta)          the swing itself, about a vertical axis
    //   body   T(-s*hinge) S(s)  the leaf, scaled in its own frame
    //
    // which multiplies out to T(s*hinge) R(theta) S(s) T(-hinge): scale the
    // door, then swing it about a hinge that has moved with the carcass. At
    // theta = 0 the whole chain collapses back to S(s), so a shut door behaves
    // exactly as it did when it was parented flat.
    //
    // The same counter-scaling trick the pulls already use, for the same
    // reason -- see the handle comment in applyParams.
    const doors = byRole.get("door");
    if (doors) {
      for (const shell of doors.shells) {
        const centre = boxCenter(shell.box);
        // Hinged on the OUTER vertical edge -- the one further from the centre
        // line -- which is what makes a pair open away from each other rather
        // than both swinging the same way. A single centred door is left-hung,
        // which is the usual default when nothing else decides it.
        const leftHung = centre.x <= 0;
        const hinge = new THREE.Vector3(
          leftHung ? shell.box.min.x : shell.box.max.x,
          0,
          // The face against the carcass, not the door's own middle: a door
          // pivots on its back edge, and hinging about the centre of the panel
          // would sink half its thickness into the cabinet as it opened.
          shell.box.min.z
        );

        const mount = new THREE.Group();
        mount.position.copy(hinge);
        const swing = new THREE.Group();
        const body = new THREE.Group();
        mount.add(swing);
        swing.add(body);
        const leafMesh = meshFor(doors, shell.geometry);
        body.add(leafMesh);
        carcassPivot.inner.add(mount);

        doorLeaves.push({
          mount,
          swing,
          body,
          hinge,
          sign: leftHung ? -1 : 1,
          box: shell.box,
          meshes: [leafMesh],
        });
      }
    }

    // Shelves are built to the maximum the control allows and then switched
    // on up to the chosen count, rather than created and destroyed as the
    // slider moves. A count control is dragged, so it fires on every tick of
    // the drag; allocating a geometry, a mesh and two groups per tick -- and
    // disposing the last lot -- would churn the GPU for the whole gesture.
    // Four spare groups cost nothing and never change.
    //
    // Every instance draws the FIRST authored shelf's geometry. Sharing one
    // geometry across meshes is free in three, and it is also the right
    // answer: shelves in a bay are identical boards, so a cabinet asked for
    // four should not inherit whatever slight difference the mesh happened to
    // have between its two.
    const shelves = byRole.get("shelf");
    const shelfTemplate = shelves?.shells[0];
    if (shelves && shelfTemplate) {
      const base = boxCenter(shelfTemplate.box);
      for (let i = 0; i < MAX_SHELVES; i++) {
        // Each shelf thickens about its own middle, so a thicker shelf eats
        // equally into the gap above and below instead of climbing the stack.
        const pivot = pivotGroup(base);
        const mesh = meshFor(shelves, shelfTemplate.geometry);
        pivot.inner.add(mesh);
        carcassPivot.inner.add(pivot.outer);
        shelfPivots.push(pivot.outer);
        shelfMeshes.push(mesh);
      }
      shelfBase.copy(base);

      // The opening, implied by where the authored shelves sit.
      //
      // The rig normally takes this from the doors, because on a cabinet the
      // bay IS what the doors close over -- a drawer bank in the same carcass
      // is not somewhere a shelf may appear. An open case has no doors and so
      // nothing to ask, and before this the two ends collapsed onto one
      // height and every shelf stacked in the same plane.
      //
      // n shelves spaced evenly through a bay sit one step in from each end,
      // so the step is the gap between two of them and the bay is their span
      // plus one step at either end. That inverts exactly, and it is why the
      // generators author shelves evenly rather than wherever looked right.
      // Needs two to measure a gap; with one authored shelf there is nothing
      // to infer and the old behaviour stands.
      const ys = shelves.shells.map((shell) => boxCenter(shell.box).y).sort((a, b) => a - b);
      if (ys.length > 1) {
        const step = (ys[ys.length - 1] - ys[0]) / (ys.length - 1);
        impliedBay = { low: ys[0] - step, high: ys[ys.length - 1] + step };
      }
    }

    const hardware = byRole.get("hardware");
    if (hardware) {
      /**
       * The first pull found sitting on a drawer front becomes the template
       * for every drawer's pull, and the authored ones are not built at all.
       *
       * Matched by position, exactly as a door's pull is matched below: a
       * pull inside a front's face IS that front's pull, and no asset here
       * labels them. Templating rather than keeping the authored pulls is
       * what makes a third drawer arrive with a handle on it -- keeping them
       * would leave two pulls floating over three drawers.
       */
      const drawerHost = (centre: THREE.Vector3) =>
        drawerRow?.authoredBoxes.find(
          (box) =>
            centre.x >= box.min.x &&
            centre.x <= box.max.x &&
            centre.y >= box.min.y &&
            centre.y <= box.max.y
        ) ?? null;

      for (const shell of hardware.shells) {
        const centre = boxCenter(shell.box);

        const onDrawer = drawerRow ? drawerHost(centre) : null;
        if (onDrawer) {
          // Only the first is templated; the rest of the authored pulls are
          // the same pull on the other authored drawers and are redundant
          // once the row is rebuilt.
          if (drawerPulls.length === 0) {
            const from = boxCenter(onDrawer);
            for (let i = 0; i < MAX_DRAWERS; i++) {
              const pivot = pivotGroup(centre);
              const mesh = meshFor(hardware, shell.geometry);
              pivot.inner.add(mesh);
              // Rides its drawer's slide, so the pull comes out with the drawer.
              const slide = drawerSlides[i];
              if (slide) slide.add(pivot.outer);
              else carcassPivot.inner.add(pivot.outer);
              drawerPulls.push({ pivot: pivot.outer, mesh, offset: centre.clone().sub(from) });
              handleSlots.push(pivot.outer);
            }
          }
          continue;
        }

        const pivot = pivotGroup(centre);
        pivot.inner.add(meshFor(hardware, shell.geometry));
        // A pull fitted to a door travels with that door, which is the whole
        // of what "parented to the door or drawer they are fitted to" has
        // always meant -- it simply never showed while the doors could not
        // move. Matched by where the pull sits rather than by anything the
        // model declares: a handle inside a door's face IS that door's
        // handle, and no asset here labels them. A drawer pull matches no
        // door and stays on the carcass, which is correct: drawers do not
        // open here.
        const host = doorLeaves.find(
          (leaf) =>
            centre.x >= leaf.box.min.x &&
            centre.x <= leaf.box.max.x &&
            centre.y >= leaf.box.min.y &&
            centre.y <= leaf.box.max.y
        );
        (host ? host.body : carcassPivot.inner).add(pivot.outer);
        // A pull on a leaf that the count has switched off goes with it --
        // otherwise dropping to a single door leaves the vanished leaf's
        // handle floating against the carcass.
        host?.meshes.push(...pivot.inner.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh));
        handleSlots.push(pivot.outer);
      }
    }
  }

  // ---- the opening the doors close over
  //
  // The bay is where shelves are allowed to appear and what a leaf has to
  // cover, so both counts are measured against it. Taken from the doors
  // themselves rather than from the carcass: a cabinet whose drawer bank
  // shares the same box has interior height the doors never open on, and a
  // shelf placed there would be inside a compartment nobody can reach.
  const doorSpan = new THREE.Box3();
  for (const leaf of doorLeaves) doorSpan.union(leaf.box);

  // ---- the swing itself
  //
  // A target and a current value rather than a single flag, because the doors
  // are eased into place by `advance` rather than snapped: a 105-degree jump
  // between frames reads as a glitch, and the whole point of opening them is
  // to look at what the movement reveals.
  let doorTarget = 0;
  let doorCurrent = 0;

  function applyDoorAngle() {
    for (const leaf of doorLeaves) {
      leaf.swing.rotation.y = leaf.sign * doorCurrent * DOOR_OPEN_RADIANS;
    }
  }

  function setDoorsOpen(open: boolean) {
    doorTarget = open ? 1 : 0;
  }

  // ---- the drawers' slide
  //
  // One value per drawer rather than one for the row, because each starts
  // DRAWER_STAGGER_SECONDS after the one before it. Each eases from wherever it
  // is when the toggle flips, so pressing it again mid-slide sends the drawers
  // straight back rather than restarting the move.
  let drawerTarget = 0;
  const drawerCurrent: number[] = drawerSlides.map(() => 0);
  let drawerElapsed = 0;
  let drawersSettled = true;
  let reducedMotion = false;

  function applyDrawerSlide() {
    for (let i = 0; i < drawerSlides.length; i++) {
      drawerSlides[i].position.z = drawerCurrent[i] * drawerTravel;
      // Hidden while shut: it is inside the carcass anyway, and a hidden body
      // cannot cast a stray shadow or show through an open-backed piece.
      drawerBodies[i].visible = drawerMeshes[i].visible && drawerCurrent[i] > 0.001;
    }
  }

  function setDrawersOpen(open: boolean) {
    const next = open ? 1 : 0;
    if (next === drawerTarget) return;
    drawerTarget = next;
    drawerElapsed = 0;
    drawersSettled = drawerSlides.length === 0;
  }

  function setReducedMotion(reduce: boolean) {
    reducedMotion = reduce;
  }

  function advance(deltaSeconds: number) {
    // Clamped because a backgrounded tab hands back a delta of several seconds
    // on its first frame, which would otherwise land everything open with no
    // movement at all.
    const dt = Math.min(deltaSeconds, 0.1);

    if (doorCurrent !== doorTarget) {
      if (reducedMotion) {
        doorCurrent = doorTarget;
      } else {
        // Exponential settle, framed in seconds so the swing takes the same
        // time whatever the refresh rate.
        doorCurrent += (doorTarget - doorCurrent) * (1 - Math.exp(-DOOR_SETTLE_RATE * dt));
        if (Math.abs(doorTarget - doorCurrent) < 0.0015) doorCurrent = doorTarget;
      }
      applyDoorAngle();
    }

    if (!drawersSettled) {
      drawerElapsed += dt;
      let moving = false;
      for (let i = 0; i < drawerCurrent.length; i++) {
        if (drawerCurrent[i] === drawerTarget) continue;
        if (reducedMotion) {
          drawerCurrent[i] = drawerTarget;
          continue;
        }
        moving = true;
        if (drawerElapsed < i * DRAWER_STAGGER_SECONDS) continue;
        drawerCurrent[i] += (drawerTarget - drawerCurrent[i]) * (1 - Math.exp(-DRAWER_SETTLE_RATE * dt));
        if (Math.abs(drawerTarget - drawerCurrent[i]) < 0.002) drawerCurrent[i] = drawerTarget;
      }
      drawersSettled = !moving;
      applyDrawerSlide();
    }
  }

  function withShut<T>(fn: () => T): T {
    const doorWas = doorCurrent;
    const drawersWere = drawerCurrent.slice();
    doorCurrent = 0;
    drawerCurrent.fill(0);
    applyDoorAngle();
    applyDrawerSlide();
    root.updateMatrixWorld(true);
    try {
      return fn();
    } finally {
      doorCurrent = doorWas;
      drawersWere.forEach((value, i) => {
        drawerCurrent[i] = value;
      });
      applyDoorAngle();
      applyDrawerSlide();
      root.updateMatrixWorld(true);
    }
  }

  function applyParams(params: RigParams) {
    const {
      legHeight,
      legThickness,
      seatWidth,
      seatDepth,
      seatCushionThickness,
      backHeight,
      backCushionThickness,
      armScale,
      ornamentScale,
      apronThickness,
      stretcherThickness,
      footboardHeight,
      beddingThickness,
      cabinetHeight,
      drawerCount,
      shelfThickness,
      handleScale,
      shelfCount,
      doorCount,
      leafWidth,
      leafWest,
      leafEast,
      leafNorth,
      leafSouth,
    } = params;

    // Legs stretch about the floor; everything they carry rises by the distance
    // that assembly's own attachment point travelled.
    legsPivot.outer.scale.y = legHeight;
    for (const slot of legSlots) {
      slot.outer.scale.set(legThickness * (slot.spans ? seatWidth : 1), 1, legThickness * (slot.spans ? seatDepth : 1));
      // ...and in by however much the top's shape pulls its own edge in, so a
      // round top stands on legs under the timber rather than beside it.
      slot.outer.position.set(
        slot.base.x * seatWidth * topFootprint.x,
        0,
        slot.base.z * seatDepth * topFootprint.z
      );
    }

    seatPivot.outer.scale.set(seatWidth, 1, seatDepth);
    seatPivot.outer.position.set(0, seatAttachY + (legHeight - 1) * seatAttachY, 0);
    if (seatFrameThicknessPivot) seatFrameThicknessPivot.outer.scale.y = Math.max(apronThickness, 0.001);

    backPivot.outer.scale.set(seatWidth, backHeight, 1);
    backPivot.outer.position.set(
      0,
      backAttachY + (legHeight - 1) * backAttachY,
      (seatDepth - 1) * backAttachZ
    );

    // Mirrors backPivot exactly, on its own height key. footAttachZ is
    // positive where backAttachZ is negative, so the same `(seatDepth - 1) *
    // attachZ` term that carries a headboard rearward carries a footboard
    // forward -- the piece lengthens from both ends rather than sliding.
    footPivot.outer.scale.set(seatWidth, footboardHeight, 1);
    footPivot.outer.position.set(
      0,
      footAttachY + (legHeight - 1) * footAttachY,
      (seatDepth - 1) * footAttachZ
    );
    // Zero is a real answer here, not just a very short footboard -- plenty
    // of beds have none. Dropped from the design outright the way arms and
    // ornaments are at zero, rather than left as a flattened part that is
    // invisible on screen but still costed, measured and on the blueprint.
    setRemoved("footboard", !(footboardHeight > 0.02));

    // Leaves. `raised` runs 0 (hanging) to 1 (level with the top), and the
    // rotation is the remainder of the droop -- so 1 leaves the pivot at
    // identity, which is exactly where the leaf was authored.
    //
    // The width scales along the axis the leaf reaches, about the hinge,
    // which is what keeps the hinged edge welded to the table's edge while
    // the far edge moves. Scaling the leaf about its own middle would pull it
    // away from the top and leave a gap along the hinge.
    const raisedBySide = { west: leafWest, east: leafEast, north: leafNorth, south: leafSouth };
    let anyLeafShowing = false;
    for (const leaf of leafHinges) {
      const raised = Math.min(1, Math.max(0, raisedBySide[leaf.side]));
      const width = Math.max(leafWidth, 0.001);
      leaf.pivot.rotation.set(0, 0, 0);
      // The hinge rides the top's own edge. seatPivot already carries the
      // width/depth scaling; this is the extra move a shape makes when its
      // outline does not fill the box.
      leaf.pivot.position.set(
        leaf.hinge.x * topFootprint.x,
        leaf.hinge.y,
        leaf.hinge.z * topFootprint.z
      );
      if (leaf.side === "west" || leaf.side === "east") {
        leaf.pivot.rotation.z = leaf.droop * (1 - raised);
        leaf.pivot.scale.set(width, 1, 1);
      } else {
        leaf.pivot.rotation.x = leaf.droop * (1 - raised);
        leaf.pivot.scale.set(1, 1, width);
      }
      if (leafWidth > 0.02) anyLeafShowing = true;
    }
    // A table whose leaves have been taken off entirely, as opposed to one
    // with them hanging: the same distinction `armScale` at zero draws.
    if (leafHinges.length > 0) setRemoved("leaves", !anyLeafShowing);

    if (seatCushionPivot) seatCushionPivot.scale.y = seatCushionThickness;
    if (beddingPivot) beddingPivot.scale.y = Math.max(beddingThickness, 0.001);
    if (backCushionPivot) backCushionPivot.scale.z = backCushionThickness;
    // Stripping the bed back to the frame is a real thing to want to see, so
    // zero takes the bedding out rather than merely flattening it.
    setRemoved("bedding", !(beddingThickness > 0.02));

    // Arms rise with the base and spread with the seat, and scale in place.
    armPivot.outer.position.set(0, seatAttachY + (legHeight - 1) * seatAttachY, 0);
    for (const slot of armSlots) {
      // Pillows answer to their own control; arms to theirs. Same pivot, same
      // spreading, different scalar -- see the note where the slots are built.
      const scale = slot.pillow ? ornamentScale : armScale;
      slot.outer.scale.setScalar(Math.max(scale, 0.001));
      slot.outer.position.set(
        slot.base.x * seatWidth,
        slot.base.y,
        slot.base.z * seatDepth
      );
    }
    setRemoved("armrests", !(armScale > 0.02));
    setRemoved("pillows", !(ornamentScale > 0.02));

    // Spreads with the base exactly like the seat/apron does -- X/Z always
    // match seatWidth/seatDepth exactly, with no thickness coupling, so the
    // stretcher keeps reaching the legs at any thickness. stretcherThickness
    // scales Y alone, in place, the same way legThickness and apronThickness
    // thicken their own parts without moving anything they carry.
    // Spans the legs, so it follows them in as well -- otherwise the H
    // reaches out past the feet it is supposed to brace.
    stretcherPivot.outer.scale.set(
      seatWidth * topFootprint.x,
      Math.max(stretcherThickness, 0.001),
      seatDepth * topFootprint.z
    );
    stretcherPivot.outer.position.set(0, stretcherAttachY + (legHeight - 1) * stretcherAttachY, 0);
    setRemoved("stretchers", !(stretcherThickness > 0.02));

    const ornamentsOn = ornamentScale > 0.02;
    for (const pivot of ornamentPivots) {
      pivot.scale.setScalar(Math.max(ornamentScale, 0.001));
    }
    setRemoved("ornaments", !ornamentsOn);

    // ---- casegoods
    // The carcass grows from its own bottom face, which rests on the plinth,
    // so it rides legHeight upward exactly as the seat assembly does. Its
    // doors, drawers, shelves and pulls are all children of this one pivot
    // and follow for free.
    const carcassScaleX = Math.max(seatWidth, 0.001);
    const carcassScaleY = Math.max(cabinetHeight, 0.001);
    const carcassScaleZ = Math.max(seatDepth, 0.001);
    carcassPivot.outer.scale.set(carcassScaleX, carcassScaleY, carcassScaleZ);
    carcassPivot.outer.position.set(0, carcassAttachY + (legHeight - 1) * carcassAttachY, 0);

    // ---- how many shelves, and where they sit
    //
    // Evenly through the bay rather than at the heights the mesh happened to
    // put them: n shelves make n + 1 compartments, so each one lands on a
    // whole fraction of the opening and adding a shelf moves the others to
    // make room. Anchored to the doors' own span, because the bay IS what the
    // doors close over -- a drawer bank lower down the same carcass is not
    // somewhere a shelf may appear.
    const wantedShelves = Math.max(0, Math.min(MAX_SHELVES, Math.round(shelfCount)));
    // Doors first: on a cabinet they define the reachable bay exactly. Then
    // the opening implied by the authored shelves, for an open case. Then the
    // authored height itself, which puts every shelf in one plane -- correct
    // only for a single shelf, and the honest answer when there is nothing
    // else to go on.
    const bayLow = !doorSpan.isEmpty() ? doorSpan.min.y : impliedBay ? impliedBay.low : shelfBase.y;
    const bayHigh = !doorSpan.isEmpty() ? doorSpan.max.y : impliedBay ? impliedBay.high : shelfBase.y;
    for (let i = 0; i < shelfPivots.length; i++) {
      const on = i < wantedShelves;
      if (on) inactive.delete(shelfMeshes[i]);
      else inactive.add(shelfMeshes[i]);
      if (!on) continue;
      const step = (bayHigh - bayLow) / (wantedShelves + 1);
      shelfPivots[i].position.set(shelfBase.x, bayLow + step * (i + 1), shelfBase.z);
      shelfPivots[i].scale.y = Math.max(shelfThickness, 0.001);
    }
    // Zero shelves and zero thickness are the same answer to a build sheet --
    // the bay is left open -- so either one takes the part out of the design.
    setRemoved("shelves", !(shelfThickness > 0.02) || wantedShelves === 0);

    // ---- how many drawers divide the run
    //
    // The run does not change; how many fronts divide it does. Each front is
    // scaled to its slot rather than repositioned at its authored size, so
    // three drawers really are three narrower drawers filling the same
    // opening -- not two drawers and a gap. Their pulls follow, carrying
    // whatever offset the authored pull had from its own front.
    const wantedDrawers = Math.max(0, Math.min(MAX_DRAWERS, Math.round(drawerCount)));
    if (drawerRow) {
      const { axis, min, run, fill, templateSize, centre } = drawerRow;
      const pitch = wantedDrawers > 0 ? run / wantedDrawers : run;
      const scale = templateSize > 1e-6 ? (pitch * fill) / templateSize : 1;

      for (let i = 0; i < drawerPivots.length; i++) {
        const on = i < wantedDrawers;
        if (on) inactive.delete(drawerMeshes[i]);
        else inactive.add(drawerMeshes[i]);

        const pull = drawerPulls[i];
        if (pull) {
          if (on) inactive.delete(pull.mesh);
          else inactive.add(pull.mesh);
        }
        if (!on) continue;

        const slotCentre = min + pitch * (i + 0.5);
        const pivot = drawerPivots[i];
        pivot.scale.set(1, 1, 1);
        pivot.position.copy(centre);
        if (axis === "x") {
          pivot.scale.x = scale;
          pivot.position.x = slotCentre;
        } else {
          pivot.scale.y = scale;
          pivot.position.y = slotCentre;
        }

        if (pull) {
          // The pull moves to its drawer but is never scaled by it -- the
          // handle loop further down owns its scale, and a 90mm pull is 90mm
          // on a narrower drawer too.
          pull.pivot.position.set(
            axis === "x" ? slotCentre + pull.offset.x : centre.x + pull.offset.x,
            axis === "y" ? slotCentre + pull.offset.y : centre.y + pull.offset.y,
            centre.z + pull.offset.z
          );
        }
      }
    }
    // A piece asked for no drawers is built with none, exactly as zero shelves
    // leaves the bay open.
    setRemoved("drawers", drawerRow !== null && wantedDrawers === 0);

    // ---- how many leaves close the opening
    //
    // The opening does not change; how many leaves divide it does. So a leaf
    // is widened by the ratio of authored leaves to wanted ones -- two becomes
    // one at twice the width -- and the spare leaf is switched off. Widening
    // about the hinge is what makes this work without any repositioning: a
    // left-hung leaf grows rightward across the opening from the hinge it
    // already sits on, which is exactly where the missing leaf was.
    const wantedDoors = Math.max(0, Math.min(doorLeaves.length, Math.round(doorCount)));
    const leafWidening = wantedDoors > 0 ? doorLeaves.length / wantedDoors : 1;
    for (let i = 0; i < doorLeaves.length; i++) {
      const leaf = doorLeaves[i];
      const on = i < wantedDoors;
      for (const mesh of leaf.meshes) {
        if (on) inactive.delete(mesh);
        else inactive.add(mesh);
      }
      if (!on) continue;

      // The hinge's half of the counter-scale described where the leaves are
      // built: cancel the carcass scale above the swing, re-apply it below,
      // and carry the hinge itself out to where the widened carcass has put
      // it. The leaf's own widening rides along inside that, on x alone.
      const bodyX = carcassScaleX * leafWidening;
      leaf.mount.scale.set(1 / carcassScaleX, 1 / carcassScaleY, 1 / carcassScaleZ);
      leaf.body.scale.set(bodyX, carcassScaleY, carcassScaleZ);
      leaf.body.position.set(
        -leaf.hinge.x * bodyX,
        -leaf.hinge.y * carcassScaleY,
        -leaf.hinge.z * carcassScaleZ
      );
    }
    setRemoved("doors", wantedDoors === 0);

    // A pull travels with the panel it is fitted to but must not stretch with
    // it: 90mm of brass is 90mm on a wider cabinet too. Its position is in
    // the carcass's own space, so the parent scale moves it for free; undoing
    // that scale here is what keeps its shape. Without this, widening the
    // piece drew the handles out into bars.
    const handleSize = Math.max(handleScale, 0.001);
    for (const slot of handleSlots) {
      slot.scale.set(handleSize / carcassScaleX, handleSize / carcassScaleY, handleSize / carcassScaleZ);
    }
    setRemoved("handles", !(handleScale > 0.02));

    syncVisibility();
  }

  function setRemoved(id: PartId, value: boolean) {
    if (value) removed.add(id);
    else removed.delete(id);
  }

  /**
   * One place decides what is on screen, for the two different reasons a
   * part can be off it. A removed part is gone because it was never going to
   * be built (a size control took it out). A hidden part is gone because the
   * customer asked to see past it -- still built, still measured, just not
   * drawn.
   *
   * Both end up as `mesh.visible = false`, which costs nothing per frame and
   * needs no blending: an invisible mesh is skipped outright rather than
   * drawn transparently, so hiding a part can only ever make the scene
   * cheaper. Opacity here is now only ever a part's OWN transparency -- a
   * glass tabletop's -- and never a signal about its hidden state.
   */
  function syncVisibility() {
    for (const mesh of pickables) {
      const id = mesh.userData.partId as PartId;
      mesh.visible = !removed.has(id) && !hidden.has(id) && !inactive.has(mesh);

      const material = materials.get(id);
      if (!material) continue;
      const opacity = realOpacity.get(id) ?? 1;
      material.opacity = opacity;
      const nextTransparent = opacity < 1;
      // WebGL compiles a material's blend state into its program up front;
      // flipping `transparent` afterward is invisible until the program is
      // rebuilt. Only toggling it costs a recompile, so this fires on the one
      // frame a finish actually changes a part's transparency, not on every
      // applyParams tick a slider drag produces.
      if (material.transparent !== nextTransparent) material.needsUpdate = true;
      material.transparent = nextTransparent;
    }
    // A drawer's box follows its front: gone with a drawer the count switched
    // off or a part the customer hid.
    applyDrawerSlide();
  }

  function setPartHidden(id: PartId, value: boolean) {
    if (value) hidden.add(id);
    else hidden.delete(id);
    syncVisibility();
  }

  function isRemoved(id: PartId) {
    return removed.has(id);
  }

  function isHidden(id: PartId) {
    return hidden.has(id);
  }

  function isMeshInactive(mesh: THREE.Mesh) {
    return inactive.has(mesh);
  }

  function setColor(id: PartId, hex: string) {
    materials.get(id)?.color.set(hex);
  }

  // What each part's finish resolved to, so a repeat request for the same one
  // does not re-clone maps that are already on the material.
  //
  // The key is the whole appearance, not just the folder. Every wood finish
  // now draws from one scan, so keying on the folder alone would make
  // Narra -> Kamagong a silent no-op: same folder, therefore "already applied",
  // therefore the tighter grain and the swapped albedo never arrive.
  const appliedPbr = new Map<PartId, string>();
  // The roughness the model shipped with, so a varnish scales the material's
  // own value rather than compounding on the last varnish that was tried.
  const baseRoughness = new Map<PartId, number>();
  // The same, for metalness, which only an Original gives back; see setMaterialProfile.
  const baseMetalness = new Map<PartId, number>();

  // A finish's maps read the projected set when the model has one; the
  // model's own colour map always stays on its own unwrap.
  const finishChannel = finishUv === "projected" ? 1 : 0;
  function onFinishUvs(texture: THREE.Texture | null): THREE.Texture | null {
    if (texture) texture.channel = finishChannel;
    return texture;
  }

  /** Frees a finish's relief maps -- never the model's own; see originalRelief. */
  function releaseRelief(id: PartId, material: THREE.MeshPhysicalMaterial) {
    const own = originalRelief.get(id);
    if (material.normalMap && material.normalMap !== own?.normal) material.normalMap.dispose();
    if (material.roughnessMap && material.roughnessMap !== own?.roughness) material.roughnessMap.dispose();
  }

  function pbrKey(profile: MaterialProfile): string {
    const x = profile.repeat ?? 2;
    const y = profile.repeatY ?? x;
    return [profile.pbr ?? "", profile.albedo ? "albedo" : "relief", profile.keepsScanPattern === false ? "flat" : "scan", x * uvScale, y * uvScale, profile.gain ?? 1].join("|");
  }

  function setMaterialProfile(id: PartId, profile: MaterialProfile, varnish?: Varnish) {
    const material = materials.get(id);
    if (!material) return;

    // Everything that costs nothing lands now. The maps below may never arrive,
    // and the piece has to look like the chosen finish either way.
    material.color.set(profile.hex);
    // Above 1 this brightens rather than tints, which is the only way a pale
    // finish can sit on a dark scan: multiplication alone cannot lighten.
    if (profile.gain) material.color.multiplyScalar(profile.gain);
    if (!baseRoughness.has(id)) baseRoughness.set(id, material.roughness);
    const seal = varnishForMaterial(profile, varnish);
    const own = profile.roughness ?? baseRoughness.get(id) ?? 0.7;
    // Scale rather than replace: a coarse weave stays coarser than a planed
    // board under the same varnish, which is what makes the two tiers read as
    // independent instead of one overriding the other.
    material.roughness = Math.min(1, Math.max(0.03, own * seal.roughnessScale));
    material.clearcoat = seal.clearcoat;
    material.clearcoatRoughness = seal.clearcoatRoughness;
    // PBR reads roughness against the environment; without this a fabric and
    // a polished wood reflect the room identically and both look like vinyl.
    // Only coated and bronzed strands are metallic; everything else is a
    // dielectric and must be reset, or the last metallic finish picked would
    // leave the next timber looking like painted tin.
    //
    // Except an Original (no `family`) on a generated model, which means the
    // part as Meshy painted it -- and that paint carries its own metalness
    // map: its bronze bands are metal and its timber is not. Forcing 0 there
    // flattened the whole paint job into a pale, chalky coat. Generated only:
    // the shipped models were tuned against the 0, and one of them (the
    // Victorian chair) leaves glTF's default metalness of 1 on its materials.
    if (!baseMetalness.has(id)) baseMetalness.set(id, material.metalness);
    const keepsOwnMetal = profile.family === undefined && finishUv === "projected";
    material.metalness = profile.metalness ?? (keepsOwnMetal ? (baseMetalness.get(id) ?? 0) : 0);
    material.envMapIntensity =
      profile.type === "fabric" ? 0.35 : profile.type === "rattan" ? 0.62 : 1;
    // Absent means "leave whatever the source model shipped with" -- the
    // same convention every other optional field on a profile uses. Every
    // other surface leaves this unset; glass is the one surface where the
    // finish itself IS the transparency, not just a colour over it.
    if (profile.opacity !== undefined) {
      realOpacity.set(id, profile.opacity);
      material.opacity = profile.opacity;
      material.transparent = profile.opacity < 1;
      // A hidden part is not drawn at all now, so its opacity can be applied
      // unconditionally: there is no ghost state left for it to overwrite,
      // and `mesh.visible` keeps it off screen regardless of what the finish
      // sets here.
    } else {
      // Every other finish means "whatever the model shipped with", which has
      // to be restored rather than merely left alone: the part may be wearing
      // a pane's transparency from the finish before this one. Leaving it
      // alone is what made a timber top picked after a glass one stay
      // see-through.
      const source = sourceOpacity.get(id) ?? { opacity: 1, transparent: false };
      realOpacity.set(id, source.opacity);
      material.opacity = source.opacity;
      material.transparent = source.transparent;
    }
    material.needsUpdate = true;

    const wanted = pbrKey(profile);
    if (appliedPbr.get(id) === wanted) return;
    appliedPbr.set(id, wanted);

    if (profile.keepsScanPattern === false && !profile.albedo && material.map) {
      if (material.map !== originalMaps.get(id)) material.map.dispose();
      material.map = null;
      material.needsUpdate = true;
    }

    if (!profile.pbr) {
      // Back to a plain tint: drop the previous finish's relief, and give the
      // model back its own.
      releaseRelief(id, material);
      const ownRelief = originalRelief.get(id);
      material.normalMap = ownRelief?.normal ?? null;
      material.roughnessMap = ownRelief?.roughness ?? null;
      // A stain keeps the model's own photographed colour under it
      // (keepsScanPattern, on by default -- see the field's own comment); a
      // flat fabric or leather colour drops it, or the tint only ever darkens
      // whatever the scan's baked shading happened to be.
      const nextMap = profile.keepsScanPattern === false ? null : (originalMaps.get(id) ?? null);
      if (material.map !== nextMap) {
        material.map?.dispose();
        material.map = nextMap;
      }
      material.needsUpdate = true;
      return;
    }

    // The material asks for a repeat; the model's own unwrap decides what that
    // is worth. Without this a weave tuned on one chair tiles to mush on another.
    const repeatX = (profile.repeat ?? 2) * uvScale;
    const repeatY = (profile.repeatY ?? profile.repeat ?? 2) * uvScale;

    void loadMaterialMaps(profile.pbr).then((maps) => {
      // The customer may have clicked three more swatches while this loaded.
      if (appliedPbr.get(id) !== wanted) return;
      const live = materials.get(id);
      if (!live) return;

      releaseRelief(id, live);
      // A generated model's own normal map outranks the finish's grain: it
      // is the shape its low-poly mesh stands in for, and there is only the
      // one normal map to spend. Shipped models keep taking the finish's.
      const ownNormal = originalRelief.get(id)?.normal ?? null;
      live.normalMap =
        finishUv === "projected" && ownNormal ? ownNormal : onFinishUvs(tiled(maps.normal, repeatX, repeatY));
      live.roughnessMap = onFinishUvs(tiled(maps.roughness, repeatX, repeatY));

      // Painted colors use the grain relief without a photographed color map.
      // Other finishes can request the scan's albedo or retain the model's.
      const original = originalMaps.get(id) ?? null;
      const nextMap = profile.albedo
        ? onFinishUvs(tiled(maps.diffuse, repeatX, repeatY))
        : profile.keepsScanPattern === false ? null : original;
      if (live.map !== original) live.map?.dispose();
      live.map = nextMap;

      live.needsUpdate = true;
    });
  }

  function setEmphasis(selected: PartId | null, hovered: PartId | null) {
    materials.forEach((material, id) => {
      if (id === selected) {
        material.emissive.setHex(SELECT_EMISSIVE);
        material.emissiveIntensity = SELECT_INTENSITY;
      } else if (id === hovered) {
        material.emissive.setHex(HOVER_EMISSIVE);
        material.emissiveIntensity = HOVER_INTENSITY;
      } else {
        material.emissiveIntensity = 0;
      }
    });
  }

  function dispose() {
    materials.forEach((material, id) => {
      releaseRelief(id, material);
      // Only if we replaced it: the model's own map is shared with the
      // cached GLTF and disposing it would blank the next chair loaded.
      if (material.map && material.map !== originalMaps.get(material.name as PartId)) {
        material.map.dispose();
      }
    });
    for (const id of Array.from(apertureInserts.keys())) clearInserts(id);
    for (const geometry of geometries) geometry.dispose();
    drawerBodyGeometry?.dispose();
    // Anything a shape substitution built. Held separately from `geometries`
    // because that list is the model's own, and a part currently wearing a
    // generated shape has its original sitting unused in it.
    for (const geometry of generated) geometry.dispose();
    generated.clear();
    materials.forEach((material) => material.dispose());
  }

  // DEFAULT_RIG_PARAMS rather than a literal repeating it: this call is just
  // "settle the rig at the model's own proportions", and a hand-copied list
  // silently falls behind every time a new parameter is added.
  applyParams(DEFAULT_RIG_PARAMS);

  const bounds = new THREE.Box3();
  for (const part of parts) bounds.union(part.box);

  return {
    root,
    pickables,
    availableParts: parts.map((part) => part.id),
    bounds,
    applyParams,
    setColor,
    setMaterialProfile,
    setPartShape,
    setPartApertures,
    setPartCarving,
    leafReach,
    // Counted off the shells the rig actually built with, after merging, so
    // it is the same number the leg/base decision elsewhere is made on. The
    // base counts its touching groups instead: a layered pedestal is one
    // object, and offering it a leg shape per layer would be wrong.
    shellCounts: Object.fromEntries(
      parts.map((part) => [part.id, part === legs ? legGroups.length : part.shells.length])
    ) as Partial<Record<PartId, number>>,
    hasDoors: doorLeaves.length > 0,
    baySpan: {
      width: doorSpan.isEmpty() ? 0 : doorSpan.max.x - doorSpan.min.x,
      height: doorSpan.isEmpty() ? 0 : doorSpan.max.y - doorSpan.min.y,
    },
    drawerSpan: drawerRow
      ? {
          width: drawerRow.axis === "x" ? drawerRow.run : 0,
          height: drawerRow.axis === "y" ? drawerRow.run : 0,
        }
      : { width: 0, height: 0 },
    setDoorsOpen,
    setDrawersOpen,
    setReducedMotion,
    withShut,
    advance,
    setPartHidden,
    isHidden,
    isMeshInactive,
    componentFractions: (id: PartId) => componentFractions.get(id) ?? null,
    isRemoved,
    setEmphasis,
    dispose,
  };
}
