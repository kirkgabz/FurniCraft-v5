import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { splitMeshesIntoShells, type RawShell } from "./chair-segmentation";
import { filterBackdropShells, groupShells, type ShellGroup } from "./shell-grouping";
import {
  buildAiClassifier,
  buildGenericPartDefs,
  consolidateAliasedRoles,
  ensureBaseRole,
  demoteOversizedHardware,
  groundFrameShells,
  orderCushions,
  genericResolveSurface,
  originalFinishesFor,
  shellCountByRoleFrom,
  surfaceByRoleFrom,
} from "./generic-rig";
import { GENERATED_SOURCE_VERSION, type FurnitureCategoryId, type StudioModel } from "./studio-models";
import { isPartRole, type FurnitureFamily, type PartRole } from "./studio-config";
import { orientModel, type OrientationResult } from "./model-leveling";
import { installThreeConsoleFilter } from "./three-console";
import { preparePhotoForMeshy, type PreparedPhoto } from "@/lib/meshy/prepare-photo";
import { storeGeneratedModel } from "@/lib/meshy/stored-model";

/**
 * Photo or file in, editable StudioModel out -- the one pipeline both the
 * model lab and the shop owners' photo page run.
 *
 * BROWSER-ONLY: WebGL for the group render, canvas for the photo, and fetch
 * against this app's own routes.
 *
 * Lifted out of /dev/model-lab, where it grew. There is deliberately one
 * copy: the moment the shop's path and the lab's path diverge, the lab stops
 * being a test of what shops actually get.
 *
 * The AI call is injected (`label`) rather than hard-wired, for two reasons.
 * The two callers are admitted differently -- the lab as an admin, a shop
 * against a generation it paid for -- and the steps either side of the call
 * can be exercised against a stand-in without spending a request.
 */

/**
 * One colour per group in the picture the AI names parts from.
 *
 * Twenty-two, from Kelly's set of maximally distinct colours (black swapped
 * for white against the dark background), where there used to be ten: a
 * split model routinely has more than ten parts, and past the tenth, colours
 * repeated -- two parts the AI could not tell apart. Each group's number is
 * printed on it as well; see renderGroupsToDataUrl.
 */
const GROUP_COLOR_PALETTE = [
  "#f3c300", "#875692", "#f38400", "#a1caf1", "#be0032", "#c2b280", "#848482", "#008856",
  "#e68fac", "#0067a5", "#f99379", "#604e97", "#f6a600", "#b3446c", "#dcd300", "#882d17",
  "#8db600", "#654522", "#e25822", "#2b3d26", "#ffffff", "#5ad1c4",
];

/** Same boundary the CLI script enforces: a raw or chunked scan is out of scope, not a bug to chase. */
const MAX_SHELLS = 5000;

/**
 * How often the browser asks Meshy how the generation is going.
 *
 * Generation runs to minutes, so a tight poll would be hundreds of pointless
 * requests against a rate-limited key. Slow enough to be cheap, quick enough
 * that the percentage on screen still moves.
 */
const MESHY_POLL_MS = 4000;

/** Gives up rather than polling a stuck task forever -- generous, since a detailed model is not fast. */
const MESHY_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * The same, for a high-detail chain: the model alone took three and a half
 * minutes on the test table, and the split and the paint come after it.
 */
const MESHY_DETAILED_TIMEOUT_MS = 15 * 60 * 1000;

/** Where a high-detail chain is; see the route. A quick generation only ever reports `generating`. */
export type GenerationStage = "generating" | "separating" | "done";

export type PipelineStage = "parsing" | "splitting" | "grouping" | "rendering" | "classifying";

/** What the pipeline learned along the way, reported as it learns it. */
export type PipelineReport = {
  orientation?: OrientationResult;
  shellCount?: number;
  groupCount?: number;
  excludedMeshCount?: number;
};

/**
 * What one trip through the pipeline produced that is worth keeping.
 *
 * `glb` is the scene the studio is now showing -- levelled, squared, stripped
 * of any backdrop -- and `shellRoles` labels its shells in the order
 * `splitMeshesIntoShells` yields them. The two only mean anything together:
 * see `GeneratedSource` for why storing the wrong one of these silently
 * relabels the furniture rather than failing.
 */
