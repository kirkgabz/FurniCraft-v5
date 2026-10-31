import * as THREE from "three";
import type { ChairRig } from "./chair-rig";
import type { PartId } from "./studio-config";

/**
 * A blueprint draws two ink weights, not one per material palette: structure,
 * and the upholstery over it. Deliberately not `Surface` -- a woven panel and
 * a timber rail are different things to build and the same thing to draw, so
 * tying this to the finish palette would mean a new pen every time a palette
 * was added.
 */
type DrawnSurface = "wood" | "cloth";


/**
 * Extracts true orthographic silhouettes of the posed chair as SVG path data.
 *
 * A blueprint drawn from bounding boxes is unusable: four legs merge into one
 * slab, the open balloon back becomes a filled panel, and the carvings turn
 * into a bar across the front. So instead of measuring envelopes, this projects
 * the real triangles, rasterises the coverage, and traces the outline back out
 * with marching squares -- which recovers concave edges and interior holes (the
 * void inside the backrest) that no box could express.
 *
 * The result is compact path data in centimetre model space, so it can ride
 * along on a saved order and be redrawn later with no 3D involved.
 */

export type ViewKey = "front" | "side" | "top";

/** Per view, per surface: SVG path data in centimetres, plus the extents it spans. */
export type Silhouettes = {
  cm: Record<ViewKey, { wood: string; cloth: string }>;
  bounds: Record<ViewKey, { hMin: number; hMax: number; vMin: number; vMax: number }>;
};

/** Longest axis of each view is divided into this many cells. Trades detail for size. */
const GRID_LONG_AXIS = 300;
/** Contours are simplified to this fraction of a cell -- below visible error. */
const SIMPLIFY_CELLS = 0.55;

type Axis = 0 | 1 | 2;

const VIEW_AXES: Record<ViewKey, { h: Axis; v: Axis }> = {
  front: { h: 0, v: 1 }, // looking down -z: width across, height up
  side: { h: 2, v: 1 },  // looking along -x: depth across, height up
  top: { h: 0, v: 2 },   // looking down -y: width across, depth down the page
};



/** World-space triangles of every part that will be built, by surface, in centimetres. */
function collectTriangles(
  rig: ChairRig,
  cmPerUnit: number,
  clothParts: PartId[],
  stagingParts: PartId[]
): Record<DrawnSurface, Float32Array[]> {
  rig.root.updateMatrixWorld(true);
  const out: Record<DrawnSurface, Float32Array[]> = { wood: [], cloth: [] };
  const vertex = new THREE.Vector3();

  for (const mesh of rig.pickables) {
    const id = mesh.userData.partId as PartId | undefined;
    if (!id) continue;
    // Excluded from the drawing when either removed (it will not be built at
    // all) or hidden (the customer chose not to show it) -- see setPartHidden
    // on ChairRig for why hidden still leaves it priced and on the schedule
    // even though it drops out of these traced views.
    if (rig.isRemoved(id) || rig.isHidden(id)) continue;
    // The same two exclusions measureRig makes, so the outline and the
    // dimensions written beside it describe the same piece. A staging part --
    // an uploaded bed's duvet -- is shown in the studio but never built; a
    // mesh the rig has switched off is a shelf beyond the count the customer
    // chose. Drawing either put boards on the sheet that the schedule, the
    // overall size and the furniture shop all leave out.
    if (stagingParts.includes(id) || rig.isMeshInactive(mesh)) continue;
    const surface: DrawnSurface = clothParts.includes(id) ? "cloth" : "wood";

    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!position || !index) continue;

    const triangles = new Float32Array(index.count * 3);
    for (let i = 0; i < index.count; i++) {
      const vi = index.getX(i);
      vertex.set(position.getX(vi), position.getY(vi), position.getZ(vi));
      vertex.applyMatrix4(mesh.matrixWorld).multiplyScalar(cmPerUnit);
      triangles[i * 3] = vertex.x;
      triangles[i * 3 + 1] = vertex.y;
      triangles[i * 3 + 2] = vertex.z;
    }
    out[surface].push(triangles);
  }
  return out;
}

