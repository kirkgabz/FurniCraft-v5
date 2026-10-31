import type { MaterialProfile } from "../design/studio/materials-db";

/** Catalog colors are composed at runtime; translate their labels, never IDs. */
export function materialLabel(material: MaterialProfile, t: (text: string) => string): string {
  if (!material.baseMaterialId || !material.colorName) return t(material.name);
  const separator = material.name.lastIndexOf(" · ");
  if (separator < 0) return t(material.name);
  return `${t(material.name.slice(0, separator))} · ${t(material.colorName)}`;
}
