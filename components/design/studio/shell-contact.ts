import * as THREE from "three";

/**
 * Groups shells that physically touch.
 *
 * Built for the base role. The rig gives every base shell its own slot and
 * spreads the slots as the piece widens, which is right for four chair legs
 * and wrong for a pedestal: a generated pedestal routinely arrives as a stack
 * of layers -- a fluted face, the band behind it, an inner core, the plinth
 * they stand on -- each a separate shell. Spread one by one, the layers drift
 * apart and the pedestal opens up into loose boards. Grouped first, the
 * layers move and thicken as the one object they are, while legs that really
 * stand apart still spread.
 *
 * "Touch" is measured against the surfaces themselves, not bounding boxes.
 * The legs of a splayed stool converge under the seat, so their boxes overlap
 * while the legs never meet; a box test would weld them into one and stop
 * them spreading.
 */

export type ContactShell = {
  geometry: THREE.BufferGeometry;
  /** Applied to the positions first -- for shells still in their mesh's local space. */
  matrix?: THREE.Matrix4;
};

type Prepared = {
  positions: Float32Array;
  /** Vertex indices, three per triangle. */
  triangles: Uint32Array;
  box: THREE.Box3;
};

/** At most this many vertices of one shell are tested against another, sampled evenly. */
const MAX_PROBE_VERTICES = 4000;

function prepare(shell: ContactShell): Prepared {
  const attribute = shell.geometry.getAttribute("position");
  const positions = new Float32Array(attribute.count * 3);
  const point = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < attribute.count; i++) {
    point.fromBufferAttribute(attribute, i);
    if (shell.matrix) point.applyMatrix4(shell.matrix);
    point.toArray(positions, i * 3);
    box.expandByPoint(point);
  }

  const index = shell.geometry.getIndex();
  let triangles: Uint32Array;
  if (index) {
    triangles = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) triangles[i] = index.getX(i);
  } else {
    triangles = new Uint32Array(attribute.count - (attribute.count % 3));
    for (let i = 0; i < triangles.length; i++) triangles[i] = i;
  }
  return { positions, triangles, box };
}

/**
 * True when some vertex of `a` lies within `tolerance` of a triangle of `b`.
 * Only the region where the two boxes overlap can hold a contact, so both the
 * probe vertices and the candidate triangles are cut down to it first.
 */
function touches(a: Prepared, b: Prepared, tolerance: number): boolean {
  const region = a.box.clone().expandByScalar(tolerance).intersect(b.box.clone().expandByScalar(tolerance));
  if (region.isEmpty()) return false;

  const point = new THREE.Vector3();
  const probes: number[] = [];
  for (let i = 0; i < a.positions.length / 3; i++) {
    point.fromArray(a.positions, i * 3);
    if (region.containsPoint(point)) probes.push(i);
  }
  if (probes.length === 0) return false;

  const triangle = new THREE.Triangle();
  const triangleBox = new THREE.Box3();
  const candidates: THREE.Triangle[] = [];
  for (let t = 0; t < b.triangles.length; t += 3) {
    triangle.a.fromArray(b.positions, b.triangles[t] * 3);
    triangle.b.fromArray(b.positions, b.triangles[t + 1] * 3);
    triangle.c.fromArray(b.positions, b.triangles[t + 2] * 3);
    triangleBox.setFromPoints([triangle.a, triangle.b, triangle.c]).expandByScalar(tolerance);
    if (triangleBox.intersectsBox(region)) candidates.push(triangle.clone());
  }
  if (candidates.length === 0) return false;

  const boxes = candidates.map((c) => new THREE.Box3().setFromPoints([c.a, c.b, c.c]).expandByScalar(tolerance));
  const closest = new THREE.Vector3();
  const stride = Math.max(1, Math.ceil(probes.length / MAX_PROBE_VERTICES));
  for (let p = 0; p < probes.length; p += stride) {
    point.fromArray(a.positions, probes[p] * 3);
    for (let c = 0; c < candidates.length; c++) {
      if (!boxes[c].containsPoint(point)) continue;
      candidates[c].closestPointToPoint(point, closest);
      if (closest.distanceToSquared(point) <= tolerance * tolerance) return true;
    }
  }
  return false;
}

/**
 * Partitions `shells` into groups that touch, directly or through a chain of
 * others. Returns shell indices, each group in ascending order and the groups
 * ordered by their first index, so the result is stable for a given input.
 *
 * A shell whose box lies wholly inside another's counts as touching it: a core
 * sealed inside a casing never comes within `tolerance` of the casing's
 * surface, but it is plainly part of the same object.
 */
export function groupTouchingShells(shells: ContactShell[], tolerance: number): number[][] {
  const prepared = shells.map(prepare);
  const parent = shells.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      if (find(i) === find(j)) continue;
      const a = prepared[i];
      const b = prepared[j];
      if (!a.box.clone().expandByScalar(tolerance).intersectsBox(b.box)) continue;
      if (
        b.box.containsBox(a.box) ||
        a.box.containsBox(b.box) ||
        touches(a, b, tolerance) ||
        touches(b, a, tolerance)
      ) {
        parent[find(j)] = find(i);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < shells.length; i++) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(i);
    groups.set(root, group);
  }
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

/**
 * How close two surfaces must come to count as touching, as a fraction of the
 * piece's height. Generated layers that are meant to sit flush land a hair
 * apart; 1% closes that without reaching across a real gap between two legs.
 */
export const CONTACT_TOLERANCE_OF_HEIGHT = 0.01;
