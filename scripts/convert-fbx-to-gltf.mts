/**
 * One-off: convert an FBX file to GLB using the loader/exporter Three.js
 * already ships (examples/jsm), so architect-analysis.mts's existing glTF
 * reader can run against it unmodified. Not a general pipeline -- just
 * enough to get a genuinely foreign model into a format the prototype
 * understands.
 *
 * Usage: npx tsx scripts/convert-fbx-to-gltf.mts <input.fbx> <output.glb>
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Node has no <img>/<canvas>, and FBXLoader tries to decode embedded texture
// images through the browser Image element regardless. Segmentation only
// needs geometry and material *names*, never pixel data, so texture loading
// is short-circuited to a blank texture instead of shimming a DOM.
THREE.TextureLoader.prototype.load = function (_url, onLoad) {
  const texture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
  onLoad?.(texture);
  return texture;
};

// GLTFExporter packs its output through Blob + FileReader, both browser-only.
// Node has a native Blob (with an async arrayBuffer() method) since v18; this
// is the minimal FileReader surface the exporter actually calls.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob: Blob) {
    const buf = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || "application/octet-stream"};base64,${buf.toString("base64")}`;
    this.onloadend?.();
  }
}
(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;

// FBXLoader builds a default aspect ratio for any camera baked into the FBX
// scene from window.innerWidth/innerHeight -- a table exported with its own
// scene camera hits this path, chairs so far have not. Segmentation never
// looks at cameras, so any plausible aspect ratio is fine; this only exists
// so the parse does not crash reading `window` in Node.
const globalWithWindow = globalThis as unknown as { window?: { innerWidth: number; innerHeight: number } };
if (typeof globalWithWindow.window === "undefined") {
  globalWithWindow.window = { innerWidth: 1920, innerHeight: 1080 };
}

/**
 * Object3D, what traverse hands back, does not declare isMesh -- only the Mesh
 * subclass does. Narrowing on it here rather than casting at each use keeps
 * `material` properly typed as Material | Material[] in both loops below.
 */
function isMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true;
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("Usage: npx tsx scripts/convert-fbx-to-gltf.mts <input.fbx> <output.glb>");
  process.exit(1);
}

const buffer = readFileSync(inputPath);
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loader = new FBXLoader();
const group = loader.parse(arrayBuffer, "");

console.log("Loaded FBX. Children:", group.children.length);
let meshCount = 0;
group.traverse((obj) => {
  if (isMesh(obj)) {
    meshCount++;
    console.log(" -", obj.name || "(unnamed mesh)", "| material:", Array.isArray(obj.material) ? obj.material.map((m) => m.name) : obj.material?.name);
  }
});
console.log("Total meshes:", meshCount);

// The exporter serializes any texture it finds via Blob + FileReader, both
// browser-only. Segmentation reads geometry and material names, never
// texture pixels, so every map is dropped before export rather than shimming
// FileReader to round-trip image data nothing downstream will look at.
const MAP_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap", "emissiveMap", "specularMap", "envMap", "alphaMap"];
group.traverse((obj) => {
  if (!isMesh(obj)) return;
  const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const material of materials) {
    // Which texture slots exist depends on the material class, and three types
    // none of them as string-indexable. This loop only ever clears a slot that
    // is already set, so viewing the material as a bag of texture slots is
    // accurate for what it does and beats naming all ten properties twice.
    const slots = material as unknown as Record<string, THREE.Texture | null>;
    for (const key of MAP_KEYS) if (slots[key]) slots[key] = null;
  }
});

const exporter = new GLTFExporter();
exporter.parse(
  group,
  (result) => {
    const glb = result as ArrayBuffer;
    writeFileSync(outputPath, Buffer.from(glb));
    console.log(`Wrote ${outputPath} (${(glb.byteLength / 1024).toFixed(0)} KB)`);
  },
  (err: unknown) => {
    console.error("Export failed:", err);
    process.exit(1);
  },
  { binary: true }
);
