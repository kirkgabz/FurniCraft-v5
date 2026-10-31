import { buildGenericPartDefs } from "./generic-rig";
import { materialById, materialsForSurfaces, combineAllowedMaterials } from "./materials-db";
import { surfacesForPart, type PartDef, type PartId, type PartRole } from "./studio-config";
import { resolveStudioModel, type StudioDesignItem } from "./studio-design-state";

/** Check measured build parts, excluding removed parts and staging accessories. */
export function designStockIssues(item: StudioDesignItem, stock: string[] | null | undefined, templateMaterials?: string[] | null): string[] {
  if (!stock?.length) return ["This shop has not confirmed its material stock. Ask it to list the materials it can supply before ordering."];
  const permitted = combineAllowedMaterials(templateMaterials, stock) ?? stock;
  const issues: string[] = [];
  const resolution = resolveStudioModel(item.studio.modelId, item.studio.source);
  if (resolution.kind === "missing" || !Object.keys(item.dims).length) return ["Reopen this design and select listed materials before ordering."];
  const roleCounts: Partial<Record<PartRole, number>> = {};
  if (resolution.kind === "generated") {
    for (const role of resolution.source.shellRoles) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  const modelParts = resolution.kind === "shipped" ? resolution.model.parts : buildGenericPartDefs(
    new Set(resolution.source.shellRoles), {},
    roleCounts
  );
  const parts: Array<{ id: PartId; label: string; definition?: PartDef }> = modelParts
    .filter((part) => !part.staging && Object.hasOwn(item.dims, part.label))
    .map((part) => ({ id: part.id, label: part.label, ...(resolution.kind === "shipped" ? { definition: part } : {}) }));
  if (!parts.length) return ["Reopen this design and select listed materials before ordering."];
  for (const part of parts) {
    // Drop leaves inherit the top/frame's stock; they have no independent picker.
    const materialPart = part.id === "leaves"
      ? modelParts.find((entry) => ["tabletopBorder", "apron", "seatFrame"].includes(entry.role)) ?? modelParts.find((entry) => entry.role === "tabletop") ?? part
      : part;
    const id = item.studio.materials?.[materialPart.id];
    const material = materialById(id);
    const compatible = material && (!part.definition || materialsForSurfaces(surfacesForPart(part.definition)).some((entry) => entry.id === id));
    if (!material || !compatible || !permitted.includes(material.id) || item.studio.colors[materialPart.id]?.toLowerCase() !== material.hex.toLowerCase()) {
      issues.push(`${part.label}: select a material and color listed by this shop.`);
    }
    const holes = item.studio.apertures?.[part.id] ?? [];
    for (const hole of holes) {
      if (hole.fill && (!materialById(hole.fill) || !permitted.includes(hole.fill))) issues.push(`${part.label} insert: select a material listed by this shop.`);
    }
  }
  return issues;
}
