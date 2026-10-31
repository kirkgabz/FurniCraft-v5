import type { PartMeasurement } from "./studio-dimensions";
import type { ViewKey } from "./studio-silhouette";

/**
 * Where the numbered balloons go on a shop drawing, and what their leaders
 * point at.
 *
 * A balloon is only worth drawing if its leader lands on the part it names.
 * The first version put each bubble at the centre of its part's bounding box,
 * which is the one place a set of legs is guaranteed NOT to be: four legs at
 * the corners of a table have their centre in the empty air between them.
 * Every part on a symmetric piece shared that centre, so the bubbles stacked
 * into a column, and in plan view all of them landed on the same spot of the
 * tabletop. The drawing looked annotated and identified nothing.
 *
 * So this works the way a draughtsman does:
 *
 *  1. Find what the reader can actually SEE of each part in each view. The
 *     traced outline says where there is ink; each part's bounds say which
 *     parts could be responsible for it; and depth says which of those is in
 *     front. A part whose pieces are spread out (four legs, a pair of arms)
 *     does not hide what is behind it, so it only claims the ink it is the
 *     most specific explanation for.
 *  2. Balloon each part ONCE, in the view where it is seen most clearly, as
 *     assembly drawings do. Repeating a number in every view is what turned
 *     the plan view into a pile of bubbles.
 *  3. Put the balloon in clear space beside the drawing, never on it, with a
 *     leader that ends in a dot on the part itself. Leaders avoid crossing
 *     other parts, dimension lines and each other.
 *
 * A part that is built but hidden in every view -- shelves behind cabinet
 * doors -- is still ballooned, with a dashed leader, the drafting convention
 * for "behind what you see".
 *
 * Everything here is derived at render time from the saved measurement and
 * outline, so every design ever saved gets the same treatment with nothing
 * new stored.
 */

type Axis = "x" | "y" | "z";

/** A page-space rectangle, in drawing pixels. */
export type Rect = { x1: number; y1: number; x2: number; y2: number };

/** One view panel, as the placement needs to see it. */
export type CalloutFrame = {
  key: ViewKey;
  /** The panel's own border. Balloons stay inside it. */
  panel: Rect;
  /** Where the drawing itself sits inside the panel. */
  content: Rect;
  hAxis: Axis;
  vAxis: Axis;
  /** The model axis that points out of the page toward the reader. */
  depthAxis: Axis;
  toX: (cm: number) => number;
  toY: (cm: number) => number;
  /** Traced outline path data in centimetres, or null where the view is drawn from envelopes. */
  outline: { wood: string; cloth: string } | null;
  /** Dimension lines, extension lines and their labels: space a balloon must not sit on. */
  keepOut: Rect[];
};

export type Callout = {
  /** The schedule's "#" -- the part's 1-based position in `parts`. */
  n: number;
  view: ViewKey;
  anchor: { x: number; y: number };
  balloon: { x: number; y: number };
  /** The part is behind something in this view; drawn with a dashed leader. */
  hidden: boolean;
};

/** Raster cell size, in drawing pixels. Fine enough for a 4cm rail at typical scales. */
const CELL = 2;

/** Balloon centres are tried on a lattice this many cells apart. */
const CANDIDATE_STEP = 3;

/** Clear space kept between a balloon's edge and any ink or annotation, px. */
const BALLOON_CLEARANCE = 4;

/** Balloons closer than this edge to edge read as one blob, px. */
const BALLOON_GAP = 5;

/**
 * Shortest leader worth drawing, px beyond the balloon's radius. Shorter and
 * the dot sits under the balloon's rim and the reader cannot see what it
 * touches.
 */
const MIN_LEADER = 12;

/**
 * Two surfaces within this many centimetres of the same depth are treated as
 * flush. The bookcase's shelves sit 0.8cm behind the face of the case and are
 * plainly visible through its open front; the cabinet's shelves sit 3cm
 * behind its doors and are not. 1.5 separates the two.
 */
const DEPTH_TOLERANCE_CM = 1.5;

/**
 * A part whose pieces cover at least this share of its own bounds in a view
 * hides what is behind it there. Four table legs cover 18% of the table's
 * front; a pair of cabinet doors covers 99% of the doorway.
 */
const SOLID_FILL = 0.6;

/**
 * How thick a part's visible region must be (in cells from its edge) before
 * one view counts as good as another for ballooning it. Past this, the
 * choice goes to whichever view has fewer balloons, which spreads them
 * across the sheet instead of crowding the front elevation.
 */
const CLEAR_ENOUGH = 3;

// Leader cost, in pixels of leader length each is treated as equal to.
/** Per pixel of leader crossing a different part: it reads as pointing at that part. */
const COST_FOREIGN_INK = 4;
/** Per pixel of leader crossing a dimension or extension line. */
const COST_ANNOTATION = 2;
/** A balloon sitting inside the drawing's own frame (between legs, say) rather than beside it. */
const COST_INSIDE_CONTENT = 14;
/** One leader crossing another. Legal, but the first thing a checker circles. */
const COST_CROSSING = 250;