export type CanonicalUpload = {
  glb: Blob;
  shellRoles: PartRole[];
  shellCount: number;
  cmPerUnit: number;
  name: string;
};

/**
 * The model came back in a shape this pipeline cannot turn into parts.
 *
 * Its own class because it is the one failure that is OUR system failing the
 * shop rather than the shop's photo or connection, and the subscription
 * refunds it ('pipeline_rejected') while the period's retries last.
 */
export class PipelineRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineRejectedError";
  }
}

/**
 * The session lapsed partway through.
 *
 * A signed-out request never reaches these routes: the proxy redirects it to
 * the sign-in page, fetch follows that redirect without saying so, and what
 * comes back is a 200 carrying the sign-in page's HTML. Read naively, that was
 * a crash in labelling (no `groups`), a missing task id from generation, and
 * -- worst -- a poll that never saw a finished status and sat on "Building
 * the 3D model" until the six-minute timeout. Measured, not assumed: a
 * signed-out GET of the task route answers 200, redirected, text/html.
 */
export class SignedOutError extends Error {
  constructor() {
    super("You've been signed out. Sign in again to carry on; anything already generating is kept under “Unfinished”.");
    this.name = "SignedOutError";
  }
}

function assertSignedIn(response: Response): void {
  if (response.redirected && new URL(response.url).pathname.startsWith("/auth")) throw new SignedOutError();
}

/** A route's JSON reply, or an empty object when it has none -- once a sign-in redirect is ruled out. */
async function readReply(response: Response): Promise<Record<string, unknown>> {
  assertSignedIn(response);
  const body: unknown = await response.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** The labelling route refused or failed. `exhausted` means no passes are left to try again with. */
export class LabellingError extends Error {
  readonly exhausted: boolean;

  constructor(message: string, exhausted: boolean) {
    super(message);
    this.name = "LabellingError";
    this.exhausted = exhausted;
  }
}

export type LabelRequest = {
  displayName: string;
  upAxis: "y";
  modelBox: { min: number[]; max: number[] };
  groups: Array<{
    groupIndex: number;
    materialName: string;
    surface: string;
    memberCount: number;
    vertexCountMin: number;
    vertexCountMax: number;
    triCountTotal: number;
    box: { min: number[]; max: number[] };
  }>;
  imageDataUrl: string;
  legend: Array<{ groupIndex: number; color: string }>;
  family: FurnitureFamily;
  /** The kind of piece, when known -- so the prompt can call a cabinet a cabinet rather than "chair-shaped". */
  category?: FurnitureCategoryId;
  /** The image has every group's number printed on it. */
  numbered?: boolean;
};

export type LabelAnswer = Array<{ groupIndex: number; partId: string }>;

/** Names each shell group. See `labelViaApi` for the real one. */
export type LabelGroups = (request: LabelRequest) => Promise<LabelAnswer>;

/**
 * Labels through /api/architect-analysis.
 *
 * With a `taskId` the route admits a shop owner for a generation their shop
 * paid for, and spends one of that generation's labelling passes; without
 * one it admits only an admin. `onRemaining` hears how many passes are left.
 */
export function labelViaApi(options: { taskId?: string; onRemaining?: (left: number | null) => void } = {}): LabelGroups {
  return async (request) => {
    const response = await fetch("/api/architect-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.taskId ? { ...request, taskId: options.taskId } : request),
    });
    const data = await readReply(response);
    if (!response.ok) {
      const message = typeof data.error === "string" ? data.error : `Naming the parts failed (${response.status}).`;
      throw new LabellingError(message, response.status === 429);
    }
    if (!Array.isArray(data.groups)) throw new LabellingError("The part names came back unreadable. Try again.", false);
    options.onRemaining?.(typeof data.analysesRemaining === "number" ? data.analysesRemaining : null);
    return data.groups as LabelAnswer;
  };
}

/**
 * Renders every group in its own flat colour to an offscreen canvas and
 * returns a PNG data URL -- the same picture `scripts/architect-analysis.mts`
 * builds via puppeteer, except the browser already has the GPU context that
 * required, so no headless-Chrome step is needed here.
 *
 * Clones each shell's geometry before transforming it: `rawShells[i].geometry`
 * must stay in local space for `classifyAndBakeShells` to bake later --
 * baking it twice here would double-transform it.
 */
