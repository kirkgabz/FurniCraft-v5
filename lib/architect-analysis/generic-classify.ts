import { z } from "zod";
import type { FurnitureFamily, PartRole } from "@/components/design/studio/studio-config";

/**
 * The generic-mode half of `scripts/architect-analysis.mts`'s AI step,
 * shared with the server route that drives the live-upload test at
 * `/dev/model-lab` (see `app/api/architect-analysis/route.ts`). Both callers
 * are asking the same question -- classify an unfamiliar piece's shell
 * groups by structural role -- so the vocabulary, schema and prompt text
 * live here once rather than drifting between a Node script and a route.
 */

/**
 * The vocabulary a genuinely unfamiliar chair or table has to be classified
 * against: PartRole, not PartId. Role is what chair-rig.ts actually reads to
 * build the rig ("this one stands on the floor and carries the rest"), and
 * it is shared across every model already -- unlike a PartDef list (labels
 * like "Frame" vs "Legs", blurbs written by someone who had already studied
 * that exact chair), which a real upload would not come with.
 */
export const GENERIC_ROLE_VOCAB: Partial<Record<PartRole, string>> = {
  base: "Legs, feet, or a base structure that touches the floor and carries everything above it.",
  seatFrame: "A structural frame or shell at seat height that a seat cushion rests in or on. Rides the base.",
  seatCushion: "The seating surface itself: a pad, cushion, or woven seat you actually sit on.",
  backFrame: "A structural frame, rail, or shell behind the seat, at backrest height. Rides the base and carries the back cushion.",
  backCushion: "The upholstered or woven back panel you lean against. Follows the back frame.",
  armrest: "An arm support beside the seat, if the piece has one at all.",
  accessory: "Decorative or applied detail -- carving, trim, ornament -- riding along with a structural part rather than standing on its own.",
  tabletop: "A flat working surface riding on the base (or on an apron or tabletopBorder, if either exists) -- a tabletop, desktop, or similar -- with nothing resting on top of it as a separate part.",
  apron: "A structural frame or rail BELOW a tabletop, at a clearly lower height than the top itself, tying the tops of the legs together -- a hidden support, not part of the visible top surface. If the legs run straight into the top with no such frame, there is no apron. Do NOT use this for a frame that sits in the SAME plane as the top, bordering an inset pane -- that is tabletopBorder.",
  tabletopBorder: "A frame or rim in one material, at the SAME height as the top (not below it), bordering a materially distinct inset panel -- glass, stone, a different wood -- set into the middle of it. Coplanar with the top: it is the top's own visible edge, not a hidden support underneath. Rides the base exactly like an apron would, but is a different thing to a customer, so it needs its own name.",
  stretcher: "A cross-brace lower down between the legs, adding strength -- not at top/seat height, and not the legs or base itself.",
  carcass: "The box of a storage piece -- its sides, fixed deck, top and back panel, enclosing an interior. Carries the doors, drawers and shelves fitted to it. Use this only for a piece you can store things INSIDE, never for a chair's frame.",
  shelf: "A horizontal surface INSIDE a carcass, spanning its interior, that things rest on. Sits behind the front face rather than forming part of it.",
  door: "A panel covering an opening in the front of a carcass, hinged or sliding. Spans a large part of the front face and sits proud of it, in the same plane as any drawer fronts.",
  drawer: "The visible front face of a drawer: a panel across the front of a carcass, usually one of a stack of similar panels at different heights, each much wider than it is tall.",
  hardware: "A pull, knob, or visible hinge fitted onto a door or drawer front. Small, and standing proud of the panel it is fixed to -- the frontmost thing on the piece.",
  leaf: "A board hinged along one edge of a tabletop, level with it and extending it outward, that folds down against the legs when it is not needed. Separate from the top itself and from any border around it, and always at the top's own height when raised.",
};

/**
 * The bed vocabulary. Every role has to be a part the rig can actually move
 * and a customer can actually refinish, or naming it just produces a label
 * with nothing behind it.
 *
 * It covers the bedding as well as the frame, because a downloaded bed model
 * almost always arrives made up -- a duvet, a pair of pillows -- and those
 * shells have to go somewhere. Given no word for them they were absorbed
 * into "mattress", which put a duvet on the build sheet as part of the
 * mattress and left the customer unable to restyle or strip the bed. They
 * are marked staging in the rig (see `PartDef.staging`), so they are shown
 * and refinishable but never costed: a furniture shop builds the bed, not the
 * bedlinen.
 *
 * Two things a real bed can have are knowingly absent. A four-poster's
 * posts are not their own role: they touch the floor and carry everything
 * above them, which is what `base` already means, and splitting them off
 * would leave a bed whose base is only the feet. A canopy or tester has no
 * pivot in the rig at all -- there is nothing above head height for it to
 * ride -- so it is left to fall to `accessory` rather than promised a
 * control that does not exist.
 *
 * Slats, a solid platform and a box spring are deliberately ONE role rather
 * than three. They sit in the same place, do the same job and are moved
 * identically by the rig; the only thing that differs is what the part gets
 * called, which `buildGenericPartDefs` settles from the shell count without
 * needing the AI to commit to a distinction the geometry may not support.
 */
