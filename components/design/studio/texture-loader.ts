import * as THREE from "three";

/**
 * Loads and caches the PBR maps a finish adds to a part.
 *
 * Three things make this more than a call to TextureLoader.
 *
 * The maps are shared but the *transform* is not: how many times a grain
 * repeats across a leg is different from across a seat, and `repeat` lives on
 * the texture rather than on the material. So the decoded image is cached once
 * per folder and handed out as a clone, which shares the GPU upload but carries
 * its own repeat.
 *
 * The maps are not encoded alike. A diffuse is colour and must be decoded
 * through sRGB; a normal and a roughness are measurements and must not be.
 * Getting this backwards does not fail loudly -- it just lights every surface
 * slightly wrongly -- so the colour space is declared per map here rather than
 * left to whoever calls this.
 *
 * And the load is allowed to fail. A finish is a colour first and a texture
 * second: the hex tint is applied immediately and the maps arrive later, so a
 * missing file, a slow connection or a blocked request costs the surface
 * detail and nothing else. Nothing here ever leaves the customer looking at an
 * untextured grey chair waiting for a download.
 *
 * ---------------------------------------------------------------------------
 * Adding a finish
 *
 * Drop a folder under `public/textures/<name>/` containing exactly these files:
 *
 *   diffuse.jpg    the scanned colour, sRGB. Optional -- a finish that omits
 *                  it keeps the model's own photographed baseColor and takes
 *                  only the relief, which is what a pale finish wants when the
 *                  scan is a dark timber.
 *   normal.png     OpenGL convention (+Y up). Poly Haven calls this `nor_gl`;
 *                  the DirectX `nor_dx` variant has its green channel inverted
 *                  and will light every bevel backwards.
 *   roughness.png  read from the GREEN channel by Three.js, so a single-channel
 *                  source must be broadcast across RGB before it is saved.
 *
 * Then point a profile in materials-db.ts at the folder name via `pbr`.
 */

export type MaterialMaps = {
  diffuse: THREE.Texture | null;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
};

/**
 * The file name and colour space of each map, in one place.
 *
 * The extensions differ on purpose. A diffuse is a photograph, so JPEG costs a
 * fraction of the bytes and the artefacts are invisible. A normal map is a
 * per-pixel direction, and JPEG ringing on an XY vector reads as faceting
 * across what should be a flat panel -- so it stays lossless.
 */
const MAPS = {
  diffuse: { file: "diffuse.jpg", colorSpace: THREE.SRGBColorSpace },
  normal: { file: "normal.png", colorSpace: THREE.NoColorSpace },
  roughness: { file: "roughness.png", colorSpace: THREE.NoColorSpace },
} as const;

type MapKind = keyof typeof MAPS;
const KINDS = Object.keys(MAPS) as MapKind[];

/**
 * Anisotropic filtering degree, set from the renderer once it exists.
 *
 * This matters more here than it would elsewhere: a chair is looked at from a
 * low angle, and a wood grain viewed edge-on across a seat is precisely the
 * case trilinear filtering smears into mush. The default is a safe floor for
 * hardware that reports less.
 */
let maxAnisotropy = 4;

export function setTextureAnisotropy(value: number) {
  maxAnisotropy = Math.max(1, Math.floor(value));
}

/** One in-flight or settled load per folder, so a swatch clicked twice loads once. */
const cache = new Map<string, Promise<MaterialMaps>>();

function loadOne(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = colorSpace;
        texture.anisotropy = maxAnisotropy;
        resolve(texture);
      },
      undefined,
      // A missing map is a missing detail, never a broken studio.
      () => resolve(null)
    );
  });
}

export function loadMaterialMaps(folder: string): Promise<MaterialMaps> {
  const hit = cache.get(folder);
  if (hit) return hit;

  const pending = Promise.all(
    KINDS.map((kind) => loadOne(`/textures/${folder}/${MAPS[kind].file}`, MAPS[kind].colorSpace))
  ).then(([diffuse, normal, roughness]) => ({ diffuse, normal, roughness }));

  cache.set(folder, pending);
  return pending;
}

/**
 * A per-use copy of a cached map, with its own tiling.
 *
 * clone() shares the underlying image and its GPU upload; what it does not
 * share is the transform, which is the whole point -- without this, changing
 * the repeat for a chair leg would silently change it for the seat as well.
 *
 * The repeat is taken separately per axis because timber is not isotropic: the
 * grain runs the length of a rail, and tiling it as often across the width as
 * along the length turns a plank into a chequerboard.
 */
export function tiled(
  texture: THREE.Texture | null,
  repeatX: number,
  repeatY: number
): THREE.Texture | null {
  if (!texture) return null;
  const copy = texture.clone();
  copy.needsUpdate = true;
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  copy.repeat.set(repeatX, repeatY);
  return copy;
}

/** Frees the clones a material was holding. The cached originals stay. */
export function disposeMaps(maps: MaterialMaps) {
  maps.diffuse?.dispose();
  maps.normal?.dispose();
  maps.roughness?.dispose();
}