function renderGroupsToDataUrl(rawShells: RawShell[], groups: ShellGroup[]): { imageDataUrl: string; legend: Array<{ groupIndex: number; color: string }> } {
  const legend = groups.map((g, i) => ({ groupIndex: g.groupIndex, color: GROUP_COLOR_PALETTE[i % GROUP_COLOR_PALETTE.length] }));

  const width = 900;
  const height = 700;
  installThreeConsoleFilter();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20242b);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 1.4, 1);
  scene.add(dirLight);

  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  groups.forEach((g, i) => {
    const material = new THREE.MeshStandardMaterial({ color: legend[i].color, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide });
    materials.push(material);
    for (const memberIndex of g.memberIndices) {
      const raw = rawShells[memberIndex];
      const worldGeometry = raw.geometry.clone();
      worldGeometry.applyMatrix4(raw.mesh.matrixWorld);
      worldGeometry.computeVertexNormals();
      group.add(new THREE.Mesh(worldGeometry, material));
    }
  });
  scene.add(group);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
  camera.position.set(center.x + maxDim * 1.1, center.y + maxDim * 0.75, center.z + maxDim * 1.4);
  camera.lookAt(center);

  renderer.render(scene, camera);

  // Each group's number, printed on a spot of it the camera can actually see.
  // Colour alone was not enough to name a part by: with more groups than the
  // palette has colours, two parts share one, and a split lounge chair came
  // back with its cushion and one of its back posts swapped. A number on the
  // part itself leaves nothing to match by eye.
  scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const meshesOf = new Map<THREE.Mesh, number>();
  // One material per group, in group order, so a mesh's material says whose it is.
  group.children.forEach((child) => {
    const mesh = child as THREE.Mesh;
    meshesOf.set(mesh, materials.indexOf(mesh.material as THREE.Material));
  });
  const labels = groups.map((_, i) => {
    const own = [...meshesOf.entries()].filter(([, owner]) => owner === i).map(([mesh]) => mesh);
    const point = new THREE.Vector3();
    for (const mesh of own) {
      const position = mesh.geometry.getAttribute("position");
      const step = Math.max(1, Math.floor(position.count / 60));
      for (let v = 0; v < position.count; v += step) {
        point.fromBufferAttribute(position, v);
        const toPoint = point.clone().sub(camera.position);
        raycaster.set(camera.position, toPoint.clone().normalize());
        const hit = raycaster.intersectObjects(group.children, false)[0];
        if (hit && meshesOf.get(hit.object as THREE.Mesh) === i && hit.distance >= toPoint.length() - maxDim * 0.02) {
          return point.clone().project(camera);
        }
      }
    }
    // No spot of it can be seen from here: better unnumbered than numbered on
    // whatever hides it, which is how a band on the back of a cushion once
    // put its number on the cushion's face.
    return null;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser would not give a 2D canvas to label the parts on.");
  context.drawImage(renderer.domElement, 0, 0);
  context.font = "bold 20px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  labels.forEach((projected, i) => {
    if (!projected) return;
    const x = ((projected.x + 1) / 2) * width;
    const y = ((1 - projected.y) / 2) * height;
    const text = String(groups[i].groupIndex);
    const radius = 13 + 5 * (text.length - 1);
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#000000";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#000000";
    context.fillText(text, x, y + 1);
  });
  const imageDataUrl = canvas.toDataURL("image/png");

  group.traverse((object) => {
    (object as THREE.Mesh).geometry?.dispose();
  });
  for (const material of materials) material.dispose();
  renderer.dispose();

  return { imageDataUrl, legend };
}

/**
 * Repackages a parsed scene as a self-contained .glb Blob. Needed for a
 * multi-file glTF upload (scene.gltf + scene.bin + textures, the most
 * common export shape): FurnitureStudio independently re-fetches
 * `model.url` with its own plain GLTFLoader, which has no way to resolve
 * this page's blob-URL-by-filename map, so the URL it fetches has to carry
 * everything it needs on its own.
 */
