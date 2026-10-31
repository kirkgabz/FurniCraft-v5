import type { PartId } from "./studio-config";
import {
  DEFAULT_SURFACE_HEIGHT_LABEL,
  NO_SURFACE_HEIGHT_LABEL,
  type ChairMeasurement,
  type PartMeasurement,
} from "./studio-dimensions";
import type { StudioDesignItem } from "./studio-design-state";
import type { Silhouettes, ViewKey } from "./studio-silhouette";
import { planCallouts, renderCallouts, type Callout, type CalloutFrame, type Rect } from "./studio-blueprint-callouts";
import {
  DEFAULT_LENGTH_UNIT,
  formatLength,
  formatLengthValue,
  formatLengthWithAlternate,
  lengthUnitLabel,
  lengthUnitName,
  type LengthUnit,
} from "../length-units";

/**
 * Generates a dimensioned shop drawing for a studio design as a standalone SVG
 * string.
 *
 * Where the design carries traced silhouettes (see studio-silhouette.ts) the
 * views are drawn from those outlines, so the sheet shows the chair as it
 * actually is -- four separate legs, the open void inside the balloon back, the
 * carved detail on the front legs. Older designs saved before outlines existed
 * fall back to drawing each component's envelope, which is coarse but never
 * wrong about position or size.
 *
 * Either way the drawing is a pure function of saved order data, so a shop can
 * open it without loading the 3D model.
 */

const MARGIN = 20;
const HEADER_H = 70;
const PANEL_W = 440;
const PANEL_H = 360;
const GAP = 18;
const TITLE_H = 246;

const PAD_L = 64;
const PAD_R = 40;
const PAD_T = 34;
const PAD_B = 54;

const PAGE_W = MARGIN * 2 + PANEL_W * 2 + GAP;
const ROW1_Y = MARGIN + HEADER_H;
const ROW2_Y = ROW1_Y + PANEL_H + GAP;
const TITLE_Y = ROW2_Y + PANEL_H + GAP;
/** The human-scale panel: the piece beside a person, under the title block. */
const HUMAN_PANEL_H = 260;
const HUMAN_Y = TITLE_Y + TITLE_H + GAP;
const PAGE_H = HUMAN_Y + HUMAN_PANEL_H + MARGIN;

const DRAW_W = PANEL_W - PAD_L - PAD_R;
const DRAW_H = PANEL_H - PAD_T - PAD_B;

/** Drawn with the blueprint's soft-goods hatch rather than its timber one. */
const CLOTH_PARTS: PartId[] = ["seatCushion", "backCushion", "mattress", "headboardPanel", "bedding", "pillows"];


/**
 * Radius of the numbered callout bubbles drawn on each view.
 *
 * They are the thing that turns three outlines and a table into a drawing you
 * can build from: without them the schedule says a 73.6cm post exists and the
 * elevation shows four uprights, and matching one to the other is the
 * reader's problem. Every real shop drawing keys its views to its schedule
 * this way. Where they go is worked out in studio-blueprint-callouts.ts.
 */
const CALLOUT_R = 9;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The person the human-scale panel draws, and every height is compared to.
 * 5′7″ is 67 inches exactly; the figure is the average-height adult the shop
 * and the customer can both picture.
 */
export const HUMAN_HEIGHT_CM = 67 * 2.54;
const HUMAN_LABEL = "5′7″";

/**
 * Where on a standing adult a height falls, as a fraction of their stature.
 *
 * Standard anthropometric proportions (knee about 0.285 of stature, hip joint
 * about 0.53, waist about 0.6, shoulder about 0.82), which hold closely enough
 * across adults that "hip height" means the same thing to every reader.
 */
const BODY_LANDMARKS: Array<[string, number]> = [
  ["ankle height", 0.04],
  ["mid-shin height", 0.16],
  ["knee height", 0.285],
  ["mid-thigh height", 0.39],
  ["upper-thigh height", 0.47],
  ["hip height", 0.53],
  ["waist height", 0.6],
  ["elbow height", 0.63],
  ["lower-chest height", 0.7],
  ["chest height", 0.75],
  ["shoulder height", 0.82],
  ["chin height", 0.87],
  ["eye level", 0.93],
  ["head height", 1],
];

/** "about hip height on a 5′7″ person", or how far it stands above one. */
export function bodyLandmark(cm: number, personCm = HUMAN_HEIGHT_CM): string {
  const fraction = cm / personCm;
  if (fraction > 1.03) return `${formatLength(cm - personCm, sheetUnit)} taller than a ${HUMAN_LABEL} person`;
  let best = BODY_LANDMARKS[0];
  for (const landmark of BODY_LANDMARKS) {
    if (Math.abs(landmark[1] - fraction) < Math.abs(best[1] - fraction)) best = landmark;
  }
  return `about ${best[0]} on a ${HUMAN_LABEL} person`;
}

/**
 * The unit a sheet is printed in, chosen by whoever is reading it.
 *
 * Module state rather than a parameter threaded through every helper below,
 * because nearly all of them print a length and the sheet is generated in one
 * synchronous pass: `generateStudioBlueprintSvg` sets it on entry and every
 * helper it calls reads it. Nothing is awaited in between, so two sheets in
 * different units can never interleave.
 */
let sheetUnit: LengthUnit = DEFAULT_LENGTH_UNIT;

/** A length in the sheet's unit, with its unit: "90 cm", "35.43 in", "2′ 11⅜″". */
function len(cm: number): string {
  return formatLength(cm, sheetUnit);
}

/** The bare number, for the schedule, whose headings carry the unit. */
function lenValue(cm: number): string {
  return formatLengthValue(cm, sheetUnit);
}

/** "90 cm (2′ 11⅜″)": the chosen unit first, a familiar second reading after. */
function lenBoth(cm: number): string {
  return formatLengthWithAlternate(cm, sheetUnit);
}

type Axis = "x" | "y" | "z";

type ViewSpec = {
  key: ViewKey;
  title: string;
  hAxis: Axis;
  vAxis: Axis;
  /** Vertical axis is height (grows up the page) rather than depth (grows down). */
  vIsHeight: boolean;
  /** The axis pointing out of the page at the reader: what is in front of what. */
  depthAxis: Axis;
};

const VIEWS: ViewSpec[] = [
  { key: "front", title: "FRONT ELEVATION", hAxis: "x", vAxis: "y", vIsHeight: true, depthAxis: "z" },
  { key: "side", title: "SIDE ELEVATION", hAxis: "z", vAxis: "y", vIsHeight: true, depthAxis: "x" },
  { key: "top", title: "PLAN (TOP)", hAxis: "x", vAxis: "z", vIsHeight: false, depthAxis: "y" },
];

