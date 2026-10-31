import * as THREE from "three";

/**
 * Clusters near-duplicate shells (a woven seat's few hundred individual
 * strands, say) into the handful of groups an AI classifier can actually
 * reason about, one entry per real part rather than one per strand.
 *
 * Ported from `scripts/architect-analysis.mts`'s `groupShellsForPrompt`,
 * generalized off that script's own `ShellRecord` shape so both the CLI
 * script and the browser (which has live `THREE.Box3`es, not JSON-safe
 * plain arrays) can share one implementation. See that script's own
 * comments for the reasoning behind clustering by material, then height,
 * then vertex count -- it is unchanged here, just re-typed.
 */

export type Groupable = {
  materialName: string;
  surface: string;
  vertexCount: number;
  triCount: number;
  box: THREE.Box3;
  /**
   * Shells with different keys are never grouped together. Defaults to the
   * material name; see the split-model case in generation-pipeline.ts.
   */
  groupKey?: string;
};

export type ShellGroup = {
  groupIndex: number;
  /** Indices into the array `groupShells` was called with. */
  memberIndices: number[];
  materialName: string;
  surface: string;
  memberCount: number;
  vertexCountMin: number;
  vertexCountMax: number;
  triCountTotal: number;
  box: THREE.Box3;
};

/** A gap this large, as a fraction of the model's own extent along the up-axis, starts a new height band. */
const CLUSTER_HEIGHT_GAP_FRACTION = 0.08;
/** Within a height band, how far a vertex count can jump from its neighbour before it starts a new size band. */
const CLUSTER_SIZE_GAP_RATIO = 2.5;
/**
 * How far a shell's own EXTENT along the up-axis -- how tall the shell
 * itself stands, not where it sits -- can jump from its neighbour's before
 * it starts a new band.
 *
 * This is the answer to the one case height banding structurally cannot
 * reach. Banding keys on a shell's CENTRE, which works whenever parts
 * occupy separate height bands, and fails whenever something bridges the
 * gap between two of them. The Victorian chair is exactly that: its legs
 * (centres at 0.25-0.31) and its seat rails (0.45) are far enough apart to
 * band on their own, but its two dozen carvings sit at every height in
 * between and act as stepping stones, so no single gap clears the 8%
 * threshold and the whole material collapses into one band. Vertex count,
 * the pass after it, then cannot help either -- legs and rails run 981 to
 * 3689 vertices in a smooth continuum with no gap above 2.5x. The result
 * was four seat rails labeled "base", measured at 89% on a model whose
 * other 31 shells were all correct.
 *
 * Extent separates them immediately and by definition rather than by
 * tuning: a leg spans 0.50-0.62 of that chair's height because standing on
 * the floor and reaching the seat is what a leg IS, while a rail spans
 * 0.09-0.11 because it is a rail. That is a 4.7x jump in a list whose every
 * other neighbouring pair is under 1.5x. The same reasoning covers a bed,
 * where slats (thin boards) and rails share a height band for the same kind
 * of reason.
 *
 * Runs innermost, after material, height and vertex count, so it only ever
 * refines a cluster those three already agreed on -- applied earlier it
 * would interleave a chair's carvings with its seat rails, which happen to
 * be a similar height as each other while being nothing alike. The ratio
 * matches CLUSTER_SIZE_GAP_RATIO rather than introducing a second tuned
 * number, since it measures the same kind of thing: a jump in scale between
 * neighbours, not an absolute size.
 */