async function exportSceneAsGlb(scene: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  const output = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(scene, (result) => resolve(result as ArrayBuffer), reject, { binary: true });
  });
  return new Blob([output], { type: "model/gltf-binary" });
}

export type AnalysedModel = {
  /** Ephemeral until a caller files it; its `url` is a blob URL the caller owns and must revoke. */
  model: StudioModel;
  upload: CanonicalUpload;
};

/**
 * Levels, splits, groups and labels a model file, and builds the StudioModel
 * the studio opens.
 */
export async function analyseModelFiles(
  files: File[],
  options: {
    /** Real height of the piece in centimetres -- see StudioModel.cmPerUnit. */
    cmPerUnit: number;
    family: FurnitureFamily;
    /** What kind of piece, when the caller knows -- the labeller names it in its prompt. */
    category?: FurnitureCategoryId;
    label: LabelGroups;
    onStage?: (stage: PipelineStage) => void;
    onReport?: (report: PipelineReport) => void;
  }
): Promise<AnalysedModel> {
  const { cmPerUnit, family, category, label, onStage, onReport } = options;

  const primary = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
  if (!primary) throw new Error("Select a .glb file, or a .gltf plus its .bin and textures.");

  onStage?.("parsing");
  const companions = files.filter((f) => f !== primary);
  const blobUrlByName = new Map(companions.map((f) => [f.name, URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const name = decodeURIComponent(url.split(/[\\/]/).pop() ?? url);
    return blobUrlByName.get(name) ?? url;
  });

  let gltf: GLTF;
  try {
    const buffer = await primary.arrayBuffer();
    gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader(manager).parse(buffer, "", resolve, reject);
    });
  } finally {
    // The companions exist only to satisfy the loader's own fetches for
    // a multi-file .gltf. Once parse has returned -- or thrown -- they
    // have no further reader, so they are released here rather than
    // being left pinned for the life of the tab.
    for (const url of blobUrlByName.values()) URL.revokeObjectURL(url);
  }

  // Before anything measures the geometry. A model built on a slant
  // classifies perfectly and then renders tipped over, because every
  // step between the two is relative and only the render cares which
  // way Y points -- so the correction has to land ahead of all of them,
  // not be applied to the picture at the end.
  const orientation = orientModel(gltf.scene);
  const levelledBy = orientation.tiltDegrees + orientation.yawDegrees;
  onReport?.({ orientation });

  onStage?.("splitting");
  let split = splitMeshesIntoShells(gltf.scene);
  if (split.rawShells.length === 0) {
    throw new PipelineRejectedError("The model came back with no solid geometry in it, so there was nothing to split into parts.");
  }
  if (split.rawShells.length > MAX_SHELLS) {
    throw new PipelineRejectedError(
      `The model came back in ${split.rawShells.length} separate fragments -- far more than any real piece of furniture has -- so it can't be split into parts.`
    );
  }

  // Some exports (tables especially) bundle a backdrop/ground plane
  // alongside the real furniture. Strip any mesh that is ENTIRELY
  // backdrop-flagged shells straight out of the scene graph and
  // re-split, rather than just filtering the array here: FurnitureStudio
  // re-parses this same upload independently later, and buildAiClassifier
  // depends on both parses producing shells in the identical order --
  // an array-only filter here would silently desync the two. A mesh
  // that mixes real and flagged shells is left alone entirely; that is
  // a rarer shape than a dedicated backdrop mesh, and leaving a little
  // stray geometry in is safer than risking a real part.
  const boxed = split.rawShells.map((s) => ({ raw: s, box: s.worldBox }));
  const { excluded } = filterBackdropShells(boxed);
  let sceneWasCleaned = false;
  let removedMeshCount = 0;
  if (excluded.length > 0) {
    const excludedMeshes = new Set(excluded.map((e) => e.raw.mesh));
    const meshHasKeptShell = new Set(
      boxed.filter((b) => !excluded.includes(b)).map((b) => b.raw.mesh)
    );
    for (const mesh of excludedMeshes) {
      if (meshHasKeptShell.has(mesh)) continue;
      mesh.removeFromParent();
      sceneWasCleaned = true;
      removedMeshCount++;
    }
    if (sceneWasCleaned) split = splitMeshesIntoShells(gltf.scene);
  }

  // One shell is one solid lump. There is nothing to resize or refinish part
  // by part, which is the whole of what a template offers a customer.
  if (split.rawShells.length === 1) {
    throw new PipelineRejectedError("The model came back as one solid lump, with no separate parts to customise.");
  }

  const { rawShells, worldModelBox } = split;
  onReport?.({ shellCount: rawShells.length, excludedMeshCount: removedMeshCount });

  onStage?.("grouping");
  // A split model (High detail) arrives as one mesh per part Meshy cut, all
  // sharing one blank material. Grouping is for many copies of one part --
  // the strands of a weave, four legs -- and with no material to tell them
  // apart it matched parts on counts alone: a lounge chair's whole frame and
  // its back cushion, 22,639 and 24,686 triangles, went to the AI as "two
  // nearly-identical shells" and came back with one name. The split has
  // already said which shells belong together, so its meshes are kept apart.
  // A one-mesh model -- every Quick generation -- is grouped exactly as before.
  const meshes = [...new Set(rawShells.map((s) => s.mesh))];
  const materials = new Set(rawShells.map((s) => s.materialName));
  const keepMeshesApart = meshes.length > 1 && materials.size === 1;
  const groupInput = rawShells.map((s) => ({
    materialName: s.materialName,
    // A split model has no materials to read a surface from, and the default
    // guess is "wood" -- for the cushions too, which told the AI a cushion was
    // timber and had it called a frame. Unknown is the honest answer.
    surface: keepMeshesApart ? "unknown" : genericResolveSurface(s.material),
    vertexCount: s.vertexCount,
    triCount: (s.geometry.getIndex()?.count ?? 0) / 3,
    box: s.worldBox,
    ...(keepMeshesApart ? { groupKey: `mesh-${meshes.indexOf(s.mesh)}` } : {}),
  }));
  const groups = groupShells(groupInput, worldModelBox, "y");
  onReport?.({ groupCount: groups.length });

  onStage?.("rendering");
  const { imageDataUrl, legend } = renderGroupsToDataUrl(rawShells, groups);

  onStage?.("classifying");
  const answers = await label({
    displayName: primary.name,
    upAxis: "y",
    modelBox: { min: worldModelBox.min.toArray(), max: worldModelBox.max.toArray() },
    groups: groups.map((g) => ({
      groupIndex: g.groupIndex,
      materialName: g.materialName,
      surface: g.surface,
      memberCount: g.memberCount,
      vertexCountMin: g.vertexCountMin,
      vertexCountMax: g.vertexCountMax,
      triCountTotal: g.triCountTotal,
      box: { min: g.box.min.toArray(), max: g.box.max.toArray() },
    })),
    imageDataUrl,
    legend,
    numbered: true,
    family,
    ...(category ? { category } : {}),
  });

  const shellRoles: PartRole[] = new Array(rawShells.length).fill("base");
  for (const group of groups) {
    const answer = answers.find((a) => a.groupIndex === group.groupIndex);
    const role: PartRole = isPartRole(answer?.partId) ? answer.partId : "base";
    for (const memberIndex of group.memberIndices) shellRoles[memberIndex] = role;
  }
  consolidateAliasedRoles(shellRoles);
  groundFrameShells(rawShells, shellRoles, worldModelBox, family);
  demoteOversizedHardware(rawShells, shellRoles, worldModelBox);
  orderCushions(rawShells, shellRoles, family);
  ensureBaseRole(rawShells, shellRoles, worldModelBox);

  const parts = buildGenericPartDefs(
    new Set(shellRoles),
    surfaceByRoleFrom(rawShells, shellRoles),
    shellCountByRoleFrom(shellRoles, rawShells)
  );
  const classify = buildAiClassifier(shellRoles);

  // A single, untouched .glb is already self-contained. A multi-file
  // glTF upload, one that had backdrop geometry stripped out above, or
  // one just levelled, gets repackaged so FurnitureStudio's own,
  // independent GLTFLoader fetch -- which knows nothing about the blob-URL
  // map, the mesh removed, or the rotation baked in -- sees the exact same
  // corrected scene. Levelling MUST be in this list: without it the studio
  // would re-fetch the original file and render the crooked original,
  // while every measurement on screen described the levelled one.
  const needsRepackage = companions.length > 0 || sceneWasCleaned || levelledBy > 0;
  // Kept as a Blob first, and the URL made from it, so there is exactly
  // one set of canonical bytes: the scene that was just classified.
  //
  // That identity is what makes `shellRoles` reusable later. The labels
  // are positional, so re-splitting a DIFFERENT file -- the raw download
  // before levelling, say -- can renumber the shells and quietly relabel
  // the furniture. Whatever the studio loads is what gets stored, and
  // when nothing needed repackaging `primary` already IS that scene,
  // byte for byte, so exporting it again would only add a glTF
  // round-trip for the untouched uploads that need it least.
  const canonicalGlb: Blob = needsRepackage ? await exportSceneAsGlb(gltf.scene) : primary;
  const name = primary.name.replace(/\.(glb|gltf)$/i, "");

  return {
    model: {
      // Lives only as long as this tab until a caller files it: its url is a
      // blob URL. See StudioModel.ephemeral and keepGeneratedModel.
      ephemeral: true,
      id: `dynamic-upload-${Date.now()}`,
      name,
      defaultProjectName: primary.name,
      url: URL.createObjectURL(canonicalGlb),
      cmPerUnit,
      classify,
      resolveSurface: genericResolveSurface,
      finishUv: "projected",
      // A painted model opens showing its paint, not tinted over it.
      defaultFinishes: originalFinishesFor(parts, gltf.scene),
      parts,
      icon: "\u{1F9EA}",
      credit: "",
    },
    upload: { glb: canonicalGlb, shellRoles, shellCount: rawShells.length, cmPerUnit, name },
  };
}