type Extent = { hMin: number; hMax: number; vMin: number; vMax: number };

function extentFromParts(parts: PartMeasurement[], view: ViewSpec): Extent {
  let hMin = Infinity, hMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const part of parts) {
    hMin = Math.min(hMin, part.min[view.hAxis]);
    hMax = Math.max(hMax, part.max[view.hAxis]);
    vMin = Math.min(vMin, part.min[view.vAxis]);
    vMax = Math.max(vMax, part.max[view.vAxis]);
  }
  return { hMin, hMax, vMin, vMax };
}

function arrowDefs(): string {
  return `
  <defs>
    <marker id="sbArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f3d5c"/>
    </marker>
    <pattern id="sbCloth" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="6" stroke="#5c7fa3" stroke-width="1.4"/>
    </pattern>
    <pattern id="sbGrid" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#dbe6f0" stroke-width="1"/>
    </pattern>
  </defs>`;
}

function styles(): string {
  return `
  <style>
    .sheet { fill: #ffffff; }
    .panel { fill: #ffffff; stroke: #1f3d5c; stroke-width: 1.4; }
    .panel-title { font: 700 12px 'Segoe UI', system-ui, sans-serif; fill: #1f3d5c; letter-spacing: 1.1px; }
    .part-wood { fill: #e8d9c3; stroke: #6b4a2a; stroke-width: 1.1; }
    .part-cloth { fill: url(#sbCloth); stroke: #3d5f80; stroke-width: 1.1; }
    .dim-line { stroke: #1f3d5c; stroke-width: 1; }
    .ext-line { stroke: #1f3d5c; stroke-width: 0.7; stroke-dasharray: 3 2; }
    .dim-text { font: 600 11px 'Segoe UI', system-ui, sans-serif; fill: #1f3d5c; }
    .dim-label-bg { fill: #ffffff; }
    .head-title { font: 700 22px 'Segoe UI', system-ui, sans-serif; fill: #14293d; }
    .head-sub { font: 400 12px 'Segoe UI', system-ui, sans-serif; fill: #5b7590; }
    .tb-key { font: 600 10.5px 'Segoe UI', system-ui, sans-serif; fill: #5b7590; letter-spacing: 0.8px; }
    .tb-val { font: 700 13px 'Segoe UI', system-ui, sans-serif; fill: #14293d; }
    .tb-note { font: 400 10.5px 'Segoe UI', system-ui, sans-serif; fill: #5b7590; }
    .row-head { font: 700 10.5px 'Segoe UI', system-ui, sans-serif; fill: #5b7590; letter-spacing: 0.8px; }
    .row-cell { font: 400 11.5px 'Segoe UI', system-ui, sans-serif; fill: #14293d; }
    .row-line { stroke: #dbe6f0; stroke-width: 1; }
    .callout { fill: #ffffff; stroke: #1f3d5c; stroke-width: 1.2; }
    .callout-text { font: 700 10px 'Segoe UI', system-ui, sans-serif; fill: #1f3d5c; }
    .callout-lead { stroke: #1f3d5c; stroke-width: 0.8; }
    .callout-lead-hidden { stroke-dasharray: 3 2; }
    .callout-dot { fill: #1f3d5c; }
    .legend-text { font: 400 10.5px 'Segoe UI', system-ui, sans-serif; fill: #14293d; }
    .scale-bar-dark { fill: #1f3d5c; stroke: #1f3d5c; stroke-width: 0.8; }
    .scale-bar-light { fill: #ffffff; stroke: #1f3d5c; stroke-width: 0.8; }
    .human { fill: #cfdbe7; stroke: #5b7590; stroke-width: 1; }
    .ground { stroke: #1f3d5c; stroke-width: 1.2; }
  </style>`;
}

/**
 * Every dimension below reports the space it occupies into `keepOut`, so a
 * callout balloon is never set down on a dimension line or across its label.
 */
function lineBox(x1: number, y1: number, x2: number, y2: number, pad = 1.5): Rect {
  return { x1: Math.min(x1, x2) - pad, y1: Math.min(y1, y2) - pad, x2: Math.max(x1, x2) + pad, y2: Math.max(y1, y2) + pad };
}

function dimH(x1: number, x2: number, y: number, label: string, extY: number, keepOut: Rect[]): string {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  const mid = (lo + hi) / 2;
  const w = Math.max(30, label.length * 6.4 + 10);
  keepOut.push(
    lineBox(lo, extY, lo, y),
    lineBox(hi, extY, hi, y),
    lineBox(lo, y, hi, y, 4),
    { x1: mid - w / 2, y1: y - 8, x2: mid + w / 2, y2: y + 7 }
  );
  return `
    <line x1="${lo}" y1="${extY}" x2="${lo}" y2="${y}" class="ext-line"/>
    <line x1="${hi}" y1="${extY}" x2="${hi}" y2="${y}" class="ext-line"/>
    <line x1="${lo}" y1="${y}" x2="${hi}" y2="${y}" class="dim-line" marker-start="url(#sbArrow)" marker-end="url(#sbArrow)"/>
    <rect x="${mid - w / 2}" y="${y - 8}" width="${w}" height="15" class="dim-label-bg"/>
    <text x="${mid}" y="${y + 4}" class="dim-text" text-anchor="middle">${esc(label)}</text>`;
}

/**
 * A vertical dimension. Its label sits to the left of the line by default --
 * right for the overall height, which has the panel's left margin to itself.
 * `aligned` instead writes the label along the line, reading bottom to top,
 * the way a drafter lettering an aligned dimension does: the surface-height
 * dimension stands just right of the drawing, and a label beside it there
 * was printed straight over the piece ("Table 74.5" across the leg).
 */
