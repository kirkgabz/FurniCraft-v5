// Generates a self-contained technical blueprint (front/side/top orthographic
// views + a zoomed leg detail + a title block) as an SVG markup string, in the
// style of a woodworking shop drawing. Pure function of the saved design data
// (dims/shapes) -- no three.js/canvas capture involved -- so it can run both
// inside the live 3D designer (imperative DOM injection) and inside the React
// shop-facing order/template preview, from the exact same cadState already
// being persisted today.

import type { CadStateItem } from "./design-state-utils";
import { turnedLegRadii } from "./leg-profiles";

const PANEL_W = 460;
const PANEL_H = 380;
const GAP = 20;
const MARGIN = 20;
const HEADER_H = 76;
const TITLE_H = 150;
const PAD_L = 70;
const PAD_R = 30;
const PAD_T = 24;
const PAD_B = 64;

const PAGE_W = MARGIN * 2 + PANEL_W * 2 + GAP;
const ROW1_Y = MARGIN + HEADER_H;
const ROW2_Y = ROW1_Y + PANEL_H + GAP;
const TITLE_Y = ROW2_Y + PANEL_H + GAP;
const PAGE_H = TITLE_Y + TITLE_H + MARGIN;

const LEG_SHAPE_LABELS: Record<string, string> = {
  straight_post_s: "Straight Square Post",
  straight_post_r: "Straight Round Post",
  tapered_square: "Tapered Square",
  tapered_round: "Tapered Round",
  cabriole: "Cabriole (S-Curve)",
  saber: "Saber (Outward)",
  fluted_round: "Fluted Round",
  turned_leg: "Turned / Bobbin",
  hairpin: "Metal Hairpin",
  rocking_runners: "Classic Oak Runners",
  modern_rocker_runners: "Sleek Modern Runners",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt(cm: number): string {
  return (Math.round(cm * 10) / 10).toString();
}

type Pt = [number, number];

function labelBgWidth(label: string) {
  return Math.max(30, label.length * 6.4 + 10);
}

/**
 * Absolute-space horizontal dimension line + extension ticks + label.
 * `pA`/`pB` give the two x-positions the dim line spans (their y is ignored --
 * the line is drawn at `dimY`); `extA`/`extB` are the object-edge points the
 * dashed extension ticks rise from.
 */
function dimH(pA: Pt, pB: Pt, dimY: number, label: string, extA: Pt, extB: Pt): string {
  const lo = Math.min(pA[0], pB[0]);
  const hi = Math.max(pA[0], pB[0]);
  const midX = (lo + hi) / 2;
  const w = labelBgWidth(label);
  return `
    <line x1="${extA[0]}" y1="${extA[1]}" x2="${extA[0]}" y2="${dimY}" class="ext-line"/>
    <line x1="${extB[0]}" y1="${extB[1]}" x2="${extB[0]}" y2="${dimY}" class="ext-line"/>
    <line x1="${lo}" y1="${dimY}" x2="${hi}" y2="${dimY}" class="dim-line" marker-start="url(#bpArrow)" marker-end="url(#bpArrow)"/>
    <rect x="${midX - w / 2}" y="${dimY - 9}" width="${w}" height="15" class="dim-label-bg"/>
    <text x="${midX}" y="${dimY + 3}" class="dim-text" text-anchor="middle">${esc(label)}</text>
  `;
}

/** Same as `dimH` but vertical: `pA`/`pB` give the two y-positions, line drawn at `dimX`. */
function dimV(pA: Pt, pB: Pt, dimX: number, label: string, extA: Pt, extB: Pt): string {
  const lo = Math.min(pA[1], pB[1]);
  const hi = Math.max(pA[1], pB[1]);
  const midY = (lo + hi) / 2;
  const w = labelBgWidth(label);
  return `
    <line x1="${extA[0]}" y1="${extA[1]}" x2="${dimX}" y2="${extA[1]}" class="ext-line"/>
    <line x1="${extB[0]}" y1="${extB[1]}" x2="${dimX}" y2="${extB[1]}" class="ext-line"/>
    <line x1="${dimX}" y1="${lo}" x2="${dimX}" y2="${hi}" class="dim-line" marker-start="url(#bpArrow)" marker-end="url(#bpArrow)"/>
    <rect x="${dimX + 6}" y="${midY - 7.5}" width="${w}" height="15" class="dim-label-bg"/>
    <text x="${dimX + 6 + w / 2}" y="${midY + 3}" class="dim-text" text-anchor="middle">${esc(label)}</text>
  `;
}

/** Silhouette path (model-space cm, centered at u=0, v in [0,h]) for a leg's front/side profile. */
function legSilhouettePath(shape: string, w: number, h: number): { d: string; strokeOnly?: boolean } {
  const r = Math.max(w, 0.5) / 2;
  const H = Math.max(h, 1);

  if (shape === "turned_leg") {
    const samples = 48;
    const radii = turnedLegRadii(samples, r);
    const right = radii.map((rv, i) => `${rv.toFixed(2)} ${((i / samples) * H).toFixed(2)}`);
    const left = radii.map((rv, i) => `${(-rv).toFixed(2)} ${((i / samples) * H).toFixed(2)}`).reverse();
    return { d: `M ${right.join(" L ")} L ${left.join(" L ")} Z` };
  }
  if (shape === "tapered_square" || shape === "tapered_round") {
    const topR = r * 0.44;
    return { d: `M ${-r} 0 L ${-topR} ${H} L ${topR} ${H} L ${r} 0 Z` };
  }
  if (shape === "straight_post_r" || shape === "fluted_round") {
    const fr = Math.min(r * 0.3, H * 0.06);
    return {
      d: `M ${-r} ${fr} Q ${-r} 0 ${-r + fr} 0 L ${r - fr} 0 Q ${r} 0 ${r} ${fr}
          L ${r} ${H - fr} Q ${r} ${H} ${r - fr} ${H} L ${-r + fr} ${H} Q ${-r} ${H} ${-r} ${H - fr} Z`,
    };
  }
  if (shape === "cabriole") {
    const bulge = r * 2.1;
    return {
      d: `M ${-r * 0.55} 0 Q ${-bulge} ${H * 0.14} ${-bulge * 0.62} ${H * 0.44}
          Q ${-r * 0.55} ${H * 0.72} ${-r * 0.55} ${H}
          L ${r * 0.55} ${H} Q ${r * 0.55} ${H * 0.72} ${bulge * 0.5} ${H * 0.44}
          Q ${r * 0.35} ${H * 0.14} ${r * 0.55} 0 Z`,
    };
  }
  if (shape === "saber") {
    const lean = r * 1.7;
    return {
      d: `M ${-r * 0.5} 0 Q ${-r * 0.95} ${H * 0.4} ${-lean * 0.32} ${H * 0.78}
          L ${-lean * 0.12} ${H} L ${lean * 0.48} ${H}
          Q ${r * 0.65} ${H * 0.55} ${r * 0.5} 0 Z`,
    };
  }
  if (shape === "hairpin") {
    return {
      d: `M ${-r * 0.55} 0 L 0 ${H * 0.58} L ${r * 0.55} 0 M ${-r * 0.55} ${H * 0.03} L 0 ${H * 0.62} L ${r * 0.55} ${H * 0.03}`,
      strokeOnly: true,
    };
  }
  // straight_post_s and anything unrecognized: plain square post
  return { d: `M ${-r} 0 L ${-r} ${H} L ${r} ${H} L ${r} 0 Z` };
}

const OPEN_BACK_SHAPES = new Set(["spindle_back", "slat_back", "ladder_back", "cross_back"]);

/**
 * Outline path (model-space cm, centered at u=0, v in [0,h] bottom-up) for a
 * solid backrest panel. Ported directly from the quadratic-curve shapes
 * buildStandardChair3D() extrudes (round_back/balloon_back/shield_back/
 * wingback), just reparented from that function's vertically-centered
 * (-hh..hh) local space to this module's bottom-up (0..h) one via `sy`.
 */
function backPanelPath(shape: string, w: number, h: number): string {
  const hw = w / 2;
  const hh = h / 2;
  const sy = (localY: number) => localY + hh;

  if (shape === "round_back") {
    return `M ${-hw} ${sy(-hh)} L ${hw} ${sy(-hh)}
      Q ${hw * 1.15} ${sy(0)} ${hw} ${sy(hh)}
      Q 0 ${sy(hh * 1.1)} ${-hw} ${sy(hh)}
      Q ${-hw * 1.15} ${sy(0)} ${-hw} ${sy(-hh)} Z`;
  }
  if (shape === "balloon_back") {
    return `M ${-hw * 0.25} ${sy(-hh)} L ${hw * 0.25} ${sy(-hh)}
      Q ${hw * 0.55} ${sy(-hh * 0.5)} ${hw * 0.42} ${sy(hh * 0.5)}
      Q ${hw * 0.2} ${sy(hh * 0.75)} 0 ${sy(hh * 0.78)}
      Q ${-hw * 0.2} ${sy(hh * 0.75)} ${-hw * 0.42} ${sy(hh * 0.5)}
      Q ${-hw * 0.55} ${sy(-hh * 0.5)} ${-hw * 0.25} ${sy(-hh)} Z`;
  }
  if (shape === "shield_back") {
    return `M 0 ${sy(-hh)}
      Q ${hw * 0.55} ${sy(-hh * 0.2)} ${hw} ${sy(hh * 0.1)}
      Q ${hw} ${sy(hh * 0.55)} 0 ${sy(hh)}
      Q ${-hw} ${sy(hh * 0.55)} ${-hw} ${sy(hh * 0.1)}
      Q ${-hw * 0.55} ${sy(-hh * 0.2)} 0 ${sy(-hh)} Z`;
  }
  if (shape === "wingback") {
    return `M ${-hw} ${sy(-hh)} L ${hw} ${sy(-hh)} L ${hw} ${sy(hh * 0.35)}
      Q ${hw} ${sy(hh * 0.6)} ${hw * 0.85} ${sy(hh * 0.75)}
      Q ${hw * 0.7} ${sy(hh * 0.9)} ${hw * 0.4} ${sy(hh)}
      Q 0 ${sy(hh * 1.05)} ${-hw * 0.4} ${sy(hh)}
      Q ${-hw * 0.7} ${sy(hh * 0.9)} ${-hw * 0.85} ${sy(hh * 0.75)}
      Q ${-hw} ${sy(hh * 0.6)} ${-hw} ${sy(hh * 0.35)} Z`;
  }
  // simple_panel, padded_back, and anything else solid: plain rect
  return `M ${-hw} 0 L ${hw} 0 L ${hw} ${h} L ${-hw} ${h} Z`;
}

/** Side posts + a few vertical/horizontal/diagonal members for open (slatted) backs, in local 0..h space. */
function backOpenMembers(shape: string, w: number, h: number): string {
  const hw = w / 2;
  const margin = w * 0.08;
  let out = "";
  if (shape === "ladder_back") {
    const rungs = 4;
    for (let i = 0; i < rungs; i++) {
      const y = (h * (i + 0.5)) / rungs;
      out += `<line x1="${-hw + margin}" y1="${y}" x2="${hw - margin}" y2="${y}" class="part-stroke-only" vector-effect="non-scaling-stroke"/>`;
    }
  } else if (shape === "cross_back") {
    out += `<line x1="${-hw + margin}" y1="${h * 0.06}" x2="${hw - margin}" y2="${h * 0.94}" class="part-stroke-only" vector-effect="non-scaling-stroke"/>`;
    out += `<line x1="${hw - margin}" y1="${h * 0.06}" x2="${-hw + margin}" y2="${h * 0.94}" class="part-stroke-only" vector-effect="non-scaling-stroke"/>`;
  } else {
    // spindle_back / slat_back: evenly spaced verticals
    const count = shape === "slat_back" ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const x = -hw + margin * 1.4 + (i * (w - margin * 2.8)) / (count - 1);
      out += `<line x1="${x}" y1="${h * 0.05}" x2="${x}" y2="${h * 0.95}" class="part-stroke-only" vector-effect="non-scaling-stroke"/>`;
    }
  }
  return out;
}