type Grid = { x0: number; y0: number; w: number; h: number };

type Scene = {
  frame: CalloutFrame;
  grid: Grid;
  ink: Uint8Array;
  /** Index of the part that owns each ink cell, or -1. */
  owner: Int16Array;
  keepOut: Uint8Array;
  /** Distance, in cells, from each cell to the nearest ink or keep-out cell. */
  clearance: Float32Array;
  /** Each part's bounds in this view, px, and the cells they cover. */
  rects: Rect[];
  spans: CellSpan[];
  /** Where in its span each part's pieces can be; see pieceBands. */
  bands: PieceBands[];
};

// ------------------------------------------------------------------ raster

function makeGrid(panel: Rect): Grid {
  return {
    x0: panel.x1,
    y0: panel.y1,
    w: Math.ceil((panel.x2 - panel.x1) / CELL),
    h: Math.ceil((panel.y2 - panel.y1) / CELL),
  };
}

const cellX = (g: Grid, col: number) => g.x0 + (col + 0.5) * CELL;
const cellY = (g: Grid, row: number) => g.y0 + (row + 0.5) * CELL;
const colOf = (g: Grid, x: number) => Math.floor((x - g.x0) / CELL);
const rowOf = (g: Grid, y: number) => Math.floor((y - g.y0) / CELL);

function markRect(g: Grid, mask: Uint8Array, r: Rect) {
  const c1 = Math.max(0, colOf(g, Math.min(r.x1, r.x2)));
  const c2 = Math.min(g.w - 1, colOf(g, Math.max(r.x1, r.x2)));
  const r1 = Math.max(0, rowOf(g, Math.min(r.y1, r.y2)));
  const r2 = Math.min(g.h - 1, rowOf(g, Math.max(r.y1, r.y2)));
  for (let row = r1; row <= r2; row++) mask.fill(1, row * g.w + c1, row * g.w + c2 + 1);
}

/** The cells whose centres fall inside `r` grown by `pad`, clamped to the grid. */
type CellSpan = { c1: number; c2: number; r1: number; r2: number };

function cellSpan(g: Grid, r: Rect, pad: number): CellSpan {
  return {
    c1: Math.max(0, Math.ceil((r.x1 - pad - g.x0) / CELL - 0.5)),
    c2: Math.min(g.w - 1, Math.floor((r.x2 + pad - g.x0) / CELL - 0.5)),
    r1: Math.max(0, Math.ceil((r.y1 - pad - g.y0) / CELL - 0.5)),
    r2: Math.min(g.h - 1, Math.floor((r.y2 + pad - g.y0) / CELL - 0.5)),
  };
}

function markSegment(g: Grid, mask: Uint8Array, ax: number, ay: number, bx: number, by: number) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
  for (let i = 0; i <= steps; i++) {
    const col = colOf(g, ax + ((bx - ax) * i) / steps);
    const row = rowOf(g, ay + ((by - ay) * i) / steps);
    if (col >= 0 && row >= 0 && col < g.w && row < g.h) mask[row * g.w + col] = 1;
  }
}

/**
 * Reads the outline path data back into closed loops in page pixels. The
 * tracer writes only absolute M, L and Z (see buildPath in
 * studio-silhouette.ts), and that is all this accepts.
 */
function parseLoops(d: string, toX: (v: number) => number, toY: (v: number) => number): Array<Array<[number, number]>> {
  const loops: Array<Array<[number, number]>> = [];
  const tokens = d.match(/[MLZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let current: Array<[number, number]> | null = null;
  let command = "";
  const close = () => {
    if (current && current.length >= 3) loops.push(current);
    current = null;
  };
  for (let i = 0; i < tokens.length; ) {
    const token = tokens[i];
    if (/^[MLZ]$/i.test(token)) {
      command = token.toUpperCase();
      if (command === "Z") close();
      i++;
      continue;
    }
    const x = Number(tokens[i]);
    const y = Number(tokens[i + 1]);
    i += 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (command === "M" || !current) {
      close();
      current = [];
      command = "L";
    }
    current.push([toX(x), toY(y)]);
  }
  close();
  return loops;
}

/**
 * Scanline fill with the even-odd rule -- the same rule the drawing renders
 * its outlines with, so a hole (the void inside a balloon back) stays a hole
 * here too. The outline's own edges are marked as well, so a member thinner
 * than a cell still registers as ink.
 */
function fillEvenOdd(g: Grid, mask: Uint8Array, loops: Array<Array<[number, number]>>) {
  const edges: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i];
      const [bx, by] = loop[(i + 1) % loop.length];
      edges.push(ax, ay, bx, by);
    }
  }
  const crossings: number[] = [];
  for (let row = 0; row < g.h; row++) {
    const yc = cellY(g, row);
    crossings.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const ay = edges[e + 1];
      const by = edges[e + 3];
      if (ay <= yc !== by <= yc) {
        const ax = edges[e];
        const bx = edges[e + 2];
        crossings.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c1 = Math.max(0, Math.ceil((crossings[k] - g.x0) / CELL - 0.5));
      const c2 = Math.min(g.w - 1, Math.floor((crossings[k + 1] - g.x0) / CELL - 0.5));
      if (c2 >= c1) mask.fill(1, row * g.w + c1, row * g.w + c2 + 1);
    }
  }
  for (let e = 0; e < edges.length; e += 4) markSegment(g, mask, edges[e], edges[e + 1], edges[e + 2], edges[e + 3]);
}

