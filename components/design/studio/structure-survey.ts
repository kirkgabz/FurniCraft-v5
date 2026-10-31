import * as THREE from "three";
import type { ChairRig } from "./chair-rig";
import type { PartId, PartRole } from "./studio-config";
import type { StudioModel } from "./studio-models";

/**
 * The posed piece as a structural engineer would need it: how many of each
 * member there are, how long they are, and -- the part that actually matters --
 * how much material is in their cross-section.
 *
 * Why this is not just `measureRig`. That function unions every mesh sharing a
 * part id into one box, which is exactly right for a build sheet ("the legs
 * occupy 49 x 44 x 46cm") and useless for engineering, because the union of
 * four legs is not the section of one leg. Nothing can be said about buckling
 * or bending from it.
 *
 * So the section is taken from the solid, not from the box. Each mesh's own
 * volume is computed once from its geometry and thereafter scaled by the
 * determinant of its world matrix, which is what a volume does under a linear
 * transform. Average section area is then volume / length. That handles the
 * cases a bounding box gets badly wrong: a turned Victorian leg is a series of
 * beads and coves whose box says 5cm square and whose real average section is
 * nearer 3.4cm square, and analysing it as the box would call a leg safe that
 * is closer to its limit than the customer thinks.
 *
 * NOTHING HERE IS STORED. The survey is derived from the rig on the same beat
 * as the on-screen measurement and lives as long as the studio is open. It adds
 * no column, no migration, no field inside `cad_state`, and no second copy of
 * anything that could drift from the design it describes. A saved design is
 * re-analysed by reopening it, which is the same rule the blueprint and the
 * measurements already follow.
 */

export type MemberSurvey = {
  id: PartId;
  role: PartRole;
  label: string;
  /** How many separate pieces make up this part. */
  count: number;
  /** Bounding size of ONE piece, in cm -- the median instance, not the union. */
  each: { w: number; h: number; d: number };
  /** Union bounds of the whole part, in cm, floor-referenced. */
  span: { w: number; h: number; d: number };
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  /** Solid volume of ONE piece, cm^3. */
  volumeCm3: number;
  /**
   * Surface area of ONE piece, cm^2.
   *
   * Carried because volume is the wrong measure for anything woven. The volume
   * integral treats a closed mesh as solid, so a caned shell wrapping a chair
   * comes back as a block of cane the size of the chair -- the patio armchair
   * weighed 33 kg before this existed. A weave is a surface, and its material
   * is its area times a strand thickness, which is what the analysis uses.
   */
  surfaceAreaCm2: number;
  /**
   * Average cross-sectional area of one piece, cm^2, taken across its longest
   * axis. This is the number the beam and column formulas need.
   */
  sectionAreaCm2: number;
  /** Which axis the piece is longest along; its span is measured along this. */
  axis: "x" | "y" | "z";
  /** Length of one piece along that axis, cm. */
  lengthCm: number;
  /** Centre of the part's mass, cm, floor-referenced, assuming uniform stock. */
  centroid: { x: number; y: number; z: number };
};

export type StructureSurvey = {
  members: MemberSurvey[];
  /** Overall envelope, cm. */
  overall: { w: number; h: number; d: number };
  /** Top of the seat, cm. Zero on a piece with no seat. */
  seatHeightCm: number;
  /**
   * The polygon the piece stands on, as its extent in x and z at floor level,
   * cm. Tipping is checked against this.
   */
  footprint: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
};

/** Geometry volume is a property of the mesh, so it is computed once and kept. */
const LOCAL_VOLUME = new WeakMap<THREE.BufferGeometry, number>();
const LOCAL_AREA = new WeakMap<THREE.BufferGeometry, number>();

/**
 * Signed volume of a closed triangle mesh, by the divergence theorem: the sum
 * of the signed volumes of the tetrahedra formed by each triangle and the
 * origin. Absolute value, because a mesh with inverted winding is a modelling
 * detail rather than a piece of negative furniture.
 *
 * An open mesh -- a cushion modelled as a shell, say -- gives an approximation
 * rather than a wrong answer, because the missing faces are usually small
 * relative to the form. Callers guard the result anyway: a section derived from
 * it is clamped against the bounding box, which no real section can exceed.
 */