export const BED_ROLE_VOCAB: Partial<Record<PartRole, string>> = {
  base: "Legs, feet, posts, or a plinth that touches the floor and carries the whole bed. On a four-poster the tall corner posts belong here too -- they stand on the floor and carry everything, whatever else they also do higher up.",
  bedRail: "The side and end rails: the horizontal frame at mattress height that the mattress sits inside. Rides the base and does NOT touch the floor.",
  mattress: "The sleeping surface itself -- the mattress, or a single thick pad filling the rails. One solid slab, usually the topmost horizontal thing on the piece.",
  mattressSupport: "Whatever the mattress rests ON, spanning between the rails just BELOW it: a row of slats, a solid platform, or a box spring / foundation. Use this for all three -- many near-identical thin boards in a row at one height, or a single slab directly under the mattress.",
  headboard: "The upright panel standing at the head end of the bed -- the taller of the two end panels, and the only one if there is just one.",
  headboardPanel: "An upholstered, caned or otherwise materially distinct insert set INTO the headboard, framed by it. Only use this when the headboard is genuinely two parts; a single solid headboard is just \"headboard\".",
  footboard: "The upright panel standing at the foot end -- the opposite end from the headboard, and nearly always the shorter of the two. Many beds have none at all.",
  bedding: "The flat layers dressed OVER the mattress: sheets, a blanket, a comforter, a duvet, a quilt. Softer and more irregular than the mattress under it, usually overhanging the rails, and normally the topmost broad thing on the piece.",
  pillows: "The pillows at the head end, lying on top of the mattress or bedding. Typically two matching shells side by side, small next to the mattress and well up the bed toward the headboard.",
  accessory: "Decorative or applied detail -- a finial, a carving, applied trim -- riding along with a structural part rather than standing on its own.",
};

/**
 * One vocabulary per family. See `FurnitureFamily` in studio-config.ts for
 * why the lists are scoped rather than pooled into one.
 */
export const ROLE_VOCAB_BY_FAMILY: Record<FurnitureFamily, Partial<Record<PartRole, string>>> = {
  generic: GENERIC_ROLE_VOCAB,
  bed: BED_ROLE_VOCAB,
};

/** What the piece is called in the prompt's own opening sentence. */
const FAMILY_NOUN: Record<FurnitureFamily, string> = {
  generic: "chair-shaped piece of furniture",
  bed: "bed",
};

/**
 * What the piece is called when the shop has said what kind it is.
 *
 * The generic vocabulary covers storage pieces as well as chairs and tables
 * (carcass, shelf, door, drawer), but the prompt opened by calling every one
 * of them "chair-shaped" -- telling the model a cabinet was a chair before it
 * had looked. Chairs and stools keep the original wording exactly, so the
 * accuracy history recorded against the shipped chairs stays comparable.
 */
export const PIECE_NOUNS: Record<string, string> = {
  chair: FAMILY_NOUN.generic,
  stool: FAMILY_NOUN.generic,
  table: "table",
  desk: "desk",
  sofa: "sofa",
  bed: "bed",
  cabinet: "cabinet or other storage piece",
  bookshelf: "bookshelf or other storage piece",
};