/**
 * Two-pass chamfer distance: for every set cell, roughly how many cells to
 * the nearest unset one (the grid's edge counts as unset). Within a few
 * percent of Euclidean, which is all a placement heuristic needs.
 */
function distanceInside(mask: Uint8Array, w: number, h: number): Float32Array {
  // Written out long-hand: this runs over every cell of every view several
  // times per drawing, and a helper closure per neighbour was most of its cost.
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
  const D = Math.SQRT2;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!d[i]) continue;
      let v = d[i];
      const left = col > 0 ? d[i - 1] + 1 : 1;
      if (left < v) v = left;
      if (row > 0) {
        const up = d[i - w] + 1;
        if (up < v) v = up;
        const upLeft = col > 0 ? d[i - w - 1] + D : D;
        if (upLeft < v) v = upLeft;
        const upRight = col < w - 1 ? d[i - w + 1] + D : D;
        if (upRight < v) v = upRight;
      } else if (1 < v) {
        v = 1;
      }
      d[i] = v;
    }
  }
  for (let row = h - 1; row >= 0; row--) {
    for (let col = w - 1; col >= 0; col--) {
      const i = row * w + col;
      if (!d[i]) continue;
      let v = d[i];
      const right = col < w - 1 ? d[i + 1] + 1 : 1;
      if (right < v) v = right;
      if (row < h - 1) {
        const down = d[i + w] + 1;
        if (down < v) v = down;
        const downRight = col < w - 1 ? d[i + w + 1] + D : D;
        if (downRight < v) v = downRight;
        const downLeft = col > 0 ? d[i + w - 1] + D : D;
        if (downLeft < v) v = downLeft;
      } else if (1 < v) {
        v = 1;
      }
      d[i] = v;
    }
  }
  return d;
}

// --------------------------------------------------------------- ownership

const sizeAlong = (d: { w: number; h: number; d: number }, axis: Axis) =>
  axis === "x" ? d.w : axis === "y" ? d.h : d.d;

/**
 * Whether a part hides what is behind it in this view.
 *
 * Its components say how much of its own bounds it really fills: four legs
 * span a whole table and fill a fifth of it, a pair of doors fills the whole
 * doorway -- that is "known".
 *
 * A part with no component list is one piece, and could be a panel or an
 * open frame: the rattan chair's legs are one welded piece that wraps the
 * whole chair. It is "assumed" solid, and buildScene only lets it hide what
 * the outline shows no see-through gaps in. The exception is many meshes the
 * cutting list gave up on (the stool's 98 cane fragments), which is a
 * lattice, not a panel.
 */
type Solidity = "known" | "assumed" | false;

function isSolid(part: PartMeasurement, frame: CalloutFrame): Solidity {
  const components = part.components ?? [];
  if (components.length > 0) {
    const covered = components.reduce(
      (sum, c) => sum + c.qty * sizeAlong(c, frame.hAxis) * sizeAlong(c, frame.vAxis),
      0
    );
    const box = Math.max(sizeAlong(part, frame.hAxis), 0.1) * Math.max(sizeAlong(part, frame.vAxis), 0.1);
    return covered / box >= SOLID_FILL ? "known" : false;
  }
  return (part.count ?? 1) <= 1 ? "assumed" : false;
}

/**
 * Background the outline encloses -- the gaps in a woven seat, the void in a
 * balloon back: places the reader can see straight through the piece.
 * Found as the empty cells a flood from the panel's edge cannot reach.
 */