/**
 * Hole/cutout glyphs for a backrest, in the same local space as `backPanelPath`.
 * Ported from punchBackHoles() so the blueprint shows the same cutout the 3D
 * model actually carves (e.g. the oval in "handle_cutout").
 */
function backHoleShapes(holeType: string | undefined, w: number, h: number): string {
  if (!holeType || holeType === "none") return "";
  const bw = w * 0.12;
  const bh = h * 0.11;
  const safeW = w * 0.38;
  const safeH = h * 0.38;
  const hh = h / 2;
  const sy = (localY: number) => localY + hh;
  const rectHole = (localCx: number, localCy: number, rw: number, rh: number) =>
    `<rect x="${localCx - rw}" y="${sy(localCy) - rh}" width="${rw * 2}" height="${rh * 2}" class="hole-punch" vector-effect="non-scaling-stroke"/>`;

  if (holeType === "center_slot") {
    const hw_ = Math.min(bw, safeW * 0.3);
    const hh_ = Math.min(bh * 2.2, safeH);
    return rectHole(0, 0, hw_, hh_);
  }
  if (holeType === "handle_cutout") {
    const rx = Math.min(bw * 1.6, safeW);
    const ry = Math.min(bh * 0.5, safeH * 0.25);
    return `<ellipse cx="0" cy="${sy(h * 0.2)}" rx="${rx}" ry="${ry}" class="hole-punch" vector-effect="non-scaling-stroke"/>`;
  }
  if (holeType === "grid_holes") {
    const gw = Math.min(bw * 0.7, safeW * 0.25);
    const gh = Math.min(bh * 0.7, safeH * 0.25);
    const stepX = w * 0.28;
    const stepY = h * 0.28;
    let out = "";
    for (let xi = -1; xi <= 1; xi++) for (let yi = -1; yi <= 1; yi++) out += rectHole(xi * stepX, yi * stepY, gw, gh);
    return out;
  }
  if (holeType === "keyhole") {
    const kw = Math.min(bw * 0.55, safeW * 0.25);
    const kh = Math.min(bh * 1.65, safeH * 0.7);
    const kr = Math.min(bw * 0.9, safeW * 0.35);
    return `<path d="M ${-kw} ${sy(-kh)} L ${-kw} ${sy(kh * 0.4)} A ${kr} ${kr} 0 0 0 ${kw} ${sy(kh * 0.4)} L ${kw} ${sy(-kh)} Z" class="hole-punch" vector-effect="non-scaling-stroke"/>`;
  }
  if (holeType === "horizontal_slots") {
    const hw_ = Math.min(bw * 2.3, safeW);
    const hh_ = Math.min(bh * 0.4, safeH * 0.15);
    const stepY = h * 0.26;
    return [-1, 0, 1].map((i) => rectHole(0, i * stepY, hw_, hh_)).join("");
  }
  if (holeType === "heart_cutout") {
    const scl = Math.min(safeW / (bw * 1.8), safeH / (bh * 2.8), 1.0);
    const sw_ = bw * scl;
    const sh_ = bh * scl;
    const cy = sh_ * 0.8;
    const p = (dy: number) => sy(cy + dy);
    return `<path d="M 0 ${p(sh_ * 0.4)}
      C ${-sw_ * 0.1} ${p(sh_ * 1.2)} ${-sw_ * 1.8} ${p(sh_ * 1.2)} ${-sw_ * 1.8} ${p(0)}
      C ${-sw_ * 1.8} ${p(-sh_ * 1.0)} 0 ${p(-sh_ * 2.0)} 0 ${p(-sh_ * 2.4)}
      C 0 ${p(-sh_ * 2.0)} ${sw_ * 1.8} ${p(-sh_ * 1.0)} ${sw_ * 1.8} ${p(0)}
      C ${sw_ * 1.8} ${p(sh_ * 1.2)} ${sw_ * 0.1} ${p(sh_ * 1.2)} 0 ${p(sh_ * 0.4)} Z" class="hole-punch" vector-effect="non-scaling-stroke"/>`;
  }
  if (holeType === "three_slots") {
    const sw_ = Math.min(bw * 0.38, safeW * 0.12);
    const sh_ = Math.min(bh * 2.2, safeH * 0.8);
    const stepX = w * 0.26;
    return [-1, 0, 1].map((i) => rectHole(i * stepX, 0, sw_, sh_)).join("");
  }
  if (holeType === "diamond_cutout") {
    const r = Math.min(bw, bh, safeW * 0.55, safeH * 0.55) * 2.2;
    return `<path d="M 0 ${sy(r)} L ${r} ${sy(0)} L 0 ${sy(-r)} L ${-r} ${sy(0)} Z" class="hole-punch" vector-effect="non-scaling-stroke"/>`;
  }
  if (holeType === "arch_window") {
    const aw = Math.min(bw * 1.55, safeW * 0.75);
    const ab = -Math.min(bh * 2.1, safeH * 0.75);
    const at = Math.min(bh * 0.6, safeH * 0.2);
    return `<path d="M ${-aw} ${sy(ab)} L ${-aw} ${sy(at)} A ${aw} ${aw} 0 0 0 ${aw} ${sy(at)} L ${aw} ${sy(ab)} Z" class="hole-punch" vector-effect="non-scaling-stroke"/>`;
  }
  return "";
}