function dimV(
  y1: number,
  y2: number,
  x: number,
  label: string,
  extX: number,
  keepOut: Rect[],
  aligned = false
): string {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  const mid = (lo + hi) / 2;
  const w = Math.max(30, label.length * 6.4 + 10);
  keepOut.push(lineBox(extX, lo, x, lo), lineBox(extX, hi, x, hi), lineBox(x, lo, x, hi, 4));
  const lines = `
    <line x1="${extX}" y1="${lo}" x2="${x}" y2="${lo}" class="ext-line"/>
    <line x1="${extX}" y1="${hi}" x2="${x}" y2="${hi}" class="ext-line"/>
    <line x1="${x}" y1="${lo}" x2="${x}" y2="${hi}" class="dim-line" marker-start="url(#sbArrow)" marker-end="url(#sbArrow)"/>`;
  if (aligned) {
    keepOut.push({ x1: x - 8, y1: mid - w / 2, x2: x + 8, y2: mid + w / 2 });
    return `${lines}
    <rect x="${x - 7.5}" y="${mid - w / 2}" width="15" height="${w}" class="dim-label-bg"/>
    <text x="${x}" y="${mid + 4}" class="dim-text" text-anchor="middle" transform="rotate(-90 ${x} ${mid})">${esc(label)}</text>`;
  }
  keepOut.push({ x1: x - w - 6, y1: mid - 7.5, x2: x - 6, y2: mid + 7.5 });
  return `${lines}
    <rect x="${x - w - 6}" y="${mid - 7.5}" width="${w}" height="15" class="dim-label-bg"/>
    <text x="${x - 6 - w / 2}" y="${mid + 4}" class="dim-text" text-anchor="middle">${esc(label)}</text>`;
}

/** Where one view sits on the sheet, and how model centimetres map onto it. */
type ViewLayout = {
  view: ViewSpec;
  extent: Extent;
  originX: number;
  originY: number;
  scale: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  toX: (value: number) => number;
  toY: (value: number) => number;
};

function layoutView(view: ViewSpec, extent: Extent, originX: number, originY: number, scale: number): ViewLayout {
  const contentW = (extent.hMax - extent.hMin) * scale;
  const contentH = (extent.vMax - extent.vMin) * scale;
  const left = originX + PAD_L + (DRAW_W - contentW) / 2;
  const top = originY + PAD_T + (DRAW_H - contentH) / 2;
  const bottom = top + contentH;
  const right = left + contentW;

  const toX = (value: number) => left + (value - extent.hMin) * scale;
  const toY = (value: number) =>
    view.vIsHeight ? bottom - (value - extent.vMin) * scale : top + (value - extent.vMin) * scale;

  return { view, extent, originX, originY, scale, left, top, right, bottom, toX, toY };
}

/** The view's traced outline, when it has one worth drawing. */
function outlineOf(view: ViewSpec, silhouettes: Silhouettes | undefined) {
  const outlines = silhouettes?.cm?.[view.key];
  return outlines && (outlines.wood || outlines.cloth) ? outlines : null;
}

function renderBody(layout: ViewLayout, parts: PartMeasurement[], silhouettes: Silhouettes | undefined): string {
  const { view, extent, scale, left, top, bottom, toX, toY } = layout;
  const outlines = outlineOf(view, silhouettes);

  if (outlines) {
    // Paths are authored in centimetre model space; one transform maps the whole
    // view, and non-scaling strokes keep line weights constant regardless of scale.
    const transform = view.vIsHeight
      ? `translate(${(left - extent.hMin * scale).toFixed(3)} ${(bottom + extent.vMin * scale).toFixed(3)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})`
      : `translate(${(left - extent.hMin * scale).toFixed(3)} ${(top - extent.vMin * scale).toFixed(3)}) scale(${scale.toFixed(5)} ${scale.toFixed(5)})`;

    const layer = (d: string, cls: string) =>
      d ? `<path d="${d}" class="${cls}" fill-rule="evenodd" vector-effect="non-scaling-stroke"/>` : "";

    return `<g transform="${transform}">${layer(outlines.wood, "part-wood")}${layer(outlines.cloth, "part-cloth")}</g>`;
  }

  // Fallback: component envelopes, largest first so small detail stays visible.
  const ordered = [...parts].sort(
    (a, b) =>
      (b.max[view.hAxis] - b.min[view.hAxis]) * (b.max[view.vAxis] - b.min[view.vAxis]) -
      (a.max[view.hAxis] - a.min[view.hAxis]) * (a.max[view.vAxis] - a.min[view.vAxis])
  );
  return ordered
    .map((part) => {
      const x1 = toX(part.min[view.hAxis]);
      const x2 = toX(part.max[view.hAxis]);
      const y1 = toY(part.min[view.vAxis]);
      const y2 = toY(part.max[view.vAxis]);
      const cls = CLOTH_PARTS.includes(part.id) ? "part-cloth" : "part-wood";
      return `<rect x="${Math.min(x1, x2).toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${Math.max(Math.abs(x2 - x1), 1).toFixed(1)}" height="${Math.max(Math.abs(y2 - y1), 1).toFixed(1)}" class="${cls}"><title>${esc(part.label)}</title></rect>`;
    })
    .join("");
}

/** The view's dimensions, plus the space they take up for the callouts to avoid. */
/**
 * The overall size along one axis, exactly as the studio measured it.
 *
 * The dimension labels are read from here, never from the traced outline's
 * bounds. The outline is a drawing of the piece and the measurement is the
 * piece's size; they agree to within a rounding, but "agree to within" is not
 * the promise. The studio's Overall readout, the order and this sheet all print
 * `measurement.overall`, so the three can never show different numbers.
 */
function overallAlong(measurement: ChairMeasurement, axis: Axis): number {
  return axis === "x" ? measurement.overall.w : axis === "y" ? measurement.overall.h : measurement.overall.d;
}

function renderDimensions(layout: ViewLayout, measurement: ChairMeasurement): { svg: string; keepOut: Rect[] } {
  const { view, originX, originY, left, top, right, bottom, toX, toY } = layout;
  const keepOut: Rect[] = [];
  const dimY = originY + PANEL_H - 26;
  const dimX = originX + PAD_L - 16;

  // Placed at the measured extent rather than the outline's, so the arrows
  // span exactly the length their label states.
  const measured = extentFromParts(measurement.parts, view);
  const hasMeasured = Number.isFinite(measured.hMin) && Number.isFinite(measured.vMin);
  const hLo = hasMeasured ? toX(measured.hMin) : left;
  const hHi = hasMeasured ? toX(measured.hMax) : right;
  const vLo = hasMeasured ? toY(measured.vMin) : view.vIsHeight ? bottom : top;
  const vHi = hasMeasured ? toY(measured.vMax) : view.vIsHeight ? top : bottom;
  const vTop = Math.min(vLo, vHi);
  const vBottom = Math.max(vLo, vHi);

  let svg = `
    ${dimH(hLo, hHi, dimY, len(overallAlong(measurement, view.hAxis)), vBottom, keepOut)}
    ${dimV(vTop, vBottom, dimX, len(overallAlong(measurement, view.vAxis)), Math.min(hLo, hHi), keepOut)}`;

  if (view.vIsHeight && measurement.seatHeight > 0) {
    const seatY = toY(measurement.seatHeight);
    // "Mattress height" will not fit beside the elevation, so the dimension
    // carries just the noun -- "Mattress 51.8" -- and the title block spells
    // out which height it is.
    const short = (measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL).replace(/\s*height$/i, "");
    keepOut.push(lineBox(left, seatY, right + 12, seatY));
    svg += `
      <line x1="${left}" y1="${seatY.toFixed(1)}" x2="${(right + 12).toFixed(1)}" y2="${seatY.toFixed(1)}" class="ext-line"/>
      ${dimV(vBottom, seatY, right + 34, `${short} ${len(measurement.seatHeight)}`, right + 12, keepOut, true)}`;
  }

  return { svg, keepOut };
}

