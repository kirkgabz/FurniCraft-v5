import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { fetchStoredModel } from "@/lib/meshy/stored-model";
import { splitMeshesIntoShells } from "./chair-segmentation";
import {
  buildAiClassifier,
  buildGenericPartDefs,
  genericResolveSurface,
  originalFinishesFor,
  shellCountByRoleFrom,
  surfaceByRoleFrom,
} from "./generic-rig";
import type { GeneratedSource, StudioModel } from "./studio-models";

/**
 * Turns a stored `GeneratedSource` back into a `StudioModel` the studio can
 * open.
 *
 * BROWSER-ONLY: it fetches through a signed URL and parses with GLTFLoader.
 *
 * This is the other half of what the model lab does after classification,
 * minus everything that needed the AI. The lab split the file, asked for
 * labels, and derived parts from them; here the labels are already known, so
 * the file is split only to (a) prove it still splits into exactly the shells
 * the labels were written for, and (b) read the per-shell materials that
 * decide each part's finish palette. No orientation pass runs: the stored file
 * is the canonical scene the lab already levelled, and re-levelling it could
 * only ever move it.
 *
 * Every failure is a thrown `GeneratedModelError`, never a fallback. The one
 * thing this must not do is return SOMETHING when it cannot return the right
 * thing -- that is how a generated bed used to come back as a Victorian chair.
 */

export type GeneratedModelFailure = "unavailable" | "damaged" | "mismatch";

export class GeneratedModelError extends Error {
  readonly reason: GeneratedModelFailure;

  constructor(reason: GeneratedModelFailure, message: string) {
    super(message);
    this.name = "GeneratedModelError";
    this.reason = reason;
  }
}

/** Shown in the studio's header for a rebuilt piece. */
const GENERATED_ICON = "\u{1F4F7}";

/**
 * Rebuilds the model. The caller owns the returned `url` (a blob URL) and
 * must revoke it once the studio no longer shows this model.
 */
export async function rebuildGeneratedModel(id: string, source: GeneratedSource): Promise<StudioModel> {
  // A missing file and a refused one look identical from here -- both come
  // back from createSignedUrl as an error -- and they mean the same thing to
  // whoever is looking at the screen: this piece cannot be shown to you.
  const file = await fetchStoredModel(source.storagePath);
  if (!file) {
    throw new GeneratedModelError(
      "unavailable",
      "The 3D model behind this design couldn't be loaded. The shop may have removed the piece, or it isn't shared with your account."
    );
  }
  return generatedModelFromFile(id, source, file);
}

/**
 * The half of rebuilding that never touches the network: given the stored
 * file, verify it against the seed and derive the model from it.
 *
 * Split out from `rebuildGeneratedModel` so that the part which can go wrong
 * in subtle ways -- the re-split and the positional labels -- can be checked
 * against a real file without a storage bucket in the way. Same ownership
 * rule for the returned `url`.
 */
export async function generatedModelFromFile(id: string, source: GeneratedSource, file: Blob): Promise<StudioModel> {
  let scene: THREE.Object3D;
  try {
    scene = (await new GLTFLoader().parseAsync(await file.arrayBuffer(), "")).scene;
  } catch {
    throw new GeneratedModelError("damaged", "The stored model for this design is damaged and can't be opened.");
  }

  try {
    const { rawShells } = splitMeshesIntoShells(scene);
    try {
      // The tripwire from GeneratedSource. Labels are positional, so a split
      // with a different count cannot be matched back to them at all -- and a
      // split with the same count but a different order would be matched
      // WRONGLY, which is why `v` exists for the changes this cannot see.
      if (rawShells.length !== source.shellCount) {
        throw new GeneratedModelError(
          "mismatch",
          "This design was saved by an earlier version of the studio, and its parts no longer line up with the model. Publishing it again from the shop will fix this."
        );
      }

      const parts = buildGenericPartDefs(
        new Set(source.shellRoles),
        surfaceByRoleFrom(rawShells, source.shellRoles),
        shellCountByRoleFrom(source.shellRoles, rawShells)
      );

      return {
        id,
        name: source.name,
        defaultProjectName: source.name,
        // The studio fetches and splits this again itself, the same way it
        // does for every model. Handing it the exact bytes that were just
        // verified is what keeps its split and this one the same split.
        url: URL.createObjectURL(file),
        cmPerUnit: source.cmPerUnit,
        classify: buildAiClassifier(source.shellRoles),
        resolveSurface: genericResolveSurface,
        finishUv: "projected",
        defaultFinishes: originalFinishesFor(parts, scene),
        parts,
        icon: GENERATED_ICON,
        credit: "",
        source,
      };
    } finally {
      for (const raw of rawShells) raw.geometry.dispose();
    }
  } finally {
    // Only the part list and the labels survive this function; the studio
    // loads its own copy of the scene. Without this, every reopened design
    // would leave a full parsed model's buffers on the GPU heap.
    disposeScene(scene);
  }
}

function disposeScene(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
