import * as THREE from "three";

/**
 * Stands an uploaded model straight: level, and squared to the axes.
 *
 * Two corrections, in that order, because the second is a rotation about the
 * vertical and only means anything once the vertical is right.
 *
 * Everything downstream of an upload assumes world +Y is up: the rig's
 * `normalize` stands the piece on y=0 and scales by its Y extent, grouping
 * keys its height bands on Y, and `ensureBaseRole` measures floor contact
 * from Y. A model that was built a few degrees off never contradicts any of
 * that -- the classification still comes out right, because grouping and
 * labeling both work in relative terms -- so the error survives the whole
 * pipeline untouched and only appears at the very end, as a piece hanging in
 * the air at an angle. A real bed measured here arrived 11.5 degrees off,
 * which also inflated every dimension the studio reported for it: a leaning
 * bed reads as taller and shorter than it really is.
 *
 * What makes this safe is WHICH faces are allowed to vote. An earlier
 * attempt asked the broader question -- "which axis does this model's
 * surface area mostly face?" -- and got it wrong on the Victorian chair,
 * whose backrest is a larger flat plane than its seat: it wanted to lay an
 * upright chair on its back. So this never chooses an axis at all. It
 * assumes the model is already roughly Y-up and only corrects the residue,
 * letting nothing but already-near-horizontal faces contribute. A vertical
 * panel cannot vote however large it is, because it is not in the cone.
 *
 * That means this deliberately does NOT fix a model that is a full quarter
 * turn out (authored Z-up with no correction baked in). Detecting that
 * reliably is a different and harder problem, and guessing at it tips over
 * pieces that were standing up fine. A model that far out arrives obviously
 * wrong rather than subtly wrong, which is the better failure of the two.
 *
 * The second correction is YAW -- how far the piece is turned about the
 * vertical relative to the axes. Furniture is designed rectilinear: a bed is
 * a rectangle seen from above. So the orientation whose axis-aligned
 * footprint is smallest is the piece's own, and anything else inflates its
 * bounding box toward a square. The bed that prompted this sat at 34.5
 * degrees, which cost twice over: its reported footprint was 3.97 x 4.56
 * when the piece is really 2.34 x 4.04, and every axis-aligned rule
 * downstream was reading a diagonal. Its headboard and footboard spanned
 * only 0.38 of x each, so nothing could tell that they sat at opposite ends,
 * and grouping merged them into one entry the AI then had to give a single
 * label to.
 */

/**
 * The vote cone, tightened in stages around the running estimate.
 *
 * The first, wide pass takes in a real piece's tops, seats and undersides
 * along with whatever slant they are sitting at, while staying narrow enough
 * that a wall, a headboard or a chair back is never in the set. That alone
 * is not accurate enough, because it treats every roughly-horizontal face as
 * equally good evidence, and a bed does not arrive bare: a draped duvet
 * contributes a huge, curved, near-horizontal area whose faces point every
 * which way. On the bed measured here that soft geometry dragged the
 * estimate from the true 11.4 degrees to 13.1 -- and the resulting
 * over-rotation lifted the whole head end of the bed 5cm off the floor,
 * which is exactly what a blueprint elevation shows up.
 *
 * Tightening fixes it without needing to know which mesh is bedlinen (which
 * is not known until long after this runs). A flat surface -- a rail, a
 * panel, a mattress top -- puts all of its area at ONE angle, so it survives
 * every narrowing. Draped cloth spreads its area across many angles, so each
 * narrowing sheds most of it. By the last stage the estimate rests on the
 * piece's genuinely flat surfaces, which is what "level" was always supposed
 * to mean.
 *
 * Measured across all seven models on hand: every already-level piece reads
 * FLATTER at the end of the schedule than at the start (the cushion chair
 * 1.85 -> 0.35, the stool 1.48 -> 0.25, the level bed 0.93 -> 0.01), and the
 * crooked bed converges on 11.43, within a rounding error of the 11.37 you
 * get by deleting its duvet and pillow by hand.
 */
const NEAR_UP_CONE_SCHEDULE_DEGREES = [35, 15, 7, 3];

/**
 * Below this, leave the model alone. The five shipped models measure between
 * 0.08 and 1.5 degrees by this metric -- none is exactly zero, since
 * modelling and export both round -- so the floor sits above the largest of
 * them. Correcting a fraction of a degree would be churn that risks a
 * rounding artefact for no visible gain.
 */