function renderView(layout: ViewLayout, body: string, dimensions: string, callouts: string): string {
  const { view, originX, originY } = layout;
  // Callouts go last so a balloon is never painted under a dimension line.
  return `
  <g>
    <rect x="${originX}" y="${originY}" width="${PANEL_W}" height="${PANEL_H}" class="panel"/>
    <rect x="${originX + 1}" y="${originY + 1}" width="${PANEL_W - 2}" height="${PANEL_H - 2}" fill="url(#sbGrid)" opacity="0.55"/>
    <text x="${originX + 14}" y="${originY + 22}" class="panel-title">${esc(view.title)}</text>
    ${body}
    ${dimensions}
    ${callouts}
  </g>`;
}

/**
 * How many pieces the piece is made of, for the title block. A part that
 * resolved into components counts its actual quantity -- four legs are four
 * -- while one that did not counts as the single line it prints. Before
 * components existed this was just the number of parts, which under-counted
 * every set of legs the studio has ever drawn.
 */
/**
 * A graphic scale bar, rather than a "1:10" ratio.
 *
 * An SVG has no guaranteed physical size -- it is printed, scaled to a phone,
 * or pasted into a chat at whatever width fits -- so a printed ratio is a
 * claim the sheet cannot keep. A bar drawn in the same units as the views is
 * true at any size, because it is rescaled by exactly whatever rescales the
 * drawing. Divided into alternating light and dark cells the way a surveyor's
 * bar is, so a length can be stepped off by eye.
 */
function renderScaleBar(scale: number, x: number, y: number): string {
  // A round step in the sheet's own unit whose bar lands in a drawable range:
  // 10 cm or 100 mm on a metric sheet, 6 or 12 inches on an imperial one, so
  // the bar's ticks are numbers a reader would step off with a tape.
  const imperial = sheetUnit === "in" || sheetUnit === "ft";
  const choices = imperial ? [1, 2, 3, 6, 12, 24, 36, 48].map((inch) => inch * 2.54) : [5, 10, 20, 25, 50, 100];
  const step = choices.find((cm) => cm * scale >= 26) ?? choices[choices.length - 1];
  const cells = 4;
  const cellW = step * scale;

  const bars = Array.from({ length: cells }, (_, i) => {
    const cls = i % 2 === 0 ? "scale-bar-dark" : "scale-bar-light";
    return `<rect x="${(x + i * cellW).toFixed(1)}" y="${y}" width="${cellW.toFixed(1)}" height="7" class="${cls}"/>`;
  }).join("");

  const ticks = Array.from({ length: cells + 1 }, (_, i) => {
    if (i !== 0 && i !== cells / 2 && i !== cells) return "";
    return `<text x="${(x + i * cellW).toFixed(1)}" y="${y + 20}" class="legend-text" text-anchor="middle">${esc(
      i === 0 ? "0" : lenValue(i * step)
    )}</text>`;
  }).join("");

  return `
    <text x="${x}" y="${y - 8}" class="tb-key">${esc(`SCALE (${lengthUnitLabel(sheetUnit).toUpperCase()}) · TRUE AT ANY PRINT SIZE`)}</text>
    ${bars}
    ${ticks}`;
}

/**
 * A standing adult, front on, in centimetres with the feet at y=0.
 *
 * Written as fractions of stature from the same proportions as
 * BODY_LANDMARKS, so the hip on the drawing is at the height the label calls
 * hip height. Deliberately a plain figure: it is a ruler, not an illustration.
 */