const CLUSTER_EXTENT_GAP_RATIO = 2.5;
/**
 * How tall a shell has to stand, as a fraction of the whole model's height,
 * before its extent is allowed to split a band at all.
 *
 * Extent means something for a structural member and nothing for a detail.
 * The Victorian chair's carvings run 0.010 to 0.115 of its height, and the
 * jump from the smallest to the next size up is 6.7x -- a bigger ratio than
 * the 4.7x that genuinely separates its legs from its seat rails, but a
 * meaningless one: both sides of it are carvings either way. Splitting there
 * cost 24 shells their correct "accessory" label, because two dozen carvings
 * read unmistakably as ornament when the AI sees them as one group covering
 * a whole chair, and read as something structural once they are served in
 * pieces. Accuracy on that model fell from 89% to 31% on that split alone,
 * even though the legs-versus-rails fix it came packaged with was working.
 *
 * So the gap only counts when the taller side of it is a real structural
 * member. Below this fraction, a shell is detail riding on something else
 * and how tall it happens to be says nothing about what it is.
 */
const CLUSTER_EXTENT_MIN_STRUCTURAL_FRACTION = 0.1;
/**
 * How far apart two members must sit along a HORIZONTAL axis, as a fraction
 * of the model's extent on it, before they start separate groups.
 *
 * This is the head-versus-foot pass. A bed's headboard and footboard match on
 * every earlier key -- same material, same height band, same vertex count,
 * same vertical extent -- so all four passes above merge them, and their
 * combined box then spans the whole piece from head to foot. Handed one entry
 * covering everything, the AI has to give one label to two different parts,
 * and it duly flip-flopped between "headboard", "accessory" and "mattress"
 * across repeated runs of the same file.
 *
 * Only meaningful once a model has been squared to its own axes (see
 * model-leveling.ts): on a piece exported at an angle the two ends do not
 * separate along x or z at all, they smear across both.
 */
const CLUSTER_PLAN_GAP_FRACTION = 0.5;
/**
 * ...but only for members that reach ACROSS the piece on the other
 * horizontal axis. This is what keeps the pass from shredding everything
 * else, and it is a real distinction rather than a fudge: a headboard spans
 * the bed's full width and is thin front-to-back, so two of them at opposite
 * ends are two different parts. Four legs at four corners are small on BOTH
 * horizontal axes and are interchangeable instances of one part, which is
 * exactly what a group is for.
 *
 * Measured, not guessed. Without this guard the Victorian chair goes from 6
 * prompt entries to 13 and the rattan chair from 9 to 14 -- the same kind of
 * over-splitting that once cost that chair's two dozen carvings their label.
 * With it, the Victorian, cushion and rattan chairs are untouched, the patio
 * chair and stool gain one group each, and the bed's head and foot finally
 * separate. Both thresholds sit on a wide plateau: anything from 0.25 to
 * 0.65 here, and 0.4 to 0.6 below, produces identical groups on all six
 * models, so neither is balanced on an edge.
 */
const CLUSTER_PLAN_MIN_SPAN_FRACTION = 0.5;

/**
 * Splits a sorted-by-key list wherever consecutive items are farther apart
 * than `maxGap` allows, on whatever scale `gap` measures its distance in.
 * Returns index ranges [start, end) into the sorted array, not the items
 * themselves, so a caller can run this twice -- once on the whole material,
 * once again inside each band it returns -- without copying arrays at every
 * level.
 */
export function splitByGap<T>(sorted: T[], gap: (prev: T, next: T) => number, maxGap: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && gap(sorted[i - 1], sorted[i]) <= maxGap) continue;
    ranges.push([start, i]);
    start = i;
  }
  return ranges;
}

