import * as THREE from "three";
import type { PartDef, PartId, PartRole, RigParamKey, SizeControl, Surface } from "./studio-config";
import type { RawShell, ShellClassifier, SurfaceResolver } from "./chair-segmentation";
import { CONTACT_TOLERANCE_OF_HEIGHT, groupTouchingShells } from "./shell-contact";
import { materialById } from "./materials-db";

/**
 * Builds a `classify`/`resolveSurface`/`parts` triple for a model that has
 * none hand-written -- an upload the AI-vision pipeline has just labeled,
 * rather than one of the 5 shipped models a person studied and measured.
 * `chair-rig.ts`'s assembly engine needs nothing else: it already reads
 * only `PartRole` and bounding boxes, with no per-model branching anywhere
 * in it (see the plan this was built from).
 */

/**
 * One canonical PartId per PartRole. `buildChairRig`'s `byRole` map assumes
 * at most one part per role; picking a single fixed id per role up front
 * guarantees that invariant instead of hoping the AI never produces two
 * ids for the same role.
 */
export const ROLE_TO_CANONICAL_PART_ID: Record<PartRole, PartId> = {
  leaf: "leaves",
  base: "legs",
  seatFrame: "seatFrame",
  seatCushion: "seatCushion",
  backFrame: "backFrame",
  backCushion: "backCushion",
  armrest: "armrests",
  accessory: "ornaments",
  tabletop: "tabletop",
  apron: "apron",
  tabletopBorder: "tabletopBorder",
  stretcher: "stretchers",
  bedRail: "bedRail",
  mattress: "mattress",
  headboard: "headboard",
  headboardPanel: "headboardPanel",
  footboard: "footboard",
  mattressSupport: "mattressSupport",
  bedding: "bedding",
  pillows: "pillows",
  carcass: "carcass",
  shelf: "shelves",
  door: "doors",
  drawer: "drawers",
  hardware: "handles",
};

/**
 * `base` alone is deliberately generic, wide enough to cover every shape the
 * 5 hand-tuned models actually gave it -- the Victorian and rattan chairs
 * call this role "Legs", the cushion chair calls it "Frame", the stool
 * calls it "Caned drum" -- each picked by a person who had looked at the
 * mesh. `buildGenericPartDefs` picks between this fallback and "Legs" using
 * the one signal available without a person looking: how many separate
 * groups of touching shells the role has. `base` is the one role never merged
 * across shells (see `PER_SHELL_ROLES` in chair-rig.ts -- each leg needs its
 * own slot to spread independently), so that count is a real signal, not an
 * artifact: several groups standing apart really is legs; one connected
 * group is a moulded base/frame or a pedestal no single "leg" word fits.
 */
const GENERIC_LABELS: Record<PartRole, { label: string; blurb: string }> = {
  leaf: {
    label: "Drop leaves",
    blurb: "Boards hinged along the edges of the top. Raise one to extend the table; leave it hanging when you do not need it.",
  },
  base: { label: "Base", blurb: "Stands on the floor and carries everything above it." },
  seatFrame: { label: "Seat frame", blurb: "Structural frame at seat height, under the seat cushion." },
  seatCushion: { label: "Seat cushion", blurb: "The seating surface itself." },
  backFrame: { label: "Back frame", blurb: "Structural frame behind the seat, at backrest height." },
  backCushion: { label: "Back cushion", blurb: "The panel you lean against." },
  armrest: { label: "Armrests", blurb: "Arm supports beside the seat." },
  accessory: { label: "Accessory", blurb: "Decorative or applied detail riding along with a structural part." },
  tabletop: { label: "Tabletop", blurb: "The flat surface you set things on." },
  apron: { label: "Apron", blurb: "The under-frame tying the legs together, just below the top." },
  tabletopBorder: {
    label: "Tabletop Border",
    blurb: "The border framing the top's centre panel, in the same plane as the top itself.",
  },
  stretcher: { label: "Stretcher", blurb: "A cross-brace between the legs for added strength." },
  bedRail: { label: "Bed rails", blurb: "The side and end rails that carry the mattress." },
  mattress: { label: "Mattress", blurb: "The sleeping surface resting inside the rails." },
  headboard: { label: "Headboard", blurb: "The panel standing at the head of the bed." },
  headboardPanel: { label: "Headboard panel", blurb: "The padded or woven insert set into the headboard." },
  footboard: { label: "Footboard", blurb: "The panel standing at the foot of the bed." },
  mattressSupport: { label: "Mattress base", blurb: "The platform the mattress lies on, spanning the rails." },
  bedding: { label: "Bedding", blurb: "The sheets and covers layered over the mattress." },
  pillows: { label: "Pillows", blurb: "The pillows at the head of the bed." },
  carcass: { label: "Carcass", blurb: "The box itself -- sides, deck, top and back -- that everything else is fitted to." },
  shelf: { label: "Shelves", blurb: "Horizontal surfaces inside the carcass." },
  door: { label: "Doors", blurb: "Front panels closing against the carcass." },
  drawer: { label: "Drawer fronts", blurb: "The visible faces of the drawers." },
  hardware: { label: "Handles", blurb: "Pulls and knobs fitted to the doors and drawers." },
};