/**
 * Files the canonical scene and returns what turns the model into one that
 * can be saved and reopened: a stable id and its GeneratedSource.
 *
 * Upserts over whatever is already at the task's path -- typically the raw
 * download a caller filed as a safety net before the pipeline ran, which is
 * NOT the scene these labels describe.
 */
export async function keepGeneratedModel(
  taskId: string,
  upload: CanonicalUpload
): Promise<{ patch: Partial<StudioModel> } | { error: string }> {
  const filed = await storeGeneratedModel(taskId, upload.glb);
  if ("error" in filed) return { error: filed.error };
  return {
    patch: {
      // A stored file plus the labels that go with it is enough to rebuild
      // this piece in another session, so it is no longer ephemeral and the
      // studio will let it be saved.
      ephemeral: false,
      // Traceable back to the generation -- a timestamp id means nothing once
      // the design is saved.
      id: `generated-${taskId}`,
      icon: "\u{1F4F7}",
      source: {
        v: GENERATED_SOURCE_VERSION,
        storagePath: filed.path,
        shellRoles: upload.shellRoles,
        shellCount: upload.shellCount,
        cmPerUnit: upload.cmPerUnit,
        name: upload.name,
      },
    },
  };
}

/**
 * Downscales the photo and asks Meshy for a model.
 *
 * With a `shopId` the route bills that shop's subscription first and refuses
 * if the allowance is spent; without one it admits only an admin. The
 * refusal message is written for the shop owner and is thrown as-is.
 */