export function groupShells<T extends Groupable>(items: T[], modelBox: THREE.Box3, upAxis: "x" | "y" | "z"): ShellGroup[] {
  const axisIndex = upAxis === "x" ? 0 : upAxis === "y" ? 1 : 2;
  const upSize = modelBox.max.getComponent(axisIndex) - modelBox.min.getComponent(axisIndex);
  const centreUp = (entry: { item: T }) => (entry.item.box.min.getComponent(axisIndex) + entry.item.box.max.getComponent(axisIndex)) / 2;
  const extentUp = (entry: { item: T }) =>
    entry.item.box.max.getComponent(axisIndex) - entry.item.box.min.getComponent(axisIndex);
  // The two axes that are not up, for the plan-split pass below.
  const horizontalAxes = ([0, 1, 2] as const).filter((axis) => axis !== axisIndex);
  const centreOn = (entry: { item: T }, axis: number) =>
    (entry.item.box.min.getComponent(axis) + entry.item.box.max.getComponent(axis)) / 2;
  const spanOn = (entry: { item: T }, axis: number) =>
    entry.item.box.max.getComponent(axis) - entry.item.box.min.getComponent(axis);

  const byMaterial = new Map<string, Array<{ item: T; index: number }>>();
  items.forEach((item, index) => {
    const key = item.groupKey ?? item.materialName;
    const bucket = byMaterial.get(key);
    if (bucket) bucket.push({ item, index });
    else byMaterial.set(key, [{ item, index }]);
  });

  /**
   * A model that arrives carrying ONE material has lost this function's
   * strongest axis before it starts: everything lands in a single material
   * bucket, and height, size, extent and position have to do all the work
   * alone. That is not a hypothetical -- it is exactly what every
   * AI-generated model looks like. Meshy returns one `material-0` for the
   * whole piece however many parts it separated, while a hand-modelled asset
   * carries two to four (the shipped chairs, and the real bed's four).
   *
   * So the plan-split's guard is relaxed for those models and only for those
   * models -- see the branch in pass 4. Measured across nine models, every
   * multi-material one groups byte-for-byte identically either way, and the
   * generated bed's ceiling goes from 73.7% to 89.5%.
   */
  const singleMaterial = new Set(items.map((item) => item.materialName)).size === 1;

  const groups: ShellGroup[] = [];
  for (const shells of byMaterial.values()) {
    // Pass 1: height bands. Carvings on a leg and the leg itself sit at the
    // same height, so this alone cannot separate them -- that is pass 2's job.
    const byHeight = [...shells].sort((a, b) => centreUp(a) - centreUp(b));
    const heightBands = splitByGap(byHeight, (a, b) => (upSize > 0 ? (centreUp(b) - centreUp(a)) / upSize : 0), CLUSTER_HEIGHT_GAP_FRACTION);

    for (const [bandStart, bandEnd] of heightBands) {
      // Pass 2: size bands within this height band.
      const band = byHeight.slice(bandStart, bandEnd).sort((a, b) => a.item.vertexCount - b.item.vertexCount);
      const sizeBands = splitByGap(band, (a, b) => b.item.vertexCount / Math.max(1, a.item.vertexCount), CLUSTER_SIZE_GAP_RATIO);

      for (const [sizeStart, sizeEnd] of sizeBands) {
        // Pass 3: extent bands, for the parts the first two passes cannot
        // tell apart -- see CLUSTER_EXTENT_GAP_RATIO.
        const sized = band.slice(sizeStart, sizeEnd).sort((a, b) => extentUp(a) - extentUp(b));
        const extentBands = splitByGap(
          sized,
          (a, b) => {
            // Sorted ascending, so b is the taller of the pair. If even it is
            // not a structural member, neither is a, and the gap between two
            // details is not a real boundary -- see the constant's comment.
            if (extentUp(b) < upSize * CLUSTER_EXTENT_MIN_STRUCTURAL_FRACTION) return 0;
            return extentUp(b) / Math.max(Number.EPSILON, extentUp(a));
          },
          CLUSTER_EXTENT_GAP_RATIO
        );

        for (const [extentStart, extentEnd] of extentBands) {
          // Pass 4: separate members that sit at opposite ends of the piece
          // -- see CLUSTER_PLAN_GAP_FRACTION. Applied to each horizontal axis
          // in turn, so a bed's head/foot pair (apart along its length) and
          // its left/right rails (apart across its width) are both caught.
          let clusters: Array<Array<{ item: T; index: number }>> = [sized.slice(extentStart, extentEnd)];
          for (const axis of horizontalAxes) {
            const across = horizontalAxes.find((other) => other !== axis)!;
            const acrossSize = modelBox.max.getComponent(across) - modelBox.min.getComponent(across);
            const axisSize = modelBox.max.getComponent(axis) - modelBox.min.getComponent(axis);
            const next: typeof clusters = [];
            const reachesAcross = (e: { item: T; index: number }) =>
              acrossSize > 0 && spanOn(e, across) / acrossSize >= CLUSTER_PLAN_MIN_SPAN_FRACTION;
            const splitAlongAxis = (members: Array<{ item: T; index: number }>) => {
              const along = [...members].sort((a, b) => centreOn(a, axis) - centreOn(b, axis));
              return splitByGap(
                along,
                (a, b) => (axisSize > 0 ? (centreOn(b, axis) - centreOn(a, axis)) / axisSize : 0),
                CLUSTER_PLAN_GAP_FRACTION
              ).map(([planStart, planEnd]) => along.slice(planStart, planEnd));
            };

            for (const group of clusters) {
              if (singleMaterial) {
                // With no material axis to lean on, a cluster routinely mixes
                // panels with posts -- a generated bed put its headboard,
                // footboard, mattress, platform AND four posts in one. The
                // all-members test below can never fire on a mix like that,
                // because the posts are not panels, so the panels stay welded
                // to them. Separating the members that DO reach across from
                // the ones that do not breaks the deadlock, and the two are
                // genuinely different things: a panel spanning the piece is a
                // part in its own right, a post is one of several
                // interchangeable supports.
                const wide = group.filter(reachesAcross);
                if (wide.length >= 2) {
                  const narrow = group.filter((e) => !reachesAcross(e));
                  next.push(...splitAlongAxis(wide));
                  if (narrow.length > 0) next.push(narrow);
                } else {
                  next.push(group);
                }
                continue;
              }

              // Multi-material models keep the original, stricter rule: split
              // only when EVERY member reaches across. It is what protects a
              // chair's four legs and its two dozen carvings from being
              // shredded into a group each, and those models have the
              // material axis doing the heavy lifting already.
              if (group.length >= 2 && group.every(reachesAcross)) {
                next.push(...splitAlongAxis(group));
              } else {
                next.push(group);
              }
            }
            clusters = next;
          }

          for (const cluster of clusters) {
          const box = new THREE.Box3();
          let triCountTotal = 0;
          for (const { item } of cluster) {
            box.union(item.box);
            triCountTotal += item.triCount;
          }
          const vertexCounts = cluster.map(({ item }) => item.vertexCount);
          groups.push({
            groupIndex: groups.length,
            memberIndices: cluster.map(({ index }) => index),
            materialName: cluster[0].item.materialName,
            surface: cluster[0].item.surface,
            memberCount: cluster.length,
            vertexCountMin: Math.min(...vertexCounts),
            vertexCountMax: Math.max(...vertexCounts),
            triCountTotal,
            box,
          });
          }
        }
      }
    }
  }
  return groups.sort((a, b) => a.memberIndices[0] - b.memberIndices[0]);
}