/**
 * Swapped in for `GENERIC_LABELS.mattressSupport` when the support turns out
 * to be several separate shells rather than one.
 *
 * Same signal, and the same reasoning, as the base/legs choice above: a
 * mattress can rest on a run of slats, a solid platform or a box spring, and
 * the rig moves all three identically, so they share one role. What tells
 * them apart without a person looking is how many shells the role has --
 * a dozen separate boards really are slats; one connected shell is a
 * platform or a foundation, which "Slats" would be plainly wrong for.
 */
const SLATS_LABEL = { label: "Slats", blurb: "The row of boards spanning the rails that the mattress lies on." };

/**
 * Roles that are shown and refinishable but never costed -- see
 * `PartDef.staging`. A furniture shop is being asked to build a bed, not the
 * bedlinen dressed over it, but a bed rendered bare would not look like the
 * model that was uploaded.
 */
export const STAGING_ROLES = new Set<PartRole>(["bedding", "pillows"]);

/** Swapped in for `GENERIC_LABELS.base` when the base has more than one shell -- see the comment above. */
const LEGS_LABEL = { label: "Legs", blurb: "The individual legs that stand on the floor and lift everything above." };

/**
 * Swapped in for `GENERIC_LABELS.tabletop` whenever an `apron` or a
 * `tabletopBorder` is also present. Plain "Tabletop" is right for a single,
 * uniform top -- but once there is a bordering frame, the tabletop role is
 * specifically the panel that frame surrounds (a glass or stone inset is the
 * case this was built for), not the whole visible top surface the frame is
 * also part of. The more specific name says what it actually is instead of
 * implying it is everything the eye reads as "the top". Either bordering
 * role produces the same label here -- the distinction between a genuine
 * below-the-top `apron` and a coplanar `tabletopBorder` only matters for the
 * border part's own label/blurb, not for what the inset panel it surrounds
 * is called.
 */
const TABLETOP_CENTER_LABEL = {
  label: "Tabletop Center",
  blurb: "The inset panel at the centre of the top, bordered by the frame around it.",
};

/**
 * Opens a painted generated model in each part's "Original" finish.
 *
 * With no finish chosen, a part renders in DEFAULT_PART_COLORS -- and on a
 * model carrying its own paint, that colour multiplies the paint: a walnut
 * pedestal came out salmon, a bronze plinth pale. "Original" is white, which
 * is the one tint that leaves the paint exactly as Meshy made it, so a shop
 * reviewing a textured piece sees what it paid for. An unpainted model gets
 * nothing here and opens as before.
 */
export function originalFinishesFor(parts: PartDef[], scene: THREE.Object3D): Partial<Record<PartId, string>> | undefined {
  let painted = false;
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    if (list.some((entry) => (entry as THREE.MeshStandardMaterial).map)) painted = true;
  });
  if (!painted) return undefined;

  const finishes: Partial<Record<PartId, string>> = {};
  for (const part of parts) {
    const original = `${part.surface}-original`;
    if (materialById(original)) finishes[part.id] = original;
  }
  return finishes;
}

