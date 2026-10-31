/**
 * Architect Analysis — prototype
 *
 * Tests whether an AI model can label a furniture model's parts (legs, seat
 * cushion, backrest, ...) well enough to stand in for the hand-written
 * per-model classifiers in chair-segmentation.ts. That labeling step is the
 * hard part of letting a shop owner upload their own design and get an
 * editable model back, instead of picking from the five built in ones.
 *
 * This does not reimplement or approximate anything: it runs the real
 * connected-component split (the same union-find-over-triangles algorithm
 * chair-segmentation.ts uses) and calls the real classify() function each
 * model already ships in STUDIO_MODELS to get ground truth. It then asks an
 * AI model to guess the same labels from geometry alone -- no rendering yet,
 * that is a later prototype -- and reports where the two agree and disagree.
 *
 * The JSON it writes per model is also the answer to the *other* half of the
 * idea this came out of: a data-driven description of a model's parts and
 * their measurements, the shape a future rig-template system would consume
 * instead of bespoke per-model TypeScript.
 *
 * Usage:
 *   npx tsx scripts/architect-analysis.mts --model victorian-chair
 *   npx tsx scripts/architect-analysis.mts --model all
 *   npx tsx scripts/architect-analysis.mts --model all --mode generic
 *   npx tsx scripts/architect-analysis.mts --file scripts/foreign-chair.glb --vision
 *   npx tsx scripts/architect-analysis.mts --file scripts/some-bed.glb --mode bed --vision
 *
 * --vision renders every group in its own flat colour (via a headless
 * Chromium already on the machine -- see findChromePath) and sends that
 * image to Gemini alongside the geometry, instead of text alone. This
 * exists because text-only reasoning, on an unfamiliar chair with no
 * descriptive names, called the legs "seatCushion" and part of the seat
 * "base" -- backwards on the most basic distinction the piece has -- the
 * kind of thing a picture settles immediately. Adds real latency (a render
 * plus a larger request), so it is opt-in rather than the default.
 *
 * --file points at a glTF/GLB with no STUDIO_MODELS entry at all -- a
 * genuinely unfamiliar model, not a simulation of one. There is no
 * classify() to compare against, so this mode has no accuracy number: it
 * prints the AI's group-by-group guesses and reasoning for a human to judge,
 * which is the honest end state of this whole prototype anyway -- a real
 * upload flow was always going to need a confirm step, never blind trust.
 *
 * --mode known (default) hands the AI this exact model's own part list --
 * the fair-but-easy version, since that list was written by someone who had
 * already studied this exact chair. --mode generic hands it only the
 * cross-model PartRole vocabulary (base/seatFrame/seatCushion/backFrame/
 * backCushion/armrest/accessory) that chair-rig.ts already shares across
 * every model, with no name, no per-model blurbs, and scores it against
 * each shell's real *role* rather than its model-specific part id. That is
 * the honest simulation of an unfamiliar upload: it is what the system
 * would have to get right without a human having pre-described this chair.
 *
 * --mode bed swaps that vocabulary for the bed one (see BED_ROLE_VOCAB in
 * lib/architect-analysis/generic-classify.ts): headboard, footboard, rails,
 * mattress, slats. It is scoped rather than pooled with the chair/table
 * roles on purpose -- every role the model can see is a role it can pick,
 * and "mattress" offered on a dining chair is an invitation to a confident
 * wrong answer. All 5 shipped models are chairs, so this mode is really for
 * --file: run it against a bed and read the labels, since there is no
 * bed classify() anywhere to score against.
 *
 * Calls Google's Gemini API directly (not through Vercel's AI Gateway):
 * Gateway model access turned out to be gated behind purchased credits even
 * on a verified-card account, which defeated the point of a free prototype.
 * Google AI Studio's own free tier has no such gate. Set
 * GOOGLE_GENERATIVE_AI_API_KEY in .env.local (get a key at
 * https://aistudio.google.com/apikey). Without a key this still runs the
 * segmentation and ground-truth extraction and prints what would have been
 * sent, so the geometry half of the pipeline is checkable at no cost.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import puppeteer from "puppeteer-core";

import { STUDIO_MODELS, type StudioModelId } from "../components/design/studio/studio-models.ts";
import type { ShellInfo } from "../components/design/studio/chair-segmentation.ts";
import type { PartId } from "../components/design/studio/studio-config.ts";
import { filterBackdropShells, groupShells } from "../components/design/studio/shell-grouping.ts";
import {
  readingFromSample,
  sampleFootprintFromTriangles,
  rotationForYaw,
  sampleTriangleFaces,
  solveYaw,
} from "../components/design/studio/model-leveling.ts";
import type { FurnitureFamily } from "../components/design/studio/studio-config.ts";
import { AiResponse, buildGenericPrompt, ROLE_VOCAB_BY_FAMILY } from "../lib/architect-analysis/generic-classify.ts";

// ------------------------------------------------------------- environment

try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"));
} catch {
  // No .env.local -- fine, the AI step just gets skipped below.
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(projectRoot, "public");

// ------------------------------------------------------------ glTF reading
//
// Deliberately not three's GLTFLoader: that wants a fetch-able URL, and the
// two .glb models here would need a real HTTP server or a file:// fetch
// polyfill for no benefit -- every field this script needs (POSITION,
// indices, material names) is a direct accessor read against the raw
// buffer, which is simpler to do by hand than to route through a loader
// built for the browser.

/**
 * Only the glTF fields this reader actually touches, rather than the whole
 * schema. Worth spelling out rather than leaving as `any`: everything below
 * is byte arithmetic against a raw buffer, so a mistyped field name yields
 * plausible-looking garbage geometry instead of an error, and that is exactly
 * the class of bug a type here catches. Optional where the spec is optional --
 * `primitives` excepted, which is required in the spec but guarded anyway.
 */
type GltfAccessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};
type GltfBufferView = { buffer: number; byteOffset?: number; byteStride?: number };
type GltfNode = {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};
type GltfPrimitive = { attributes?: Record<string, number>; indices?: number; material?: number };
type GltfMesh = { name?: string; primitives?: GltfPrimitive[] };
type GltfJson = {
  accessors: GltfAccessor[];
  bufferViews: GltfBufferView[];
  buffers: { uri?: string }[];
  materials?: { name?: string }[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
};

type GltfDoc = {
  json: GltfJson;
  getBufferData: (bufferIndex: number) => Buffer;
};

function loadGltf(filePath: string): GltfDoc {
  if (filePath.endsWith(".glb")) {
    const buf = readFileSync(filePath);
    let offset = 12; // past the 12-byte GLB header (magic, version, length)
    let json: GltfJson | null = null;
    const binChunks: Buffer[] = [];
    while (offset < buf.length) {
      const chunkLength = buf.readUInt32LE(offset);
      const chunkType = buf.readUInt32LE(offset + 4);
      const chunkData = buf.subarray(offset + 8, offset + 8 + chunkLength);
      if (chunkType === 0x4e4f534a) json = JSON.parse(chunkData.toString("utf8")); // 'JSON'
      else if (chunkType === 0x004e4942) binChunks.push(Buffer.from(chunkData)); // 'BIN\0'
      offset += 8 + chunkLength;
    }
    if (!json) throw new Error(`No JSON chunk found in ${filePath}`);
    return { json, getBufferData: (i) => binChunks[i] };
  }

  const dir = dirname(filePath);
  const json: GltfJson = JSON.parse(readFileSync(filePath, "utf8"));
  const cache = new Map<number, Buffer>();
  return {
    json,
    getBufferData: (i: number) => {
      const hit = cache.get(i);
      if (hit) return hit;
      // A .gltf buffer without a uri is either GLB-style embedded binary (not
      // this branch) or a data: uri this reader does not decode; say so rather
      // than letting `undefined` reach the path join as an ENOENT on the
      // literal string "undefined".
      const uri = json.buffers[i]?.uri;
      if (!uri) throw new Error(`Buffer ${i} of ${filePath} has no uri to read`);
      const data = readFileSync(join(dir, decodeURIComponent(uri)));
      cache.set(i, data);
      return data;
    },
  };
}

const COMPONENT_TYPES: Record<number, { bytes: number; read: (b: Buffer, o: number) => number }> = {
  5120: { bytes: 1, read: (b, o) => b.readInt8(o) },
  5121: { bytes: 1, read: (b, o) => b.readUInt8(o) },
  5122: { bytes: 2, read: (b, o) => b.readInt16LE(o) },
  5123: { bytes: 2, read: (b, o) => b.readUInt16LE(o) },
  5125: { bytes: 4, read: (b, o) => b.readUInt32LE(o) },
  5126: { bytes: 4, read: (b, o) => b.readFloatLE(o) },
};
const TYPE_SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(doc: GltfDoc, accessorIndex: number): Float64Array {
  const accessor = doc.json.accessors[accessorIndex];
  const bufferView = doc.json.bufferViews[accessor.bufferView];
  const buf = doc.getBufferData(bufferView.buffer);
  const itemSize = TYPE_SIZES[accessor.type];
  const comp = COMPONENT_TYPES[accessor.componentType];
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? itemSize * comp.bytes;
  const out = new Float64Array(accessor.count * itemSize);
  for (let i = 0; i < accessor.count; i++) {
    const base = byteOffset + i * stride;
    for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = comp.read(buf, base + c * comp.bytes);
  }
  return out;
}

// --------------------------------------------------------- shell splitting
//
// Same algorithm as chair-segmentation.ts's splitIntoShells: weld vertices
// that share a position, union-find the triangles that touch through a
// shared weld id, group triangles by root. vertexCount matches what
// extractShell reports -- the count of distinct ORIGINAL (pre-weld) vertex
// indices a shell's triangles reference -- because classifyVictorianShell
// keys a threshold on it.

/**
 * triPositions is the shell's own RENDER geometry, non-indexed (every 3
 * floats * 3 = one triangle corner), in WORLD space -- with the mesh's own
 * node transform applied (see nodeWorldTransform), unlike `box`, which stays
 * in the mesh's local space on purpose: chair-segmentation.ts's classifiers
 * were calibrated against local space ("Shells are classified in the
 * meshes' own local space, before transforms are baked"), so this must not
 * change what box/vertexCount mean for the 5 known models' classification.
 * It only matters for rendering, where multiple meshes with different node
 * transforms (a converted FBX's separate parts, each with its own
 * translation and a baked axis-conversion rotation) have to land in their
 * real relative positions or the picture is just wrong -- which the first
 * version of this render was, garbled, despite every shell's box and
 * classification being correct throughout.
 */
type RawShell = { box: THREE.Box3; triCount: number; vertexCount: number; triPositions: Float32Array };

function splitShells(
  positions: Float64Array,
  indices: Float64Array,
  worldTransform: THREE.Matrix4 = new THREE.Matrix4(),
  weldPrecisionBase = 1e5
): RawShell[] {
  const vertCount = positions.length / 3;

  // Same fix as chair-segmentation.ts's weldVertices, and for the same
  // reason: an absolute weld precision tuned for the shipped models' sub-2-
  // unit local space over-fragments a mesh whose raw coordinates run into
  // the hundreds or thousands (an unnormalized scan, say) -- float32 cannot
  // even represent two points closer than roughly their own magnitude times
  // 1.19e-7, so genuinely duplicate vertices stop landing in the same weld
  // bucket. Scaling the precision down by the mesh's own largest coordinate
  // magnitude, floored at 1, leaves every shipped model unchanged (all of
  // them stay at or under that floor) and only loosens for a mesh that
  // actually needs it -- discovered on a 2-million-triangle photogrammetry
  // scan that fragmented into 30,134 shells and then timed out rendering.
  let maxAbs = 0;
  for (let i = 0; i < vertCount; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(positions[i * 3]), Math.abs(positions[i * 3 + 1]), Math.abs(positions[i * 3 + 2]));
  }
  const weldPrecision = weldPrecisionBase / Math.max(1, maxAbs);

  const lookup = new Map<string, number>();
  const welded = new Int32Array(vertCount);
  let next = 0;
  for (let i = 0; i < vertCount; i++) {
    const key = `${Math.round(positions[i * 3] * weldPrecision)}|${Math.round(positions[i * 3 + 1] * weldPrecision)}|${Math.round(positions[i * 3 + 2] * weldPrecision)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = next++;
      lookup.set(key, id);
    }
    welded[i] = id;
  }

  const parent = new Int32Array(next);
  for (let i = 0; i < next; i++) parent[i] = i;
  function find(x: number): number {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    let walk = x;
    while (parent[walk] !== root) {
      const n = parent[walk];
      parent[walk] = root;
      walk = n;
    }
    return root;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    union(welded[indices[t * 3]], welded[indices[t * 3 + 1]]);
    union(welded[indices[t * 3 + 1]], welded[indices[t * 3 + 2]]);
  }

  const shells = new Map<number, { triCount: number; box: THREE.Box3; origVertIds: Set<number>; corners: number[] }>();
  for (let t = 0; t < triCount; t++) {
    const root = find(welded[indices[t * 3]]);
    let shell = shells.get(root);
    if (!shell) {
      shell = { triCount: 0, box: new THREE.Box3(), origVertIds: new Set(), corners: [] };
      shells.set(root, shell);
    }
    shell.triCount++;
    for (let corner = 0; corner < 3; corner++) {
      const vi = indices[t * 3 + corner];
      shell.origVertIds.add(vi);
      const local = new THREE.Vector3(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
      shell.box.expandByPoint(local); // local space, unchanged -- what classification reads
      const world = local.clone().applyMatrix4(worldTransform); // world space -- what rendering reads
      shell.corners.push(world.x, world.y, world.z);
    }
  }
  return Array.from(shells.values()).map((s) => ({
    box: s.box,
    triCount: s.triCount,
    vertexCount: s.origVertIds.size,
    triPositions: Float32Array.from(s.corners),
  }));
}

// -------------------------------------------------------------- analysis

type ShellRecord = {
  shellIndex: number;
  meshName: string;
  materialName: string;
  surface: string;
  triCount: number;
  vertexCount: number;
  box: { min: [number, number, number]; max: [number, number, number] };
  /** null for a genuinely foreign file -- there is no classify() to ask. */
  groundTruthPartId: PartId | null;
  /** This shell's own renderable geometry -- see RawShell. Only used by the vision pipeline. */
  triPositions: Float32Array;
};

/**
 * A mesh's accumulated node-to-scene-root transform (parent's transform
 * composed with its own), which is where a glTF actually stores each part's
 * position and orientation -- geometry accessors hold only local, mesh-space
 * coordinates. Only rendering needs this (see the comment on RawShell); one
 * mesh can be referenced by more than one node, so this returns the first
 * node found rather than assuming a unique owner.
 */
function nodeWorldTransform(doc: GltfDoc, meshIndex: number): THREE.Matrix4 {
  const nodes: GltfNode[] = doc.json.nodes ?? [];
  const parentOf = new Map<number, number>();
  nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parentOf.set(c, i);
  });

  const ownerIndex = nodes.findIndex((n) => n.mesh === meshIndex);
  if (ownerIndex === -1) return new THREE.Matrix4();

  const chain: number[] = [];
  for (let cur: number | undefined = ownerIndex; cur !== undefined; cur = parentOf.get(cur)) chain.unshift(cur);

  const result = new THREE.Matrix4();
  for (const idx of chain) {
    const node = nodes[idx];
    const local = new THREE.Matrix4();
    if (node.matrix) {
      local.fromArray(node.matrix);
    } else {
      const [px, py, pz] = node.translation ?? [0, 0, 0];
      const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
      const [sx, sy, sz] = node.scale ?? [1, 1, 1];
      local.compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion(qx, qy, qz, qw), new THREE.Vector3(sx, sy, sz));
    }
    result.multiply(local);
  }
  return result;
}

function extractRawShells(doc: GltfDoc) {
  const rawShells: (RawShell & { materialName: string; meshName: string })[] = [];
  doc.json.meshes?.forEach((mesh, meshIndex) => {
    const worldTransform = nodeWorldTransform(doc, meshIndex);
    for (const prim of mesh.primitives ?? []) {
      if (prim.attributes?.POSITION === undefined) continue;
      const positions = readAccessor(doc, prim.attributes.POSITION);
      // Non-indexed geometry (every three consecutive vertices form a
      // triangle) is legal glTF and is what GLTFExporter writes for a
      // converted FBX with no shared vertices to begin with. An implicit
      // identity index buffer makes it indistinguishable from indexed input
      // to splitShells, which never assumed indices were unique anyway.
      const indices = prim.indices !== undefined ? readAccessor(doc, prim.indices) : Float64Array.from({ length: positions.length / 3 }, (_, i) => i);
      const materialName =
        prim.material !== undefined ? doc.json.materials?.[prim.material]?.name ?? `material-${prim.material}` : "unknown";
      for (const shell of splitShells(positions, indices, worldTransform)) {
        rawShells.push({ ...shell, materialName, meshName: mesh.name ?? "mesh" });
      }
    }
  });
  return rawShells;
}

function analyzeModel(modelId: StudioModelId) {
  const model = STUDIO_MODELS[modelId];
  const doc = loadGltf(join(publicDir, model.url));
  const rawShells = extractRawShells(doc);

  const modelBox = new THREE.Box3();
  for (const s of rawShells) modelBox.union(s.box);

  const records: ShellRecord[] = rawShells.map((s, i) => {
    const fakeMaterial = { name: s.materialName } as unknown as THREE.Material;
    const surface = model.resolveSurface(fakeMaterial);
    const shellInfo: ShellInfo = { localBox: s.box, vertexCount: s.vertexCount, surface, materialName: s.materialName, modelBox };
    return {
      shellIndex: i,
      meshName: s.meshName,
      materialName: s.materialName,
      surface,
      triCount: s.triCount,
      vertexCount: s.vertexCount,
      box: { min: s.box.min.toArray() as [number, number, number], max: s.box.max.toArray() as [number, number, number] },
      groundTruthPartId: model.classify(shellInfo),
      triPositions: s.triPositions,
    };
  });

  return { model, records, modelBox };
}

/**
 * `s.box` from `extractRawShells` is local (mesh) space, matching what the
 * 5 shipped classifiers expect -- but a genuinely foreign file has no known
 * local up-axis the way a curated model does. A table conversion was found
 * whose local geometry was actually Z-up, with the Y-up correction living
 * only in its node's rotation, never baked into the vertex data -- so
 * defaulting to "local space, y up" silently broke both grouping and the
 * floor-touching backdrop filter. `triPositions` is already world space
 * (see the comment on `RawShell` above), which the rest of the app already
 * treats as canonically Y-up, so the foreign-file path measures from that
 * instead.
 */
function worldBoxFromTriPositions(triPositions: Float32Array): THREE.Box3 {
  const box = new THREE.Box3();
  for (let i = 0; i < triPositions.length; i += 3) {
    box.expandByPoint(new THREE.Vector3(triPositions[i], triPositions[i + 1], triPositions[i + 2]));
  }
  return box;
}

/**
 * A genuinely foreign file: no STUDIO_MODELS entry, no classify(), no
 * resolveSurface(), no known up-axis. Surface is left as the raw material
 * name (there is no wood/cloth/rattan/cane palette to sort it into without a
 * model-specific resolver). Every box measured here is world space (see
 * `worldBoxFromTriPositions`), which the up-axis defaults to Y for -- the
 * convention this app already treats world space as normalized to.
 */
function analyzeForeignFile(filePath: string) {
  const doc = loadGltf(filePath);
  const extracted = extractRawShells(doc);

  // Stand the piece level before anything measures it, exactly as
  // /dev/model-lab does on upload -- same solver, same thresholds (see
  // model-leveling.ts). Without this the CLI and the browser would group a
  // crooked model differently, since height banding keys on Y: a real bed
  // that arrives 13 degrees off has its parts smeared across height bands
  // that do not correspond to the bed's own layers at all. This script is
  // meant to be a faithful way to test the pipeline without starting the
  // app, so it cannot quietly skip one of the pipeline's steps.
  const applyToAll = (matrix: THREE.Matrix4) => {
    const point = new THREE.Vector3();
    for (const shell of extracted) {
      for (let i = 0; i < shell.triPositions.length; i += 3) {
        point.set(shell.triPositions[i], shell.triPositions[i + 1], shell.triPositions[i + 2]).applyMatrix4(matrix);
        shell.triPositions[i] = point.x;
        shell.triPositions[i + 1] = point.y;
        shell.triPositions[i + 2] = point.z;
      }
    }
  };

  const tilt = readingFromSample(sampleTriangleFaces(extracted.map((s) => s.triPositions)));
  if (tilt.correctable) {
    applyToAll(new THREE.Matrix4().makeRotationFromQuaternion(tilt.correction));
    console.log(`
  [Stood the model level -- it was modelled ${tilt.degrees.toFixed(1)}° off.]`);
  }

  // Yaw AFTER levelling, and re-sampled from the corrected geometry: a turn
  // about the vertical only means anything once the vertical is right.
  const yaw = solveYaw(sampleFootprintFromTriangles(extracted.map((s) => s.triPositions)));
  if (yaw.correctable) {
    applyToAll(rotationForYaw(yaw));
    console.log(
      `  [Squared the model to its own axes -- it was turned ${((yaw.radians * 180) / Math.PI).toFixed(1)}°, ` +
        `which was inflating its footprint by ${((1 / (1 - yaw.areaReduction) - 1) * 100).toFixed(0)}%.]`
    );
  }

  // Overwrite the local-space box extractRawShells gives every shell with
  // its world-space one -- see the comment on worldBoxFromTriPositions.
  // Recomputed from triPositions AFTER levelling, so the boxes grouping and
  // the prompt read describe the corrected piece.
  const allShells = extracted.map((s) => ({ ...s, box: worldBoxFromTriPositions(s.triPositions) }));

  const modelBox = new THREE.Box3();
  for (const s of allShells) modelBox.union(s.box);

  // A table export was found carrying a stray backdrop/ground plane
  // dwarfing the real furniture in footprint -- excluded before it ever
  // reaches grouping or the AI prompt. See shell-grouping.ts's own comment
  // for the two-condition (footprint outlier + thin) reasoning.
  const { kept: rawShells, excluded } = filterBackdropShells(allShells);
  if (excluded.length > 0) {
    console.log(
      `\n  [Excluded ${excluded.length} shell(s) that looked like backdrop/staging geometry, not real furniture parts: ` +
        `${excluded.map((s) => s.meshName).join(", ")}]`
    );
  }

  const records: ShellRecord[] = rawShells.map((s, i) => ({
    shellIndex: i,
    meshName: s.meshName,
    materialName: s.materialName,
    surface: s.materialName,
    triCount: s.triCount,
    vertexCount: s.vertexCount,
    box: { min: s.box.min.toArray() as [number, number, number], max: s.box.max.toArray() as [number, number, number] },
    groundTruthPartId: null,
    triPositions: s.triPositions,
  }));

  return { records, modelBox };
}

/**
 * Which local-space axis is "up" (away from the floor) for each model,
 * before the node transform that makes every model Y-up is applied. Not
 * derived -- read straight off chair-segmentation.ts's own comments and the
 * axis each classifier keys its floor/height thresholds on ("Shells are
 * classified in the meshes' own local space, where +Z is up" for the
 * Victorian; "Local +Y is up here" for the cushion chair; the rattan
 * classifier's use of localBox.min.y; "its local space is Z-up" for the
 * patio armchair). The stool's classifier never reads position at all, so
 * its axis does not matter.
 */
const UP_AXIS: Record<StudioModelId, "x" | "y" | "z"> = {
  "victorian-chair": "z",
  "cushion-chair": "y",
  "rattan-chair": "y",
  "patio-armchair": "z",
  "rattan-stool": "y",
  // Generated Y-up in world space, like the other scripted assets.
  sofa: "y",
  "sofa-bed": "y",
  // Not read off a classifier comment like the five above: this asset is
  // generated (scripts/make-cabinet.mts) directly in Y-up world space with
  // identity node transforms, so local and world space are the same and Y is
  // up in both by construction.
  cabinet: "y",
  // Generated Y-up in metres by scripts/make-bookshelf.mts, origin on the floor.
  bookshelf: "y",
  // Same construction, same reasoning: all four are generated directly in
  // Y-up world space with identity node transforms (scripts/make-table.mts,
  // scripts/make-rocking-chair.mts, scripts/make-desk.mts and
  // scripts/make-bed.mts).
  table: "y",
  "rocking-chair": "y",
  desk: "y",
  bed: "y",
  // Sourced rather than generated, but already Y-up in metres with its feet on
  // the floor and identity node transforms.
  "side-table": "y",
};

// ---------------------------------------------------------- shell grouping
//
// The rattan armchair's seat and back are not one mesh each -- they are 401
// individual woven strands, every one its own connected-component shell. The
// first AI pass listed all 401 as separate rows and the model called almost
// every one "accessory": a single strand, described only by its own tiny
// bounding box, genuinely looks like a small decorative bit riding on a
// structural part. What it could not see, one row at a time, is that 400
// nearly-identical tiny shells collectively cover the whole seat.
//
// The first fix clustered by material and vertex count, which merged all 401
// weave shells into one blob (losing the seat/back split, since strand size
// grows smoothly across the panel with no real jump to cluster on) and
// merged legs with seat rails with the back rail into one "frame" blob for
// the same reason. Vertex count is a smooth, continuous quantity here; it
// has no gaps to find.
//
// Position does. A chair's legs, seat and back occupy genuinely separate
// height bands -- that is exactly what every hand-written classifier in
// chair-segmentation.ts keys its own thresholds on. So this clusters by
// material and then by a shell's centre position along the model's own known
// up-axis, gap-detecting height bands instead of size bands. Two strands at
// the same height, whatever their individual size, are almost certainly the
// same surface; a leg and a seat rail, similar in size or not, are not.

type ShellGroup = {
  groupIndex: number;
  memberShellIndices: number[];
  materialName: string;
  surface: string;
  memberCount: number;
  vertexCountMin: number;
  vertexCountMax: number;
  triCountTotal: number;
  box: { min: [number, number, number]; max: [number, number, number] };
  /** Every member shell's triPositions concatenated -- this group's own renderable geometry, for the vision pipeline. */
  triPositions: Float32Array;
};

/**
 * Thin adapter over the shared clustering algorithm in shell-grouping.ts
 * (also used by the browser at /dev/model-lab, so the two never drift):
 * converts this script's JSON-safe `ShellRecord.box` (plain arrays, for the
 * report this writes) to the `THREE.Box3` the shared function reads, then
 * converts back and re-attaches each group's own concatenated triPositions
 * -- a rendering concern specific to this script's puppeteer step, not part
 * of the shared grouping shape.
 */
function groupShellsForPrompt(records: ShellRecord[], modelBox: THREE.Box3, upAxis: "x" | "y" | "z"): ShellGroup[] {
  const items = records.map((r) => ({
    materialName: r.materialName,
    surface: r.surface,
    vertexCount: r.vertexCount,
    triCount: r.triCount,
    box: new THREE.Box3(new THREE.Vector3(...r.box.min), new THREE.Vector3(...r.box.max)),
  }));

  return groupShells(items, modelBox, upAxis).map((g) => {
    const memberShellIndices = g.memberIndices;
    const triPositions = new Float32Array(memberShellIndices.reduce((sum, i) => sum + records[i].triPositions.length, 0));
    let offset = 0;
    for (const i of memberShellIndices) {
      triPositions.set(records[i].triPositions, offset);
      offset += records[i].triPositions.length;
    }
    return {
      groupIndex: g.groupIndex,
      memberShellIndices,
      materialName: g.materialName,
      surface: g.surface,
      memberCount: g.memberCount,
      vertexCountMin: g.vertexCountMin,
      vertexCountMax: g.vertexCountMax,
      triCountTotal: g.triCountTotal,
      box: { min: g.box.min.toArray() as [number, number, number], max: g.box.max.toArray() as [number, number, number] },
      triPositions,
    };
  });
}

// -------------------------------------------------------------- rendering
//
// The Rattan Armchair test proved geometry-only text has a real ceiling: on
// a model with no descriptive names, it got the single most basic
// distinction a chair has -- legs vs. the part you sit in -- backwards,
// something no person would ever get wrong glancing at a picture. This
// renders exactly that picture: every group gets its own flat colour, built
// straight from the triangle geometry groupShellsForPrompt already
// extracted (no mesh boundaries, no loader involved), and the group colours
// double as the legend the vision prompt hands the AI alongside the image.
//
// puppeteer-core drives whatever Chromium-based browser is already on the
// machine rather than bundling its own -- there is no reason to download a
// second copy of Chrome to render a few dozen triangles.

const GROUP_COLOR_PALETTE = ["#ff6b6b", "#4dabf7", "#69db7c", "#ffd43b", "#da77f2", "#ff922b", "#20c997", "#f06595", "#845ef7", "#94d82d"];

function findChromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No Chromium-based browser found for headless rendering. Set CHROME_PATH to a Chrome/Edge executable."
    );
  }
  return found;
}

function float32ToBase64(arr: Float32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("base64");
}

/**
 * Renders every group in its own flat colour and writes a PNG. Returns the
 * legend (groupIndex -> hex colour) the vision prompt needs to read it back.
 */
async function renderGroupsToImage(groups: ShellGroup[], outPngPath: string): Promise<Array<{ groupIndex: number; color: string }>> {
  const legend = groups.map((g, i) => ({ groupIndex: g.groupIndex, color: GROUP_COLOR_PALETTE[i % GROUP_COLOR_PALETTE.length] }));

  // triPositions is already real-world-assembled (see the comment on
  // RawShell) -- each mesh's own node transform, axis-conversion rotation
  // included, was applied when it was extracted. No further reorientation
  // belongs here: the first render, before that fix existed, ignored node
  // transforms altogether and additionally guessed a whole-scene rotation
  // from UP_AXIS, which is no more correct now that per-mesh position and
  // orientation are handled properly -- it would just misrotate them again.
  const groupPayload = groups.map((g, i) => ({ color: legend[i].color, positionsB64: float32ToBase64(g.triPositions) }));

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>html,body{margin:0;background:#20242b;}canvas{display:block;}</style>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.185.1/build/three.module.js"}}</script>
</head><body>
<script type="module">
import * as THREE from "three";

const W = 900, H = 700;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20242b);
scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(1, 1.4, 1);
scene.add(dir);

const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100000);

const groupData = ${JSON.stringify(groupPayload)};
const group = new THREE.Group();
for (const g of groupData) {
  const binary = atob(g.positionsB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const positions = new Float32Array(bytes.buffer);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: g.color, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(geometry, material));
}
scene.add(group);

const box = new THREE.Box3().setFromObject(group);
const center = box.getCenter(new THREE.Vector3());
const size = box.getSize(new THREE.Vector3());
const maxDim = Math.max(size.x, size.y, size.z) || 1;
camera.position.set(center.x + maxDim * 1.1, center.y + maxDim * 0.75, center.z + maxDim * 1.4);
camera.lookAt(center);

renderer.render(scene, camera);
window.__status = "ready";
</script>
</body></html>`;

  const browser = await puppeteer.launch({ executablePath: findChromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 700 });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction("window.__status === 'ready'", { timeout: 20000 });
    await page.screenshot({ path: outPngPath as `${string}.png` });
  } finally {
    await browser.close();
  }

  return legend;
}