function localVolume(geometry: THREE.BufferGeometry): number {
  const cached = LOCAL_VOLUME.get(geometry);
  if (cached !== undefined) return cached;

  const position = geometry.getAttribute("position");
  if (!position) {
    LOCAL_VOLUME.set(geometry, 0);
    return 0;
  }

  const index = geometry.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let total = 0;

  const triangles = index ? index.count / 3 : position.count / 3;
  for (let t = 0; t < triangles; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    total += cross.crossVectors(b, c).dot(a) / 6;
  }

  const volume = Math.abs(total);
  LOCAL_VOLUME.set(geometry, volume);
  return volume;
}

/** Total triangle area of a mesh, in its own local units. Cached like volume. */
function localArea(geometry: THREE.BufferGeometry): number {
  const cached = LOCAL_AREA.get(geometry);
  if (cached !== undefined) return cached;

  const position = geometry.getAttribute("position");
  if (!position) {
    LOCAL_AREA.set(geometry, 0);
    return 0;
  }

  const index = geometry.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let total = 0;

  const triangles = index ? index.count / 3 : position.count / 3;
  for (let t = 0; t < triangles; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    total += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
  }

  LOCAL_AREA.set(geometry, total);
  return total;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The middle value, so one oddly-modelled instance cannot skew a part. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Instance = {
  size: THREE.Vector3;
  centre: THREE.Vector3;
  volumeCm3: number;
  surfaceAreaCm2: number;
};

export function surveyRig(rig: ChairRig, model: StudioModel): StructureSurvey {
  const cmPerUnit = model.cmPerUnit;
  const cm3PerUnit3 = cmPerUnit ** 3;
  rig.root.updateMatrixWorld(true);

  const byPart = new Map<PartId, Instance[]>();
  const unionByPart = new Map<PartId, THREE.Box3>();

  for (const mesh of rig.pickables) {
    const id = mesh.userData.partId as PartId | undefined;
    if (!id) continue;
    // Same two exclusions the measurement makes, and for the same reasons: a
    // part a control removed is out of the piece, and a mesh switched off
    // individually is surplus to the count the customer asked for. A part
    // merely hidden from view is still built and still analysed.
    if (rig.isRemoved(id)) continue;
    if (rig.isMeshInactive(mesh)) continue;

    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(cmPerUnit);
    const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(cmPerUnit);

    const scale = Math.abs(mesh.matrixWorld.determinant());
    const volumeCm3 = localVolume(mesh.geometry) * scale * cm3PerUnit3;
    // Area does not scale by the determinant, and under a non-uniform scale it
    // depends on how each triangle is oriented. The cube root squared is the
    // isotropic approximation, close enough for the one thing area is used
    // for: estimating how much strand is in a weave.
    const areaScale = Math.cbrt(scale) ** 2;
    const surfaceAreaCm2 = localArea(mesh.geometry) * areaScale * cmPerUnit ** 2;

    const list = byPart.get(id);
    if (list) list.push({ size, centre, volumeCm3, surfaceAreaCm2 });
    else byPart.set(id, [{ size, centre, volumeCm3, surfaceAreaCm2 }]);

    const union = unionByPart.get(id);
    if (union) union.union(box);
    else unionByPart.set(id, box.clone());
  }

  const roleById = new Map(model.parts.map((part) => [part.id, part.role]));
  const labelById = new Map(model.parts.map((part) => [part.id, part.label]));

  const members: MemberSurvey[] = [];
  byPart.forEach((instances, id) => {
    const union = unionByPart.get(id)!;
    const unionSize = union.getSize(new THREE.Vector3()).multiplyScalar(cmPerUnit);

    const each = {
      w: median(instances.map((i) => i.size.x)),
      h: median(instances.map((i) => i.size.y)),
      d: median(instances.map((i) => i.size.z)),
    };
    const volumeCm3 = median(instances.map((i) => i.volumeCm3));
    const surfaceAreaCm2 = median(instances.map((i) => i.surfaceAreaCm2));

    // Longest axis is the member's length; the other two frame its section.
    const axis: "x" | "y" | "z" =
      each.h >= each.w && each.h >= each.d ? "y" : each.w >= each.d ? "x" : "z";
    const lengthCm = axis === "y" ? each.h : axis === "x" ? each.w : each.d;
    const boxSectionCm2 =
      axis === "y" ? each.w * each.d : axis === "x" ? each.h * each.d : each.w * each.h;

    // Volume over length is the true average section. The box is the ceiling it
    // cannot exceed, which catches a mesh too open for the volume integral to
    // be trusted; the floor keeps a degenerate result from dividing by zero
    // downstream. Taking the smaller of the two is the conservative reading,
    // and conservative is the right direction for a structural claim.
    const fromVolume = lengthCm > 0 ? volumeCm3 / lengthCm : 0;
    const sectionAreaCm2 =
      fromVolume > 0 ? Math.min(fromVolume, boxSectionCm2) : boxSectionCm2;

    // Volume-weighted, so a heavy plinth pulls the centre down the way it
    // actually does. Uniform density within a part is assumed; density between
    // parts is applied later, where the stock is known.
    const totalVolume = instances.reduce((sum, i) => sum + i.volumeCm3, 0);
    const centroid = { x: 0, y: 0, z: 0 };
    if (totalVolume > 0) {
      for (const instance of instances) {
        const share = instance.volumeCm3 / totalVolume;
        centroid.x += instance.centre.x * share;
        centroid.y += instance.centre.y * share;
        centroid.z += instance.centre.z * share;
      }
    } else {
      const centre = union.getCenter(new THREE.Vector3()).multiplyScalar(cmPerUnit);
      centroid.x = centre.x;
      centroid.y = centre.y;
      centroid.z = centre.z;
    }

    members.push({
      id,
      role: roleById.get(id) ?? "accessory",
      label: labelById.get(id) ?? id,
      count: instances.length,
      each: { w: round(each.w), h: round(each.h), d: round(each.d) },
      span: { w: round(unionSize.x), h: round(unionSize.y), d: round(unionSize.z) },
      min: {
        x: round(union.min.x * cmPerUnit),
        y: round(union.min.y * cmPerUnit),
        z: round(union.min.z * cmPerUnit),
      },
      max: {
        x: round(union.max.x * cmPerUnit),
        y: round(union.max.y * cmPerUnit),
        z: round(union.max.z * cmPerUnit),
      },
      volumeCm3: round(volumeCm3),
      surfaceAreaCm2: round(surfaceAreaCm2),
      sectionAreaCm2: round(sectionAreaCm2, 3),
      axis,
      lengthCm: round(lengthCm),
      centroid: { x: round(centroid.x), y: round(centroid.y), z: round(centroid.z) },
    });
  });

  const order = model.parts.map((part) => part.id);
  members.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const overallBox = new THREE.Box3();
  unionByPart.forEach((box) => overallBox.union(box));
  const overallSize = overallBox.getSize(new THREE.Vector3()).multiplyScalar(cmPerUnit);

  const seat = unionByPart.get("seatCushion") ?? unionByPart.get("seatFrame");
  const seatHeightCm = seat ? round(seat.max.y * cmPerUnit) : 0;

  /**
   * What the piece stands on. Taken from whichever parts reach the floor
   * rather than from the overall envelope, because those are different numbers
   * on exactly the pieces where it matters: a chair whose back leans out past
   * its rear legs has an envelope wider than the ground it actually occupies,
   * and tipping is decided by the ground.
   */
  const floorTolerance = 0.02 * (overallBox.max.y - overallBox.min.y);
  let footprint: StructureSurvey["footprint"] = null;
  unionByPart.forEach((box) => {
    if (box.min.y > overallBox.min.y + floorTolerance) return;
    const minX = box.min.x * cmPerUnit;
    const maxX = box.max.x * cmPerUnit;
    const minZ = box.min.z * cmPerUnit;
    const maxZ = box.max.z * cmPerUnit;
    footprint = footprint
      ? {
          minX: Math.min(footprint.minX, minX),
          maxX: Math.max(footprint.maxX, maxX),
          minZ: Math.min(footprint.minZ, minZ),
          maxZ: Math.max(footprint.maxZ, maxZ),
        }
      : { minX, maxX, minZ, maxZ };
  });

  return {
    members,
    overall: { w: round(overallSize.x), h: round(overallSize.y), d: round(overallSize.z) },
    seatHeightCm,
    footprint,
  };
}