/**
 * How many raw shells ended up on each role, for `buildGenericPartDefs`'s
 * base/legs label choice.
 *
 * The base is counted in groups of shells that touch, which is what the rig
 * gives a slot each (see shell-contact.ts). A pedestal that arrived as five
 * layers is one object, and calling it "Legs" was the label that gave the
 * misreading away.
 */
export function shellCountByRoleFrom(shellRoles: PartRole[], rawShells: RawShell[]): Partial<Record<PartRole, number>> {
  const counts: Partial<Record<PartRole, number>> = {};
  for (const role of shellRoles) counts[role] = (counts[role] ?? 0) + 1;

  const base = rawShells.filter((_, index) => shellRoles[index] === "base");
  if (base.length > 1) {
    const whole = new THREE.Box3();
    for (const raw of rawShells) whole.union(raw.worldBox);
    const tolerance = CONTACT_TOLERANCE_OF_HEIGHT * (whole.max.y - whole.min.y);
    counts.base = groupTouchingShells(
      base.map((raw) => ({ geometry: raw.geometry, matrix: raw.mesh.matrixWorld })),
      tolerance
    ).length;
  }
  return counts;
}

/**
 * materialName heuristic -- there is no per-model resolver for an unfamiliar
 * upload, only whatever the exporter happened to name each material.
 */
export const genericResolveSurface: SurfaceResolver = (material) => {
  const name = (material.name ?? "").toLowerCase();
  if (/cane|rattan|wicker|weave|woven/.test(name)) return "rattan";
  if (/fabric|cloth|leather|upholst|velvet|linen|suede/.test(name)) return "cloth";
  if (/glass|glas\b/.test(name)) return "glass";
  return "wood";
};

/**
 * Turns an array of AI-predicted roles -- one per raw shell, in the exact
 * order `splitMeshesIntoShells` produced them -- into a classifier
 * `classifyAndBakeShells` can call. Relies on that function visiting shells
 * in that same, single-pass, deterministic order every time; see the doc
 * comment on `classifyAndBakeShells` for why that holds.
 */
export function buildAiClassifier(shellRoles: PartRole[]): ShellClassifier {
  return (_shell, index?: number) => ROLE_TO_CANONICAL_PART_ID[shellRoles[index ?? -1] ?? "base"];
}

/**
 * `chair-rig.ts` reads a handful of roles as a fallback chain, only checking
 * the next when every earlier one is entirely absent (e.g.
 * `byRole.get("seatFrame") ?? byRole.get("apron") ?? byRole.get("tabletopBorder")`,
 * `byRole.get("seatCushion") ?? byRole.get("tabletop")`) -- each chain is
 * meant to be mutually exclusive, one rig slot, several possible labels. The
 * AI doesn't know that: on a real table it split one physical structure's
 * shells across two roles in a chain (calling one shell "tabletopBorder" and
 * an equally border-ish one "apron"). Left alone, `??` would silently drop
 * every role after the first one found -- the first lookup succeeding means
 * the rest are never even evaluated, so those shells would just vanish from
 * the rig, not merely be mislabeled. This merges every role in `group` into
 * whichever one the shells most often agreed on, mutating `shellRoles` in
 * place, so exactly one role of the group ever reaches
 * `buildGenericPartDefs`. Call once per aliased group, passing every role in
 * that group at once -- merging only two at a time when three alias to the
 * same slot can still leave a real conflict between the untouched pair.
 *
 * Prefer `consolidateAliasedRoles`, which walks `ALIASED_ROLE_GROUPS` for
 * you: every caller needs all of them, and a caller that forgets one loses
 * those shells silently.
 */
export function consolidateAliasedRoleGroup(shellRoles: PartRole[], group: PartRole[]): void {
  const counts = group.map((role) => ({ role, count: shellRoles.filter((r) => r === role).length }));
  const present = counts.filter(({ count }) => count > 0);
  if (present.length <= 1) return;

  const winner = present.reduce((best, next) => (next.count > best.count ? next : best)).role;
  const losers = new Set(group.filter((role) => role !== winner));
  for (let i = 0; i < shellRoles.length; i++) {
    if (losers.has(shellRoles[i])) shellRoles[i] = winner;
  }
}

