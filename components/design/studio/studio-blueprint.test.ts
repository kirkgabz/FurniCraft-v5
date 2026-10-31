import assert from "node:assert/strict";
import { test } from "node:test";
import { materialById } from "./materials-db";
import { CARVINGS, shapesForPart } from "./part-shapes";
import { DEFAULT_PART_COLORS, DEFAULT_RIG_PARAMS, type PartId } from "./studio-config";
import { buildStudioDesignItem } from "./studio-design-state";
import type { ChairMeasurement } from "./studio-dimensions";
import { generateStudioBlueprintSvg } from "./studio-blueprint-svg";
import { studioModel } from "./studio-models";

/**
 * What the studio hands the blueprint after a customer changes something.
 *
 * The rig (three.js) is what turns sliders and shapes into sizes, so it is
 * stood in for here by the measurement it would publish. Everything after
 * that -- the design record, the specification names and the blueprint's
 * component schedule -- is the real code, run on every kind of change the
 * studio offers.
 */
const table = studioModel("table");
const top = table.parts.find((part) => part.role === "tabletopBorder")!;
const inset = table.parts.find((part) => part.role === "tabletop")!;
const leaves = table.parts.find((part) => part.id === "leaves")!;

function measurement(scale = 1): ChairMeasurement {
  const part = (id: PartId, label: string, w: number, h: number, d: number) => ({
    id, label, w: w * scale, h, d: d * scale, components: [], count: 1,
    // Floor-standing and centred, the way measureRig reports bounds.
    min: { x: (-w * scale) / 2, y: 75 - h, z: (-d * scale) / 2 },
    max: { x: (w * scale) / 2, y: 75, z: (d * scale) / 2 },
  });
  return {
    overall: { w: 120 * scale, h: 75, d: 80 * scale },
    seatHeight: 75,
    parts: [
      part(top.id, top.label, 120, 4, 80),
      part(inset.id, inset.label, 60, 2, 40),
      part(leaves.id, leaves.label, 30, 4, 80),
    ],
  };
}

function design(overrides: Partial<Parameters<typeof buildStudioDesignItem>[0]> = {}) {
  const narra = materialById("wood-narra")!;
  return buildStudioDesignItem({
    model: table,
    name: "Dining table",
    params: { ...DEFAULT_RIG_PARAMS },
    colors: { ...DEFAULT_PART_COLORS, [top.id]: narra.hex, [inset.id]: narra.hex },
    materials: { [top.id]: narra.id, [inset.id]: narra.id },
    measurement: measurement(),
    ...overrides,
  });
}

const blueprint = (item: ReturnType<typeof design>) => generateStudioBlueprintSvg(item, { pieceName: "Table" });

test("a finish change is what the specification and the blueprint name", () => {
  const red = materialById("wood-narra--red")!;
  const item = design({
    colors: { ...DEFAULT_PART_COLORS, [top.id]: red.hex, [inset.id]: materialById("wood-narra")!.hex },
    materials: { [top.id]: red.id, [inset.id]: "wood-narra" },
  });
  assert.equal(item.materialNames[top.label], "Narra - Red");
  assert.equal(item.materialNames[inset.label], "Narra - Natural");
  assert.match(blueprint(item), /Narra - Red/);
});

test("changing to a different material names that material, not the model's original stock", () => {
  const steel = materialById("metal-matte-black");
  const mdf = materialById("panel-mdf-white")!;
  const item = design({
    colors: { ...DEFAULT_PART_COLORS, [top.id]: mdf.hex, [inset.id]: mdf.hex },
    materials: { [top.id]: mdf.id, [inset.id]: mdf.id },
  });
  assert.equal(item.materialNames[top.label], "Painted MDF - White painted MDF");
  assert.doesNotMatch(item.materialNames[top.label], /Hardwood|Solid hardwood/);
  assert.ok(steel, "catalogue still has matte black steel");
});

test("drop leaves are named in the top's finish, which is what they are shown in", () => {
  const molave = materialById("wood-molave--blue")!;
  const item = design({
    colors: { ...DEFAULT_PART_COLORS, [top.id]: molave.hex },
    materials: { [top.id]: molave.id },
  });
  assert.equal(item.materialNames[leaves.label], item.materialNames[top.label]);
  assert.equal(item.materialNames[leaves.label], "Molave - Blue");
});

test("a filled hole names its insert's material", () => {
  const item = design({
    apertures: { [inset.id]: [{ shape: "round", size: 0.3, x: 0, y: 0, fill: "glass-frosted" }] },
  });
  const said = item.shapeNames?.[inset.label] ?? "";
  assert.match(said, /filled with Glass - Frosted/);
  assert.doesNotMatch(said, /Custom Finish/);
});

