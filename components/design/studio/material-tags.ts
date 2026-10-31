import type { PartId, PartRole, Surface } from "./studio-config";
import { materialById } from "./materials-db";
import { ROLE_TO_CANONICAL_PART_ID, STAGING_ROLES, UPHOLSTERY_ONLY_ROLES } from "./generic-rig";
import { STUDIO_MODELS, type StudioModel, type StudioModelId } from "./studio-models";
import { parseStudioDesign } from "./studio-design-state";

/**
 * What a piece of furniture is made of, as a handful of tags a customer can
 * browse by: all wood, cushioned, rattan and cane, and the rest.
 *
 * Worked out, never typed in. Every part already carries a surface -- the
 * palette it is built from -- and every finish chosen for a part carries its
 * own, so the tags follow the piece as it is actually designed. A shop that
 * gives a template a glass top gets a Glass tag without thinking about it, and
 * a tag can never claim a material the design does not use. The one free-text
 * `tag` a template already has is a different thing (a room, a mood) and is
 * left alone.
 */

export type MaterialTagId = "all-wood" | "cushioned" | "rattan-cane" | "metal" | "glass" | "stone";

/** In the order they are shown and offered as filters. */
export const MATERIAL_TAGS: ReadonlyArray<{ id: MaterialTagId; label: string }> = [
  { id: "all-wood", label: "All wood" },
  { id: "cushioned", label: "Has cushions" },
  { id: "rattan-cane", label: "Rattan & cane" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Glass" },
  { id: "stone", label: "Stone" },
];

type TaggablePart = { id: PartId; role: PartRole; surface: Surface; staging?: boolean };

/**
 * The tags for a set of parts, each in the finish chosen for it where one was.
 *
 * Two kinds of part are left out, because neither is what a piece is MADE of:
 * staging -- a bed's duvet and pillows, which a furniture shop does not build -- and
 * hardware. A timber cabinet with brass pulls is a wooden cabinet; tagged by
 * its handles it read as "Metal", which is a different piece of furniture.
 */
export function materialTagsFor(
  parts: TaggablePart[],
  finishes: Partial<Record<PartId, string>> = {}
): MaterialTagId[] {
  const surfaces = parts
    .filter((part) => !part.staging && part.role !== "hardware")
    .map((part) => materialById(finishes[part.id])?.surface ?? part.surface);
  if (surfaces.length === 0) return [];

  const uses = (...wanted: Surface[]) => surfaces.some((surface) => wanted.includes(surface));
  const tags: MaterialTagId[] = [];
  if (surfaces.every((surface) => surface === "wood")) tags.push("all-wood");
  if (uses("cloth")) tags.push("cushioned");
  if (uses("rattan", "cane")) tags.push("rattan-cane");
  if (uses("metal")) tags.push("metal");
  if (uses("glass")) tags.push("glass");
  if (uses("stone")) tags.push("stone");
  return tags;
}

/** A shipped model as it opens: its own parts in the finishes it opens with. */
export function materialTagsForModel(model: StudioModel): MaterialTagId[] {
  return materialTagsFor(model.parts, model.defaultFinishes ?? {});
}

/**
 * A saved design -- a template or an order -- as it was saved.
 *
 * A generated piece has no part list to look up, only the role of each shell.
 * Its parts are rebuilt here the way the rig builds them for a generated
 * model: cushion roles in cloth, everything else in timber, until a finish
 * says otherwise.
 */
export function materialTagsForDesign(cadState: unknown): MaterialTagId[] {
  const design = parseStudioDesign(cadState);
  if (!design) return [];

  if (design.source) {
    const parts = [...new Set(design.source.shellRoles)].map((role) => ({
      id: ROLE_TO_CANONICAL_PART_ID[role],
      role,
      surface: (UPHOLSTERY_ONLY_ROLES.has(role) ? "cloth" : "wood") as Surface,
      staging: STAGING_ROLES.has(role),
    }));
    return materialTagsFor(parts, design.materials);
  }

  const model = STUDIO_MODELS[design.modelId as StudioModelId];
  if (!model) return [];
  return materialTagsFor(model.parts, { ...(model.defaultFinishes ?? {}), ...design.materials });
}