/**
 * Every set of roles `chair-rig.ts` reads as one `??` fallback chain -- one
 * rig slot, several names for it depending on what the piece is. The list
 * lives here, beside the merge that consumes it, so adding a role to a chain
 * in the rig has exactly one other place to update rather than one per
 * caller. Kept in sync by hand with the four chains at the top of
 * `buildChairRig` plus its `stretcher`/`slats` lookup.
 */
export const ALIASED_ROLE_GROUPS: PartRole[][] = [
  ["seatFrame", "apron", "tabletopBorder", "bedRail"],
  ["seatCushion", "tabletop", "mattress"],
  ["backFrame", "headboard"],
  ["backCushion", "headboardPanel"],
  ["stretcher", "mattressSupport"],
  ["armrest", "pillows"],
];

/** Runs `consolidateAliasedRoleGroup` over every chain in `ALIASED_ROLE_GROUPS`. */
export function consolidateAliasedRoles(shellRoles: PartRole[]): void {
  for (const group of ALIASED_ROLE_GROUPS) consolidateAliasedRoleGroup(shellRoles, group);
}

/** A shell's own low extreme within this fraction of the model's total height counts as touching the floor. */
const FLOOR_TOUCH_FRACTION = 0.05;

/**
 * Guarantees at least one shell ends up labeled "base", mutating
 * `shellRoles` in place. Some chairs are built with their legs, seat rails
 * and backrest as one continuously connected mesh -- no seam for the
 * connected-component split to find -- and the AI, forced to pick one role
 * for a shape that is genuinely both, has been observed to call the whole
 * thing "backFrame" and leave the piece with no base at all. That is worse
 * than an imperfect label: `buildChairRig` has nothing to build a base
 * pivot from, so no height/thickness control exists at all.
 *
 * This is a deterministic backstop, not a replacement for the AI's answer:
 * it only ever activates when nothing was already called "base", and even
 * then only relabels shells that geometrically touch the floor -- the same
 * signal every hand-written classifier in chair-segmentation.ts keys its
 * own floor threshold on.
 */
export function ensureBaseRole(rawShells: RawShell[], shellRoles: PartRole[], worldModelBox: THREE.Box3): void {
  if (shellRoles.some((role) => role === "base")) return;

  const height = worldModelBox.max.y - worldModelBox.min.y;
  if (height <= 0) return;

  rawShells.forEach((raw, index) => {
    const fraction = (raw.worldBox.min.y - worldModelBox.min.y) / height;
    if (fraction <= FLOOR_TOUCH_FRACTION) shellRoles[index] = "base";
  });
}

/**
 * Roles the AI gives to parts of a frame that the rig then lifts off the floor.
 *
 * Each of these rides the base: taller legs raise them by as much as the
 * legs grew. That is right for a back frame sitting on a chair's seat and
 * wrong for one whose runners stand on the floor -- the runners would float.
 * Stretchers are left out on purpose: a rocking chair's runners are
 * stretchers that do touch the floor, and the rig keeps those grounded.
 */
const RIDES_THE_BASE = new Set<PartRole>(["backFrame", "armrest", "seatFrame"]);

/**
 * Relabels as `base` any frame shell that stands on the floor, mutating
 * `shellRoles` in place.
 *
 * The AI is told this already -- a group reaching from the floor to the
 * backrest is the base, never the back frame -- and does not always listen:
 * a lounge chair whose side runners and back posts came out as one piece was
 * called "Back frame", which would have lifted its runners into the air the
 * moment the legs were lengthened. The floor is a fact of the geometry, so
 * this does not wait for the AI to get it right. Beds are left alone: a
 * headboard reaching the floor is still a headboard.
 */