function humanPath(heightCm: number): string {
  const side = (points: Array<[number, number]>) => points.map(([x, y]) => [x * heightCm, y * heightCm] as [number, number]);
  const mirror = (points: Array<[number, number]>) => points.map(([x, y]) => [-x, y] as [number, number]);
  const poly = (points: Array<[number, number]>) =>
    `M ${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;

  const torso = side([
    [-0.125, 0.84], [0.125, 0.84], [0.115, 0.75], [0.085, 0.6], [0.1, 0.53],
    [-0.1, 0.53], [-0.085, 0.6], [-0.115, 0.75],
  ]);
  const neck = side([[-0.03, 0.875], [0.03, 0.875], [0.03, 0.84], [-0.03, 0.84]]);
  const arm = side([
    [-0.125, 0.84], [-0.155, 0.8], [-0.16, 0.62], [-0.15, 0.48], [-0.125, 0.48], [-0.13, 0.62], [-0.115, 0.76],
  ]);
  const leg = side([
    [-0.1, 0.53], [-0.006, 0.5], [-0.02, 0.285], [-0.03, 0.05], [-0.02, 0], [-0.085, 0], [-0.075, 0.05], [-0.08, 0.285],
  ]);
  const r = 0.065 * heightCm;
  const cy = (1 - 0.065) * heightCm;
  const head = `M ${(-r).toFixed(2)} ${cy.toFixed(2)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0 a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0 Z`;
  return [head, poly(neck), poly(torso), poly(arm), poly(mirror(arm)), poly(leg), poly(mirror(leg))].join(" ");
}

/**
 * The piece standing beside a 5′7″ person, both at one scale.
 *
 * The views above are scaled to fill their panels, so a stool and a wardrobe
 * come out the same size on the sheet and "90 cm" is just a number. Here the
 * piece is drawn against a body the reader already knows the size of, with
 * its height carried across to the figure -- which is what answers "how tall
 * is that, really?" at a glance. Its own scale, not the views': a person beside
 * a 42 cm stool would not fit the views' scale at all.
 */
function renderHumanScale(
  measurement: ChairMeasurement,
  frontExtent: Extent,
  silhouettes: Silhouettes | undefined,
  parts: PartMeasurement[],
  x: number,
  y: number
): string {
  const width = PAGE_W - MARGIN * 2;
  const o = measurement.overall;
  const pieceH = frontExtent.vMax - frontExtent.vMin;
  const pieceW = frontExtent.hMax - frontExtent.hMin;
  const drawTop = y + 46;
  const ground = y + HUMAN_PANEL_H - 34;
  const personX = x + 90;
  const pieceLeftGap = 70;
  // Tall enough for whichever is taller, and narrow enough that the piece
  // never reaches the text column on the right.
  const s = Math.min((ground - drawTop) / Math.max(HUMAN_HEIGHT_CM, pieceH), 360 / Math.max(pieceW, 1));
  const pieceLeft = personX + 0.16 * HUMAN_HEIGHT_CM * s + pieceLeftGap;
  const pieceRight = pieceLeft + pieceW * s;
  const pieceTop = ground - pieceH * s;
  const personTop = ground - HUMAN_HEIGHT_CM * s;

  const outlines = outlineOf(VIEWS[0], silhouettes);
  const piece = outlines
    ? `<g transform="translate(${(pieceLeft - frontExtent.hMin * s).toFixed(3)} ${(ground + frontExtent.vMin * s).toFixed(3)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})">${
        outlines.wood ? `<path d="${outlines.wood}" class="part-wood" fill-rule="evenodd" vector-effect="non-scaling-stroke"/>` : ""
      }${outlines.cloth ? `<path d="${outlines.cloth}" class="part-cloth" fill-rule="evenodd" vector-effect="non-scaling-stroke"/>` : ""}</g>`
    : parts
        .map((part) => {
          const x1 = pieceLeft + (part.min.x - frontExtent.hMin) * s;
          const x2 = pieceLeft + (part.max.x - frontExtent.hMin) * s;
          const y1 = ground - (part.max.y - frontExtent.vMin) * s;
          const y2 = ground - (part.min.y - frontExtent.vMin) * s;
          const cls = CLOTH_PARTS.includes(part.id) ? "part-cloth" : "part-wood";
          return `<rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(x2 - x1, 1).toFixed(1)}" height="${Math.max(y2 - y1, 1).toFixed(1)}" class="${cls}"/>`;
        })
        .join("");

  const textX = x + width - 330;
  const surface = measurement.seatHeight > 0 ? measurement.seatHeight : 0;
  const surfaceLabel = (measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL).replace(/\s*height$/i, "").toLowerCase();

  return `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="${HUMAN_PANEL_H}" class="panel"/>
    <text x="${x + 14}" y="${y + 22}" class="panel-title">${esc(
      sheetUnit === "ft"
        ? `HUMAN SCALE · BESIDE A ${HUMAN_LABEL} PERSON`
        : `HUMAN SCALE · BESIDE A ${HUMAN_LABEL} (${len(HUMAN_HEIGHT_CM)}) PERSON`
    )}</text>
    <line x1="${x + 20}" y1="${ground}" x2="${textX - 24}" y2="${ground}" class="ground"/>
    <g transform="translate(${personX} ${ground}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})">
      <path d="${humanPath(HUMAN_HEIGHT_CM)}" class="human" vector-effect="non-scaling-stroke"/>
    </g>
    ${piece}
    <line x1="${(personX - 0.2 * HUMAN_HEIGHT_CM * s).toFixed(1)}" y1="${pieceTop.toFixed(1)}" x2="${(pieceRight + 10).toFixed(1)}" y2="${pieceTop.toFixed(1)}" class="ext-line"/>
    <line x1="${(personX - 0.2 * HUMAN_HEIGHT_CM * s).toFixed(1)}" y1="${personTop.toFixed(1)}" x2="${(personX + 0.2 * HUMAN_HEIGHT_CM * s).toFixed(1)}" y2="${personTop.toFixed(1)}" class="ext-line"/>
    <text x="${personX}" y="${ground + 18}" class="legend-text" text-anchor="middle">${HUMAN_LABEL} person</text>
    <text x="${((pieceLeft + pieceRight) / 2).toFixed(1)}" y="${ground + 18}" class="legend-text" text-anchor="middle">This piece</text>

    <text x="${textX}" y="${y + 58}" class="tb-key">OVERALL HEIGHT</text>
    <text x="${textX}" y="${y + 78}" class="tb-val">${esc(lenBoth(o.h))}</text>
    <text x="${textX}" y="${y + 96}" class="tb-note">${esc(bodyLandmark(o.h))}</text>
    ${
      surface > 0
        ? `<text x="${textX}" y="${y + 126}" class="tb-key">${esc((measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL).toUpperCase())}</text>
    <text x="${textX}" y="${y + 146}" class="tb-val">${esc(lenBoth(surface))}</text>
    <text x="${textX}" y="${y + 164}" class="tb-note">${esc(
      bodyLandmark(surface).startsWith("about")
        ? `the ${surfaceLabel} is at ${bodyLandmark(surface)}`
        : `the ${surfaceLabel} is ${bodyLandmark(surface)}`
    )}</text>`
        : ""
    }
    <text x="${textX}" y="${y + 194}" class="tb-key">WIDTH × DEPTH</text>
    <text x="${textX}" y="${y + 214}" class="tb-val">${esc(`${len(o.w)} × ${len(o.d)}`)}</text>
    <text x="${textX}" y="${y + 232}" class="tb-note">${esc(
      sheetUnit === "in" || sheetUnit === "ft"
        ? `${formatLength(o.w, "cm")} × ${formatLength(o.d, "cm")}`
        : `${formatLength(o.w, "ft")} × ${formatLength(o.d, "ft")}`
    )}</text>
  </g>`;
}

/**
 * What the two hatches and the numbered bubbles mean. The dashed-leader entry
 * appears only on a sheet that has one, so a reader is never told about a
 * convention the drawing does not use.
 */
function renderLegend(x: number, y: number, hasHidden: boolean): string {
  const hidden = hasHidden
    ? `
    <line x1="${x + 330}" y1="${y + 32}" x2="${x + 356}" y2="${y + 32}" class="callout-lead callout-lead-hidden"/>
    <circle cx="${x + 330}" cy="${y + 32}" r="1.8" class="callout-dot"/>
    <text x="${x + 364}" y="${y + 36}" class="legend-text">Part hidden behind others</text>`
    : "";
  return `
    <text x="${x}" y="${y - 8}" class="tb-key">LEGEND</text>
    <rect x="${x}" y="${y}" width="22" height="12" class="part-wood"/>
    <text x="${x + 30}" y="${y + 10}" class="legend-text">Timber</text>
    <rect x="${x + 84}" y="${y}" width="22" height="12" class="part-cloth"/>
    <text x="${x + 114}" y="${y + 10}" class="legend-text">Upholstery / soft goods</text>
    <circle cx="${x + 8}" cy="${y + 32}" r="${CALLOUT_R}" class="callout"/>
    <text x="${x + 8}" y="${y + 35.5}" class="callout-text" text-anchor="middle">1</text>
    <text x="${x + 30}" y="${y + 36}" class="legend-text">Part number, keyed to the schedule's # column</text>${hidden}`;
}

