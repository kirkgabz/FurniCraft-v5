import * as THREE from "three";
import { GlbError, TriangleGrid, alignTo, boundsOf, parseGlb, triangleSoup, worldPrimitives, writeGlb, type PartOut } from "./glb";

/**
 * Divides Meshy's original model into the parts its split found, without
 * using the split's geometry.
 *
 * The split is what makes a high-detail piece a template -- it knows where a
 * chair's leg stops and its arm begins -- but its geometry is not fit to
 * show. It rebuilds the surface around every cut and drops the model's
 * normals and texture coordinates: measured on a lounge chair, a straight,
 * clean front leg came back dented and ragged at the arm, the seat rail and
 * the runner, and no amount of smoothing puts back a shape that has moved.
 *
 * So the split is read as a map, not a model. Every triangle of the original
 * surface is given to the split part nearest it, and the original triangles
 * are what the parts are made of -- the same shape Meshy generated, with its
 * own shading normals and texture coordinates, divided the way the split
 * divided it.
 *
 * A division by nearest part is noisy along the boundaries, so it is tidied
 * twice: a triangle outvoted by its neighbours joins them, and a small island
 * of one part stranded inside another is folded into what surrounds it.
 */

export class PartitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartitionError";
  }
}

export type PartitionResult = {
  glb: ArrayBuffer;
  parts: number;
  /** Triangles whose part was changed by the tidying passes, as a share of all of them. */
  retidied: number;
  /** Mean distance from an original triangle to the split surface it was matched to, as a share of the diagonal. */
  meanGap: number;
};

/** Neighbour-vote passes. Two settle the boundary noise on every model measured; more change nothing. */
const VOTE_PASSES = 2;

/**
 * An island of a part smaller than this, as a share of all triangles, is
 * folded into its surroundings -- as long as that part has a bigger piece
 * somewhere else. A part that is ONLY small (a handle, a knob) is kept.
 */
const ISLAND_FRACTION = 0.002;

/**
 * A whole part smaller than this -- as a share of the piece, and in plain
 * triangles -- is a scrap of the split rather than a part of the furniture,
 * and folds into whichever real part it borders most. A cabinet's handle,
 * the smallest thing here that IS a part, ran to 900 triangles of 72,000.
 */
const MIN_PART_FRACTION = 0.001;
const MIN_PART_TRIANGLES = 40;

/**
 * Above this `meanGap`, the match between the original surface and the
 * split's own surface is not just noisy at the boundaries -- it is strained
 * everywhere, which is what a moving part caught open in one of the source
 * photos looks like: an open door's whole depth can fuse with the carcass
 * behind it in the original reconstruction, and no amount of nearest-part
 * voting then finds a seam that was never there to begin with. The caller
 * uses this to warn the shop rather than silently hand over a piece with a
 * part that quietly absorbed its neighbour.
 *
 * Set from a single measured case (a cabinet photographed with a door open,
 * whose carcass came back a fifth the size it should have been) rather than
 * a distribution of good and bad runs, so it is set deliberately high --
 * conservative toward not warning -- until more generations are measured
 * against it. Revisit with real numbers before tightening it.
 */
export const HIGH_GAP_THRESHOLD = 0.03;

export function partitionBySplit(whole: ArrayBuffer, split: ArrayBuffer): PartitionResult {
  try {
    return partition(whole, split);
  } catch (error) {
    if (error instanceof GlbError) throw new PartitionError(error.message);
    throw error;
  }
}