const MIN_CORRECTABLE_DEGREES = 3;

/**
 * Above this, refuse. Past roughly this angle the "roughly horizontal" set
 * stops being a reliable read on the floor plane -- it starts picking up
 * whatever else leans into the cone -- and a correction that large is no
 * longer levelling a slightly crooked model but guessing at its orientation,
 * which is the thing that went wrong before. Arriving visibly wrong beats
 * being confidently rotated somewhere else.
 */
const MAX_CORRECTABLE_DEGREES = 25;

/**
 * Voting faces must be at least this share of total surface area. A piece
 * made almost entirely of curved or vertical surfaces gives the cone very
 * little to average, and a mean taken over a sliver of the model is noise
 * rather than a floor plane. Every model measured here clears this several
 * times over -- the lowest, the Victorian chair, sits at 22%.
 */
const MIN_VOTING_AREA_SHARE = 0.1;

/** Cap on triangles sampled; an even stride across the whole model, never the first N. */
const MAX_SAMPLED_TRIANGLES = 60000;

/**
 * The estimate is refined until a pass moves it less than this, or until the
 * pass budget runs out.
 *
 * Refinement is needed because the cone is defined against +Y, so tilting
 * the model changes which faces are inside it: correcting once with the
 * first estimate left a real bed at 1.37 degrees rather than zero, and that
 * residue was visible on a wide flat headboard viewed straight on. Each pass
 * re-selects the voting set in the frame the previous pass produced, which
 * converges quickly -- the faces that belong are already nearly all in the
 * cone by the second pass.
 *
 * Cheap, because the geometry is sampled ONCE up front and every pass after
 * that runs over that fixed array of normals rather than re-reading (or
 * worse, re-baking) vertices. Only the final, composed rotation is ever
 * written to geometry.
 */
const CONVERGENCE_DEGREES = 0.05;
const MAX_REFINEMENT_PASSES = 12;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Yaw is searched at this resolution over a quarter turn -- past 90 degrees a
 * rectangle simply repeats.
 */
const YAW_SEARCH_STEP_DEGREES = 0.25;

/**
 * Squaring the piece has to shrink its footprint by at least this much before
 * it counts as having found the piece's own axes.
 *
 * Every model measured here separates cleanly on this. The four axis-aligned
 * chairs and the level bed gain 0.0%; the crooked bed gains 47.9%. The one
 * that would otherwise be caught out is the rattan stool, a round drum whose
 * footprint is very nearly rotationally symmetric: the search duly reports a
 * "best" angle of 30.75 degrees, but it buys only 1.1%, which is noise in the
 * shape of a result. Turning a circular piece a third of a right angle for
 * nothing would be a pure loss, so the gain has to be real to be acted on.
 */
const MIN_YAW_AREA_REDUCTION = 0.05;

export type YawReading = {
  /** Radians about +Y that square the piece to the axes. */
  radians: number;
  /** Fraction of footprint area that squaring removes; 0 when nothing is gained. */
  areaReduction: number;
  /** True when the gain is big enough to be the piece's own axes rather than noise. */
  correctable: boolean;
};

export type TiltReading = {
  /** Degrees the model's horizontal plane is off level, after refinement. */
  degrees: number;
  /** Rotation that carries the model's current up direction onto +Y. */
  correction: THREE.Quaternion;
  /** Share of sampled surface area that was near-horizontal enough to vote. */
  votingAreaShare: number;
  /** True when the reading is both trustworthy and worth acting on. */
  correctable: boolean;
};

export type FaceSample = {
  /** Unit normals, three floats each, in world space, sign NOT folded. */
  normals: Float32Array;
  /** Twice each face's area -- the weight. The factor of two cancels in every ratio. */
  weights: Float32Array;
  count: number;
  totalArea: number;
};