export const AiGroupLabel = z.object({
  groupIndex: z.number(),
  partId: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export const AiResponse = z.object({ groups: z.array(AiGroupLabel) });

export type GenericShellGroupInfo = {
  groupIndex: number;
  materialName: string;
  surface: string;
  memberCount: number;
  vertexCountMin: number;
  vertexCountMax: number;
  triCountTotal: number;
  box: { min: [number, number, number]; max: [number, number, number] };
};

export type Box3Like = { min: [number, number, number]; max: [number, number, number] };

/**
 * The family-specific guidance, appended after the shared paragraphs about
 * the up-axis and about many-small-shell groups (both of which are true of
 * any piece, so they stay outside this).
 *
 * Every paragraph here exists because of a mistake a real run made, or a
 * mistake the geometry makes obvious in advance. They are written against
 * the ambiguity, not against the furniture: what the numbers alone cannot
 * settle is what needs a sentence.
 */
function familyGuidance(family: FurnitureFamily, upAxis: "x" | "y" | "z"): string {
  if (family === "bed") {
    return `A bed is longer than it is wide. Its LONG horizontal axis (whichever of x or z spans the greater distance -- read it off the model's own dimensions below) runs head to foot, and the two upright panels at either extreme of that axis are the headboard and the footboard. They are the same shape as each other and only their position and height tell them apart: the TALLER one is the headboard, the shorter one at the opposite extreme is the footboard. If there is only one such panel, it is the headboard -- plenty of beds have no footboard at all, and none have a footboard and no headboard.

A made-up bed is a stack of broad horizontal layers at nearly the same height, and telling them apart is the whole difficulty here. Read them by ORDER, from the bottom up: "mattressSupport" is lowest, sitting between the rails; "mattress" is the solid slab resting on it; "bedding" is whatever is dressed over the mattress; "pillows" sit on top at the head end. A model may be missing any of them -- plenty of beds are modelled bare -- so never invent a layer that is not there. Assign each broad layer you actually see to its place in that order rather than expecting all four.

The support is below the mattress and may be a row of many repeated thin boards, a solid platform, or a box spring; all three are "mattressSupport". The bedding is above the mattress, is usually the softest and most irregular shape on the piece, and often overhangs the rails where a mattress would not. If there is only ONE broad slab and nothing over it, it is the mattress, not bedding. Pillows are small repeated shells high up the bed near the headboard -- do not call the whole top layer pillows because a pillow is visible in it.

The rails and the base are told apart by the floor, not by shape. A rail runs horizontally at mattress height and its lowest extreme is well clear of the floor; anything reaching the lowest extreme of ${upAxis} is base. A platform bed whose sides run in one unbroken surface from the floor all the way up to the mattress is "base", not "bedRail" -- the rig treats "base" as the one thing everything else rides on, so a floor-to-mattress structure has to be it, and a bed left with no base at all has no height control and nothing to stand on.`;
  }

  return `Some chairs are built with their legs, seat rails and backrest as one continuously connected piece (legs mortised straight into the seat rails and back stiles, with no seam the mesh split could find) rather than as separate shells. When ONE group's bounding box spans nearly the full height of the piece -- reaching all the way down to the floor AND all the way up to backrest height, at the low extreme of ${upAxis} through the high extreme -- classify that whole group as "base", never "backFrame". The rig treats "base" as the one thing everything else rides on, so a floor-to-ceiling frame has to be it; calling that same shape "backFrame" instead would leave the piece with no base at all, which is worse than not distinguishing the backrest.

A table's top is sometimes two different groups at the same height: a border or frame in one material bordering a distinct pane -- glass, stone, a different wood -- set into the middle of it. Every part built from this piece can only wear ONE finish, so lumping a wood border and a glass pane into the same "tabletop" role loses the glass entirely -- the customer would never be offered a glass finish for it. When you see this shape (a ring or frame in one material at top height, with a materially distinct, usually smaller group filling the space it borders), check the HEIGHT of the border against the pane it surrounds: if the border sits at the SAME height as the pane -- coplanar, its top face flush with the pane's, together forming one continuous top surface -- call the border "tabletopBorder", not "apron", and reserve "tabletop" for the inset pane. Only call a border "apron" when it is clearly LOWER than the top surface it supports -- a hidden structural rail the top rests on, not part of the top's own visible face. A table can have a genuine "apron" (below the top, holding the legs together) at the same time as a "tabletopBorder" does not exist, or vice versa -- judge each by its own height relative to the pane, not by assuming one or the other.`;
}

export function buildGenericPrompt(
  target: {
    displayName: string;
    upAxis: "x" | "y" | "z";
    family?: FurnitureFamily;
    category?: string;
    /** The image carries each group's number printed on it (the in-app pipeline draws them; the CLI script does not). */
    numbered?: boolean;
  },
  groups: GenericShellGroupInfo[],
  modelBox: Box3Like,
  legend?: Array<{ groupIndex: number; color: string }>
): string {
  const { displayName, upAxis, family = "generic", category, numbered = false } = target;
  // Chairs, stools and an unnamed piece keep the original sentence word for
  // word; see PIECE_NOUNS.
  const noun = category && Object.hasOwn(PIECE_NOUNS, category) ? PIECE_NOUNS[category] : null;
  const named = noun && noun !== FAMILY_NOUN.generic ? noun : null;
  const size: [number, number, number] = [
    modelBox.max[0] - modelBox.min[0],
    modelBox.max[1] - modelBox.min[1],
    modelBox.max[2] - modelBox.min[2],
  ];
  const vocab = (Object.entries(ROLE_VOCAB_BY_FAMILY[family]) as [PartRole, string][])
    .map(([role, desc]) => `- "${role}": ${desc}`)
    .join("\n");

  const groupLines = groups
    .map((g) => {
      const [minX, minY, minZ] = g.box.min;
      const [maxX, maxY, maxZ] = g.box.max;
      const frac = (lo: number, hi: number, min: number, s: number) =>
        `${(s > 0 ? (lo - min) / s : 0).toFixed(2)}-${(s > 0 ? (hi - min) / s : 0).toFixed(2)}`;
      const countNote =
        g.memberCount === 1
          ? `1 shell, ${g.vertexCountMin} vertices, ${g.triCountTotal} triangles`
          : `${g.memberCount} nearly-identical shells (${g.vertexCountMin}-${g.vertexCountMax} vertices each, ${g.triCountTotal} triangles combined) -- likely a repeated element like a weave, a row of spindles, or a set of legs, not one solid piece`;
      return (
        `Group ${g.groupIndex}: material="${g.materialName}" surface="${g.surface}" -- ${countNote}\n` +
        `  their COMBINED bounding box, as a fraction of the whole piece (0=one extreme, 1=the other): ` +
        `x=${frac(minX, maxX, modelBox.min[0], size[0])} y=${frac(minY, maxY, modelBox.min[1], size[1])} z=${frac(minZ, maxZ, modelBox.min[2], size[2])}`
      );
    })
    .join("\n");

  const seeing = legend ? "an image of the piece, plus" : "just";
  const intro = `You are labeling the parts of an UNFAMILIAR ${named ?? FAMILY_NOUN[family]} called "${displayName}" from ${seeing} geometric measurements -- no part list written specifically for this piece. This simulates a customer uploading a ${named ?? (family === "bed" ? "bed" : "chair")} the system has never seen before.\n\nThe model's mesh was split into disconnected "shells", then shells sharing a material and a similar size were grouped together into ${groups.length} groups (a woven seat made of hundreds of individual strands is one group, not hundreds of rows). Classify EVERY group by its structural ROLE -- exactly one of these, which apply to any ${named ? "such" : family === "bed" ? "bed-shaped" : "chair-shaped"} piece:`;

  const legendBlock = legend
    ? `\n\nThe attached image shows the piece with every group painted a distinct flat colour (materials and real textures are not shown -- colour means group membership only, nothing else). This is the legend:\n${legend
        .map((l) => `- Group ${l.groupIndex}: ${l.color}`)
        .join("\n")}\nLook at the actual shape each colour covers before answering -- the colour tells you which group, the picture tells you what it is.${
        numbered
          ? " Each group's number is also printed on the image, in a white circle on a visible spot of that group: where two groups look alike in colour, go by the number."
          : ""
      }`
    : "";

  // The whole piece's own dimensions, so the bed guidance's "whichever
  // horizontal axis is longer runs head to foot" is answerable from the
  // prompt rather than from an axis convention the file may not follow.
  // Bed-only on purpose: the generic prompt has a measured accuracy history
  // against the 5 shipped models, and silently adding a sentence to it would
  // make every number recorded before today incomparable to every number
  // after, for a line nothing in the chair/table guidance asks about.
  const dimensions =
    family === "bed"
      ? ` The whole piece measures x=${size[0].toFixed(3)}, y=${size[1].toFixed(3)}, z=${size[2].toFixed(3)} in its own units.`
      : "";

  return `${intro}
${vocab}
${legendBlock}

In this model's coordinate space, +${upAxis} points up (away from the floor): the group(s) that reach the lowest extreme of ${upAxis} are almost always the base, and a backrest sits toward the high extreme of ${upAxis}.${dimensions} A group of many small shells is not automatically a minor accessory -- judge it by what its COMBINED bounding box covers: many tiny shells whose union spans a large, contiguous area of the piece (most of its width and depth at seat or back height) are very likely a woven or slatted surface doing real structural work, exactly like a single solid cushion would. A group is a minor accessory only when its combined footprint is itself small.

${familyGuidance(family, upAxis)}

${groupLines}

Return one entry per group index, 0 through ${groups.length - 1}. The "partId" field in your answer should be one of the roles listed above (a role, since this piece has no part list of its own).`;
}
