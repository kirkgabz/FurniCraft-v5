import * as THREE from "three";

/**
 * Just enough glTF to read Meshy's models and write new ones, server-side,
 * without decoding a single image.
 *
 * Used by split-partition.ts, which cuts Meshy's original model into the
 * parts its split found. three's own loader and exporter are no use on the
 * server -- both decode textures through browser APIs -- so this works on
 * accessors and bytes directly.
 */

export type GltfJson = {
  asset?: unknown;
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }>;
  meshes?: Array<{
    name?: string;
    primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number; material?: number }>;
  }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    normalized?: boolean;
  }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }>;
  materials?: unknown[];
  textures?: unknown[];
  samplers?: unknown[];
  images?: Array<{ bufferView?: number; mimeType?: string; uri?: string; name?: string }>;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
};

export type Glb = { json: GltfJson; bin: Uint8Array };

/** Anything wrong with a model file itself, as opposed to the network or Meshy. */
export class GlbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlbError";
  }
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGlb(bytes: ArrayBuffer): Glb {
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new GlbError("Not a GLB file.");
  let offset = 12;
  let json: GltfJson | null = null;
  let bin = new Uint8Array(0);
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const body = new Uint8Array(bytes, offset + 8, length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (type === CHUNK_BIN) bin = body;
    offset += 8 + length;
  }
  if (!json) throw new GlbError("The GLB has no JSON chunk.");
  // Compressed geometry would need a decoder this does not carry. No Meshy
  // output uses any, and saying so beats producing garbage.
  if (json.extensionsRequired?.length) {
    throw new GlbError(`Unsupported GLB extensions: ${json.extensionsRequired.join(", ")}.`);
  }
  return { json, bin };
}

const COMPONENT: Record<number, { size: number; read: (view: DataView, at: number) => number }> = {
  5126: { size: 4, read: (v, at) => v.getFloat32(at, true) },
  5125: { size: 4, read: (v, at) => v.getUint32(at, true) },
  5123: { size: 2, read: (v, at) => v.getUint16(at, true) },
  5121: { size: 1, read: (v, at) => v.getUint8(at) },
};
export const ITEM_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readAccessor(glb: Glb, index: number): Float32Array {
  const accessor = glb.json.accessors?.[index];
  if (!accessor || accessor.bufferView === undefined) throw new GlbError(`Accessor ${index} is missing.`);
  const bufferView = glb.json.bufferViews![accessor.bufferView];
  const component = COMPONENT[accessor.componentType];
  const itemSize = ITEM_SIZE[accessor.type];
  if (!component || !itemSize) throw new GlbError(`Accessor ${index} has an unsupported layout.`);

  const stride = bufferView.byteStride ?? component.size * itemSize;
  const base = glb.bin.byteOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(glb.bin.buffer);
  const array = new Float32Array(accessor.count * itemSize);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < itemSize; c++) array[i * itemSize + c] = component.read(view, base + i * stride + c * component.size);
  }
  return array;
}

export type WorldPrimitive = {
  name: string;
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array;
};

/** Every triangle primitive in the default scene, with node transforms baked into positions and normals. */
export function worldPrimitives(glb: Glb): WorldPrimitive[] {
  const { json } = glb;
  const out: WorldPrimitive[] = [];
  const point = new THREE.Vector3();

  const visit = (nodeIndex: number, parent: THREE.Matrix4) => {
    const node = json.nodes![nodeIndex];
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.compose(
        new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1])
      );
    }
    const world = parent.clone().multiply(local);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);

    if (node.mesh !== undefined) {
      const mesh = json.meshes![node.mesh];
      mesh.primitives.forEach((primitive, p) => {
        if ((primitive.mode ?? 4) !== 4) return;
        const position = readAccessor(glb, primitive.attributes.POSITION);
        const positions = new Float32Array(position.length);
        for (let i = 0; i < position.length; i += 3) point.fromArray(position, i).applyMatrix4(world).toArray(positions, i);

        let normals: Float32Array | null = null;
        if (primitive.attributes.NORMAL !== undefined) {
          const normal = readAccessor(glb, primitive.attributes.NORMAL);
          normals = new Float32Array(normal.length);
          for (let i = 0; i < normal.length; i += 3) point.fromArray(normal, i).applyMatrix3(normalMatrix).normalize().toArray(normals, i);
        }
        const uvs = primitive.attributes.TEXCOORD_0 !== undefined ? readAccessor(glb, primitive.attributes.TEXCOORD_0) : null;
        const indices =
          primitive.indices !== undefined
            ? Uint32Array.from(readAccessor(glb, primitive.indices))
            : Uint32Array.from({ length: position.length / 3 }, (_, i) => i);
        out.push({
          name: `${node.name ?? mesh.name ?? `part${out.length}`}${mesh.primitives.length > 1 ? `-${p}` : ""}`,
          positions,
          normals,
          uvs,
          indices,
        });
      });
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const scene = json.scenes?.[json.scene ?? 0];
  for (const root of scene?.nodes ?? []) visit(root, new THREE.Matrix4());
  return out;
}

