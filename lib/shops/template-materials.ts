import { MATERIALS } from "../../components/design/studio/materials-db";

/**
 * A template's material list, as it is saved and as it is edited.
 *
 * design_templates.allowed_materials is null for "every material", a list for
 * a restriction. The picker shows both as ticks -- every box ticked for null --
 * so what is saved has to turn a full set of ticks back into null. Saving the
 * full list instead was the publish failure: every finish in the catalogue is
 * 593 ids, and the column caps the list (design_templates_allowed_materials_sane)
 * because a list that long means nothing a null does not.
 */

const CATALOGUE_IDS = MATERIALS.map((material) => material.id);
const KNOWN = new Set(CATALOGUE_IDS);

/** What to write: null for none ticked or all of them, otherwise the known ids ticked, once each, in catalogue order. */
export function templateMaterialsForSave(ticked: readonly string[]): string[] | null {
  const chosen = new Set(ticked.filter((id) => KNOWN.has(id)));
  if (chosen.size === 0 || chosen.size === KNOWN.size) return null;
  return CATALOGUE_IDS.filter((id) => chosen.has(id));
}

/** What the picker opens with: a saved null is every material, so every box is ticked. */
export function templateMaterialsForEdit(saved: readonly string[] | null | undefined): string[] {
  return saved == null ? [...CATALOGUE_IDS] : saved.filter((id) => KNOWN.has(id));
}

/** A database refusal of the material list, in words a shop can act on. */
export function templateSaveErrorMessage(message: string | undefined, fallback: string): string {
  if (message && /allowed_materials/i.test(message)) {
    return "The materials and colors list could not be saved. Select all, or tick fewer, and save again.";
  }
  return message || fallback;
}