export async function startGeneration(
  photos: File | File[],
  options: {
    textured?: boolean;
    shopId?: string;
    /** High detail: a detailed model split into parts, costing the shop 3 generations. */
    mode?: "quick" | "detailed";
    category?: FurnitureCategoryId;
  } = {}
): Promise<{ taskId: string; remaining: number | null; sent: PreparedPhoto }> {
  const files = (Array.isArray(photos) ? photos : [photos]).slice(0, options.mode === "detailed" ? 4 : 1);
  // Downscaled here, not sent whole: a full-resolution phone photo is past
  // the platform's request-body limit once base64 has inflated it, and the
  // generator does not use the extra pixels anyway. Several photos share the
  // one request body, so each gets its share of it.
  const prepared = [];
  for (const file of files) prepared.push(await preparePhotoForMeshy(file, files.length));
  const sent = prepared[0];
  const response = await fetch("/api/meshy/image-to-3d", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      images: prepared.map((photo) => photo.dataUri),
      textured: options.textured === true,
      mode: options.mode ?? "quick",
      ...(options.category ? { category: options.category } : {}),
      ...(options.shopId ? { shopId: options.shopId } : {}),
    }),
  });
  const body = await readReply(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `The model couldn't be started (${response.status}).`);
  }
  if (typeof body.taskId !== "string") throw new Error("The model couldn't be started: no task came back.");
  return { taskId: body.taskId, remaining: typeof body.remaining === "number" ? body.remaining : null, sent };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for Meshy to finish a task, has the server file the model in
 * storage, and reads it back from there.
 *
 * Returns null if `isCancelled` turns true first -- Meshy carries on either
 * way, the credits already committed, but there is no reason to keep asking
 * about a generation nobody is waiting for. Polls straight away rather than
 * sleeping first, so resuming a task that finished long ago does not make
 * anyone wait four seconds to be told so.
 */
