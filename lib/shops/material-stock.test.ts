import assert from "node:assert/strict";
import { test } from "node:test";
import { MATERIALS, allowedMaterialsForSurfaces } from "../../components/design/studio/materials-db";
import { closestStockedFinish, materialStockIssues, selectedStockMaterials, STOCK_COLOR_CATEGORIES, STOCK_MATERIALS, stockColorCategory, stockColorLabel } from "./material-stock";

test("each bamboo finish is its own material, so no paint colour is listed twice", () => {
  for (const id of ["bamboo-natural", "bamboo-honey", "bamboo-charcoal", "bamboo-bleached"]) {
    const group = STOCK_MATERIALS.find((entry) => entry.id === id);
    assert.ok(group, id);
    const labels = group.colors.map(stockColorLabel);
    assert.equal(new Set(labels).size, labels.length, `${id} has duplicate colour names`);
  }
  for (const group of STOCK_MATERIALS) {
    const labels = group.colors.map(stockColorLabel);
    assert.equal(new Set(labels).size, labels.length, `${group.label} lists a colour twice`);
  }
});

test("a part showing unlisted stock moves to the nearest listed finish", () => {
  const byId = (id: string) => MATERIALS.find((material) => material.id === id)!;
  // Same material in a listed colour first.
  assert.equal(closestStockedFinish(byId("wood-narra"), [byId("wood-molave"), byId("wood-narra--red")], "wood")?.id, "wood-narra--red");
  // Otherwise the part's own surface.
  assert.equal(closestStockedFinish(byId("wood-narra"), [byId("glass-clear"), byId("wood-molave")], "wood")?.id, "wood-molave");
  // Otherwise anything the part can take; nothing when nothing is listed.
  assert.equal(closestStockedFinish(byId("wood-narra"), [byId("glass-clear")], "wood")?.id, "glass-clear");
  assert.equal(closestStockedFinish(byId("wood-narra"), [], "wood"), null);
});

test("every existing finish belongs to exactly one material with no ID or color changes", () => {
  const entries = STOCK_MATERIALS.flatMap((group) => group.colors);
  assert.equal(entries.length, MATERIALS.length);
  assert.equal(new Set(entries.map((color) => color.id)).size, MATERIALS.length);
  for (const material of MATERIALS) assert.equal(entries.find((color) => color.id === material.id), material);
});

test("wood species, stone and distinct polymers remain separate materials", () => {
  for (const ids of [["wood-narra", "wood-molave"], ["stone-carrara", "stone-travertine"], ["plastic-hdpe-marine", "plastic-acrylic-clear"]]) {
    assert.notEqual(STOCK_MATERIALS.find((group) => group.colors.some((color) => color.id === ids[0]))?.id,
      STOCK_MATERIALS.find((group) => group.colors.some((color) => color.id === ids[1]))?.id);
  }
  assert.notEqual(selectedStockMaterials(["cloth-abaca"])[0], selectedStockMaterials(["cloth-royal-blue"])[0]);
});

test("synthetic rattan offers exactly its four saved catalog colors", () => {
  const group = STOCK_MATERIALS.find((group) => group.label === "Synthetic rattan")!;
  assert.deepEqual(group.colors.map((color) => color.id), ["synth-slate", "synth-espresso", "synth-ash", "synth-sandstone"]);
  assert.deepEqual(selectedStockMaterials(["synth-ash", "synth-sandstone"]), [group.id]);
});

test("color categories cover the catalog without adding unavailable colors", () => {
  for (const material of MATERIALS) assert(STOCK_COLOR_CATEGORIES.some((category) => category.id === stockColorCategory(material)));
  assert.equal(stockColorCategory(MATERIALS.find((m) => m.id === "cloth-royal-blue")!), "primary");
  assert.equal(stockColorCategory(MATERIALS.find((m) => m.id === "cloth-emerald")!), "secondary");
  assert.equal(stockColorCategory(MATERIALS.find((m) => m.id === "synth-ash")!), "neutral");
  assert.equal(stockColorCategory(MATERIALS.find((m) => m.id === "synth-sandstone")!), "natural");
});

test("a selection is required, including a color for each enabled material", () => {
  assert(materialStockIssues([]).length);
  assert(materialStockIssues(["synth-slate"], ["Synthetic rattan", "Leather"]).some((issue) => issue.startsWith("Leather:")));
  assert.deepEqual(materialStockIssues(["synth-slate", "leather-tan"], ["Synthetic rattan", "Leather"]), []);
  assert(materialStockIssues(["synth-slate"], ["Synthetic rattan", "wood-narra"]).some((issue) => issue.startsWith("Narra:")));
  assert.deepEqual(materialStockIssues(["wood-narra"]), []);
});

test("unknown saved colors require correction; older valid stocks load without replacement", () => {
  assert(materialStockIssues(["synth-slate", "retired-color"]).length);
  const old = ["wood-narra", "synth-espresso", "cloth-royal-blue"];
  const before = [...old];
  assert.deepEqual(materialStockIssues(old), []);
  assert.deepEqual(old, before);
  assert.deepEqual(allowedMaterialsForSurfaces(["rattan"], ["synth-espresso"]).map((material) => material.id), ["synth-espresso"]);
  assert(!allowedMaterialsForSurfaces(["wood"], ["synth-espresso"]).length);
});
