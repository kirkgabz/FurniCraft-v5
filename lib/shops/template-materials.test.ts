import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIALS } from "../../components/design/studio/materials-db";
import { templateMaterialsForEdit, templateMaterialsForSave, templateSaveErrorMessage } from "./template-materials";

const ALL = MATERIALS.map((material) => material.id);

/** The rule the live column enforces after 20261102090000; null always passes. */
function columnAccepts(value: string[] | null): boolean {
  if (value === null) return true;
  return value.length >= 1 && value.length <= 1000 && value.join(",").length <= 40000;
}

/** The rule it enforced before that migration, which the publish failure hit. */
function oldColumnAccepts(value: string[] | null): boolean {
  if (value === null) return true;
  return value.length >= 1 && value.length <= 160 && value.join(",").length <= 6000;
}

test("Select all saves as null -- every material -- and passes even the old cap", () => {
  assert.equal(templateMaterialsForSave(ALL), null);
  assert.equal(oldColumnAccepts(templateMaterialsForSave(ALL)), true);
  // What used to be sent, and why it failed.
  assert.equal(oldColumnAccepts(ALL), false);
});

test("nothing ticked also saves as null", () => {
  assert.equal(templateMaterialsForSave([]), null);
});

test("a large partial selection fits the raised cap", () => {
  const most = ALL.slice(0, ALL.length - 1);
  const saved = templateMaterialsForSave(most);
  assert.equal(saved?.length, ALL.length - 1);
  assert.equal(columnAccepts(saved), true);
});

test("duplicates and unknown ids are dropped; order follows the catalogue", () => {
  const saved = templateMaterialsForSave(["wood-molave", "retired-finish", "wood-narra", "wood-narra"]);
  assert.deepEqual(saved, ["wood-narra", "wood-molave"]);
});

test("a template saved as null opens with every box ticked, and saves back as null", () => {
  const opened = templateMaterialsForEdit(null);
  assert.equal(opened.length, ALL.length);
  assert.equal(templateMaterialsForSave(opened), null);
  assert.deepEqual(templateMaterialsForEdit(["wood-narra", "gone"]), ["wood-narra"]);
});

test("a refused list reads as an instruction, not a constraint name", () => {
  assert.match(
    templateSaveErrorMessage('new row for relation "design_templates" violates check constraint "design_templates_allowed_materials_sane"', "x"),
    /could not be saved/
  );
  assert.equal(templateSaveErrorMessage(undefined, "Could not publish that template."), "Could not publish that template.");
});