// ------------------------------------------------------------------- AI

// GENERIC_ROLE_VOCAB, the AI schema, and the generic-mode prompt itself now
// live in lib/architect-analysis/generic-classify.ts (imported above),
// shared with the /api/architect-analysis route the /dev/model-lab test
// drives -- the same question either way, so the two can't drift apart.

/**
 * "known" hands the AI this exact model's own part list. Every other mode is
 * a role vocabulary from generic-classify.ts, named after the family of
 * furniture it describes -- so a mode is exactly a FurnitureFamily plus the
 * one non-family option, and adding a family there adds a mode here for
 * free.
 */
type AnalysisMode = "known" | FurnitureFamily;

const ANALYSIS_MODES: AnalysisMode[] = ["known", ...(Object.keys(ROLE_VOCAB_BY_FAMILY) as FurnitureFamily[])];


function isAnalysisMode(value: string): value is AnalysisMode {
  return (ANALYSIS_MODES as string[]).includes(value);
}

function buildPrompt(
  target: { displayName: string; upAxis: "x" | "y" | "z"; knownParts?: (typeof STUDIO_MODELS)[StudioModelId]["parts"] },
  groups: ShellGroup[],
  modelBox: THREE.Box3,
  mode: AnalysisMode,
  legend?: Array<{ groupIndex: number; color: string }>
) {
  // Every mode but "known" asks the exact question /api/architect-analysis
  // asks (an unfamiliar piece, a shared PartRole vocabulary scoped to its
  // family, no part list) -- built from the same shared prompt so tuning it
  // happens in one place and the CLI stays a working way to test that tuning
  // without spinning up the app.
  if (mode !== "known") {
    return buildGenericPrompt(
      { displayName: target.displayName, upAxis: target.upAxis, family: mode },
      groups.map((g) => ({
        groupIndex: g.groupIndex,
        materialName: g.materialName,
        surface: g.surface,
        memberCount: g.memberCount,
        vertexCountMin: g.vertexCountMin,
        vertexCountMax: g.vertexCountMax,
        triCountTotal: g.triCountTotal,
        box: g.box,
      })),
      { min: modelBox.min.toArray() as [number, number, number], max: modelBox.max.toArray() as [number, number, number] },
      legend
    );
  }

  // known mode only below: hands the AI this exact model's own part list,
  // which a real upload would never come with -- so there is nothing here
  // for the shared, upload-facing prompt builder to share.
  const { displayName, upAxis, knownParts } = target;
  const size = modelBox.getSize(new THREE.Vector3());
  const vocab = (knownParts ?? []).map((p) => `- "${p.id}" (${p.label}): ${p.blurb} [surface: ${p.surface}]`).join("\n");

  const groupLines = groups
    .map((g) => {
      const [minX, minY, minZ] = g.box.min;
      const [maxX, maxY, maxZ] = g.box.max;
      const frac = (lo: number, hi: number, min: number, s: number) =>
        `${(s > 0 ? (lo - min) / s : 0).toFixed(2)}-${(s > 0 ? (hi - min) / s : 0).toFixed(2)}`;
      const countNote =
        g.memberCount === 1
          ? `1 shell, ${g.vertexCountMin} vertices, ${g.triCountTotal} triangles`
          : `${g.memberCount} nearly-identical shells (${g.vertexCountMin}-${g.vertexCountMax} vertices each, ${g.triCountTotal} triangles combined) -- likely a repeated element like a weave, a row of spindles, or a set of legs, not one solid piece`;
      return (
        `Group ${g.groupIndex}: material="${g.materialName}" surface="${g.surface}" -- ${countNote}\n` +
        `  their COMBINED bounding box, as a fraction of the whole piece (0=one extreme, 1=the other): ` +
        `x=${frac(minX, maxX, modelBox.min.x, size.x)} y=${frac(minY, maxY, modelBox.min.y, size.y)} z=${frac(minZ, maxZ, modelBox.min.z, size.z)}`
      );
    })
    .join("\n");

  const seeing = legend ? "an image of the piece, plus" : "just";
  const intro = `You are labeling the parts of a piece of furniture called "${displayName}" from ${seeing} geometric measurements. ${legend ? "" : "No image, no render, just numbers -- "}This is a prototype testing whether that is enough on its own.\n\nThe model's mesh was split into disconnected "shells", then shells sharing a material and a similar size were grouped together into ${groups.length} groups (a woven seat made of hundreds of individual strands is one group, not hundreds of rows). Classify EVERY group as exactly one of these part ids:`;

  const legendBlock = legend
    ? `\n\nThe attached image shows the piece with every group painted a distinct flat colour (materials and real textures are not shown -- colour means group membership only, nothing else). This is the legend:\n${legend
        .map((l) => `- Group ${l.groupIndex}: ${l.color}`)
        .join("\n")}\nLook at the actual shape each colour covers before answering -- the colour tells you which group, the picture tells you what it is.`
    : "";

  return `${intro}
${vocab}
${legendBlock}

In this model's coordinate space, +${upAxis} points up (away from the floor): the group(s) that reach the lowest extreme of ${upAxis} are almost always the base, and a backrest sits toward the high extreme of ${upAxis}. A group of many small shells is not automatically a minor accessory -- judge it by what its COMBINED bounding box covers: many tiny shells whose union spans a large, contiguous area of the piece (most of its width and depth at seat or back height) are very likely a woven or slatted surface doing real structural work, exactly like a single solid cushion would. A group is a minor accessory only when its combined footprint is itself small.

${groupLines}

Return one entry per group index, 0 through ${groups.length - 1}. The "partId" field in your answer should be one of the ids listed above.`;
}

