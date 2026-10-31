import { addToCart, readCart } from "./design-cart";
import { buildGenericPartDefs } from "./generic-rig";
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import {
  MATERIALS, allowedMaterialsForSurfaces, combineAllowedMaterials,
  materialById, supportsVarnish, varnishById, varnishForMaterial,
} from "./materials-db";
import { designStockIssues } from "./material-availability";
import { studioModel } from "./studio-models";
import { DEFAULT_PART_COLORS, DEFAULT_RIG_PARAMS, type PartId } from "./studio-config";
import { consumeStagedStudioDesign, stageStudioDesignForOpen, resolveFinish, type StudioDesignItem } from "./studio-design-state";

const model = studioModel("patio-armchair");
const woven = model.parts.find((part) => part.surface === "rattan")!;
const synthetic = materialById("synth-sandstone")!;
function design(): StudioDesignItem {
  return {
    kind: "victorian-chair-studio", type: model.id, name: "Patio chair", dims: { [woven.label]: { w: 40, h: 40, d: 40 } },
    materialNames: { [woven.label]: "Synthetic rattan - Sandstone" }, score: null, globalScale: { x: 1, y: 1, z: 1 },
    studio: { measurement: { overall: { w: 40, h: 40, d: 40 }, seatHeight: 40, parts: [] }, modelId: model.id, params: { ...DEFAULT_RIG_PARAMS }, colors: { ...DEFAULT_PART_COLORS, [woven.id]: synthetic.hex }, materials: { [woven.id]: synthetic.id } },
  };
}

test("shop/template restrictions never expand an empty intersection", () => {
  assert.deepEqual(combineAllowedMaterials([synthetic.id], ["synth-slate"]), []);
  assert.deepEqual(allowedMaterialsForSurfaces(["rattan"], []), []);
  assert.deepEqual(allowedMaterialsForSurfaces(["wood"], [synthetic.id]), []);
  assert.equal(allowedMaterialsForSurfaces(["rattan"], [synthetic.id])[0].id, synthetic.id);
  assert.ok(allowedMaterialsForSurfaces(["rattan"], null).length > 0);
});

test("synthetic rattan retains four stable colors, real texture assets, and no wood coating", () => {
  const colors = MATERIALS.filter((material) => material.family === "Synthetic rattan");
  assert.deepEqual(colors.map((material) => material.id), ["synth-slate", "synth-espresso", "synth-ash", "synth-sandstone"]);
  for (const material of colors) {
    assert.equal(material.surface, "rattan");
    assert.equal(supportsVarnish(material), false);
    assert.equal(varnishForMaterial(material, varnishById("lacquer")).roughnessScale, 1);
    assert.equal(varnishForMaterial(material, varnishById("lacquer")).clearcoat, 0);
    for (const file of ["diffuse.jpg", "normal.png", "roughness.png"]) assert.ok(existsSync(`public/textures/${material.pbr}/${file}`));
  }
  const wood = MATERIALS.find((material) => material.type === "wood")!;
  assert.equal(varnishForMaterial(wood, varnishById("satin")).id, "satin");
});

test("checkout permits stocked colors but blocks unconfirmed, changed, unknown and custom choices", () => {
  assert.deepEqual(designStockIssues(design(), [synthetic.id]), []);
  assert.ok(designStockIssues(design(), [synthetic.id], ["synth-slate"]).length);
  assert.ok(designStockIssues(design(), [synthetic.id], []).length);
  assert.ok(designStockIssues(design(), null, [synthetic.id]).length);
  for (const stock of [null, [], ["synth-slate"]]) assert.ok(designStockIssues(design(), stock).length);
  const custom = design(); custom.studio.colors[woven.id] = "#123456";
  assert.ok(designStockIssues(custom, [synthetic.id]).length);
  const unknown = design(); unknown.studio.materials![woven.id] = "removed-material";
  assert.ok(designStockIssues(unknown, [synthetic.id]).length);
  const legacy = design(); delete legacy.studio.materials;
  assert.ok(designStockIssues(legacy, [synthetic.id]).length);
  // Saved objects remain unchanged when availability is checked.
  assert.equal(custom.studio.colors[woven.id], "#123456");
});