/** The box around every primitive's positions. */
export function boundsOf(prims: WorldPrimitive[]): THREE.Box3 {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const prim of prims) {
    for (let i = 0; i < prim.positions.length; i += 3) box.expandByPoint(point.fromArray(prim.positions, i));
  }
  return box;
}

/**
 * Moves and scales `prims` in place so their bounds match `target`.
 *
 * Meshy's later steps do not promise to hand a model back where they found
 * it: measured, a retexture returned a table 2.00 wide that went in 1.90 wide,
 * and recentred. Two models of the same shape are brought onto the same box
 * before any surface of one is compared with any surface of the other.
 */
export function alignTo(prims: WorldPrimitive[], target: THREE.Box3): void {
  const source = boundsOf(prims);
  const sourceCentre = source.getCenter(new THREE.Vector3());
  const targetCentre = target.getCenter(new THREE.Vector3());
  const sourceSize = source.getSize(new THREE.Vector3());
  const targetSize = target.getSize(new THREE.Vector3());
  const scale = new THREE.Vector3(
    sourceSize.x > 0 ? targetSize.x / sourceSize.x : 1,
    sourceSize.y > 0 ? targetSize.y / sourceSize.y : 1,
    sourceSize.z > 0 ? targetSize.z / sourceSize.z : 1
  );
  const point = new THREE.Vector3();
  for (const prim of prims) {
    for (let i = 0; i < prim.positions.length; i += 3) {
      point.fromArray(prim.positions, i).sub(sourceCentre).multiply(scale).add(targetCentre).toArray(prim.positions, i);
    }
  }
}

/** A set of primitives flattened to one triangle soup: three corners, a face normal and a tag per triangle. */
export type TriangleSoup = {
  corners: Float32Array;
  normals: Float32Array;
  /** Which primitive each triangle came from, as its index in the list it was built from. */
  owner: Uint32Array;
  bounds: THREE.Box3;
};

export function triangleSoup(prims: WorldPrimitive[]): TriangleSoup {
  const count = prims.reduce((sum, prim) => sum + prim.indices.length / 3, 0);
  const corners = new Float32Array(count * 9);
  const normals = new Float32Array(count * 3);
  const owner = new Uint32Array(count);
  const bounds = new THREE.Box3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  let t = 0;
  prims.forEach((prim, p) => {
    for (let i = 0; i < prim.indices.length; i += 3, t++) {
      for (let k = 0; k < 3; k++) {
        const v = prim.indices[i + k];
        corners.set(prim.positions.subarray(v * 3, v * 3 + 3), t * 9 + k * 3);
      }
      a.fromArray(corners, t * 9);
      b.fromArray(corners, t * 9 + 3);
      c.fromArray(corners, t * 9 + 6);
      bounds.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      THREE.Triangle.getNormal(a, b, c, n).toArray(normals, t * 3);
      owner[t] = p;
    }
  });
  return { corners, normals, owner, bounds };
}

/**
 * A triangle soup bucketed on a uniform grid, so "which of 80,000 triangles
 * is nearest this point" asks a few dozen instead of all of them.
 */
export class TriangleGrid {
  readonly cell: number;
  private readonly buckets = new Map<string, number[]>();
  private readonly origin: THREE.Vector3;