export async function waitForModel(
  taskId: string,
  options: {
    isCancelled: () => boolean;
    onProgress?: (progress: number | null, credits: number | null, stage: GenerationStage | null) => void;
    /** Something the shop should know about a model that still arrived -- a texture that couldn't be painted. */
    onNote?: (note: string) => void;
  }
): Promise<Blob | null> {
  const startedAt = Date.now();
  const query = `taskId=${encodeURIComponent(taskId)}`;
  let timeout = MESHY_TIMEOUT_MS;
  // Poll rather than hold a request open: generation runs to minutes, which
  // is far past any sensible serverless timeout.
  for (;;) {
    if (options.isCancelled()) return null;
    if (Date.now() - startedAt > timeout) {
      throw new Error(
        `The model is still being built after ${Math.round(timeout / 60000)} minutes. Leave it running and pick it up again later.`
      );
    }

    const polled = await fetch(`/api/meshy/image-to-3d?${query}`);
    const task = await readReply(polled);
    if (!polled.ok) {
      throw new Error(typeof task.error === "string" ? task.error : `Checking on the model failed (${polled.status}).`);
    }
    // A reply without a status cannot be told apart from "still working", so
    // it has to end the loop here rather than be polled for six minutes.
    if (typeof task.status !== "string") throw new Error("Checking on the model returned something unreadable.");

    // Only a high-detail chain reports a stage, and it runs to three steps.
    const stage = typeof task.stage === "string" ? (task.stage as GenerationStage) : null;
    if (stage) timeout = MESHY_DETAILED_TIMEOUT_MS;

    options.onProgress?.(
      typeof task.progress === "number" ? task.progress : null,
      typeof task.consumedCredits === "number" ? task.consumedCredits : null,
      stage
    );
    if (task.status === "SUCCEEDED") {
      if (typeof task.note === "string") options.onNote?.(task.note);
      break;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      const message = typeof task.error === "string" ? task.error : `Meshy ${task.status.toLowerCase()} the generation.`;
      // Built and paid for, and unusable through no fault of the photo: the
      // same failure the pipeline itself raises for a model it cannot split,
      // and refunded the same way.
      if (task.rejected === true) throw new PipelineRejectedError(message);
      throw new Error(message);
    }
    await sleep(MESHY_POLL_MS);
  }

  if (options.isCancelled()) return null;
  // The server files the model and says where; the bytes never pass back
  // through our function, whose answers are capped at 4.5 MB on Vercel.
  const stored = await fetch(`/api/meshy/image-to-3d?${query}&store=1`);
  const reply = await readReply(stored);
  if (!stored.ok) {
    throw new Error(typeof reply.error === "string" ? reply.error : `The finished model couldn't be saved (${stored.status}).`);
  }
  if (typeof reply.signedUrl !== "string") throw new Error("The finished model was saved, but no link to it came back.");
  if (typeof reply.note === "string") options.onNote?.(reply.note);

  const download = await fetch(reply.signedUrl);
  if (!download.ok) throw new Error(`The finished model couldn't be read back from storage (${download.status}).`);
  const glb = await download.blob();
  return options.isCancelled() ? null : glb;
}