test("a sheen is named with the finish it seals", () => {
  const item = design({ varnishes: { [top.id]: "satin" } });
  assert.match(item.materialNames[top.label], /^Narra - Natural, /);
});

test("a substituted shape, eased edges and a carving are recorded for the part", () => {
  const shape = shapesForPart(top).find((entry) => entry.id !== "original");
  const carving = CARVINGS.find((entry) => entry.id !== "none");
  assert.ok(shape && carving);
  const item = design({
    shapes: { [top.id]: shape.id },
    edgeRadii: { [top.id]: 0.4 },
    carvings: { [top.id]: carving.id },
  });
  const said = item.shapeNames?.[top.label] ?? "";
  assert.match(said, new RegExp(shape.label));
  assert.match(said, /edges eased 40%/);
  assert.match(said, /carving/);
});

/** The schedule's text, in order, with tags stripped. */
function scheduleText(svg: string): string[] {
  const start = svg.indexOf("COMPONENT SCHEDULE");
  const end = svg.indexOf("TITLE BLOCK");
  return [...svg.slice(start, end).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
}

test("the schedule writes each part's shape, carving and cutouts under its row", () => {
  const shape = shapesForPart(inset).find((entry) => entry.id !== "original")!;
  const item = design({
    shapes: { [inset.id]: shape.id },
    apertures: { [inset.id]: [{ shape: "round", size: 0.3, x: 0, y: 0, fill: "glass-frosted" }] },
  });
  const text = scheduleText(blueprint(item));
  const row = text.indexOf(inset.label);
  const next = text.indexOf(leaves.label);
  const note = text.slice(row, next).filter((cell) => cell.includes("↳") || cell.startsWith("   ")).join(" ");
  assert.ok(row >= 0 && next > row);
  assert.match(note, new RegExp(shape.label));
  assert.match(note, /cutout/);
  assert.match(note, /Glass/);
  // A part nobody reshaped carries no note.
  const topRow = text.slice(text.indexOf(top.label), row);
  assert.ok(!topRow.some((cell) => cell.includes("↳")));
});

test("every row's sizes are printed, however many parts, and the page grows to hold them", () => {
  const many: ChairMeasurement = {
    overall: { w: 200, h: 90, d: 100 },
    seatHeight: 75,
    parts: Array.from({ length: 16 }, (_, index) => ({
      id: top.id,
      label: `Board ${index + 1}`,
      w: 10 + index,
      h: 2,
      d: 40 + index,
      components: [],
      count: 1,
      min: { x: -5, y: 0, z: -20 },
      max: { x: 5, y: 2, z: 20 },
    })),
  };
  const small = blueprint(design());
  const big = blueprint(design({ measurement: many }));
  const text = scheduleText(big);
  for (let index = 0; index < 16; index++) {
    assert.ok(text.includes(`Board ${index + 1}`), `Board ${index + 1} is listed`);
    assert.ok(text.includes(`${10 + index}`), `its width ${10 + index} is printed`);
    assert.ok(text.includes(`${40 + index}`), `its depth ${40 + index} is printed`);
  }
  assert.doesNotMatch(big, /not shown/);
  const height = (svg: string) => Number(/height="(\d+(?:\.\d+)?)" role="img"/.exec(svg)![1]);
  assert.ok(height(big) > height(small));
});

test("each schedule row carries exactly the measured size of its part", () => {
  const item = design();
  const text = scheduleText(blueprint(item));
  for (const part of item.studio.measurement.parts) {
    const at = text.indexOf(part.label);
    assert.ok(at >= 0, part.label);
    const cells = text.slice(at, at + 8);
    for (const value of [part.w, part.h, part.d]) assert.ok(cells.includes(`${value}`), `${part.label} shows ${value}`);
  }
});

test("a size change reaches the blueprint's schedule and its overall size", () => {
  const before = design();
  const after = design({ measurement: measurement(1.25), params: { ...DEFAULT_RIG_PARAMS, seatWidth: 1.25 } });
  assert.equal(after.dims[top.label].w, 150);
  assert.equal(after.studio.measurement.overall.w, 150);
  // The schedule's width cell and the overall-size line both move.
  assert.match(blueprint(before), />120 cm × 75 cm × 80 cm</);
  assert.match(blueprint(after), />150 cm × 75 cm × 100 cm</);
  assert.doesNotMatch(blueprint(after), />120 cm × 75 cm × 80 cm</);
  assert.equal(after.studio.params.seatWidth, 1.25);
});