/**
 * A shell whose own footprint area dwarfs the rest of the model's combined
 * footprint by more than this multiple, while also being flat, is very
 * unlikely to be a real part: a table export was found carrying a stray
 * ground plane roughly 5-8x the actual furniture's extent in each direction
 * (25-60x by area), and a second export was found staged against a full
 * floor-and-wall backdrop -- neither ever seen on any chair test file.
 *
 * Set well above the highest ratio a real part has been measured at, not
 * just above zero: a "waterfall" pedestal table -- a top that deliberately
 * overhangs a narrower splayed base -- was found with a genuine top-to-legs
 * footprint ratio of ~4.1x, which an earlier, tighter threshold here
 * excluded outright, deleting the table's only tabletop. Excluding a real
 * part is the worse failure of the two this function can make (a stray
 * backdrop plane surviving just becomes one extra, likely mislabeled shell;
 * a deleted tabletop breaks the piece), so this stays close to the observed
 * backdrop floor of ~25x rather than splitting the difference.
 */
const FOOTPRINT_OUTLIER_RATIO = 10;
/**
 * How flat a shell has to be, relative to its own footprint, to read as a
 * panel rather than a solid part: thinness < sqrt(footprint) * this ratio.
 * A real tabletop typically measures under 0.05 by this metric; a chair or
 * table leg -- thin in cross-section but not panel-shaped -- measures
 * upward of 0.2, so this sits well clear of both.
 */