function panelFrame(x: number, y: number, caption: string): string {
  return `
    <rect x="${x}" y="${y}" width="${PANEL_W}" height="${PANEL_H}" class="panel-border"/>
    <text x="${x + PANEL_W / 2}" y="${y + PANEL_H - 16}" text-anchor="middle" class="panel-caption">${esc(caption)}</text>
  `;
}

export function generateBlueprintSvg(item: CadStateItem | null | undefined, opts: { title?: string } = {}): string {
  const dims = item?.dims || {};
  const shapes = item?.shapes || {};
  const holes = item?.holes || {};
  const materialNames = item?.materialNames || {};
  // The live 3D view scales every part by the per-axis "Global Scale" sliders --
  // width/depth follow gs.x/gs.z, height follows gs.y. Skipping this here made
  // the blueprint show the pre-scale raw dims instead of what's actually on screen.
  const gs = item?.globalScale || { x: 1, y: 1, z: 1 };
  const gx = gs.x || 1;
  const gy = gs.y || 1;
  const gz = gs.z || 1;
  const get = (p: string) => ({ w: (dims[p]?.w || 0) * gx, h: (dims[p]?.h || 0) * gy, d: (dims[p]?.d || 0) * gz });

  const legs = get("Legs");
  const seat = get("Seat");
  const back = get("Back");
  const head = get("Headrest");
  const arm = get("Armrests");
  const runner = get("Runners");

  if (seat.w <= 0 && legs.h <= 0) {
    return `<svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',Arial,sans-serif">
      <rect width="600" height="200" fill="#fff"/>
      <text x="300" y="105" text-anchor="middle" font-size="15" fill="#888">No dimension data available to generate a blueprint for this design.</text>
    </svg>`;
  }

  const isRocking = item?.type === "rocking_chair";
  const legShape = shapes["Legs"] || "straight_post_s";
  const seatShape = shapes["Seat"] || "square_plank";
  const isRoundSeat = ["round_plank", "oct_plank", "hex_plank"].includes(seatShape);
  const hasHead = head.h > 0 && shapes["Headrest"] !== "none";
  const hasArm = Boolean((item?.isLeftArmVisible || item?.isRightArmVisible) && arm.h > 0);
  const hasRunner = Boolean(isRocking && runner.d > 0 && shapes["Runners"] !== "none");

  const seatInset = isRoundSeat ? 0.72 : 1.0;
  const locX = Math.max(0.5, (seat.w / 2) * seatInset - legs.w / 2);
  const locZ = Math.max(0.5, (seat.d / 2) * seatInset - legs.d / 2);

  const baseOffset = hasRunner ? Math.max(runner.h, 3) * 1.4 : 0;
  const legH = Math.max(legs.h, 1);
  const seatTopY = legH + seat.h;
  const backTopY = seatTopY + back.h;
  const headTopY = hasHead ? backTopY + head.h : backTopY;
  const totalH = Math.max(headTopY + baseOffset, 20);

  const overallW = Math.max(seat.w, back.w, legs.w * 2 + 4, 20);
  const overallD = Math.max(seat.d, back.d, legs.d * 2 + 4, hasRunner ? runner.d : 0, 20);

  const innerW = PANEL_W - PAD_L - PAD_R;
  const innerH = PANEL_H - PAD_T - PAD_B;
  const scale = Math.min(innerW / Math.max(overallW, overallD), innerH / totalH);

  // ---- Panel A: Front elevation ----
  const ax = MARGIN;
  const ay = ROW1_Y;
  const aCx = ax + PAD_L + innerW / 2;
  const aBaseY = ay + PAD_T + innerH;
  const toA = (u: number, v: number): Pt => [aCx + u * scale, aBaseY - v * scale];

  const legHalfGapX = locX;
  const apronH = Math.min(3, seat.h * 0.6);
  const apronW = Math.max(0, seat.w - legs.w * 2.2);
  const hasApron = !["hairpin", "saber"].includes(legShape) && apronW > 2;

  let frontSil = `<g transform="translate(${aCx} ${aBaseY}) scale(${scale} ${-scale})">`;
  frontSil += `<rect x="${-legHalfGapX - legs.w / 2}" y="${baseOffset}" width="${legs.w}" height="${legH}" class="part" vector-effect="non-scaling-stroke"/>`;
  frontSil += `<rect x="${legHalfGapX - legs.w / 2}" y="${baseOffset}" width="${legs.w}" height="${legH}" class="part" vector-effect="non-scaling-stroke"/>`;
  if (hasApron) {
    frontSil += `<rect x="${-apronW / 2}" y="${seatTopY + baseOffset - apronH}" width="${apronW}" height="${apronH}" class="part-light" vector-effect="non-scaling-stroke"/>`;
  }
  frontSil += `<rect x="${-seat.w / 2}" y="${legH + baseOffset}" width="${seat.w}" height="${seat.h}" class="part" vector-effect="non-scaling-stroke"/>`;
  if (back.h > 0) {
    const backShape = shapes["Back"] || "simple_panel";
    const backHole = holes["Back"] || "none";
    frontSil += `<g transform="translate(0 ${seatTopY + baseOffset})">`;
    if (OPEN_BACK_SHAPES.has(backShape)) {
      const postW = Math.max(back.w * 0.08, 1.5);
      frontSil += `<rect x="${-back.w / 2}" y="0" width="${postW}" height="${back.h}" class="part" vector-effect="non-scaling-stroke"/>`;
      frontSil += `<rect x="${back.w / 2 - postW}" y="0" width="${postW}" height="${back.h}" class="part" vector-effect="non-scaling-stroke"/>`;
      frontSil += backOpenMembers(backShape, back.w, back.h);
    } else {
      frontSil += `<path d="${backPanelPath(backShape, back.w, back.h)}" class="part" vector-effect="non-scaling-stroke"/>`;
      frontSil += backHoleShapes(backHole, back.w, back.h);
    }
    frontSil += `</g>`;
  }
  if (hasHead) {
    frontSil += `<rect x="${-head.w / 2}" y="${backTopY + baseOffset}" width="${head.w}" height="${head.h}" class="part" vector-effect="non-scaling-stroke"/>`;
  }
  if (hasArm) {
    const armH = arm.h || 8;
    [-1, 1].forEach((s) => {
      frontSil += `<rect x="${s * (seat.w / 2 - 1) - (s > 0 ? 0 : 3)}" y="${seatTopY + baseOffset}" width="3" height="${armH}" class="part-light" vector-effect="non-scaling-stroke"/>`;
    });
  }
  frontSil += `</g>`;

  const frontWidthEdgeL = toA(-seat.w / 2, baseOffset);
  const frontWidthEdgeR = toA(seat.w / 2, baseOffset);
  const frontHeightEdgeB = toA(-seat.w / 2, baseOffset);
  const frontHeightEdgeT = toA(-seat.w / 2, totalH);
  const frontDims =
    dimH(frontWidthEdgeL, frontWidthEdgeR, frontWidthEdgeL[1] + 22, `${fmt(seat.w)} cm W`, frontWidthEdgeL, frontWidthEdgeR) +
    dimV(frontHeightEdgeB, frontHeightEdgeT, aCx - (seat.w / 2 + 6) * scale, `${fmt(totalH)} cm H`, frontHeightEdgeB, frontHeightEdgeT);

  const panelA = `
    ${panelFrame(ax, ay, "FRONT ELEVATION")}
    ${frontSil}
    ${frontDims}
  `;

  // ---- Panel B: Side elevation ----
  const bx = ax + PANEL_W + GAP;
  const by = ROW1_Y;
  const bCx = bx + PAD_L + innerW / 2;
  const bBaseY = by + PAD_T + innerH;
  const toB = (u: number, v: number): Pt => [bCx + u * scale, bBaseY - v * scale];

  // Only rocking chairs actually recline the back in the 3D model (buildRockingChair3D
  // computes a backTilt off the rocker curve); standard chairs build it with zero
  // rotation, so the side view must stay upright for them to match the real geometry.
  const leanTop = isRocking ? back.h * 0.14 : 0;
  let sideSil = `<g transform="translate(${bCx} ${bBaseY}) scale(${scale} ${-scale})">`;
  sideSil += `<rect x="${locZ - legs.d / 2}" y="${baseOffset}" width="${legs.d}" height="${legH}" class="part" vector-effect="non-scaling-stroke"/>`;
  sideSil += `<rect x="${-locZ - legs.d / 2}" y="${baseOffset}" width="${legs.d}" height="${legH}" class="part" vector-effect="non-scaling-stroke"/>`;
  if (hasRunner) {
    const rw = runner.d / 2;
    sideSil += `<path d="M ${-rw} ${baseOffset * 0.15} Q 0 0 ${rw} ${baseOffset * 0.15} L ${rw * 0.94} ${baseOffset} Q 0 ${baseOffset * 0.55} ${-rw * 0.94} ${baseOffset} Z" class="part-light" vector-effect="non-scaling-stroke"/>`;
  }
  sideSil += `<rect x="${-seat.d / 2}" y="${legH + baseOffset}" width="${seat.d}" height="${seat.h}" class="part" vector-effect="non-scaling-stroke"/>`;
  if (back.h > 0) {
    const bd = Math.max(back.d, 2);
    const rz = -seat.d / 2 + bd / 2;
    sideSil += `<path d="M ${rz - bd / 2} ${seatTopY + baseOffset} L ${rz + bd / 2} ${seatTopY + baseOffset} L ${rz + bd / 2 + leanTop} ${backTopY + baseOffset} L ${rz - bd / 2 + leanTop} ${backTopY + baseOffset} Z" class="part" vector-effect="non-scaling-stroke"/>`;
    if (hasHead) {
      const headLean = leanTop + head.h * 0.14;
      sideSil += `<path d="M ${rz - bd / 2 + leanTop} ${backTopY + baseOffset} L ${rz + bd / 2 + leanTop} ${backTopY + baseOffset} L ${rz + bd / 2 + headLean} ${headTopY + baseOffset} L ${rz - bd / 2 + headLean} ${headTopY + baseOffset} Z" class="part" vector-effect="non-scaling-stroke"/>`;
    }
  }
  if (hasArm) {
    sideSil += `<rect x="${-seat.d * 0.32}" y="${seatTopY + baseOffset}" width="${seat.d * 0.64}" height="3" class="part-light" vector-effect="non-scaling-stroke"/>`;
  }
  sideSil += `</g>`;

  const sideDepthEdgeL = toB(-seat.d / 2, baseOffset);
  const sideDepthEdgeR = toB(seat.d / 2, baseOffset);
  const sideHeightEdgeB = toB(seat.d / 2, baseOffset);
  const sideHeightEdgeT = toB(seat.d / 2, totalH);
  const sideDims =
    dimH(sideDepthEdgeL, sideDepthEdgeR, sideDepthEdgeL[1] + 22, `${fmt(seat.d)} cm D`, sideDepthEdgeL, sideDepthEdgeR) +
    dimV(sideHeightEdgeB, sideHeightEdgeT, bCx + (seat.d / 2 + 6) * scale, `${fmt(totalH)} cm H`, sideHeightEdgeB, sideHeightEdgeT);

  const panelB = `
    ${panelFrame(bx, by, "SIDE ELEVATION")}
    ${sideSil}
    ${sideDims}
  `;

  // ---- Panel C: Top plan ----
  const cx0 = ax;
  const cy0 = ROW2_Y;
  const cCx = cx0 + PANEL_W / 2;
  const cCy = cy0 + PANEL_H / 2;
  const toC = (u: number, v: number): Pt => [cCx + u * scale, cCy + v * scale];

  let topSil = `<g transform="translate(${cCx} ${cCy}) scale(${scale} ${scale})">`;
  if (isRoundSeat) {
    topSil += `<ellipse cx="0" cy="0" rx="${seat.w / 2}" ry="${seat.d / 2}" class="part" vector-effect="non-scaling-stroke"/>`;
  } else {
    topSil += `<rect x="${-seat.w / 2}" y="${-seat.d / 2}" width="${seat.w}" height="${seat.d}" class="part" vector-effect="non-scaling-stroke"/>`;
  }
  [
    [-locX, -locZ],
    [locX, -locZ],
    [-locX, locZ],
    [locX, locZ],
  ].forEach(([lx, lz]) => {
    topSil += `<rect x="${lx - legs.w / 2}" y="${lz - legs.d / 2}" width="${legs.w}" height="${legs.d}" class="part-light" vector-effect="non-scaling-stroke"/>`;
  });
  if (back.h > 0) {
    const bd = Math.max(back.d, 2);
    topSil += `<rect x="${-back.w / 2}" y="${-seat.d / 2 - bd * 0.15}" width="${back.w}" height="${bd}" class="part-light" vector-effect="non-scaling-stroke"/>`;
  }
  topSil += `</g>`;

  const topWidthEdgeL = toC(-seat.w / 2, seat.d / 2);
  const topWidthEdgeR = toC(seat.w / 2, seat.d / 2);
  const topDepthEdgeF = toC(seat.w / 2, -seat.d / 2);
  const topDepthEdgeB = toC(seat.w / 2, seat.d / 2);
  const topDims =
    dimH(topWidthEdgeL, topWidthEdgeR, topWidthEdgeL[1] + 26, `${fmt(seat.w)} cm W`, topWidthEdgeL, topWidthEdgeR) +
    dimV(topDepthEdgeF, topDepthEdgeB, cCx + (seat.w / 2 + 6) * scale, `${fmt(seat.d)} cm D`, topDepthEdgeF, topDepthEdgeB);

  const panelC = `
    ${panelFrame(cx0, cy0, "TOP PLAN")}
    ${topSil}
    ${topDims}
  `;

  // ---- Panel D: Leg detail ----
  const dx0 = bx;
  const dy0 = ROW2_Y;
  const legInnerW = PANEL_W - PAD_L - PAD_R;
  const legInnerH = PANEL_H - PAD_T - PAD_B;
  const legScale = Math.min(legInnerW / (legs.w * 2.0 || 1), legInnerH / (legH * 1.1 || 1));
  const dCx = dx0 + PAD_L + legInnerW / 2 - 30;
  const dBaseY = dy0 + PAD_T + legInnerH - 6;

  const { d: legPath, strokeOnly } = legSilhouettePath(legShape, legs.w, legH);
  const legG = `<g transform="translate(${dCx} ${dBaseY}) scale(${legScale} ${-legScale})">
      <path d="${legPath}" class="${strokeOnly ? "part-stroke-only" : "part"}" vector-effect="non-scaling-stroke"/>
    </g>`;

  const dToScreen = (u: number, v: number): Pt => [dCx + u * legScale, dBaseY - v * legScale];
  const legWidthEdgeL = dToScreen(-legs.w / 2, 0);
  const legWidthEdgeR = dToScreen(legs.w / 2, 0);
  const legHeightEdgeB = dToScreen(legs.w / 2, 0);
  const legHeightEdgeT = dToScreen(legs.w / 2, legH);
  const legDims =
    dimH(legWidthEdgeL, legWidthEdgeR, dBaseY + 20, `${fmt(legs.w)} cm`, legWidthEdgeL, legWidthEdgeR) +
    dimV(legHeightEdgeB, legHeightEdgeT, dCx + (legs.w / 2 + 5) * legScale, `${fmt(legH)} cm`, legHeightEdgeB, legHeightEdgeT);

  const legLabel = LEG_SHAPE_LABELS[legShape] || "Custom Leg";
  const leaderStart = dToScreen(legs.w / 2, legH * 0.62);
  const leaderMid: Pt = [leaderStart[0] + 46, leaderStart[1] - 30];
  const leaderEnd: Pt = [leaderMid[0] + 90, leaderMid[1]];
  const leader = `
    <circle cx="${leaderStart[0]}" cy="${leaderStart[1]}" r="2.4" class="leader-dot"/>
    <line x1="${leaderStart[0]}" y1="${leaderStart[1]}" x2="${leaderMid[0]}" y2="${leaderMid[1]}" class="leader-line"/>
    <line x1="${leaderMid[0]}" y1="${leaderMid[1]}" x2="${leaderEnd[0]}" y2="${leaderMid[1]}" class="leader-line"/>
    <text x="${leaderMid[0] + 6}" y="${leaderMid[1] - 5}" class="leader-text">${esc(legLabel)} Leg</text>
  `;

  const panelD = `
    ${panelFrame(dx0, dy0, "LEG DETAIL — ENLARGED")}
    ${legG}
    ${legDims}
    ${leader}
  `;

  // ---- Header ----
  const projectName = opts.title || item?.name || "Custom Design";
  const header = `
    <text x="${MARGIN}" y="${MARGIN + 24}" class="doc-title">TECHNICAL SPECIFICATION DRAWING</text>
    <text x="${MARGIN}" y="${MARGIN + 46}" class="doc-subtitle" data-user-text="true">${esc(projectName)}</text>
    <text x="${PAGE_W - MARGIN}" y="${MARGIN + 24}" text-anchor="end" class="brand-text">FURNICRAFT DESIGN STUDIO</text>
    <text x="${PAGE_W - MARGIN}" y="${MARGIN + 44}" text-anchor="end" class="disclaimer-text">Customer preview — dimensions approximate, not to scale</text>
    <line x1="${MARGIN}" y1="${MARGIN + 58}" x2="${PAGE_W - MARGIN}" y2="${MARGIN + 58}" class="header-rule"/>
  `;

  // ---- Title block (part schedule) ----
  const scheduleParts = Object.keys(dims).filter((p) => (dims[p]?.h || 0) > 0 || (dims[p]?.w || 0) > 0);
  const rowH = 16;
  const scheduleRows = scheduleParts
    .slice(0, 7)
    .map((p, i) => {
      const d = get(p);
      const mat = materialNames[p] || "—";
      const y = TITLE_Y + 46 + i * rowH;
      return `
        <text x="${MARGIN + 14}" y="${y}" class="sched-cell sched-part">${esc(p)}</text>
        <text x="${MARGIN + 150}" y="${y}" class="sched-cell">${esc(mat)}</text>
        <text x="${MARGIN + 330}" y="${y}" class="sched-cell">${fmt(d.w || 0)} × ${fmt(d.h || 0)} × ${fmt(d.d || 0)} cm</text>
      `;
    })
    .join("");

  const titleBlock = `
    <rect x="${MARGIN}" y="${TITLE_Y}" width="${PAGE_W - MARGIN * 2}" height="${TITLE_H}" class="panel-border"/>
    <line x1="${MARGIN + 500}" y1="${TITLE_Y}" x2="${MARGIN + 500}" y2="${TITLE_Y + TITLE_H}" class="ext-line"/>
    <text x="${MARGIN + 14}" y="${TITLE_Y + 24}" class="sched-header">PART SCHEDULE</text>
    <text x="${MARGIN + 150}" y="${TITLE_Y + 24}" class="sched-header">MATERIAL</text>
    <text x="${MARGIN + 330}" y="${TITLE_Y + 24}" class="sched-header">DIMENSIONS (W × H × D)</text>
    ${scheduleRows}
    <text x="${MARGIN + 520}" y="${TITLE_Y + 30}" class="doc-title" font-size="16" data-user-text="true">${esc(projectName)}</text>
    <text x="${MARGIN + 520}" y="${TITLE_Y + 52}" class="sched-cell">Overall footprint: ${fmt(overallW)} × ${fmt(totalH)} × ${fmt(overallD)} cm (W×H×D)</text>
    <text x="${MARGIN + 520}" y="${TITLE_Y + 70}" class="sched-cell">Leg style: ${esc(legLabel)}${isRocking ? " · Rocking base" : ""}</text>
    <text x="${MARGIN + 520}" y="${TITLE_Y + 88}" class="sched-cell">Left arm: ${item?.isLeftArmVisible ? "Yes" : "No"} · Right arm: ${item?.isRightArmVisible ? "Yes" : "No"}</text>
    <rect x="${PAGE_W - MARGIN - 150}" y="${TITLE_Y + TITLE_H - 40}" width="150" height="28" class="size-box"/>
    <text x="${PAGE_W - MARGIN - 75}" y="${TITLE_Y + TITLE_H - 21}" text-anchor="middle" class="size-box-text">SIZE A · FC DRAWING</text>
  `;

  return `<svg viewBox="0 0 ${PAGE_W} ${PAGE_H}" width="${PAGE_W}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI',Arial,sans-serif">
    <defs>
      <marker id="bpArrow" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse">
        <path d="M0,1 L8,4.5 L0,8 Z" fill="#1a1a1a"/>
      </marker>
      <style>
        text { fill: #1a1a1a; }
        .doc-title { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; }
        .doc-subtitle { font-size: 14px; fill: #444; }
        .brand-text { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; fill: #8b5a2b; }
        .disclaimer-text { font-size: 10.5px; fill: #888; }
        .header-rule { stroke: #1a1a1a; stroke-width: 1.5; }
        .panel-border { fill: #fff; stroke: #333; stroke-width: 1.25; }
        .panel-caption { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; fill: #555; }
        .part { fill: #f4ede1; stroke: #1a1a1a; stroke-width: 1.1; }
        .part-light { fill: #f4ede1; stroke: #444; stroke-width: 0.9; }
        .part-stroke-only { fill: none; stroke: #1a1a1a; stroke-width: 1.6; }
        .hole-punch { fill: #fff; stroke: #444; stroke-width: 0.8; }
        .ext-line { stroke: #999; stroke-width: 0.75; stroke-dasharray: 2,2; }
        .dim-line { stroke: #1a1a1a; stroke-width: 0.9; }
        .dim-label-bg { fill: #fff; }
        .dim-text { font-size: 10.5px; fill: #1a1a1a; }
        .leader-line { stroke: #1a1a1a; stroke-width: 0.9; }
        .leader-dot { fill: #1a1a1a; }
        .leader-text { font-size: 11px; font-weight: 600; fill: #1a1a1a; }
        .sched-header { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; fill: #8b5a2b; }
        .sched-cell { font-size: 11.5px; fill: #222; }
        .sched-part { font-weight: 700; }
        .size-box { fill: #fff; stroke: #1a1a1a; stroke-width: 1.25; }
        .size-box-text { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; }
      </style>
    </defs>
    <rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>
    ${header}
    ${panelA}
    ${panelB}
    ${panelC}
    ${panelD}
    ${titleBlock}
  </svg>`;
}
