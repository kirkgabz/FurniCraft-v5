import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumeStagedStudioDesign,
  peekStagedModel,
  STUDIO_OPEN_KEY,
  stageStudioDesignForOpen,
  rememberStudioDesignForReturn,
  restoreStudioDesignForReturn,
} from "./studio-design-state";

function withStaging(run: (storage: Map<string, string>) => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const browserStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: browserStorage, sessionStorage: browserStorage } });
  try {
    run(storage);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("a cached chair cannot discard the next table template", () => withStaging((storage) => {
  const payload = JSON.stringify({
    name: "Beachcroft table", modelId: "generated-table",
    source: { v: 1, storagePath: "synthetic/table.glb", shellRoles: ["base"], shellCount: 1, cmPerUnit: 100, name: "Table" },
    allowedMaterials: ["synth-slate"], originShopId: "local-shop", originShopName: "Local shop",
  });
  storage.set(STUDIO_OPEN_KEY, payload);
  assert.equal(consumeStagedStudioDesign("generated-chair"), null);
  assert.equal(storage.get(STUDIO_OPEN_KEY), payload);
  assert.equal(peekStagedModel()?.kind, "generated");
  const restored = consumeStagedStudioDesign("generated-table")!;
  assert.equal(restored.modelId, "generated-table");
  assert.equal(restored.name, "Beachcroft table");
  assert.deepEqual(restored.allowedMaterials, ["synth-slate"]);
  assert.deepEqual(restored.originShop, { id: "local-shop", name: "Local shop" });
  assert.equal(storage.has(STUDIO_OPEN_KEY), false);
  assert.equal(consumeStagedStudioDesign("generated-table"), null);
}));

test("shipped and legacy designs retain their model identity", () => withStaging((storage) => {
  storage.set(STUDIO_OPEN_KEY, JSON.stringify({ modelId: "table", name: "Table" }));
  assert.equal(consumeStagedStudioDesign("victorian-chair"), null);
  assert.equal(consumeStagedStudioDesign("table")?.name, "Table");
  storage.set(STUDIO_OPEN_KEY, JSON.stringify({ name: "Old chair" }));
  assert.equal(consumeStagedStudioDesign("table"), null);
  assert.equal(consumeStagedStudioDesign("victorian-chair")?.modelId, "victorian-chair");
}));

test("malformed staging is cleared without preventing the next design", () => withStaging((storage) => {
  for (const invalid of ["not json", "null", "42"]) {
    storage.set(STUDIO_OPEN_KEY, invalid);
    assert.equal(consumeStagedStudioDesign("table"), null);
    assert.equal(storage.has(STUDIO_OPEN_KEY), false);
  }
  storage.set(STUDIO_OPEN_KEY, JSON.stringify({ modelId: "table", name: "Next table" }));
  assert.equal(consumeStagedStudioDesign("table")?.name, "Next table");
}));


test("Back from Review restores the latest design, stock restrictions and cart identity", () => withStaging(() => {
  const item = { kind: "victorian-chair-studio", name: "Table", studio: {
    modelId: "table", params: { width: 1.2 }, colors: {}, materials: { legs: "retired-local-wood" },
  } };
  rememberStudioDesignForReturn(item, "Before editing");
  rememberStudioDesignForReturn(item, "Edited table", [], { id: "saved-design", kind: "saved" }, "cart-line", { id: "shop", name: "Local shop" });
  restoreStudioDesignForReturn("table");
  const restored = consumeStagedStudioDesign("table")!;
  assert.equal(restored.name, "Edited table");
  assert.equal(restored.materials.legs, "retired-local-wood");
  assert.deepEqual(restored.allowedMaterials, []);
  assert.equal(restored.cartLineId, "cart-line");
  assert.equal(restored.customerDesignId, "saved-design");
  assert.equal(restored.originShop?.id, "shop");
}));

test("a return snapshot cannot replace an explicit template or a different catalog model", () => withStaging(() => {
  const table = { kind: "victorian-chair-studio", studio: { modelId: "table" } };
  const chair = { kind: "victorian-chair-studio", studio: { modelId: "victorian-chair" } };
  rememberStudioDesignForReturn(table, "Old table");
  restoreStudioDesignForReturn("victorian-chair");
  assert.equal(consumeStagedStudioDesign(), null);
  assert.equal(stageStudioDesignForOpen(chair, "New chair"), true);
  restoreStudioDesignForReturn();
  assert.equal(consumeStagedStudioDesign()?.name, "New chair");
}));

test("a template's piece reopened from an order is still locked to its shop", () => withStaging(() => {
  // The order page stages the piece without knowing it was a template; the
  // shop it belongs to is read off the piece itself.
  const item = { kind: "victorian-chair-studio", name: "Chair", originShopId: "shop-a", originShopName: "Shop A",
    studio: { modelId: "table" } };
  assert.equal(stageStudioDesignForOpen(item, "Order: Chair"), true);
  assert.deepEqual(consumeStagedStudioDesign("table")?.originShop, { id: "shop-a", name: "Shop A" });
}));