const THIN_ASPECT_RATIO = 0.15;

/**
 * Splits `items` into the shells that look like real furniture and the ones
 * that look like staging/backdrop geometry bundled into the export by
 * whoever made it.
 *
 * Unlike an earlier version of this function, this does not assume a shared
 * up-axis: each shell is measured against its OWN flattest axis, because a
 * backdrop can include a vertical wall panel alongside a horizontal floor,
 * and a wall is not "thin" along the model's up-axis at all -- it is thin
 * along a horizontal one. Outliers are also removed one at a time, worst
 * first, each time re-measuring every remaining shell against what is left:
 * a floor and a wall together can each look merely "the same size as the
 * rest of the model" while the rest still includes the other one, masking
 * both. Removing the floor first shrinks "the rest" enough that the wall
 * shows up as the extreme outlier it actually is on the next pass.
 *
 * Both conditions -- a large footprint OUTLIER *and* FLAT -- have to hold
 * together, so a real leg (thin in cross-section, but not a footprint
 * outlier) and a real tabletop (a footprint outlier relative to a leg, but
 * not relative to the OTHER legs spread out beneath it) are never caught;
 * see the reasoning in `THIN_ASPECT_RATIO`.
 *
 * Meant to run once, right after shell-splitting and before grouping, so an
 * excluded shell never reaches the AI prompt, the render, or
 * `ensureBaseRole`'s floor-touching fallback -- which matters, since a
 * backdrop plane sitting at floor level is exactly the shape that fallback
 * would otherwise be tempted to grab.
 */
export function filterBackdropShells<T extends { box: THREE.Box3 }>(items: T[]): { kept: T[]; excluded: T[] } {
  const remaining = items.slice();
  const excluded: T[] = [];

  const measure = (box: THREE.Box3) => {
    const size = box.getSize(new THREE.Vector3());
    const sizes: [number, number, number] = [size.x, size.y, size.z];
    const thinAxis = sizes[0] <= sizes[1] && sizes[0] <= sizes[2] ? 0 : sizes[1] <= sizes[2] ? 1 : 2;
    const others = ([0, 1, 2] as const).filter((axis) => axis !== thinAxis);
    return { thinness: sizes[thinAxis], others };
  };

  while (remaining.length >= 2) {
    let worstIndex = -1;
    let worstRatio = FOOTPRINT_OUTLIER_RATIO;

    for (let i = 0; i < remaining.length; i++) {
      const { thinness, others } = measure(remaining[i].box);
      const size = remaining[i].box.getSize(new THREE.Vector3());
      const footprint = Math.max(0, size.getComponent(others[0])) * Math.max(0, size.getComponent(others[1]));
      if (footprint <= 0) continue;
      if (thinness >= Math.sqrt(footprint) * THIN_ASPECT_RATIO) continue; // not flat enough to be staging geometry

      const restBox = new THREE.Box3();
      for (let j = 0; j < remaining.length; j++) if (j !== i) restBox.union(remaining[j].box);
      if (restBox.isEmpty()) continue;
      const restSize = restBox.getSize(new THREE.Vector3());
      const restFootprint = Math.max(0, restSize.getComponent(others[0])) * Math.max(0, restSize.getComponent(others[1]));
      if (restFootprint <= 0) continue;

      const ratio = footprint / restFootprint;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstIndex = i;
      }
    }

    if (worstIndex === -1) break;
    excluded.push(...remaining.splice(worstIndex, 1));
  }

  return { kept: remaining, excluded };
}