export function groundFrameShells(
  rawShells: RawShell[],
  shellRoles: PartRole[],
  worldModelBox: THREE.Box3,
  family: "generic" | "bed"
): void {
  if (family === "bed") return;
  const height = worldModelBox.max.y - worldModelBox.min.y;
  if (height <= 0) return;

  rawShells.forEach((raw, index) => {
    if (!RIDES_THE_BASE.has(shellRoles[index])) return;
    const fraction = (raw.worldBox.min.y - worldModelBox.min.y) / height;
    if (fraction <= FLOOR_TOUCH_FRACTION) shellRoles[index] = "base";
  });
}

/**
 * A pull or a knob is a small thing fitted to a panel. Anything called
 * `hardware` whose own box is longer than this share of the whole piece's is
 * not one, whatever the AI said.
 */
const HARDWARE_MAX_FRACTION = 0.2;

/**
 * Demotes a "handle" that is far too big to be one, mutating `shellRoles` in
 * place.
 *
 * Measured: a pedestal coffee table came back as three parts -- top, pedestal,
 * plinth -- and the pedestal was labelled `hardware`. The rig counter-scales
 * hardware so a pull keeps its size as the door it sits on grows, so the
 * pedestal was shrunk to a knob and the table fell apart on screen. Size is
 * the one thing that is never in doubt here, so it decides: a storage piece's
 * oversized "handle" is part of its carcass, and anything else's is structure
 * holding the piece up.
 */
export function demoteOversizedHardware(rawShells: RawShell[], shellRoles: PartRole[], worldModelBox: THREE.Box3): void {
  const pieceSpan = worldModelBox.getSize(new THREE.Vector3()).length();
  if (pieceSpan <= 0) return;
  const hasCarcass = shellRoles.includes("carcass");
  const span = new THREE.Vector3();

  rawShells.forEach((raw, index) => {
    if (shellRoles[index] !== "hardware") return;
    if (raw.worldBox.getSize(span).length() <= HARDWARE_MAX_FRACTION * pieceSpan) return;
    shellRoles[index] = hasCarcass ? "carcass" : "base";
  });
}

/**
 * Swaps the seat and back cushions when the AI has them the wrong way up,
 * mutating `shellRoles` in place.
 *
 * Measured, not supposed: the same lounge chair, labelled twice, came back
 * once with its cushions right and once with the upright back pad called the
 * seat and the seat pad called the back -- which put the seat height at the
 * top of the backrest and sized the wrong pad from each slider. A seat is
 * lower than the back it leans against on every chair and sofa there is, so
 * the order of the two is settled by the geometry, not the answer.
 */
export function orderCushions(rawShells: RawShell[], shellRoles: PartRole[], family: "generic" | "bed"): void {
  if (family === "bed") return;
  const centreOf = (role: PartRole) => {
    const box = new THREE.Box3();
    rawShells.forEach((raw, index) => {
      if (shellRoles[index] === role) box.union(raw.worldBox);
    });
    return box.isEmpty() ? null : (box.min.y + box.max.y) / 2;
  };
  const seat = centreOf("seatCushion");
  const back = centreOf("backCushion");
  if (seat === null || back === null || seat <= back) return;

  for (let index = 0; index < shellRoles.length; index++) {
    if (shellRoles[index] === "seatCushion") shellRoles[index] = "backCushion";
    else if (shellRoles[index] === "backCushion") shellRoles[index] = "seatCushion";
  }
}