/** One pass over the geometry, collecting a bounded sample of face normals and areas. */
function sampleFaces(root: THREE.Object3D): FaceSample {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) meshes.push(mesh);
  });

  let totalTriangles = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.getIndex();
    totalTriangles += (index ? index.count : mesh.geometry.getAttribute("position").count) / 3;
  }
  const stride = Math.max(1, Math.ceil(totalTriangles / MAX_SAMPLED_TRIANGLES));
  const capacity = Math.ceil(totalTriangles / stride) + 1;

  const normals = new Float32Array(capacity * 3);
  const weights = new Float32Array(capacity);
  let count = 0;
  let totalArea = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.getIndex();
    const triangles = (index ? index.count : position.count) / 3;
    const matrix = mesh.matrixWorld;

    for (let t = 0; t < triangles && count < capacity; t += stride) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(position, i0).applyMatrix4(matrix);
      b.fromBufferAttribute(position, i1).applyMatrix4(matrix);
      c.fromBufferAttribute(position, i2).applyMatrix4(matrix);
      // One cross product yields both the normal and twice the area.
      normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
      const doubleArea = normal.length();
      if (doubleArea <= 0) continue;
      normal.divideScalar(doubleArea);
      normals[count * 3] = normal.x;
      normals[count * 3 + 1] = normal.y;
      normals[count * 3 + 2] = normal.z;
      weights[count] = doubleArea;
      count++;
      totalArea += doubleArea;
    }
  }

  return { normals, weights, count, totalArea };
}

/**
 * Refines a levelling rotation from a fixed face sample.
 *
 * Each pass rotates every sampled normal by the estimate so far, folds
 * downward-facing ones up (a surface's top face and its underside are the
 * same plane, so they should agree rather than cancel), keeps the ones
 * inside the cone, and takes their area-weighted mean. The rotation that
 * carries that mean onto +Y is composed into the estimate, and the next pass
 * re-selects the voting set in the frame that produced -- which is the whole
 * point, since membership of the cone is exactly what a tilt distorts.
 */
export function solveCorrection(sample: FaceSample): { correction: THREE.Quaternion; votingAreaShare: number } {
  const correction = new THREE.Quaternion();
  const rotated = new THREE.Vector3();
  const mean = new THREE.Vector3();
  // Reported from the WIDEST stage, so it still answers "how much of this
  // piece is roughly horizontal at all" -- the question MIN_VOTING_AREA_SHARE
  // asks. The later, tighter stages deliberately vote with a sliver.
  let votingAreaShare = 0;

  for (const [stage, coneDegrees] of NEAR_UP_CONE_SCHEDULE_DEGREES.entries()) {
    const cone = Math.cos((coneDegrees * Math.PI) / 180);

    for (let pass = 0; pass < MAX_REFINEMENT_PASSES; pass++) {
      mean.set(0, 0, 0);
      let votingArea = 0;

      for (let i = 0; i < sample.count; i++) {
        rotated.set(sample.normals[i * 3], sample.normals[i * 3 + 1], sample.normals[i * 3 + 2]).applyQuaternion(correction);
        if (rotated.y < 0) rotated.negate();
        if (rotated.y < cone) continue;
        mean.addScaledVector(rotated, sample.weights[i]);
        votingArea += sample.weights[i];
      }

      // A cone this tight can empty out on a piece with no truly flat face.
      // Keep whatever the previous, wider stage concluded rather than
      // throwing the estimate away.
      if (votingArea <= 0) break;
      if (stage === 0) votingAreaShare = sample.totalArea > 0 ? votingArea / sample.totalArea : 0;

      mean.normalize();
      const step = new THREE.Quaternion().setFromUnitVectors(mean, UP);
      correction.premultiply(step);

      const stepDegrees = (Math.acos(Math.min(1, Math.max(-1, mean.y))) * 180) / Math.PI;
      if (stepDegrees < CONVERGENCE_DEGREES) break;
    }
  }

  return { correction, votingAreaShare };
}

/**
 * Builds a face sample from flat triangle-corner data -- nine floats per
 * triangle, already in world space.
 *
 * The alternative entry point to `sampleFaces`, for callers that never build
 * a THREE scene graph at all: `scripts/architect-analysis.mts` reads glTF
 * accessors by hand and carries each shell's geometry as exactly this shape.
 * Both feed the same solver, so the CLI and the browser cannot drift on how
 * level a given upload ends up.
 */