function enclosedGaps(ink: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (!ink[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let col = 0; col < w; col++) {
    seed(col);
    seed((h - 1) * w + col);
  }
  for (let row = 0; row < h; row++) {
    seed(row * w);
    seed(row * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const col = i % w;
    if (col > 0) seed(i - 1);
    if (col < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < (h - 1) * w) seed(i + w);
  }
  const gaps = new Uint8Array(w * h);
  for (let i = 0; i < gaps.length; i++) gaps[i] = !ink[i] && !outside[i] ? 1 : 0;
  return gaps;
}

/**
 * Share of a part's span that is see-through gap before a part only assumed
 * solid is taken not to be covering it. The rattan chair's woven seat is
 * about a third gap from above; a bookcase's shelves, under its top, none.
 */
const SEE_THROUGH = 0.03;

/**
 * Where, inside its own box, a set of separate pieces can actually be -- as
 * cell bands in from each end of the box, per axis, or 0 where the pieces
 * could be anywhere along it.
 *
 * A set's box is the span of its pieces, and the pieces sit at the ends of
 * that span: four legs at the corners of a table, a pair of arms at either
 * side of a sofa, a door handle at the top of the handles' box and a drawer
 * handle at the bottom. Its components say how thick one piece is along
 * each axis, and wherever that is less than half the span the pieces cannot
 * be meeting in the middle, so only the ends are theirs. Without this a
 * cabinet's handles claimed the whole strip down the middle of its doors,
 * and their leader landed on the doors.
 *
 * Worked out per size of piece and then combined, because a set can mix
 * shapes: a table's four drop leaves are two end leaves and two side
 * leaves, which between them make a ring around the top -- where taking the
 * largest piece along each axis would have said "anywhere".
 *
 * An empty list means no restriction.
 */
type PieceBands = Array<{ h: number; v: number }>;

function pieceBands(part: PartMeasurement, frame: CalloutFrame, rect: Rect): PieceBands {
  const components = part.components ?? [];
  if (components.length === 0 || isSolid(part, frame)) return [];
  const band = (piece: number, axis: Axis, px: number) => {
    const span = sizeAlong(part, axis);
    if (span <= 0 || piece >= span / 2) return 0;
    return Math.ceil((piece * (px / span)) / CELL) + 1;
  };
  const bands = components.map((c) => ({
    h: band(sizeAlong(c, frame.hAxis), frame.hAxis, rect.x2 - rect.x1),
    v: band(sizeAlong(c, frame.vAxis), frame.vAxis, rect.y2 - rect.y1),
  }));
  // One size of piece that could be anywhere makes the whole box possible.
  return bands.some((b) => !b.h && !b.v) ? [] : bands;
}

/**
 * How much of the view a part actually covers, px^2: its pieces where the
 * components list them, never more than its box.
 */
function footprint(part: PartMeasurement, frame: CalloutFrame, rect: Rect): number {
  const box = Math.max((rect.x2 - rect.x1) * (rect.y2 - rect.y1), 1);
  const components = part.components ?? [];
  const spanH = sizeAlong(part, frame.hAxis);
  const spanV = sizeAlong(part, frame.vAxis);
  if (components.length === 0 || spanH <= 0 || spanV <= 0) return box;
  const pxPerCm2 = ((rect.x2 - rect.x1) / spanH) * ((rect.y2 - rect.y1) / spanV);
  const covered = components.reduce(
    (sum, c) => sum + c.qty * sizeAlong(c, frame.hAxis) * sizeAlong(c, frame.vAxis),
    0
  );
  return Math.max(Math.min(box, covered * pxPerCm2), 1);
}

/** Whether a cell of a part's span is somewhere one of its pieces could be. */
function inPieces(span: CellSpan, bands: PieceBands, col: number, row: number): boolean {
  if (bands.length === 0) return true;
  for (const band of bands) {
    if (band.h && col >= span.c1 + band.h && col <= span.c2 - band.h) continue;
    if (band.v && row >= span.r1 + band.v && row <= span.r2 - band.v) continue;
    return true;
  }
  return false;
}

function partRect(part: PartMeasurement, frame: CalloutFrame): Rect {
  const xa = frame.toX(part.min[frame.hAxis]);
  const xb = frame.toX(part.max[frame.hAxis]);
  const ya = frame.toY(part.min[frame.vAxis]);
  const yb = frame.toY(part.max[frame.vAxis]);
  return { x1: Math.min(xa, xb), y1: Math.min(ya, yb), x2: Math.max(xa, xb), y2: Math.max(ya, yb) };
}

function buildScene(parts: PartMeasurement[], frame: CalloutFrame): Scene {
  const grid = makeGrid(frame.panel);
  const size = grid.w * grid.h;
  const rects = parts.map((part) => partRect(part, frame));

  const ink = new Uint8Array(size);
  if (frame.outline) {
    // Wood and cloth are separate even-odd paths on the drawing, so they are
    // filled separately here and then combined.
    for (const d of [frame.outline.wood, frame.outline.cloth]) {
      if (!d) continue;
      const layer = new Uint8Array(size);
      fillEvenOdd(grid, layer, parseLoops(d, frame.toX, frame.toY));
      for (let i = 0; i < size; i++) ink[i] |= layer[i];
    }
  } else {
    for (const r of rects) markRect(grid, ink, r);
  }

  // Which part each inked cell belongs to. Envelope drawings paint largest
  // first, so the smallest box containing a point is the one on top there.
  // Traced drawings are the real object: the nearest solid part hides
  // everything behind it, and among what is left the most specific
  // explanation wins -- a stretcher's band, not the box of the four legs
  // that happens to contain it.
  //
  // Both are built by painting each part's box once rather than asking every
  // part about every cell.
  const nearness = parts.map((part) => part.max[frame.depthAxis]);
  // Specificity is judged on what a part really covers, not on its box: a
  // sofa's two arms span exactly the same box as its base rail, but cover a
  // seventh of it, and the ends of that box are theirs. An envelope drawing
  // is the exception -- it paints whole boxes, largest first, so there the
  // box is what is on top.
  const area = parts.map((part, p) =>
    frame.outline
      ? footprint(part, frame, rects[p])
      : Math.max((rects[p].x2 - rects[p].x1) * (rects[p].y2 - rects[p].y1), 1)
  );
  const pad = CELL * 0.75;
  const spans = rects.map((r) => cellSpan(grid, r, pad));
  // An envelope drawing really does draw each part as its whole box; only a
  // traced one shows the separate pieces.
  const bands = parts.map((part, p): PieceBands => (frame.outline ? pieceBands(part, frame, rects[p]) : []));

  // How far back a surface may sit and still be seen at each cell: just
  // behind the nearest solid part covering it. Kept apart for parts known
  // to be solid and parts only assumed to be, because the second kind is
  // overruled for any part the reader can plainly see through the gaps of.
  const cutoffKnown = new Float32Array(size).fill(-Infinity);
  const cutoffAssumed = new Float32Array(size).fill(-Infinity);
  const seeThrough = parts.map(() => false);
  if (frame.outline) {
    parts.forEach((part, p) => {
      const solidity = isSolid(part, frame);
      if (!solidity) return;
      const cutoff = solidity === "known" ? cutoffKnown : cutoffAssumed;
      const limit = nearness[p] - DEPTH_TOLERANCE_CM;
      const { c1, c2, r1, r2 } = spans[p];
      for (let row = r1; row <= r2; row++) {
        for (let i = row * grid.w + c1, end = row * grid.w + c2; i <= end; i++) {
          if (limit > cutoff[i]) cutoff[i] = limit;
        }
      }
    });
    const gaps = enclosedGaps(ink, grid.w, grid.h);
    spans.forEach((span, p) => {
      let open = 0;
      for (let row = span.r1; row <= span.r2; row++) {
        for (let i = row * grid.w + span.c1, end = row * grid.w + span.c2; i <= end; i++) open += gaps[i];
      }
      const cells = (span.c2 - span.c1 + 1) * (span.r2 - span.r1 + 1);
      seeThrough[p] = cells > 0 && open / cells >= SEE_THROUGH;
    });
  }

  const owner = new Int16Array(size).fill(-1);
  const ownerArea = new Float64Array(size).fill(Infinity);
  // Ties go to the later part on an envelope drawing, which is the one
  // painted on top; on a traced one, to the earlier, matching the schedule.
  const takesTie = !frame.outline;
  for (let p = 0; p < parts.length; p++) {
    const span = spans[p];
    const a = area[p];
    const near = nearness[p];
    const trustAssumed = !seeThrough[p];
    for (let row = span.r1; row <= span.r2; row++) {
      for (let col = span.c1; col <= span.c2; col++) {
        const i = row * grid.w + col;
        if (!ink[i] || near < cutoffKnown[i] || (trustAssumed && near < cutoffAssumed[i])) continue;
        if (!inPieces(span, bands[p], col, row)) continue;
        if (a < ownerArea[i] || (takesTie && a === ownerArea[i])) {
          ownerArea[i] = a;
          owner[i] = p;
        }
      }
    }
  }

  const keepOut = new Uint8Array(size);
  for (const r of frame.keepOut) markRect(grid, keepOut, r);

  const free = new Uint8Array(size);
  for (let i = 0; i < size; i++) free[i] = ink[i] || keepOut[i] ? 0 : 1;
  const clearance = distanceInside(free, grid.w, grid.h);

  return { frame, grid, ink, owner, keepOut, clearance, rects, spans, bands };
}

// ------------------------------------------------------------------ targets

/** Where on a part, in one view, a leader may land. */
type Target = {
  scene: Scene;
  part: number;
  hidden: boolean;
  /** Deepest the visible region gets, in cells -- how clearly the part reads here. */
  depth: number;
  area: number;
  /** Cells a leader may end on. */
  landing: Uint8Array;
  /**
   * The landing zone's edge cells, as columns and rows. Seen from outside a
   * region, its nearest point is always on its edge, so this is all a
   * balloon needs to find where its leader should land.
   */
  edgeCols: Int32Array;
  edgeRows: Int32Array;
  /** Balloon spots for this target, cheapest first; see spotsFor. */
  strictSpots?: Spot[];
  looseSpots?: Spot[];
};

/**
 * Turns a region into a Target: the landing zone is the part of the region
 * comfortably inside its edges, so a dot never sits on a boundary where it
 * could belong to either neighbour.
 */
function targetFrom(
  scene: Scene,
  part: number,
  span: CellSpan,
  inRegion: (i: number) => boolean,
  hidden: boolean
): Target | null {
  const { w } = scene.grid;
  // Work only inside the part's own box, then inside the region's bounding
  // box within that: a leg is a sliver of the panel, and scanning the whole
  // panel for every part in every view was most of the time this took.
  let area = 0;
  let c1 = Infinity, r1 = Infinity, c2 = -1, r2 = -1;
  for (let row = span.r1; row <= span.r2; row++) {
    for (let col = span.c1; col <= span.c2; col++) {
      if (!inRegion(row * w + col)) continue;
      area++;
      if (col < c1) c1 = col;
      if (col > c2) c2 = col;
      if (row < r1) r1 = row;
      if (row > r2) r2 = row;
    }
  }
  if (area === 0) return null;
  const cw = c2 - c1 + 1;
  const ch = r2 - r1 + 1;
  const crop = new Uint8Array(cw * ch);
  for (let row = 0; row < ch; row++) {
    for (let col = 0; col < cw; col++) crop[row * cw + col] = inRegion((row + r1) * w + col + c1) ? 1 : 0;
  }
  const depth = distanceInside(crop, cw, ch);
  let deepest = 0;
  for (let i = 0; i < depth.length; i++) if (crop[i] && depth[i] > deepest) deepest = depth[i];
  // Deep enough to be clearly inside, but no deeper than needed: on a big
  // panel any point 5 cells in is as good as the dead centre, and a lot
  // closer to the margin where the balloon goes.
  const threshold = Math.max(1, Math.min(deepest * 0.7, 5));
  const inZone = (col: number, row: number) =>
    col >= 0 && row >= 0 && col < cw && row < ch && crop[row * cw + col] === 1 && depth[row * cw + col] >= threshold;
  const landing = new Uint8Array(scene.ink.length);
  const edgeCols: number[] = [];
  const edgeRows: number[] = [];
  for (let row = 0; row < ch; row++) {
    for (let col = 0; col < cw; col++) {
      if (!inZone(col, row)) continue;
      landing[(row + r1) * w + col + c1] = 1;
      if (!inZone(col - 1, row) || !inZone(col + 1, row) || !inZone(col, row - 1) || !inZone(col, row + 1)) {
        edgeCols.push(col + c1);
        edgeRows.push(row + r1);
      }
    }
  }
  return {
    scene,
    part,
    hidden,
    depth: deepest,
    area,
    landing,
    edgeCols: Int32Array.from(edgeCols),
    edgeRows: Int32Array.from(edgeRows),
  };
}

function visibleTarget(scene: Scene, part: number): Target | null {
  const { owner } = scene;
  return targetFrom(scene, part, scene.spans[part], (i) => owner[i] === part, false);
}

/**
 * For a part no view shows: the ink inside its bounds, which is whatever it
 * is behind. Failing even that -- a part the customer hid, so it was never
 * traced -- its bounds themselves.
 */
function hiddenTarget(scene: Scene, part: number): Target | null {
  const { ink, grid } = scene;
  const span = scene.spans[part];
  const bands = scene.bands[part];
  const piece = (i: number) => inPieces(span, bands, i % grid.w, (i / grid.w) | 0);
  return (
    targetFrom(scene, part, span, (i) => ink[i] === 1 && piece(i), true) ??
    targetFrom(scene, part, span, piece, true)
  );
}

// --------------------------------------------------------------- placement

type Placed = { target: Target; ax: number; ay: number; bx: number; by: number; cost: number };

function segmentsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return (
    orient(ax, ay, bx, by, cx, cy) * orient(ax, ay, bx, by, dx, dy) < 0 &&
    orient(cx, cy, dx, dy, ax, ay) * orient(cx, cy, dx, dy, bx, by) < 0
  );
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Where a leader from the anchor meets the balloon's rim. */
function rimPoint(ax: number, ay: number, bx: number, by: number, radius: number): [number, number] {
  const length = Math.hypot(bx - ax, by - ay) || 1;
  return [bx - ((bx - ax) / length) * radius, by - ((by - ay) / length) * radius];
}

/**
 * A spot a balloon could go. `base` (leader length, plus the penalty for
 * sitting inside the drawing's frame) is known up front; `cost` adds what
 * the leader crosses on its way, and is only worked out if the spot is ever
 * a contender. Neither depends on the other balloons.
 */
type Spot = { ax: number; ay: number; bx: number; by: number; base: number; cost?: number };

/**
 * Every position a balloon for this target could take, cheapest first by
 * `base`.
 *
 * Built once per part and reused every time the balloon is re-seated, so
 * seating one walks this list and stops at the first spot no later one can
 * beat, instead of re-scoring the whole panel every time a neighbour moves.
 *
 * `strict` false drops the clear-space requirement, for the rare view too
 * crowded to honour it -- a balloon on the drawing is still better than a
 * part with no number at all.
 */
function spotsFor(target: Target, radius: number, strict: boolean): Spot[] {
  const cached = strict ? target.strictSpots : target.looseSpots;
  if (cached) return cached;

  const { grid, clearance, frame } = target.scene;
  const needClear = (radius + BALLOON_CLEARANCE) / CELL;
  const inset = Math.ceil((radius + 4) / CELL);
  const titleRows = Math.ceil(30 / CELL);
  const { landing, edgeCols, edgeRows } = target;
  const c = frame.content;
  const spots: Spot[] = [];

  for (let row = titleRows + inset; row < grid.h - inset; row += CANDIDATE_STEP) {
    for (let col = inset; col < grid.w - inset; col += CANDIDATE_STEP) {
      const i = row * grid.w + col;
      if (strict && clearance[i] < needClear) continue;
      // A spot on the part itself has nowhere to lead from.
      if (landing[i]) continue;
      // The leader runs to the NEAREST point of the landing zone, not to one
      // fixed point that may be on the far side of the part.
      let nearest = -1;
      let nearestSq = Infinity;
      for (let e = 0; e < edgeCols.length; e++) {
        const dc = edgeCols[e] - col;
        const dr = edgeRows[e] - row;
        const sq = dc * dc + dr * dr;
        if (sq < nearestSq) {
          nearestSq = sq;
          nearest = e;
        }
      }
      if (nearest < 0) continue;
      const bx = grid.x0 + (col + 0.5) * CELL;
      const by = grid.y0 + (row + 0.5) * CELL;
      const ax = grid.x0 + (edgeCols[nearest] + 0.5) * CELL;
      const ay = grid.y0 + (edgeRows[nearest] + 0.5) * CELL;
      const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (length < radius + MIN_LEADER) continue;
      const inside = bx > c.x1 && bx < c.x2 && by > c.y1 && by < c.y2;
      spots.push({ ax, ay, bx, by, base: length + (inside ? COST_INSIDE_CONTENT : 0) });
    }
  }

  spots.sort((a, b) => a.base - b.base);
  if (strict) target.strictSpots = spots;
  else target.looseSpots = spots;
  return spots;
}

/**
 * The spot's cost including what its leader crosses: walking the visible part
 * of the leader, anchor to rim, and charging for every cell of someone else's
 * part or of an annotation on the way.
 */
function spotCost(target: Target, spot: Spot, radius: number): number {
  if (spot.cost !== undefined) return spot.cost;
  const { grid, ink, owner, keepOut } = target.scene;
  const { ax, ay, bx, by } = spot;
  const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  const ex = bx - ((bx - ax) / length) * radius;
  const ey = by - ((by - ay) / length) * radius;
  const steps = Math.ceil((length - radius) / CELL);
  let cost = spot.base;
  let lastCell = -1;
  for (let s = 1; s <= steps; s++) {
    const cc = Math.floor((ax + ((ex - ax) * s) / steps - grid.x0) / CELL);
    const rr = Math.floor((ay + ((ey - ay) * s) / steps - grid.y0) / CELL);
    if (cc < 0 || rr < 0 || cc >= grid.w || rr >= grid.h) continue;
    const k = rr * grid.w + cc;
    if (k === lastCell) continue;
    lastCell = k;
    if (ink[k] && owner[k] !== target.part) cost += COST_FOREIGN_INK * CELL;
    else if (keepOut[k]) cost += COST_ANNOTATION * CELL;
  }
  spot.cost = cost;
  return cost;
}

/** Best balloon position for one target given the balloons already down, or null when nothing fits. */
function placeOne(target: Target, others: Placed[], radius: number, strict: boolean): Placed | null {
  let best: Placed | null = null;
  const minApart = radius * 2 + BALLOON_GAP;
  for (const spot of spotsFor(target, radius, strict)) {
    // Sorted by a lower bound on cost, and everything else only adds to it:
    // once the bound passes the best found, nothing further on can win.
    if (best && spot.base >= best.cost) break;
    const { ax, ay, bx, by } = spot;
    let blocked = false;
    let cost = 0;
    for (const o of others) {
      if (Math.abs(o.bx - bx) < minApart && Math.abs(o.by - by) < minApart && Math.hypot(o.bx - bx, o.by - by) < minApart) {
        blocked = true;
        break;
      }
      if (pointToSegment(o.bx, o.by, ax, ay, bx, by) < radius + 2) { blocked = true; break; }
      if (pointToSegment(bx, by, o.ax, o.ay, o.bx, o.by) < radius + 2) { blocked = true; break; }
      if (segmentsCross(ax, ay, bx, by, o.ax, o.ay, o.bx, o.by)) cost += COST_CROSSING;
    }
    if (blocked) continue;
    cost += spotCost(target, spot, radius);
    if (!best || cost < best.cost) best = { target, ax, ay, bx, by, cost };
  }
  return best;
}

function placeView(targets: Target[], radius: number): Placed[] {
  const placed: Placed[] = [];
  const put = (target: Target, others: Placed[]): Placed => {
    const found = placeOne(target, others, radius, true) ?? placeOne(target, others, radius, false);
    if (found) return found;
    // Nowhere at all -- a view so full nothing fits. Sit the balloon on its
    // part, which is what the drawing always did, rather than drop the number.
    const { grid } = target.scene;
    const landing = Math.max(0, target.landing.indexOf(1));
    const x = cellX(grid, landing % grid.w);
    const y = cellY(grid, Math.floor(landing / grid.w));
    return { target, ax: x, ay: y, bx: x, by: y, cost: Infinity };
  };

  // Hardest first: a part with little visible area has few good spots, so it
  // chooses before a big panel that could go almost anywhere.
  const order = [...targets].sort((a, b) => a.area - b.area || a.part - b.part);
  for (const target of order) placed.push(put(target, placed));

  // Greedy placement locks in whatever went first. A few rounds of lifting
  // each balloon and re-seating it against all the others untangles the
  // crossings that ordering created.
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (let index = 0; index < placed.length; index++) {
      const again = put(placed[index].target, placed.filter((_, j) => j !== index));
      if (again.cost + 0.5 < placed[index].cost) {
        placed[index] = again;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return placed;
}

// --------------------------------------------------------------------- api

/**
 * Which view each part is ballooned in. Clarity first -- a region at least
 * CLEAR_ENOUGH deep reads as well in one view as another -- then whichever
 * view has fewer balloons so far, then whichever shows more of the part.
 */
function chooseView(options: Array<Target | null>, assigned: Target[][]): number {
  let best = -1;
  for (let v = 0; v < options.length; v++) {
    const target = options[v];
    if (!target) continue;
    if (best === -1) {
      best = v;
      continue;
    }
    const current = options[best]!;
    const clarity = Math.min(target.depth, CLEAR_ENOUGH);
    const bestClarity = Math.min(current.depth, CLEAR_ENOUGH);
    if (clarity > bestClarity + 0.01) {
      best = v;
    } else if (Math.abs(clarity - bestClarity) <= 0.01) {
      const crowd = assigned[v].length;
      const bestCrowd = assigned[best].length;
      if (crowd < bestCrowd || (crowd === bestCrowd && target.area > current.area)) best = v;
    }
  }
  return best;
}

export function planCallouts(parts: PartMeasurement[], frames: CalloutFrame[], radius: number): Callout[] {
  if (parts.length === 0 || frames.length === 0) return [];
  const scenes = frames.map((frame) => buildScene(parts, frame));

  const assigned: Target[][] = scenes.map(() => []);
  const visible = parts.map((_, p) => scenes.map((scene) => visibleTarget(scene, p)));

  // Parts seen in fewest views choose first, so a part only the plan shows
  // is not crowded out of it by parts that had other options.
  const order = parts
    .map((_, p) => p)
    .sort((a, b) => visible[a].filter(Boolean).length - visible[b].filter(Boolean).length || a - b);

  for (const p of order) {
    let view = chooseView(visible[p], assigned);
    let target = view >= 0 ? visible[p][view] : null;

    if (!target) {
      // Built but not seen: balloon it where the most of it would show, with
      // a dashed leader.
      for (let v = 0; v < scenes.length; v++) {
        const hidden = hiddenTarget(scenes[v], p);
        if (hidden && (!target || hidden.area > target.area)) {
          target = hidden;
          view = v;
        }
      }
    }
    if (target && view >= 0) assigned[view].push(target);
  }

  return scenes.flatMap((scene, v) =>
    placeView(assigned[v], radius).map((placed) => ({
      n: placed.target.part + 1,
      view: scene.frame.key,
      anchor: { x: placed.ax, y: placed.ay },
      balloon: { x: placed.bx, y: placed.by },
      hidden: placed.target.hidden,
    }))
  );
}

export function renderCallouts(callouts: Callout[], view: ViewKey, radius: number): string {
  return callouts
    .filter((c) => c.view === view)
    .sort((a, b) => a.n - b.n)
    .map((c) => {
      const { x: ax, y: ay } = c.anchor;
      const { x: bx, y: by } = c.balloon;
      const onPart = Math.hypot(bx - ax, by - ay) <= radius;
      const [ex, ey] = rimPoint(ax, ay, bx, by, radius);
      const leader = onPart
        ? ""
        : `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" class="${c.hidden ? "callout-lead callout-lead-hidden" : "callout-lead"}"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.8" class="callout-dot"/>`;
      const label = String(c.n);
      const text = `<text x="${bx.toFixed(1)}" y="${(by + 3.5).toFixed(1)}" class="callout-text" text-anchor="middle"${label.length > 1 ? ' style="font-size:8.5px"' : ""}>${label}</text>`;
      return `${leader}<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${radius}" class="callout"/>${text}`;
    })
    .join("");
}
