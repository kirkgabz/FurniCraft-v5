import { MATERIALS, materialById, materialCategoryOf, type MaterialProfile } from "../../components/design/studio/materials-db";
import { MATERIAL_COLOR_CATEGORIES, type MaterialColorCategory } from "../../components/design/studio/material-colors";

export const STOCK_COLOR_CATEGORIES = MATERIAL_COLOR_CATEGORIES;
export type StockColorCategory = MaterialColorCategory;

const COLOR_CATEGORIES: Partial<Record<StockColorCategory, readonly string[]>> = {
  primary: ["cloth-royal-blue", "cloth-burgundy", "cloth-ochre"],
  secondary: ["cloth-violet", "cloth-aubergine", "cloth-emerald", "metal-powder-olive", "plastic-pp-sage"],
  pastel: ["cloth-blush"],
  neutral: ["panel-mdf-white", "panel-mdf-graphite", "bamboo-charcoal", "bamboo-bleached", "cane-bleached", "cane-black", "synth-slate", "synth-ash", "reed-charcoal", "cloth-charcoal", "cloth-vinyl-black", "cloth-velvet-dove", "cloth-velvet-pewter", "leather-black", "metal-matte-black", "metal-powder-white", "metal-wrought-iron", "composite-carbon-twill", "composite-carbon-matte", "plastic-pp-white", "plastic-pp-black", "plastic-hdpe-marine"],
};

export function stockColorCategory(material: MaterialProfile): StockColorCategory {
  if (material.colorCategory) return material.colorCategory;
  for (const category of STOCK_COLOR_CATEGORIES) {
    if (COLOR_CATEGORIES[category.id]?.includes(material.id)) return category.id;
  }
  if (material.type === "glass" || material.id === "plastic-acrylic-clear") return "clear";
  if (material.type === "metal" || material.id === "cane-bronze") return "metallic";
  return "natural";
}

/**
 * A finish's name when it is listed under its material, as a colour. A
 * material's own untinted finish is its group, so naming it after the group
 * ("Narra" under Narra) repeats the heading -- it is listed as "Natural".
 */
export function stockColorLabel(material: MaterialProfile): string {
  if (material.colorName) return material.colorName;
  return stockMaterialGroup(material).id === material.id ? "Natural" : material.name;
}

export function stockMaterialGroup(material: MaterialProfile): { id: string; label: string } {
  if (material.baseMaterialId) {
    const base = materialById(material.baseMaterialId);
    if (base) return stockMaterialGroup(base);
  }
  // Distinct wood species, stone types and sheet materials are not colors of
  // one another. Keep their individual stock declarations separate.
  //
  // Bamboo too: each of its four finishes (natural, honey, smoked, bleached)
  // is its own stock with its own painted colours in the catalogue, so lumping
  // them under one "Bamboo" listed every paint colour four times -- four
  // identical "Red" swatches, each a different stock the shop never meant.
  if (["Hardwood", "Plantation timber", "Softwood", "Stone", "Outdoor polymer", "Bamboo"].includes(material.family ?? "")
    || ["panel-marine-ply", "panel-laminate-oak", "cloth-abaca", "cloth-canvas-natural"].includes(material.id)) {
    return { id: material.id, label: material.name };
  }
  if (material.id.startsWith("panel-mdf-")) return { id: "mdf", label: "Painted MDF" };
  if (material.family === "Moulded polymer") return { id: "polypropylene", label: "Polypropylene" };
  return { id: material.family ?? material.id, label: material.family ?? material.name };
}

export const STOCK_MATERIALS = Array.from(MATERIALS.reduce((groups, material) => {
  const group = stockMaterialGroup(material);
  const existing = groups.get(group.id);
  if (existing) existing.colors.push(material);
  else groups.set(group.id, { ...group, category: materialCategoryOf(material), colors: [material] });
  return groups;
}, new Map<string, { id: string; label: string; category: ReturnType<typeof materialCategoryOf>; colors: MaterialProfile[] }>()).values());

/**
 * The listed finish nearest to one the shop does not list, for a part showing
 * stock the shop never declared.
 *
 * Nearest in the order a customer would expect: the same material in a colour
 * the shop has (its natural finish first), then anything in the part's own
 * surface, then the first listed finish the part can take at all. `permitted`
 * is the part's own permitted list, in its panel's order.
 */
export function closestStockedFinish(
  current: MaterialProfile | null,
  permitted: readonly MaterialProfile[],
  partSurface: MaterialProfile["surface"]
): MaterialProfile | null {
  if (!permitted.length) return null;
  if (current) {
    const group = stockMaterialGroup(current).id;
    const sameMaterial = permitted.filter((material) => stockMaterialGroup(material).id === group);
    if (sameMaterial.length) return sameMaterial.find((material) => !material.baseMaterialId) ?? sameMaterial[0];
  }
  return permitted.find((material) => material.surface === partSurface) ?? permitted[0];
}

export function selectedStockMaterials(value: readonly string[]): string[] {
  const selected = new Set(value);
  return STOCK_MATERIALS.filter((group) => group.colors.some((color) => selected.has(color.id))).map((group) => group.id);
}

/** Pending material checkboxes count too: every enabled material needs a color. */
export function materialStockIssues(value: readonly string[], enabledMaterials = selectedStockMaterials(value)): string[] {
  const selected = new Set(value);
  const issues: string[] = [];
  const knownIds = new Set(MATERIALS.map((material) => material.id));
  if (!value.some((id) => knownIds.has(id))) issues.push("Select at least one available material and its color.");
  if (value.some((id) => !knownIds.has(id))) issues.push("Remove unavailable catalog colors before saving.");
  for (const group of STOCK_MATERIALS) {
    if (enabledMaterials.includes(group.id) && !group.colors.some((color) => selected.has(color.id))) {
      issues.push(`${group.label}: choose at least one available color.`);
    }
  }
  return issues;
}