function partition(wholeBytes: ArrayBuffer, splitBytes: ArrayBuffer): PartitionResult {
  const wholeGlb = parseGlb(wholeBytes);
  const wholePrims = worldPrimitives(wholeGlb);
  const splitPrims = worldPrimitives(parseGlb(splitBytes));
  if (!wholePrims.length) throw new PartitionError("The original model has no surface.");
  if (splitPrims.length < 2) throw new PartitionError("The split found fewer than two parts.");

  const wholeBounds = boundsOf(wholePrims);
  alignTo(splitPrims, wholeBounds);
  const grid = new TriangleGrid(triangleSoup(splitPrims));
  const diagonal = wholeBounds.getSize(new THREE.Vector3()).length() || 1;

  // ---- every original triangle, flattened across primitives
  type Tri = { prim: number; first: number };
  const tris: Tri[] = [];
  wholePrims.forEach((prim, p) => {
    for (let i = 0; i < prim.indices.length; i += 3) tris.push({ prim: p, first: i });
  });
  const label = new Int32Array(tris.length);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const matched = new THREE.Triangle();
  const onSurface = new THREE.Vector3();
  let gapSum = 0;

  const corner = (tri: Tri, k: number, into: THREE.Vector3) =>
    into.fromArray(wholePrims[tri.prim].positions, wholePrims[tri.prim].indices[tri.first + k] * 3);

  tris.forEach((tri, t) => {
    corner(tri, 0, a);
    corner(tri, 1, b);
    corner(tri, 2, c);
    centroid.copy(a).add(b).add(c).divideScalar(3);
    THREE.Triangle.getNormal(a, b, c, n);
    const hit = grid.nearest(centroid, n);
    label[t] = hit < 0 ? -1 : grid.soup.owner[hit];
    if (hit >= 0) {
      matched.a.fromArray(grid.soup.corners, hit * 9);
      matched.b.fromArray(grid.soup.corners, hit * 9 + 3);
      matched.c.fromArray(grid.soup.corners, hit * 9 + 6);
      gapSum += matched.closestPointToPoint(centroid, onSurface).distanceTo(centroid) / diagonal;
    }
  });
  const initial = Int32Array.from(label);

  // ---- which triangles share an edge, by position rather than index: the
  // original is split along its texture seams, and a seam is not a boundary
  const keyOf = (tri: Tri, k: number) => {
    const prim = wholePrims[tri.prim];
    const v = prim.indices[tri.first + k] * 3;
    return `${prim.positions[v].toFixed(5)},${prim.positions[v + 1].toFixed(5)},${prim.positions[v + 2].toFixed(5)}`;
  };
  const byEdge = new Map<string, number[]>();
  tris.forEach((tri, t) => {
    const keys = [keyOf(tri, 0), keyOf(tri, 1), keyOf(tri, 2)];
    for (let k = 0; k < 3; k++) {
      const [p, q] = [keys[k], keys[(k + 1) % 3]].sort();
      const edge = `${p}|${q}`;
      const list = byEdge.get(edge);
      if (list) list.push(t);
      else byEdge.set(edge, [t]);
    }
  });
  const neighbours: number[][] = tris.map(() => []);
  for (const list of byEdge.values()) {
    for (const t of list) for (const u of list) if (t !== u) neighbours[t].push(u);
  }

  // ---- tidy 1: a triangle outvoted by its neighbours joins them
  for (let pass = 0; pass < VOTE_PASSES; pass++) {
    const next = Int32Array.from(label);
    neighbours.forEach((around, t) => {
      const votes = new Map<number, number>();
      for (const u of around) votes.set(label[u], (votes.get(label[u]) ?? 0) + 1);
      let winner = label[t];
      let most = votes.get(label[t]) ?? 0;
      for (const [candidate, count] of votes) {
        if (count > most && count >= 2) {
          winner = candidate;
          most = count;
        }
      }
      next[t] = winner;
    });
    label.set(next);
  }

  // ---- tidy 2: small islands of a part that is bigger elsewhere fold into their surroundings
  const minIsland = Math.max(8, Math.round(tris.length * ISLAND_FRACTION));
  for (let round = 0; round < 4; round++) {
    const island = new Int32Array(tris.length).fill(-1);
    const islands: number[][] = [];
    for (let t = 0; t < tris.length; t++) {
      if (island[t] >= 0) continue;
      const members = [t];
      island[t] = islands.length;
      for (let q = 0; q < members.length; q++) {
        for (const u of neighbours[members[q]]) {
          if (island[u] < 0 && label[u] === label[t]) {
            island[u] = islands.length;
            members.push(u);
          }
        }
      }
      islands.push(members);
    }
    const largest = new Map<number, number>();
    for (const members of islands) {
      const part = label[members[0]];
      largest.set(part, Math.max(largest.get(part) ?? 0, members.length));
    }

    let changed = false;
    for (const members of islands) {
      const part = label[members[0]];
      if (members.length >= minIsland || members.length === largest.get(part)) continue;
      const border = new Map<number, number>();
      for (const t of members) for (const u of neighbours[t]) if (label[u] !== part) border.set(label[u], (border.get(label[u]) ?? 0) + 1);
      let target = part;
      let most = 0;
      for (const [candidate, count] of border) {
        if (count > most) {
          target = candidate;
          most = count;
        }
      }
      if (target === part) continue;
      for (const t of members) label[t] = target;
      changed = true;
    }
    if (!changed) break;
  }

  // ---- tidy 3: a part too small to be a part at all folds into its neighbour
  // Meshy's split leaves scraps -- measured, a five-triangle sliver off the rim
  // of a table, which arrived in the studio as its own part and was duly named
  // ("Handles"). Nothing a furniture shop builds is a thousandth of the piece.
  const minPart = Math.max(MIN_PART_TRIANGLES, Math.round(tris.length * MIN_PART_FRACTION));
  for (let round = 0; round < 4; round++) {
    const size = new Map<number, number>();
    for (let t = 0; t < tris.length; t++) size.set(label[t], (size.get(label[t]) ?? 0) + 1);
    if (size.size <= 2) break;

    let changed = false;
    for (const [part, count] of size) {
      if (count >= minPart) continue;
      const border = new Map<number, number>();
      for (let t = 0; t < tris.length; t++) {
        if (label[t] !== part) continue;
        for (const u of neighbours[t]) if (label[u] !== part) border.set(label[u], (border.get(label[u]) ?? 0) + 1);
      }
      let target = part;
      let most = 0;
      for (const [candidate, votes] of border) {
        if (votes > most && (size.get(candidate) ?? 0) >= minPart) {
          target = candidate;
          most = votes;
        }
      }
      // A scrap can be detached from everything -- a five-triangle flake off a
      // rim, touching nothing -- and then there is no neighbour to vote. It
      // joins whichever real part it lies nearest to.
      if (target === part) {
        const centre = new THREE.Vector3();
        let counted = 0;
        for (let t = 0; t < tris.length; t++) {
          if (label[t] !== part) continue;
          for (let k = 0; k < 3; k++) centre.add(corner(tris[t], k, a));
          counted += 3;
        }
        if (counted > 0) {
          centre.divideScalar(counted);
          let nearest = Infinity;
          for (const [candidate, candidateSize] of size) {
            if (candidate === part || candidateSize < minPart) continue;
            const box = new THREE.Box3();
            for (let t = 0; t < tris.length; t++) {
              if (label[t] !== candidate) continue;
              for (let k = 0; k < 3; k++) box.expandByPoint(corner(tris[t], k, a));
            }
            const distance = box.distanceToPoint(centre);
            if (distance < nearest) {
              nearest = distance;
              target = candidate;
            }
          }
        }
      }
      if (target === part) continue;
      for (let t = 0; t < tris.length; t++) if (label[t] === part) label[t] = target;
      changed = true;
    }
    if (!changed) break;
  }

  // ---- write each part from the original's own vertices
  const parts: PartOut[] = [];
  const partIds = [...new Set(label)].filter((id) => id >= 0).sort((x, y) => x - y);
  for (const id of partIds) {
    const vertexOf = new Map<string, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let hasNormals = true;
    let hasUvs = true;
    tris.forEach((tri, t) => {
      if (label[t] !== id) return;
      const prim = wholePrims[tri.prim];
      hasNormals &&= prim.normals !== null;
      hasUvs &&= prim.uvs !== null;
      for (let k = 0; k < 3; k++) {
        const v = prim.indices[tri.first + k];
        const key = `${tri.prim}:${v}`;
        let index = vertexOf.get(key);
        if (index === undefined) {
          index = positions.length / 3;
          vertexOf.set(key, index);
          positions.push(prim.positions[v * 3], prim.positions[v * 3 + 1], prim.positions[v * 3 + 2]);
          if (prim.normals) normals.push(prim.normals[v * 3], prim.normals[v * 3 + 1], prim.normals[v * 3 + 2]);
          if (prim.uvs) uvs.push(prim.uvs[v * 2], prim.uvs[v * 2 + 1]);
        }
        indices.push(index);
      }
    });
    parts.push({
      name: splitPrims[id].name,
      positions: Float32Array.from(positions),
      normals: hasNormals ? Float32Array.from(normals) : null,
      uvs: hasUvs ? Float32Array.from(uvs) : null,
      indices: Uint32Array.from(indices),
    });
  }
  if (parts.length < 2) throw new PartitionError("Dividing the original by the split left fewer than two parts.");

  let retidied = 0;
  for (let t = 0; t < tris.length; t++) if (label[t] !== initial[t]) retidied++;

  return {
    glb: writeGlb(parts, wholeGlb, "FurniCraft split partition"),
    parts: parts.length,
    retidied: retidied / tris.length,
    meanGap: gapSum / tris.length,
  };
}