export function sampleTriangleFaces(triangleChunks: Float32Array[]): FaceSample {
  let totalTriangles = 0;
  for (const chunk of triangleChunks) totalTriangles += chunk.length / 9;
  const stride = Math.max(1, Math.ceil(totalTriangles / MAX_SAMPLED_TRIANGLES));
  const capacity = Math.ceil(totalTriangles / stride) + 1;

  const normals = new Float32Array(capacity * 3);
  const weights = new Float32Array(capacity);
  let count = 0;
  let totalArea = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  // One running counter across every chunk, so the stride samples the whole
  // model evenly instead of restarting -- and never favours a shell just for
  // being small enough to fit inside one step.
  let seen = 0;
  for (const chunk of triangleChunks) {
    for (let t = 0; t < chunk.length / 9; t++, seen++) {
      if (seen % stride !== 0 || count >= capacity) continue;
      a.set(chunk[t * 9], chunk[t * 9 + 1], chunk[t * 9 + 2]);
      b.set(chunk[t * 9 + 3], chunk[t * 9 + 4], chunk[t * 9 + 5]);
      c.set(chunk[t * 9 + 6], chunk[t * 9 + 7], chunk[t * 9 + 8]);
      normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
      const doubleArea = normal.length();
      if (doubleArea <= 0) continue;
      normal.divideScalar(doubleArea);
      normals[count * 3] = normal.x;
      normals[count * 3 + 1] = normal.y;
      normals[count * 3 + 2] = normal.z;
      weights[count] = doubleArea;
      count++;
      totalArea += doubleArea;
    }
  }

  return { normals, weights, count, totalArea };
}

/** Turns a solved correction into the reading callers act on. */
export function readingFromSample(sample: FaceSample): TiltReading {
  if (sample.count === 0 || sample.totalArea <= 0) {
    return { degrees: 0, correction: new THREE.Quaternion(), votingAreaShare: 0, correctable: false };
  }

  const { correction, votingAreaShare } = solveCorrection(sample);
  // A quaternion's w is cos(theta/2), so this is the total angle the
  // refinement converged on -- the model's real tilt, not just the first
  // estimate of it.
  const degrees = (2 * Math.acos(Math.min(1, Math.abs(correction.w))) * 180) / Math.PI;

  return {
    degrees,
    correction,
    votingAreaShare,
    correctable:
      votingAreaShare >= MIN_VOTING_AREA_SHARE &&
      degrees >= MIN_CORRECTABLE_DEGREES &&
      degrees <= MAX_CORRECTABLE_DEGREES,
  };
}

/** Measures how far a model's horizontal faces are from pointing straight up. */
export function measureTilt(root: THREE.Object3D): TiltReading {
  return readingFromSample(sampleFaces(root));
}

/**
 * Levels `root` in place, returning the correction applied in degrees, or 0
 * when the model was left exactly as it arrived.
 *
 * Baked into each mesh's geometry rather than left as a rotation on a node.
 * The shells this feeds are split and measured per mesh in world space, and
 * the upload is re-exported afterwards for the studio to load independently
 * -- a transform sitting on a node that a round-trip through the exporter
 * may or may not preserve is exactly the kind of fragility worth avoiding.
 * Geometry is written exactly once, with the fully refined rotation.
 */
export function levelModel(root: THREE.Object3D): number {
  const reading = measureTilt(root);
  if (!reading.correctable) return 0;

  const matrix = new THREE.Matrix4().makeRotationFromQuaternion(reading.correction);

  root.updateMatrixWorld(true);
  const baked = new Set<THREE.BufferGeometry>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
  });

  for (const mesh of meshes) {
    if (baked.has(mesh.geometry)) continue;
    baked.add(mesh.geometry);
    // Fold each mesh's own world transform in with the correction, so every
    // mesh lands in one shared, levelled world space however deep it sat.
    mesh.geometry.applyMatrix4(matrix.clone().multiply(mesh.matrixWorld));
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  root.traverse((child) => {
    child.position.set(0, 0, 0);
    child.quaternion.identity();
    child.scale.set(1, 1, 1);
    child.updateMatrix();
  });
  root.updateMatrixWorld(true);

  return reading.degrees;
}

// --------------------------------------------------------------- yaw

/**
 * Collects a bounded sample of the model's footprint: x/z pairs, two floats
 * per point, in world space. Positions rather than normals, because squaring
 * the piece is a question about where its material is, not which way it faces.
 */
function sampleFootprint(root: THREE.Object3D): Float64Array {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) meshes.push(mesh);
  });

  let total = 0;
  for (const mesh of meshes) total += mesh.geometry.getAttribute("position").count;
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLED_TRIANGLES));

  const out: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      out.push(v.x, v.z);
    }
  }
  return Float64Array.from(out);
}