type Grid = { data: Uint8Array; w: number; h: number; hMin: number; vMin: number; cell: number };

function makeGrid(hMin: number, hMax: number, vMin: number, vMax: number): Grid {
  const spanH = Math.max(hMax - hMin, 1e-3);
  const spanV = Math.max(vMax - vMin, 1e-3);
  const cell = Math.max(spanH, spanV) / GRID_LONG_AXIS;
  // One cell of bleed on every side guarantees the contour closes inside the grid.
  const w = Math.ceil(spanH / cell) + 2;
  const h = Math.ceil(spanV / cell) + 2;
  return { data: new Uint8Array(w * h), w, h, hMin: hMin - cell, vMin: vMin - cell, cell };
}

/** Scanline-fills one projected triangle into the coverage grid. */
function rasterize(grid: Grid, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const { data, w, h, hMin, vMin, cell } = grid;

  const toCol = (value: number) => (value - hMin) / cell - 0.5;
  const toRow = (value: number) => (value - vMin) / cell - 0.5;

  const x0 = toCol(ax), y0 = toRow(ay);
  const x1 = toCol(bx), y1 = toRow(by);
  const x2 = toCol(cx), y2 = toRow(cy);

  let minCol = Math.floor(Math.min(x0, x1, x2));
  let maxCol = Math.ceil(Math.max(x0, x1, x2));
  let minRow = Math.floor(Math.min(y0, y1, y2));
  let maxRow = Math.ceil(Math.max(y0, y1, y2));
  if (maxCol < 0 || maxRow < 0 || minCol >= w || minRow >= h) return;
  minCol = Math.max(minCol, 0); maxCol = Math.min(maxCol, w - 1);
  minRow = Math.max(minRow, 0); maxRow = Math.min(maxRow, h - 1);

  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-12) {
    // Degenerate on this projection (an edge-on face): mark the span it covers
    // so thin members still register instead of vanishing.
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) data[row * w + col] = 1;
    }
    return;
  }
  const inv = 1 / area;

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const px = col;
      const py = row;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) data[row * w + col] = 1;
    }
  }
}

/**
 * Marching squares over the coverage grid, emitting one closed loop per
 * boundary component. Segments are keyed by their endpoints and then walked
 * into loops, so outer outlines and interior holes both come back.
 */
function traceContours(grid: Grid): Array<Array<[number, number]>> {
  const { data, w, h } = grid;
  const at = (col: number, row: number) =>
    col < 0 || row < 0 || col >= w || row >= h ? 0 : data[row * w + col];

  // Endpoints land on half-integer lattice positions; scale by 2 to key them as integers.
  const segments: Array<[number, number, number, number]> = [];
  for (let row = -1; row < h; row++) {
    for (let col = -1; col < w; col++) {
      const tl = at(col, row);
      const tr = at(col + 1, row);
      const br = at(col + 1, row + 1);
      const bl = at(col, row + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;

      // Midpoints of the four cell edges, in doubled lattice units.
      const top: [number, number] = [col * 2 + 1, row * 2];
      const right: [number, number] = [col * 2 + 2, row * 2 + 1];
      const bottom: [number, number] = [col * 2 + 1, row * 2 + 2];
      const left: [number, number] = [col * 2, row * 2 + 1];

      const push = (p: [number, number], q: [number, number]) =>
        segments.push([p[0], p[1], q[0], q[1]]);

      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 6: case 9: push(top, bottom); break;
        case 7: case 8: push(left, top); break;
        case 5: push(left, top); push(bottom, right); break;
        case 10: push(left, bottom); push(top, right); break;
        default: break;
      }
    }
  }

  // Link segments end-to-end into closed loops.
  const key = (x: number, y: number) => `${x},${y}`;
  const adjacency = new Map<string, Array<{ to: [number, number]; index: number }>>();
  segments.forEach(([x1, y1, x2, y2], index) => {
    const a = key(x1, y1);
    const b = key(x2, y2);
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push({ to: [x2, y2], index });
    adjacency.get(b)!.push({ to: [x1, y1], index });
  });

  const used = new Uint8Array(segments.length);
  const loops: Array<Array<[number, number]>> = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const [sx, sy, ex, ey] = segments[start];
    const loop: Array<[number, number]> = [[sx, sy], [ex, ey]];
    let current: [number, number] = [ex, ey];

    for (;;) {
      const links = adjacency.get(key(current[0], current[1]));
      if (!links) break;
      const next = links.find((link) => !used[link.index]);
      if (!next) break;
      used[next.index] = 1;
      current = next.to;
      if (current[0] === sx && current[1] === sy) break;
      loop.push(current);
    }

    if (loop.length >= 4) loops.push(loop);
  }

  return loops;
}