const GENERIC_CONTROLS_BY_KEY: Record<RigParamKey, Omit<SizeControl, "key">> = {
  // Leaves. A foreign upload will not have them -- nothing infers a hinge
  // line from imported geometry -- but the map is exhaustive by type, and
  // these are the labels if one ever declares the role.
  leafWidth: { label: "Leaf width", hint: "How far a raised leaf reaches out", min: 0, max: 1.6, step: 0.01 },
  leafWest: { label: "Left leaf", hint: "0 hangs it down, 1 raises it level", min: 0, max: 1, step: 0.02 },
  leafEast: { label: "Right leaf", hint: "0 hangs it down, 1 raises it level", min: 0, max: 1, step: 0.02 },
  leafNorth: { label: "Back leaf", hint: "0 hangs it down, 1 raises it level", min: 0, max: 1, step: 0.02 },
  leafSouth: { label: "Front leaf", hint: "0 hangs it down, 1 raises it level", min: 0, max: 1, step: 0.02 },
  legHeight: { label: "Height", hint: "Stretches the base and lifts everything above", min: 0.8, max: 1.25, step: 0.01 },
  legThickness: { label: "Thickness", hint: "Thickens the base in place", min: 0.85, max: 1.2, step: 0.01 },
  seatWidth: { label: "Width", hint: "Widens the piece", min: 0.85, max: 1.2, step: 0.01 },
  seatDepth: { label: "Depth", hint: "Deepens the piece", min: 0.85, max: 1.2, step: 0.01 },
  seatCushionThickness: { label: "Thickness", hint: "Plumps the seat cushion", min: 0.7, max: 1.4, step: 0.01 },
  backHeight: { label: "Back height", hint: "Grows the backrest upward", min: 0.85, max: 1.2, step: 0.01 },
  backCushionThickness: { label: "Thickness", hint: "Pads the back cushion", min: 0.7, max: 1.4, step: 0.01 },
  armScale: { label: "Size", hint: "Zero removes the armrests", min: 0, max: 1.3, step: 0.01 },
  ornamentScale: { label: "Size", hint: "Zero removes the ornament", min: 0, max: 1.3, step: 0.01 },
  apronThickness: { label: "Thickness", hint: "Thickens the rail in place", min: 0.5, max: 1.6, step: 0.01 },
  stretcherThickness: { label: "Thickness", hint: "Thickens the stretcher in place", min: 0.3, max: 1.6, step: 0.01 },
  footboardHeight: { label: "Foot height", hint: "Grows the footboard upward; zero removes it", min: 0, max: 1.3, step: 0.01 },
  beddingThickness: { label: "Loft", hint: "Piles the bedding higher; zero strips the bed", min: 0, max: 1.6, step: 0.01 },
  cabinetHeight: { label: "Height", hint: "Grows the carcass upward from its base", min: 0.8, max: 1.25, step: 0.01 },
  shelfThickness: { label: "Shelf thickness", hint: "Zero removes the shelves", min: 0, max: 1.6, step: 0.01 },
  handleScale: { label: "Handle size", hint: "Zero removes the handles", min: 0, max: 1.4, step: 0.01 },
  // Counts, and deliberately narrower here than on the hand-tuned cabinet.
  // The rig can only switch on leaves and shelves an uploaded mesh actually
  // contained, and nothing has measured that upload's bay: offering four
  // shelves on a piece that shipped with one would promise boards the rig has
  // no geometry to draw.
  shelfCount: { label: "Shelves", hint: "How many shelves divide the bay", min: 0, max: 4, step: 1 },
  doorCount: { label: "Doors", hint: "Zero leaves the opening without doors", min: 0, max: 2, step: 1 },
  drawerCount: { label: "Drawers", hint: "How many drawers divide the run", min: 0, max: 2, step: 1 },
};

/**
 * Per-role wording for a control whose generic name is wrong on that role.
 * The mechanism is shared -- a mattress and a seat pad plump through the
 * same pivot -- but the words a customer reads should be about the piece in
 * front of them, not about the chair the slot was first written for.
 *
 * `seatDepth` is the clearest case: "Depth" is a chair's own word, measured
 * as you sit in it. A table or a bed is read from above, where its two
 * horizontal dimensions are width and length.
 */
const CONTROL_OVERRIDES: Partial<Record<string, { label: string; hint: string }>> = {
  "tabletop:seatCushionThickness": { label: "Thickness", hint: "Thickens the slab" },
  "tabletop:seatDepth": { label: "Length", hint: "Lengthens the top, seen from above" },
  "mattress:seatCushionThickness": { label: "Thickness", hint: "Plumps the mattress" },
  "mattress:seatDepth": { label: "Length", hint: "Lengthens the bed, head to foot" },
  "mattress:seatWidth": { label: "Width", hint: "Widens the bed" },
  "headboard:backHeight": { label: "Head height", hint: "Grows the headboard upward" },
  "headboardPanel:backCushionThickness": { label: "Thickness", hint: "Pads the headboard panel" },
  "bedRail:apronThickness": { label: "Thickness", hint: "Thickens the rails in place" },
  "mattressSupport:stretcherThickness": { label: "Thickness", hint: "Thickens the mattress base in place" },
  "pillows:armScale": { label: "Size", hint: "Zero removes the pillows" },
};