async function classifyWithAi(
  target: { displayName: string; upAxis: "x" | "y" | "z"; knownParts?: (typeof STUDIO_MODELS)[StudioModelId]["parts"] },
  groups: ShellGroup[],
  modelBox: THREE.Box3,
  mode: AnalysisMode,
  image?: { pngPath: string; legend: Array<{ groupIndex: number; color: string }> }
) {
  const prompt = buildPrompt(target, groups, modelBox, mode, image?.legend);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.log("\n  [AI step skipped -- no GOOGLE_GENERATIVE_AI_API_KEY in the environment.]");
    console.log("  Get a free key at https://aistudio.google.com/apikey, set it in .env.local, and re-run.");
    console.log(`  Prompt that would have been sent (${prompt.length} chars, ${image ? "with" : "without"} an image):\n`);
    console.log(prompt.split("\n").slice(0, 12).join("\n") + "\n  ...\n");
    return null;
  }

  try {
    const result = await generateObject({
      model: google("gemini-3.5-flash-lite"),
      schema: AiResponse,
      ...(image
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: prompt },
                  { type: "image" as const, image: readFileSync(image.pngPath) },
                ],
              },
            ],
          }
        : { prompt }),
    });
    return result.object.groups;
  } catch (err) {
    console.log("\n  [AI step failed]:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ------------------------------------------------------------------ report

type AnalysisTarget = {
  displayName: string;
  upAxis: "x" | "y" | "z";
  knownParts?: (typeof STUDIO_MODELS)[StudioModelId]["parts"];
};

async function runAnalysis(
  target: AnalysisTarget,
  records: ShellRecord[],
  modelBox: THREE.Box3,
  mode: AnalysisMode,
  outName: string,
  useVision: boolean
) {
  const hasGroundTruth = records.some((r) => r.groundTruthPartId !== null);
  console.log(
    `\n=== ${target.displayName} [${mode} mode${useVision ? " + vision" : ""}${hasGroundTruth ? "" : ", no ground truth -- for human review"}] ===`
  );

  const groups = groupShellsForPrompt(records, modelBox, target.upAxis);
  console.log(`${records.length} shells, grouped into ${groups.length} prompt entries`);

  const outDir = join(projectRoot, "scripts", "architect-analysis-output");
  mkdirSync(outDir, { recursive: true });

  let image: { pngPath: string; legend: Array<{ groupIndex: number; color: string }> } | undefined;
  if (useVision) {
    // A hand-modeled or "game ready" chair tops out at a few hundred shells
    // (the densest seen so far, the rattan armchair's woven panels, is under
    // 400). A raw photogrammetry scan can blow past that by two orders of
    // magnitude -- not from real part count, but from the exporter slicing
    // one continuous surface into arbitrary vertex-capped chunks (~65,532
    // vertices each) that connected-component analysis, run per chunk, can
    // never re-join across the cut. Rendering tens of thousands of shells as
    // one inline HTML payload doesn't just look wrong, it times out the
    // headless browser outright. Skip cleanly rather than crash the run.
    if (records.length > 5000) {
      console.log(
        `\n  [Vision step skipped -- ${records.length} shells is far beyond what a real part count looks like (largest known-good case is under 400). ` +
          `This usually means the source mesh was chunked by the exporter, not the furniture -- rendering it as-is would time out.]`
      );
    } else {
      const pngPath = join(outDir, `${outName}.render.png`);
      console.log("Rendering group-colored image for the vision prompt...");
      try {
        const legend = await renderGroupsToImage(groups, pngPath);
        image = { pngPath, legend };
        console.log(`Rendered ${pngPath}`);
      } catch (err) {
        console.log("\n  [Render failed]:", err instanceof Error ? err.message : err);
      }
    }
  }

  const groupAnswers = await classifyWithAi(target, groups, modelBox, mode, image);

  // Fan each group's one answer back out to every shell it represents, so
  // scoring still happens at the real, individual-shell level -- a cluster
  // that wrongly lumped two differently-classified shells together will show
  // up as a wrong answer on one of them, rather than being hidden by scoring
  // the group as a single unit.
  const answerByShellIndex = new Map<number, { partId: string; confidence: number; reasoning: string }>();
  if (groupAnswers) {
    for (const group of groups) {
      const answer = groupAnswers.find((a) => a.groupIndex === group.groupIndex);
      if (!answer) continue;
      for (const shellIndex of group.memberShellIndices) {
        answerByShellIndex.set(shellIndex, answer);
      }
    }
  }

  const roleOf = (partId: PartId) => target.knownParts?.find((p) => p.id === partId)?.role ?? null;

  // A shipped model's classify() answers in the chair vocabulary, so its
  // ground truth is unscoreable against a different family's roles -- every
  // row would read as a miss and the run would print a 0% that measures
  // nothing but the vocabulary mismatch. Drop the ground truth instead and
  // fall through to the same "review by hand" path a foreign file takes.
  const scoreableRole = (role: string) => mode === "known" || role in ROLE_VOCAB_BY_FAMILY[mode];

  let correct = 0;
  let scored = 0;
  const rows = records.map((r) => {
    const ai = answerByShellIndex.get(r.shellIndex) ?? null;
    const resolvedGroundTruth =
      r.groundTruthPartId === null ? null : mode === "known" ? r.groundTruthPartId : (roleOf(r.groundTruthPartId) ?? r.groundTruthPartId);
    const groundTruth = resolvedGroundTruth !== null && scoreableRole(resolvedGroundTruth) ? resolvedGroundTruth : null;
    const match = ai && groundTruth !== null ? ai.partId === groundTruth : null;
    if (match !== null) {
      scored++;
      if (match) correct++;
    }
    const { triPositions: _triPositions, ...reportFields } = r;
    return {
      ...reportFields,
      groundTruthLabel: groundTruth,
      aiPartId: ai?.partId ?? null,
      aiConfidence: ai?.confidence ?? null,
      aiReasoning: ai?.reasoning ?? null,
      match,
    };
  });

  console.log("\nshell  material        surface  ground truth   ai guess        match  confidence");
  for (const row of rows) {
    const mark = row.match === null ? "-" : row.match ? "✓" : "✗";
    console.log(
      `${String(row.shellIndex).padEnd(6)}${row.materialName.slice(0, 15).padEnd(16)}${row.surface.padEnd(9)}${(row.groundTruthLabel ?? "?").padEnd(15)}${(row.aiPartId ?? "").padEnd(16)}${mark.padEnd(7)}${row.aiConfidence?.toFixed(2) ?? ""}`
    );
  }

  if (scored > 0) {
    const pct = ((correct / scored) * 100).toFixed(0);
    const noun = mode === "known" ? "the hand-written classifier" : "the shell's actual rig role";
    console.log(`\nAccuracy: ${correct}/${scored} shells (${pct}%) matched ${noun}.`);
  } else if (groupAnswers) {
    console.log(`\nNo ground truth to score against -- review the AI's guesses and reasoning above by hand.`);
    if (hasGroundTruth) {
      console.log(
        `  (This model's classify() answers in the chair vocabulary, which "${mode}" mode does not offer -- ` +
          `scoring the two against each other would only measure that mismatch.)`
      );
    }
  }

  const outPath = join(outDir, `${outName}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        modelName: target.displayName,
        mode,
        vision: useVision,
        shellCount: records.length,
        groupCount: groups.length,
        accuracy: scored > 0 ? correct / scored : null,
        // triPositions is renderable geometry, not a report field -- multi-MB
        // of raw floats serialized as a JSON object is not something anyone
        // reading this file wants.
        groups: groups.map(({ triPositions: _triPositions, ...g }) => g),
        renderPath: image?.pngPath ?? null,
        legend: image?.legend ?? null,
        parts: rows,
      },
      null,
      2
    )
  );
  console.log(`Full analysis written to ${outPath}`);
}

async function run(modelId: StudioModelId, mode: AnalysisMode, useVision: boolean) {
  const { model, records, modelBox } = analyzeModel(modelId);
  await runAnalysis(
    { displayName: `${model.name} (${modelId})`, upAxis: UP_AXIS[modelId], knownParts: model.parts },
    records,
    modelBox,
    mode,
    // Every mode but the default gets its own suffix, so runs under
    // different vocabularies sit side by side instead of overwriting each
    // other. "known" is the default and stays unsuffixed, keeping the names
    // every report written so far already has.
    `${modelId}${mode === "known" ? "" : `.${mode}`}${useVision ? ".vision" : ""}`,
    useVision
  );
}

async function runForeign(filePath: string, mode: AnalysisMode, useVision: boolean) {
  const { records, modelBox } = analyzeForeignFile(filePath);
  const displayName = filePath.split(/[\\/]/).pop() ?? filePath;
  // The mode is in the filename so running the same file under two
  // vocabularies leaves two reports to compare rather than one overwriting
  // the other. "generic" stays unsuffixed, so every report written before
  // beds existed keeps the name it already had.
  const modeSuffix = mode === "generic" ? "" : `.${mode}`;
  const outName = `foreign-${displayName.replace(/[^a-z0-9.-]+/gi, "_")}${modeSuffix}${useVision ? ".vision" : ""}`;
  await runAnalysis({ displayName, upAxis: "y" }, records, modelBox, mode, outName, useVision);
}

const args = process.argv.slice(2);
const fileArgIndex = args.indexOf("--file");
const useVision = args.includes("--vision");

const modeArgIndex = args.indexOf("--mode");
// A foreign file has no PartDef list to hand over, so "known" is not an
// option there and its default is the generic vocabulary instead.
const requestedMode = modeArgIndex >= 0 ? args[modeArgIndex + 1] : fileArgIndex >= 0 ? "generic" : "known";
if (!isAnalysisMode(requestedMode)) {
  console.error(
    `Unknown mode "${requestedMode}". Options: "known" (this model's own part list), ` +
      `"generic" (the cross-model chair/table role vocabulary -- simulates an unfamiliar chair), ` +
      `or "bed" (the bed role vocabulary: headboard, footboard, rails, mattress, slats).`
  );
  process.exit(1);
}
const mode: AnalysisMode = requestedMode;

if (fileArgIndex >= 0) {
  const filePath = args[fileArgIndex + 1];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/architect-analysis.mts --file <path-to.glb-or-.gltf> [--mode generic|bed] [--vision]");
    process.exit(1);
  }
  if (mode === "known") {
    console.error("--mode known needs a model's own part list, which a --file upload does not have. Use --mode generic or --mode bed.");
    process.exit(1);
  }
  await runForeign(filePath, mode, useVision);
} else {
  const modelArgIndex = args.indexOf("--model");
  const requested = modelArgIndex >= 0 ? args[modelArgIndex + 1] : "victorian-chair";

  const ids = requested === "all" ? (Object.keys(STUDIO_MODELS) as StudioModelId[]) : [requested as StudioModelId];

  for (const id of ids) {
    if (!(id in STUDIO_MODELS)) {
      console.error(`Unknown model "${id}". Options: ${Object.keys(STUDIO_MODELS).join(", ")}, or "all", or --file <path> for an unfamiliar model.`);
      process.exit(1);
    }
  }

  for (const id of ids) {
    await run(id, mode, useVision);
  }
}