/**
 * Schedule column positions, px from the panel's left edge. Numbers are
 * right-aligned to their column's end so a 197.7 and a 5 line up on the
 * decimal side and can never reach into the column after them; the two text
 * columns carry a width they are held to.
 */
/**
 * Every size heading carries its unit -- "W (mm)", "H (in)" -- so a shop reading
 * one column in isolation, or a photocopy of half the sheet, still knows what
 * the number is. The size columns are as wide as the unit's longest value
 * needs: feet-and-inches ("5′ 11⅜″") takes more room than "180.3", and the
 * finish column gives up the difference.
 */
function scheduleColumns(unit: LengthUnit) {
  const wide = unit === "ft";
  const size = wide ? 58 : 48;
  const d = 424;
  const h = d - size;
  const w = h - size;
  // QTY ends a full size-column clear of W, so a count can never run into the
  // size beside it -- "1" next to "2′ 11⅜″" printed as "12′ 11⅜″" otherwise.
  const qty = w - size - 2;
  const labelMax = wide ? 108 : 124;
  const finish = 40 + labelMax + 6;
  return { key: 20, label: 40, labelMax, finish, finishMax: qty - 24 - finish, qty, w, h, d, size };
}

/** Font size of a schedule cell, matching `.row-cell`. */
const ROW_FONT = 11.5;
/** A finish too long for one line drops to this size across two. */
const ROW_FONT_WRAPPED = 10;

/**
 * Rough advance width of a string in the sheet's sans-serif, px.
 *
 * An SVG built as a string has no layout engine to measure against, so this
 * estimates from character classes. It only decides whether to wrap or
 * condense; `fitText` guarantees the fit itself.
 */
function textWidth(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.27;
    else if ("iIljtf.,:;'|!()[]".includes(ch)) em += 0.3;
    else if ("mwMW".includes(ch)) em += 0.82;
    else if (ch >= "A" && ch <= "Z") em += 0.64;
    else if (ch >= "0" && ch <= "9") em += 0.56;
    else em += 0.53;
  }
  return em * fontPx;
}

/**
 * A text cell that never runs into the column after it. Past `max` it is
 * condensed with textLength -- which the renderer honours exactly, whatever
 * font it actually has -- so every character still prints. A shop drawing
 * that truncates "high-gloss lacquer" to "high-gl…" has lost the spec.
 */