/**
 * Which role owns the piece's overall Width/Length sliders, most specific
 * first. It is whichever part a customer reads AS the size of the piece: a
 * table's top and a bed's mattress each have a footprint that simply IS the
 * piece's footprint seen from above, so they claim it ahead of the frame
 * underneath them. A chair has neither, so it falls through to its seat
 * frame, and a piece with no frame at all falls through to its base --
 * mirroring the precedent the 5 shipped models set (the cushion chair
 * exposes backHeight on its back cushion because it has no back frame part).
 * Only the first role actually present wins; the rest are never added, so
 * the same slider never appears twice under two names.
 */
const SIZE_OWNER_PRIORITY: PartRole[] = ["tabletop", "mattress", "seatFrame", "bedRail", "base"];

/** Same idea for the upward-growing rear panel: its frame if there is one, else the pad itself. */
const BACK_HEIGHT_OWNER_PRIORITY: PartRole[] = ["backFrame", "headboard", "backCushion", "headboardPanel"];

/**
 * Deliberately looser than the 5 hand-tuned models' curated ranges -- there
 * is no measured joinery to avoid clipping on an unfamiliar upload, so this
 * favors staying safe over being generous. An accepted limitation of a first
 * standalone test, not a bug.
 */
export function buildGenericPartDefs(
  rolesPresent: Set<PartRole>,
  surfaceByRole: Partial<Record<PartRole, Surface>>,
  shellCountByRole: Partial<Record<PartRole, number>>
): PartDef[] {
  const keysByRole = new Map<PartRole, RigParamKey[]>();
  const add = (role: PartRole, ...keys: RigParamKey[]) => {
    if (!rolesPresent.has(role)) return false;
    keysByRole.set(role, [...(keysByRole.get(role) ?? []), ...keys]);
    return true;
  };

  add("base", "legHeight", "legThickness");
  // `.some` stops at the first role actually present -- see
  // SIZE_OWNER_PRIORITY. `apron`/`tabletopBorder`/`bedRail` are deliberately
  // absent from that list: chair-rig.ts's seatPivot already scales the frame
  // in lockstep with whatever claims seatWidth/seatDepth (the top or
  // mattress nests inside it), so exposing a second, separate Width/Length
  // slider under the frame as well would just double the same control under
  // two different names. They get their own thickness control below instead.
  SIZE_OWNER_PRIORITY.some((role) => add(role, "seatWidth", "seatDepth"));
  BACK_HEIGHT_OWNER_PRIORITY.some((role) => add(role, "backHeight"));
  add("seatCushion", "seatCushionThickness");
  add("tabletop", "seatCushionThickness");
  add("mattress", "seatCushionThickness");
  add("backCushion", "backCushionThickness");
  add("headboardPanel", "backCushionThickness");
  add("armrest", "armScale");
  add("accessory", "ornamentScale");
  add("stretcher", "stretcherThickness");
  add("mattressSupport", "stretcherThickness");
  add("bedding", "beddingThickness");
  add("pillows", "armScale");
  add("apron", "apronThickness");
  add("tabletopBorder", "apronThickness");
  add("bedRail", "apronThickness");
  add("footboard", "footboardHeight");

  return [...rolesPresent].map((role) => {
    const { label, blurb } =
      role === "base" && (shellCountByRole.base ?? 0) >= 2
        ? LEGS_LABEL
        : role === "mattressSupport" && (shellCountByRole.mattressSupport ?? 0) >= 2
          ? SLATS_LABEL
          : role === "tabletop" && (rolesPresent.has("apron") || rolesPresent.has("tabletopBorder"))
            ? TABLETOP_CENTER_LABEL
            : GENERIC_LABELS[role];
    const controls: SizeControl[] = (keysByRole.get(role) ?? []).map((key) => {
      const override = CONTROL_OVERRIDES[`${role}:${key}`];
      const { min, max, step } = GENERIC_CONTROLS_BY_KEY[key];
      return override ? { key, ...override, min, max, step } : { key, ...GENERIC_CONTROLS_BY_KEY[key] };
    });
    const fallbackSurface = UPHOLSTERY_ONLY_ROLES.has(role) ? "cloth" : "wood";
    return {
      id: ROLE_TO_CANONICAL_PART_ID[role],
      role,
      label,
      blurb,
      surface: surfaceByRole[role] ?? fallbackSurface,
      ...(STAGING_ROLES.has(role) ? { staging: true } : {}),
      controls,
    };
  });
}