test("checkout rejects synthetic weave on a structural leg even when the shop stocks it", () => {
  const structuralModel = studioModel("victorian-chair");
  const leg = structuralModel.parts.find((part) => part.role === "base")!;
  const item = design(); item.studio.modelId = structuralModel.id; item.dims[leg.label] = { w: 5, h: 30, d: 5 };
  item.studio.materials![leg.id] = synthetic.id; item.studio.colors[leg.id] = synthetic.hex;
  assert.ok(designStockIssues(item, [synthetic.id]).some((issue) => issue.startsWith(leg.label)));
});

test("insert materials must be stocked; hidden unused parts do not block checkout", () => {
  const item = design();
  item.studio.materials!["unused" as PartId] = "unavailable";
  assert.deepEqual(designStockIssues(item, [synthetic.id]), []);
  item.studio.apertures = { [woven.id]: [{ shape: "round", size: 0.3, x: 0, y: 0, fill: "synth-slate" }] };
  assert.ok(designStockIssues(item, [synthetic.id]).some((issue) => issue.includes("insert")));
  assert.deepEqual(designStockIssues(item, [synthetic.id, "synth-slate"]), []);
});

test("saved material ids, custom colors and an empty restriction survive reopening", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    setItem: (key: string, value: string) => data.set(key, value),
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => data.delete(key),
  } } });
  try {
    const item = design(); item.studio.colors[woven.id] = "#123456";
    assert.equal(addToCart({ item, modelName: model.name, previewUrl: "", unitPrice: 0, shopId: "local-shop", shopName: "Local shop", shopLocked: true, allowedMaterials: [] }).ok, true);
    assert.deepEqual(readCart()[0].allowedMaterials, []);
    assert.equal(stageStudioDesignForOpen(item, item.name, []), true);
    const staged = consumeStagedStudioDesign()!;
    assert.deepEqual(staged.allowedMaterials, []);
    assert.equal(staged.materials[woven.id], synthetic.id);
    assert.equal(staged.colors[woven.id], "#123456");
    item.studio.materials![woven.id] = "retired-local-weave";
    item.studio.colors[woven.id] = synthetic.hex;
    assert.equal(stageStudioDesignForOpen(item, item.name, []), true);
    assert.equal(consumeStagedStudioDesign()!.materials[woven.id], "retired-local-weave");
    assert.equal(resolveFinish(woven, synthetic.hex, "retired-local-weave"), null);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});


test("drop leaves inherit their frame material without demanding another selection", () => {
  const table = studioModel("table");
  const host = table.parts.find((part) => part.role === "tabletopBorder")!;
  const leaves = table.parts.find((part) => part.id === "leaves")!;
  const wood = MATERIALS.find((material) => material.type === "wood")!;
  const item = design();
  item.studio.modelId = table.id;
  item.dims = { [host.label]: { w: 80, h: 5, d: 80 }, [leaves.label]: { w: 20, h: 5, d: 80 } };
  item.studio.materials = { [host.id]: wood.id };
  item.studio.colors[host.id] = wood.hex;
  assert.deepEqual(designStockIssues(item, [wood.id]), []);
});


test("generated designs check build parts without requiring stock for staging linens", () => {
  const item = design();
  item.studio.modelId = "generated-local-bed";
  item.studio.source = { v: 1, storagePath: "synthetic/bed.glb", shellRoles: ["base", "bedding"], shellCount: 2, cmPerUnit: 100, name: "Local bed" };
  const parts = buildGenericPartDefs(new Set(item.studio.source.shellRoles), {}, { base: 1, bedding: 1 });
  const base = parts.find((part) => part.role === "base")!;
  const linen = parts.find((part) => part.role === "bedding")!;
  const wood = MATERIALS.find((material) => material.type === "wood")!;
  item.dims = { [base.label]: { w: 80, h: 40, d: 200 }, [linen.label]: { w: 80, h: 5, d: 200 } };
  item.studio.materials = { [base.id]: wood.id, [linen.id]: "unlisted-linen" };
  item.studio.colors[base.id] = wood.hex;
  assert.deepEqual(designStockIssues(item, [wood.id]), []);
  delete item.studio.materials[base.id];
  assert.ok(designStockIssues(item, [wood.id]).length);
});