  constructor(readonly soup: TriangleSoup) {
    const size = soup.bounds.getSize(new THREE.Vector3());
    this.cell = Math.max(size.x, size.y, size.z) / 96 || 1;
    this.origin = soup.bounds.min.clone();
    const box = new THREE.Box3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < soup.corners.length / 9; t++) {
      a.fromArray(soup.corners, t * 9);
      b.fromArray(soup.corners, t * 9 + 3);
      c.fromArray(soup.corners, t * 9 + 6);
      box.setFromPoints([a, b, c]);
      const lo = this.key3(box.min);
      const hi = this.key3(box.max);
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const key = `${x},${y},${z}`;
            const bucket = this.buckets.get(key);
            if (bucket) bucket.push(t);
            else this.buckets.set(key, [t]);
          }
    }
  }

  key3(point: THREE.Vector3): [number, number, number] {
    return [
      Math.floor((point.x - this.origin.x) / this.cell),
      Math.floor((point.y - this.origin.y) / this.cell),
      Math.floor((point.z - this.origin.z) / this.cell),
    ];
  }

  /**
   * The triangle nearest `point` whose face agrees with `normal`, searching
   * outward ring by ring until no nearer ring could hold a better one.
   *
   * The normal test is what keeps thin parts honest: the front and back
   * faces of a 9mm panel are 9mm apart, and without it a triangle on the
   * front could be matched to the back.
   */
  nearest(point: THREE.Vector3, normal: THREE.Vector3, maxRings = 12): number {
    const [cx, cy, cz] = this.key3(point);
    const triangle = new THREE.Triangle();
    const closest = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    let best = -1;
    let bestScore = Infinity;
    const seen = new Set<number>();

    for (let ring = 0; ring <= maxRings; ring++) {
      if (best >= 0 && (ring - 1) * this.cell > Math.sqrt(bestScore)) break;
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++)
          for (let z = cz - ring; z <= cz + ring; z++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== ring) continue;
            const bucket = this.buckets.get(`${x},${y},${z}`);
            if (!bucket) continue;
            for (const t of bucket) {
              if (seen.has(t)) continue;
              seen.add(t);
              faceNormal.fromArray(this.soup.normals, t * 3);
              // Facing the other way is not ruled out, only made very far:
              // a model whose winding disagrees must still find a match.
              const facing = faceNormal.dot(normal) < 0 ? 4 * this.cell * this.cell : 0;
              triangle.a.fromArray(this.soup.corners, t * 9);
              triangle.b.fromArray(this.soup.corners, t * 9 + 3);
              triangle.c.fromArray(this.soup.corners, t * 9 + 6);
              triangle.closestPointToPoint(point, closest);
              const score = closest.distanceToSquared(point) + facing;
              if (score < bestScore) {
                bestScore = score;
                best = t;
              }
            }
          }
    }
    return best;
  }
}

const COMPONENT_FLOAT = 5126;
const COMPONENT_UINT = 5125;
const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

export type PartOut = {
  name: string;
  positions: Float32Array;
  normals?: Float32Array | null;
  uvs?: Float32Array | null;
  indices: Uint32Array;
};

/**
 * Writes `parts` as a GLB, one mesh and one node per part. With `look`, every
 * part wears that model's first material, and its textures and images come
 * across as the bytes they already are.
 */
export function writeGlb(parts: PartOut[], look?: Glb, generator = "FurniCraft"): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];

  const addView = (bytes: Uint8Array, target?: number) => {
    const padding = (4 - (binLength % 4)) % 4;
    if (padding) {
      chunks.push(new Uint8Array(padding));
      binLength += padding;
    }
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    binLength += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (array: Float32Array | Uint32Array, type: string, componentType: number, target: number, extra: Record<string, unknown> = {}) => {
    const view = addView(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), target);
    accessors.push({ bufferView: view, componentType, count: array.length / ITEM_SIZE[type], type, ...extra });
    return accessors.length - 1;
  };

  const withLook = Boolean(look?.json.materials?.length);
  const meshes = parts.map((part) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], part.positions[i + k]);
        max[k] = Math.max(max[k], part.positions[i + k]);
      }
    }
    const attributes: Record<string, number> = {
      POSITION: addAccessor(part.positions, "VEC3", COMPONENT_FLOAT, TARGET_ARRAY_BUFFER, { min, max }),
    };
    if (part.normals) attributes.NORMAL = addAccessor(part.normals, "VEC3", COMPONENT_FLOAT, TARGET_ARRAY_BUFFER);
    if (part.uvs) attributes.TEXCOORD_0 = addAccessor(part.uvs, "VEC2", COMPONENT_FLOAT, TARGET_ARRAY_BUFFER);
    return {
      name: part.name,
      primitives: [
        {
          attributes,
          indices: addAccessor(part.indices, "SCALAR", COMPONENT_UINT, TARGET_ELEMENT_ARRAY_BUFFER),
          ...(withLook ? { material: 0 } : {}),
          mode: 4,
        },
      ],
    };
  });

  const images = withLook
    ? (look!.json.images ?? []).map((image) => {
        if (image.bufferView === undefined) throw new GlbError("The model's images are not embedded.");
        const view = look!.json.bufferViews![image.bufferView];
        const bytes = look!.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        return { ...image, bufferView: addView(bytes) };
      })
    : [];

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((mesh, i) => ({ name: mesh.name, mesh: i })),
    meshes,
    ...(withLook
      ? {
          materials: look!.json.materials!.slice(0, 1),
          ...(look!.json.textures ? { textures: look!.json.textures } : {}),
          ...(look!.json.samplers ? { samplers: look!.json.samplers } : {}),
          ...(images.length ? { images } : {}),
          ...(look!.json.extensionsUsed?.length ? { extensionsUsed: look!.json.extensionsUsed } : {}),
        }
      : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = jsonBytes.byteLength + ((4 - (jsonBytes.byteLength % 4)) % 4);
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded);
  let at = 20 + jsonPadded;
  view.setUint32(at, binPadded, true);
  view.setUint32(at + 4, CHUNK_BIN, true);
  at += 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}