/**
 * Roles that can never be built in solid wood: a "cushion" is a pad or a
 * woven surface (cloth, rattan or cane are all real -- the rattan chair's
 * own woven seat and back are "cane"), never a plank. A materialName
 * heuristic guessing "wood" for one is far more likely to be an ambiguously
 * named fabric than a shop genuinely offering a wooden seat pad, so it is
 * excluded outright rather than merely disfavoured.
 */
export const UPHOLSTERY_ONLY_ROLES = new Set<PartRole>([
  "seatCushion",
  "backCushion",
  "mattress",
  "headboardPanel",
  "bedding",
  "pillows",
]);

/**
 * The surface each role's parts should render in, picked as whichever
 * `genericResolveSurface` result covers the most vertices among that
 * role's shells -- a role can span shells from more than one material
 * (e.g. a base that mixes bare wood legs with a caned stretcher).
 */
export function surfaceByRoleFrom(rawShells: RawShell[], shellRoles: PartRole[]): Partial<Record<PartRole, Surface>> {
  const weightByRoleAndSurface = new Map<PartRole, Map<Surface, number>>();
  rawShells.forEach((raw, index) => {
    const role = shellRoles[index];
    if (!role) return;
    const surface = genericResolveSurface(raw.material);
    if (UPHOLSTERY_ONLY_ROLES.has(role) && surface === "wood") return;
    const bySurface = weightByRoleAndSurface.get(role) ?? new Map<Surface, number>();
    bySurface.set(surface, (bySurface.get(surface) ?? 0) + raw.vertexCount);
    weightByRoleAndSurface.set(role, bySurface);
  });

  const result: Partial<Record<PartRole, Surface>> = {};
  for (const role of new Set(shellRoles)) {
    const bySurface = weightByRoleAndSurface.get(role);
    if (bySurface && bySurface.size > 0) {
      // Glass wins outright rather than by vertex count, even as a minority
      // of the role's shells. A glass pane is always a small, deliberate
      // inset -- never a segmentation stray -- so if the AI's role
      // classification imperfectly folds a larger wood/other shell into the
      // same role (the shells this pipeline sees are inherently ambiguous;
      // see the two nearly-identical stretcher shelves this was diagnosed
      // against, occasionally misclassified into "tabletop" alongside a
      // genuine glass pane), a plain vertex-weighted vote would let that
      // larger shell outweigh the glass and hide the finish the customer
      // uploaded the model to get in the first place. Losing majority-vote
      // "purity" on a role costs nothing visible; losing glass entirely
      // does.
      if (bySurface.has("glass")) {
        result[role] = "glass";
        continue;
      }
      let best: Surface = "wood";
      let bestWeight = -1;
      for (const [surface, weight] of bySurface) {
        if (weight > bestWeight) {
          best = surface;
          bestWeight = weight;
        }
      }
      result[role] = best;
    } else if (UPHOLSTERY_ONLY_ROLES.has(role)) {
      // Every shell the AI put in this cushion role happened to read as
      // wood -- fall back to cloth rather than let the "?? wood" default
      // downstream put a plank finish on a seat pad.
      result[role] = "cloth";
    }
  }
  return result;
}
