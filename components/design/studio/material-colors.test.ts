import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIAL_COLORS } from "./material-colors";
import { MATERIALS, materialById, allowedMaterialsForSurfaces, combineAllowedMaterials, defaultMaterialForSurface } from "./materials-db";
import { STOCK_MATERIALS, selectedStockMaterials, materialStockIssues, stockColorCategory } from "../../../lib/shops/material-stock";
import { designStockIssues } from "./material-availability";
import { consumeStagedStudioDesign, resolveFinish, stageStudioDesignForOpen, type StudioDesignItem } from "./studio-design-state";
import { studioModel } from "./studio-models";
import { DEFAULT_PART_COLORS, DEFAULT_RIG_PARAMS } from "./studio-config";

test("each timber offers real primary, secondary, pastel, neutral and earth colors", () => {
  const woods = MATERIALS.filter((material) => !material.baseMaterialId && material.family === "Hardwood");
  for (const wood of woods) {
    const group = STOCK_MATERIALS.find((group) => group.id === wood.id)!;
    assert(group.colors.includes(wood));
    for (const color of MATERIAL_COLORS) {
      const variant = materialById(`${wood.id}--${color.id}`)!;
      assert(variant, `${wood.name} needs ${color.name}`);
      assert.equal(variant.hex, color.hex);
      assert.equal(stockColorCategory(variant), color.category);
      assert.equal(variant.baseMaterialId, wood.id);
      assert(group.colors.includes(variant));
    }
  }
});

test("new colors retain material identity, compatible surfaces and relief without dark scanned albedo", () => {
  const ids = ["wood-narra", "panel-marine-ply", "panel-mdf-white", "bamboo-natural", "cane-honey", "cloth-violet", "cloth-abaca", "cloth-canvas-natural", "leather-tan", "metal-powder-white", "plastic-pp-white"];
  for (const id of ids) {
    const base = materialById(id)!;
    const colored = materialById(`${id}--red`)!;
    assert(colored, `${id} needs a red color choice`);
    assert.equal(colored.type, base.type);
    assert.equal(colored.surface, base.surface);
    assert.equal(colored.pbr, base.pbr);
    assert.equal(colored.albedo, false);
    assert.equal(colored.keepsScanPattern, false);
    assert.equal(colored.gain, 1);
    assert.deepEqual(selectedStockMaterials([colored.id]), selectedStockMaterials([id]));
  }
  assert.equal(MATERIALS.length, new Set(MATERIALS.map((material) => material.id)).size);
});

test("legacy natural colors/defaults stay unchanged and fixed factory finishes stay fixed", () => {
  assert.equal(materialById("wood-narra")!.hex, "#e0a878");
  assert.equal(defaultMaterialForSurface("wood")!.id, "wood-narra");
  for (const id of ["stone-carrara", "glass-clear", "synth-slate", "plastic-acrylic-clear", "panel-laminate-oak", "composite-carbon-twill"]) {
    assert.equal(materialById(`${id}--red`), null);
    assert(materialById(id));
  }
  assert.equal(STOCK_MATERIALS.find((group) => group.label === "Synthetic rattan")!.colors.length, 4);
  assert.deepEqual(materialStockIssues(["wood-narra--red"]), []);
  assert(materialStockIssues(["wood-narra--red"], ["wood-narra", "wood-molave"]).some((issue) => issue.startsWith("Molave:")));
});

test("shop and template colors filter exactly; a natural color never grants its entire palette", () => {
  const stocked = ["wood-narra--red", "wood-narra--blue"];
  assert.deepEqual(allowedMaterialsForSurfaces(["wood"], stocked).map((material) => material.id), stocked);
  assert.deepEqual(allowedMaterialsForSurfaces(["cloth"], stocked), []);
  assert.deepEqual(allowedMaterialsForSurfaces(["wood"], ["wood-narra"]).map((material) => material.id), ["wood-narra"]);
  assert.deepEqual(combineAllowedMaterials(["wood-narra--red"], stocked), ["wood-narra--red"]);
  assert.deepEqual(combineAllowedMaterials(["wood-narra"], stocked), []);
});

test("colored designs resolve, save/reopen and validate exact stock without changing the original species", () => {
  const model = studioModel("victorian-chair");
  const part = model.parts.find((part) => part.role === "base")!;
  const finish = materialById("wood-narra--red")!;
  const item: StudioDesignItem = {
    kind: "victorian-chair-studio", type: model.id, name: "Red Narra chair", dims: { [part.label]: { w: 5, h: 30, d: 5 } },
    materialNames: { [part.label]: finish.name }, score: null, globalScale: { x: 1, y: 1, z: 1 },
    studio: { modelId: model.id, measurement: { overall: { w: 40, h: 80, d: 40 }, seatHeight: 40, parts: [] }, params: { ...DEFAULT_RIG_PARAMS }, colors: { ...DEFAULT_PART_COLORS, [part.id]: finish.hex }, materials: { [part.id]: finish.id } },
  };
  assert.equal(resolveFinish(part, finish.hex, finish.id), finish);
  assert.deepEqual(designStockIssues(item, [finish.id]), []);
  assert(designStockIssues(item, ["wood-narra"]).length);
  assert(designStockIssues(item, ["wood-narra--blue"]).length);
  assert(designStockIssues(item, null).length);
  const storage = new Map<string, string>();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { setItem: (key: string, value: string) => storage.set(key, value), getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key) } } });
  try {
    assert.equal(stageStudioDesignForOpen(item, item.name, [finish.id]), true);
    const reopened = consumeStagedStudioDesign()!;
    assert.equal(reopened.materials[part.id], finish.id);
    assert.equal(reopened.colors[part.id], finish.hex);
    assert.deepEqual(reopened.allowedMaterials, [finish.id]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