/** Perpendicular-distance simplification (Douglas-Peucker), iterative. */
function simplify(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) continue;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;

    let worst = -1;
    let worstIndex = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let distance: number;
      if (lengthSq === 0) {
        distance = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
        distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (distance > worst) {
        worst = distance;
        worstIndex = i;
      }
    }

    if (worst > epsilon && worstIndex > 0) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function buildPath(grid: Grid, epsilonCm: number): string {
  const loops = traceContours(grid);
  if (loops.length === 0) return "";

  const toCm = (lattice: number, min: number) => min + (lattice / 2 + 0.5) * grid.cell;
  const parts: string[] = [];

  for (const loop of loops) {
    const cm: Array<[number, number]> = loop.map(([lx, ly]) => [
      toCm(lx, grid.hMin),
      toCm(ly, grid.vMin),
    ]);
    const reduced = simplify(cm, epsilonCm);
    if (reduced.length < 3) continue;
    parts.push(
      `M ${reduced.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`
    );
  }

  return parts.join(" ");
}

/**
 * Projects the posed chair into the three standard views and returns the traced
 * outlines. Runs over the full triangle set, so call it on demand (opening the
 * blueprint, saving an order) rather than on every slider tick.
 */
export function computeSilhouettes(
  rig: ChairRig,
  cmPerUnit: number,
  clothParts: PartId[],
  /** Parts shown but never built (PartDef.staging); left off the drawing. */
  stagingParts: PartId[] = []
): Silhouettes {
  const bySurface = collectTriangles(rig, cmPerUnit, clothParts, stagingParts);
  const all = [...bySurface.wood, ...bySurface.cloth];

  const cm = {} as Silhouettes["cm"];
  const bounds = {} as Silhouettes["bounds"];

  for (const view of Object.keys(VIEW_AXES) as ViewKey[]) {
    const { h: hAxis, v: vAxis } = VIEW_AXES[view];

    let hMin = Infinity, hMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const triangles of all) {
      for (let i = 0; i < triangles.length; i += 3) {
        const hv = triangles[i + hAxis];
        const vv = triangles[i + vAxis];
        if (hv < hMin) hMin = hv;
        if (hv > hMax) hMax = hv;
        if (vv < vMin) vMin = vv;
        if (vv > vMax) vMax = vv;
      }
    }
    if (!Number.isFinite(hMin)) {
      cm[view] = { wood: "", cloth: "" };
      bounds[view] = { hMin: 0, hMax: 0, vMin: 0, vMax: 0 };
      continue;
    }

    const paths: { wood: string; cloth: string } = { wood: "", cloth: "" };
    for (const surface of ["wood", "cloth"] as DrawnSurface[]) {
      const grid = makeGrid(hMin, hMax, vMin, vMax);
      for (const triangles of bySurface[surface]) {
        for (let i = 0; i < triangles.length; i += 9) {
          rasterize(
            grid,
            triangles[i + hAxis], triangles[i + vAxis],
            triangles[i + 3 + hAxis], triangles[i + 3 + vAxis],
            triangles[i + 6 + hAxis], triangles[i + 6 + vAxis]
          );
        }
      }
      paths[surface] = buildPath(grid, grid.cell * SIMPLIFY_CELLS);
    }

    cm[view] = paths;
    bounds[view] = { hMin, hMax, vMin, vMax };
  }

  return { cm, bounds };
}