/** The same footprint sample, from flat triangle-corner data -- see `sampleTriangleFaces`. */
export function sampleFootprintFromTriangles(triangleChunks: Float32Array[]): Float64Array {
  let total = 0;
  for (const chunk of triangleChunks) total += chunk.length / 3;
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLED_TRIANGLES));

  const out: number[] = [];
  let seen = 0;
  for (const chunk of triangleChunks) {
    for (let i = 0; i < chunk.length; i += 3, seen++) {
      if (seen % stride !== 0) continue;
      out.push(chunk[i], chunk[i + 2]);
    }
  }
  return Float64Array.from(out);
}

/** Axis-aligned footprint of `points` after turning them by `radians`. */
function footprintArea(points: Float64Array, radians: number): number {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const u = points[i] * cos - points[i + 1] * sin;
    const v = points[i] * sin + points[i + 1] * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return (maxU - minU) * (maxV - minV);
}

/**
 * Finds the turn about the vertical that squares the piece to the axes, by
 * searching a quarter turn for the smallest axis-aligned footprint.
 *
 * A brute-force sweep rather than a convex hull and rotating calipers: the
 * point sample is already capped, a quarter turn at a quarter degree is 360
 * evaluations, and the exact answer matters far less than not being 34
 * degrees out. The simpler code is worth more here than the asymptotics.
 */
export function solveYaw(points: Float64Array): YawReading {
  if (points.length < 4) return { radians: 0, areaReduction: 0, correctable: false };

  const base = footprintArea(points, 0);
  if (!(base > 0)) return { radians: 0, areaReduction: 0, correctable: false };

  let bestRadians = 0;
  let bestArea = base;
  for (let deg = YAW_SEARCH_STEP_DEGREES; deg < 90; deg += YAW_SEARCH_STEP_DEGREES) {
    const radians = (deg * Math.PI) / 180;
    const area = footprintArea(points, radians);
    if (area < bestArea) {
      bestArea = area;
      bestRadians = radians;
    }
  }

  const areaReduction = 1 - bestArea / base;
  return { radians: bestRadians, areaReduction, correctable: areaReduction >= MIN_YAW_AREA_REDUCTION };
}

/**
 * The matrix that applies a solved yaw. It exists so no caller has to get the
 * sign right by hand, because the two conventions genuinely disagree and the
 * mistake is silent: `footprintArea` turns the points by +theta in the x/z
 * plane, while THREE's `makeRotationY(+theta)` turns geometry the opposite
 * way. Applying the reading directly therefore rotates a crooked model
 * FURTHER out -- measurably so, since re-solving afterwards then asks for
 * exactly twice the original angle, which is how this was caught.
 */
export function rotationForYaw(reading: YawReading): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(-reading.radians);
}

export type OrientationResult = {
  /** Degrees of tilt corrected, or 0 if none was. */
  tiltDegrees: number;
  /** Degrees of yaw corrected, or 0 if none was. */
  yawDegrees: number;
};

/**
 * Stands `root` straight in place: level first, then squared to the axes.
 *
 * Order matters. Yaw is a turn about the vertical, so it only means anything
 * once the vertical is actually up -- squaring a model that is still leaning
 * measures the footprint of a shadow rather than of the piece.
 *
 * Both corrections are baked into geometry, and for the same reason as
 * `levelModel`: the shells this feeds are split and measured per mesh in
 * world space, and the upload is re-exported for the studio to load
 * independently, so a transform left on a node is a transform that may not
 * survive the round trip.
 */
export function orientModel(root: THREE.Object3D): OrientationResult {
  const tiltDegrees = levelModel(root);

  const yaw = solveYaw(sampleFootprint(root));
  if (!yaw.correctable) return { tiltDegrees, yawDegrees: 0 };

  const matrix = rotationForYaw(yaw);
  root.updateMatrixWorld(true);
  const baked = new Set<THREE.BufferGeometry>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    if (baked.has(mesh.geometry)) continue;
    baked.add(mesh.geometry);
    mesh.geometry.applyMatrix4(matrix.clone().multiply(mesh.matrixWorld));
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  root.traverse((child) => {
    child.position.set(0, 0, 0);
    child.quaternion.identity();
    child.scale.set(1, 1, 1);
    child.updateMatrix();
  });
  root.updateMatrixWorld(true);

  return { tiltDegrees, yawDegrees: (yaw.radians * 180) / Math.PI };
}