function fitText(x: number, y: number, text: string, max: number, fontPx: number, style = ""): string {
  const fit = textWidth(text, fontPx) > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text x="${x}" y="${y}" class="row-cell"${style ? ` style="${style}"` : ""}${fit}>${esc(text)}</text>`;
}

/**
 * The finish column: "Solid hardwood - Kamagong, high-gloss lacquer" is three
 * times the width the column has, and printed on one line it ran straight
 * through QTY, W and H. Long finishes wrap onto two lines at whichever space
 * balances them best.
 */
function finishCell(x: number, y: number, text: string, max: number): string {
  if (textWidth(text, ROW_FONT) <= max) return fitText(x, y, text, max, ROW_FONT);
  const words = text.split(" ");
  let best: [string, string] = [text, ""];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    // Never start the second line on a dash: "Solid hardwood -" then
    // "Kamagong" reads as one name broken, "- Kamagong" as a list item.
    if (words[i] === "-") continue;
    const first = words.slice(0, i).join(" ");
    const second = words.slice(i).join(" ");
    const width = Math.max(textWidth(first, ROW_FONT_WRAPPED), textWidth(second, ROW_FONT_WRAPPED));
    if (width < bestWidth) {
      bestWidth = width;
      best = [first, second];
    }
  }
  const style = `font-size:${ROW_FONT_WRAPPED}px`;
  if (!best[1]) return fitText(x, y, best[0], max, ROW_FONT_WRAPPED, style);
  return `${fitText(x, y - 5.5, best[0], max, ROW_FONT_WRAPPED, style)}${fitText(x, y + 5.5, best[1], max, ROW_FONT_WRAPPED, style)}`;
}

function countComponents(parts: PartMeasurement[]): number {
  return parts.reduce((total, part) => {
    const components = part.components ?? [];
    return total + (components.length === 0 ? 1 : components.reduce((sum, c) => sum + c.qty, 0));
  }, 0);
}

/** Font size of a part's note line (shape, carving, holes) under its row. */
const NOTE_FONT = 10;
const NOTE_LINE_H = 13;
const ROW_H = 26;
/** Where the first row's baseline sits below the panel's top. */
const SCHEDULE_HEAD_H = 62;
/** Room kept under the last row for the three footnotes. */
const SCHEDULE_FOOT_H = 60;

/** Breaks a note into lines no wider than `max`, at spaces; a word longer than a line is kept whole (and condensed). */
function wrapNote(text: string, max: number, fontPx: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, fontPx) > max) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The component schedule, and how tall it had to be to hold every row.
 *
 * Every row is printed. The schedule used to stop at ten and say how many it
 * had left out, which is a build sheet missing the sizes of whatever came
 * eleventh -- the panel grows instead, and the sheet below it moves down.
 *
 * Under a part's last row goes what the customer changed about it beyond its
 * finish and size: a substituted shape and its eased edges, a carving, and
 * each hole with what fills it (StudioDesignItem.shapeNames). Those were only
 * ever drawn, never written, so a joiner had to read a cutout's size off the
 * drawing and could not read its insert's material anywhere on the sheet.
 */
function renderSchedule(
  parts: PartMeasurement[],
  item: StudioDesignItem,
  originX: number,
  originY: number
): { svg: string; height: number } {
  // One line per piece to cut, not per part: a part that resolved into
  // components contributes a row for each distinct size, carrying how many of
  // them to make. A part that did not (a single moulded shell, or a scanned
  // mesh in too many fragments to list) keeps the one summary row it always
  // had, with no quantity, since "1" would claim a precision that row does
  // not have.
  const lines = parts.flatMap((part, partIndex) => {
    const finish = item.materialNames[part.label] ?? "Custom Finish";
    // The callout number, shown once per part -- a second size of the same
    // part is still that part on the drawing, so repeating the number would
    // imply a bubble that is not there.
    const key = `${partIndex + 1}`;
    // Absent on any design saved before components existed -- see the field's
    // own comment. Those fall through to the single summary row they have
    // always been drawn with.
    const components = part.components ?? [];
    const note = item.shapeNames?.[part.label] ?? "";
    if (components.length === 0) {
      return [{ key, label: part.label, finish, qty: "", w: part.w, h: part.h, d: part.d, note }];
    }
    return components.map((component, index) => ({
      key: index === 0 ? key : "",
      // Only the first row of a multi-size part repeats the name; the second
      // reads as what it is, another size of the same thing.
      label: components.length > 1 && index > 0 ? `${part.label} (2nd size)` : part.label,
      finish,
      qty: `${component.qty}`,
      w: component.w,
      h: component.h,
      d: component.d,
      // Once per part, under its last row.
      note: index === components.length - 1 ? note : "",
    }));
  });

  const col = scheduleColumns(sheetUnit);
  const unitLabel = lengthUnitLabel(sheetUnit);
  const noteX = col.label;
  const noteMax = PANEL_W - 14 - noteX - 4;
  // Each row's baseline, with room left after it for its note's lines.
  let cursor = originY + SCHEDULE_HEAD_H;
  const placed = lines.map((line) => {
    const y = cursor;
    const noteLines = line.note ? wrapNote(line.note, noteMax, NOTE_FONT) : [];
    cursor += ROW_H + (noteLines.length ? noteLines.length * NOTE_LINE_H + 5 : 0);
    return { line, y, noteLines };
  });
  const lastBaseline = cursor - ROW_H;
  const height = Math.max(PANEL_H, lastBaseline - originY + 10 + SCHEDULE_FOOT_H);

  const rows = placed
    .map(({ line, y, noteLines }) => {
      // Condensed rather than allowed to run into the next column: a size that
      // overprints its neighbour is a size nobody can read.
      const num = (x: number, value: string) => {
        const fit =
          textWidth(value, ROW_FONT) > col.size - 6 ? ` textLength="${col.size - 6}" lengthAdjust="spacingAndGlyphs"` : "";
        return `<text x="${originX + x}" y="${y}" class="row-cell" text-anchor="end"${fit}>${esc(value)}</text>`;
      };
      return `
      <line x1="${originX + 14}" y1="${y - 16}" x2="${originX + PANEL_W - 14}" y2="${y - 16}" class="row-line"/>
      <text x="${originX + col.key}" y="${y}" class="row-cell">${esc(line.key)}</text>
      ${fitText(originX + col.label, y, line.label, col.labelMax, ROW_FONT)}
      ${finishCell(originX + col.finish, y, line.finish, col.finishMax)}
      ${num(col.qty, line.qty)}
      ${num(col.w, lenValue(line.w))}
      ${num(col.h, lenValue(line.h))}
      ${num(col.d, lenValue(line.d))}
      ${noteLines
        .map((text, index) =>
          fitText(
            originX + noteX,
            // Clear of a finish that wrapped to a second line (its baseline is y + 5.5).
            y + 18 + index * NOTE_LINE_H,
            index === 0 ? `↳ ${text}` : `   ${text}`,
            noteMax,
            NOTE_FONT,
            `font-size:${NOTE_FONT}px;fill:#5b7590;font-style:italic`
          )
        )
        .join("")}`;
    })
    .join("");

  const head = (x: number, text: string, end = false) => {
    // A size heading is held to its column, like the numbers under it.
    const fit =
      end && textWidth(text, 11.5) > col.size - 4 ? ` textLength="${col.size - 4}" lengthAdjust="spacingAndGlyphs"` : "";
    return `<text x="${originX + x}" y="${originY + 44}" class="row-head"${end ? ' text-anchor="end"' : ""}${fit}>${text}</text>`;
  };

  const svg = `
  <g>
    <rect x="${originX}" y="${originY}" width="${PANEL_W}" height="${height}" class="panel"/>
    <text x="${originX + 14}" y="${originY + 22}" class="panel-title">COMPONENT SCHEDULE</text>
    ${head(col.key - 2, "#")}
    ${head(col.label, "COMPONENT")}
    ${head(col.finish, "FINISH")}
    ${head(col.qty, "QTY", true)}
    ${head(col.w, esc(`W (${unitLabel})`), true)}
    ${head(col.h, esc(`H (${unitLabel})`), true)}
    ${head(col.d, esc(`D (${unitLabel})`), true)}
    ${rows}
    <text x="${originX + 18}" y="${originY + height - 46}" class="tb-note">${esc(
      `All sizes in ${lengthUnitName(sheetUnit).toLowerCase()} (${unitLabel}). # keys to the callouts on the views.`
    )}</text>
    <text x="${originX + 18}" y="${originY + height - 32}" class="tb-note">QTY = size of ONE piece. Blank QTY = whole part's extent.</text>
    <text x="${originX + 18}" y="${originY + height - 18}" class="tb-note">↳ under a part = its shape, carving and cutouts, as ordered.</text>
  </g>`;
  return { svg, height };
}

export function generateStudioBlueprintSvg(
  item: StudioDesignItem,
  options?: { title?: string; pieceName?: string; unit?: LengthUnit }
): string {
  // Read by every helper below; see `sheetUnit`.
  sheetUnit = options?.unit ?? DEFAULT_LENGTH_UNIT;
  const measurement = item.studio?.measurement;
  const parts = measurement?.parts ?? [];
  if (!measurement || parts.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="80"><text x="12" y="46" font-family="system-ui" font-size="14" fill="#6b7280">No measured parts on this design.</text></svg>`;
  }

  const silhouettes = item.studio?.silhouettes;
  const traced = Boolean(silhouettes && Object.values(silhouettes.cm ?? {}).some((v) => v.wood || v.cloth));

  // Prefer the traced bounds so the drawing frames exactly what it renders.
  // Widened to take in the measured extent too, so the dimension lines -- which
  // stand on the measured extent, see renderDimensions -- always land inside
  // the frame the view was scaled to.
  const extents = VIEWS.map((view) => {
    const measured = extentFromParts(parts, view);
    const fromSilhouette = silhouettes?.bounds?.[view.key];
    if (!(traced && fromSilhouette && fromSilhouette.hMax > fromSilhouette.hMin)) return measured;
    return {
      hMin: Math.min(fromSilhouette.hMin, measured.hMin),
      hMax: Math.max(fromSilhouette.hMax, measured.hMax),
      vMin: Math.min(fromSilhouette.vMin, measured.vMin),
      vMax: Math.max(fromSilhouette.vMax, measured.vMax),
    };
  });

  // One shared scale across all three views, as on a real drawing sheet.
  const scale = Math.min(
    ...extents.map((extent) =>
      Math.min(DRAW_W / Math.max(extent.hMax - extent.hMin, 1e-3), DRAW_H / Math.max(extent.vMax - extent.vMin, 1e-3))
    )
  );

  const pieceName = options?.pieceName || "Chair";
  const title = options?.title || item.name || pieceName;
  const col2 = MARGIN + PANEL_W + GAP;

  const origins: Array<[number, number]> = [
    [MARGIN, ROW1_Y],
    [col2, ROW1_Y],
    [MARGIN, ROW2_Y],
  ];
  const layouts = VIEWS.map((view, i) => layoutView(view, extents[i], origins[i][0], origins[i][1], scale));
  const dimensions = layouts.map((layout) => renderDimensions(layout, measurement));

  // Callouts are planned across all three views at once, because each part
  // is ballooned once, in whichever view shows it best.
  const frames: CalloutFrame[] = layouts.map((layout, i) => ({
    key: layout.view.key,
    panel: { x1: layout.originX, y1: layout.originY, x2: layout.originX + PANEL_W, y2: layout.originY + PANEL_H },
    content: { x1: layout.left, y1: layout.top, x2: layout.right, y2: layout.bottom },
    hAxis: layout.view.hAxis,
    vAxis: layout.view.vAxis,
    depthAxis: layout.view.depthAxis,
    toX: layout.toX,
    toY: layout.toY,
    outline: outlineOf(layout.view, silhouettes),
    keepOut: dimensions[i].keepOut,
  }));
  const callouts: Callout[] = planCallouts(parts, frames, CALLOUT_R);

  // The schedule may be taller than a view panel (every row is printed); the
  // title block, the human scale and the page itself move down to make room.
  const schedule = renderSchedule(parts, item, col2, ROW2_Y);
  const grown = schedule.height - PANEL_H;
  const titleY = TITLE_Y + grown;
  const humanY = HUMAN_Y + grown;
  const pageH = PAGE_H + grown;

  const views = `
    ${layouts
      .map((layout, i) =>
        renderView(
          layout,
          renderBody(layout, parts, silhouettes),
          dimensions[i].svg,
          renderCallouts(callouts, layout.view.key, CALLOUT_R)
        )
      )
      .join("")}
    ${schedule.svg}`;

  const o = measurement.overall;
  // A piece with no surface to measure (a height of zero -- including
  // cabinets saved before they had one) states its overall height here
  // instead of "Seat height 0 cm".
  const hasSurface = measurement.seatHeight > 0;
  const surfaceKey = hasSurface ? (measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL) : NO_SURFACE_HEIGHT_LABEL;
  const surfaceValue = hasSurface ? measurement.seatHeight : o.h;
  const note = traced
    ? "Outlines traced from the finished 3D model. Confirm all dimensions with the shop before cutting."
    : "Component outlines show occupied envelopes, not carving profiles. Confirm all dimensions with the shop before cutting.";

  const titleBlock = `
  <g>
    <rect x="${MARGIN}" y="${titleY}" width="${PAGE_W - MARGIN * 2}" height="${TITLE_H}" class="panel"/>
    <text x="${MARGIN + 18}" y="${titleY + 30}" class="panel-title">TITLE BLOCK</text>

    <text x="${MARGIN + 18}" y="${titleY + 58}" class="tb-key">PROJECT</text>
    <text x="${MARGIN + 18}" y="${titleY + 78}" class="tb-val" data-user-text="true">${esc(title)}</text>

    <text x="${MARGIN + 18}" y="${titleY + 108}" class="tb-key">PIECE</text>
    <text x="${MARGIN + 18}" y="${titleY + 128}" class="tb-val">${esc(pieceName)}</text>

    <text x="${MARGIN + 330}" y="${titleY + 58}" class="tb-key">OVERALL W × H × D</text>
    <text x="${MARGIN + 330}" y="${titleY + 78}" class="tb-val">${esc(`${len(o.w)} × ${len(o.h)} × ${len(o.d)}`)}</text>
    <text x="${MARGIN + 330}" y="${titleY + 93}" class="tb-note">${esc(
      ((alt: LengthUnit) => `${formatLength(o.w, alt)} × ${formatLength(o.h, alt)} × ${formatLength(o.d, alt)}`)(
        sheetUnit === "in" || sheetUnit === "ft" ? "cm" : "ft"
      )
    )}</text>

    <text x="${MARGIN + 330}" y="${titleY + 108}" class="tb-key">${esc(surfaceKey.toUpperCase())}</text>
    <text x="${MARGIN + 330}" y="${titleY + 128}" class="tb-val">${esc(lenBoth(surfaceValue))}</text>

    <text x="${MARGIN + 610}" y="${titleY + 58}" class="tb-key">COMPONENTS</text>
    <text x="${MARGIN + 610}" y="${titleY + 78}" class="tb-val">${countComponents(parts)}</text>

    <text x="${MARGIN + 610}" y="${titleY + 108}" class="tb-key">DRAWN FROM</text>
    <text x="${MARGIN + 610}" y="${titleY + 128}" class="tb-val">${traced ? "Model outline" : "Envelopes"}</text>

    <line x1="${MARGIN + 18}" y1="${titleY + 146}" x2="${PAGE_W - MARGIN - 18}" y2="${titleY + 146}" class="row-line"/>
    ${renderLegend(MARGIN + 18, titleY + 170, callouts.some((c) => c.hidden))}
    ${renderScaleBar(scale, MARGIN + 610, titleY + 172)}

    <text x="${MARGIN + 18}" y="${titleY + TITLE_H - 14}" class="tb-note">${note}</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${pageH}" width="${PAGE_W}" height="${pageH}" role="img" aria-label="Blueprint for ${esc(title)}">
  ${arrowDefs()}
  ${styles()}
  <rect width="${PAGE_W}" height="${pageH}" class="sheet"/>
  <text x="${MARGIN}" y="${MARGIN + 30}" class="head-title" data-user-text="true">${esc(title)}</text>
  <text x="${MARGIN}" y="${MARGIN + 52}" class="head-sub">${esc(pieceName)} · dimensioned shop drawing · all measurements in ${esc(lengthUnitName(sheetUnit).toLowerCase())} (${esc(lengthUnitLabel(sheetUnit))})</text>
  <line x1="${MARGIN}" y1="${MARGIN + HEADER_H - 8}" x2="${PAGE_W - MARGIN}" y2="${MARGIN + HEADER_H - 8}" class="dim-line"/>
  ${views}
  ${titleBlock}
  ${renderHumanScale(measurement, extents[0], silhouettes, parts, MARGIN, humanY)}
</svg>`;
}
