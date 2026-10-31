import type { ChairRig } from "./chair-rig";
import type { StudioModel } from "./studio-models";
import { measureRig, type ChairMeasurement } from "./studio-dimensions";
import { COUNT_KEYS, type RigParamKey, type RigParams, type SizeControl } from "./studio-config";

/**
 * Typed sizes for the studio: "make it 46 cm high at the seat" instead of
 * dragging a slider until the readout says so.
 *
 * The rig is driven by multipliers on its parts, not by the piece's overall
 * dimensions, and which multiplier moves which dimension differs by piece --
 * a chair's height is its back, a cabinet's is its case, one cabinet's
 * "depth" control is keyed `cabinetHeight`. Rather than keep a table of that
 * per model, which would be wrong for the next model added, this asks the
 * rig: it tries each size control at its two ends, measures what moved, and
 * picks the control that moves the dimension asked about. The same probing
 * gives the exact range a piece can be built in, and a bisection on that
 * control finds the setting for a typed number.
 *
 * Every probe is undone before returning: the caller's params are put back on
 * the rig, so the scene is never left showing a trial setting.
 */

export type SizeAxis = "w" | "h" | "d" | "seat";

export type AxisPlan = {
  axis: SizeAxis;
  key: RigParamKey;
  min: number;
  max: number;
  /** The smallest and largest this dimension can be, in cm. */
  minCm: number;
  maxCm: number;
  /** Whether a larger multiplier makes the dimension larger. */
  increasing: boolean;
};

/**
 * Controls that change what the piece has rather than how big it is: the
 * leaves of a drop-leaf table, carvings, arms and handles, which a control
 * removes outright at zero. Counts are excluded separately (COUNT_KEYS).
 */
const NOT_SIZES = new Set<RigParamKey>(["leafWidth", "ornamentScale", "armScale", "handleScale"]);

/** A dimension has to move at least this much for its control to count. */
const MIN_EFFECT_CM = 0.5;

function readAxis(measurement: ChairMeasurement, axis: SizeAxis): number {
  return axis === "seat" ? measurement.seatHeight : measurement.overall[axis];
}

/** Each size control once, with the range every part using it allows. */
function sizeControls(model: StudioModel): Array<Pick<SizeControl, "key" | "min" | "max">> {
  const byKey = new Map<RigParamKey, { key: RigParamKey; min: number; max: number }>();
  for (const part of model.parts) {
    for (const control of part.controls) {
      if (COUNT_KEYS.has(control.key) || NOT_SIZES.has(control.key)) continue;
      const seen = byKey.get(control.key);
      // The same key on two parts: only the overlap is safe for both sliders.
      if (seen) byKey.set(control.key, { key: control.key, min: Math.max(seen.min, control.min), max: Math.min(seen.max, control.max) });
      else byKey.set(control.key, { key: control.key, min: control.min, max: control.max });
    }
  }
  return [...byKey.values()].filter((control) => control.max > control.min);
}

function probe(rig: ChairRig, model: StudioModel) {
  return (params: RigParams) =>
    rig.withShut(() => {
      rig.applyParams(params);
      return measureRig(rig, model);
    });
}

/**
 * Which control sizes each dimension of this piece, and between what limits.
 * An axis no control moves is left out: that dimension is fixed.
 */
export function planSizes(rig: ChairRig, model: StudioModel, params: RigParams): Partial<Record<SizeAxis, AxisPlan>> {
  const measure = probe(rig, model);
  try {
    const base = measure(params);
    // A surface height that is the top of the piece -- a table, a cabinet --
    // is the overall height under another name. Planned as its own field it
    // offered two boxes for one measurement, and penalising the height
    // control for moving it left Height a sliver of its real range.
    const hasSeat = base.seatHeight > 0 && base.overall.h - base.seatHeight > 1;
    const trials = sizeControls(model).map((control) => {
      const low = measure({ ...params, [control.key]: control.min });
      const high = measure({ ...params, [control.key]: control.max });
      return { control, low, high };
    });

    const plans: Partial<Record<SizeAxis, AxisPlan>> = {};
    const axes: SizeAxis[] = hasSeat ? ["w", "d", "seat", "h"] : ["w", "d", "h"];
    for (const axis of axes) {
      let best: { score: number; trial: (typeof trials)[number] } | null = null;
      for (const trial of trials) {
        const moved = Math.abs(readAxis(trial.high, axis) - readAxis(trial.low, axis));
        if (moved < MIN_EFFECT_CM) continue;
        // Overall height on a piece with a seat: the control that raises the
        // top without moving the seat -- the back, not the legs -- so typing a
        // height does not undo a seat height typed a moment before.
        const seatMoved = axis === "h" && hasSeat ? Math.abs(trial.high.seatHeight - trial.low.seatHeight) : 0;
        const score = moved - 2 * seatMoved;
        if (!best || score > best.score) best = { score, trial };
      }
      if (!best) continue;
      const { control, low, high } = best.trial;
      const lowCm = readAxis(low, axis);
      const highCm = readAxis(high, axis);
      plans[axis] = {
        axis,
        key: control.key,
        min: control.min,
        max: control.max,
        minCm: Math.min(lowCm, highCm),
        maxCm: Math.max(lowCm, highCm),
        increasing: highCm >= lowCm,
      };
    }
    return plans;
  } finally {
    measure(params);
  }
}

export type SizeSolution = {
  params: RigParams;
  /** What the dimension measures at the setting found, in cm. */
  reachedCm: number;
  /** Set when the typed size was past what the piece can be built at. */
  limit: "min" | "max" | null;
};

/**
 * The setting of `plan`'s control that makes its dimension `targetCm`, with
 * every other param as given. Bisection: the dimension rises (or falls)
 * steadily with the multiplier, and twenty halvings of a 0.5-wide range is
 * far finer than the 0.1 cm the measurement is rounded to.
 */
export function solveSize(
  rig: ChairRig,
  model: StudioModel,
  params: RigParams,
  plan: AxisPlan,
  targetCm: number
): SizeSolution {
  const measure = probe(rig, model);
  try {
    // The range again, with these params: an earlier axis in the same edit may
    // have moved it (a deeper seat leaves less room for some backs).
    const atMin = readAxis(measure({ ...params, [plan.key]: plan.min }), plan.axis);
    const atMax = readAxis(measure({ ...params, [plan.key]: plan.max }), plan.axis);
    const lowCm = Math.min(atMin, atMax);
    const highCm = Math.max(atMin, atMax);

    if (targetCm <= lowCm || targetCm >= highCm) {
      const toLow = targetCm <= lowCm;
      const value = toLow === plan.increasing ? plan.min : plan.max;
      return {
        params: { ...params, [plan.key]: value },
        reachedCm: toLow ? lowCm : highCm,
        limit: Math.abs(targetCm - (toLow ? lowCm : highCm)) < 0.05 ? null : toLow ? "min" : "max",
      };
    }

    let lo = plan.min;
    let hi = plan.max;
    let value = params[plan.key];
    let reached = readAxis(measure(params), plan.axis);
    for (let step = 0; step < 20; step += 1) {
      value = (lo + hi) / 2;
      reached = readAxis(measure({ ...params, [plan.key]: value }), plan.axis);
      if (Math.abs(reached - targetCm) < 0.05) break;
      const tooBig = reached > targetCm;
      if (tooBig === plan.increasing) hi = value;
      else lo = value;
    }
    const rounded = Math.round(value * 10000) / 10000;
    return { params: { ...params, [plan.key]: rounded }, reachedCm: reached, limit: null };
  } finally {
    measure(params);
  }
}

/**
 * Every dimension at these params, leaving the rig at them -- the caller is
 * about to commit these params anyway. Used between the steps of one edit:
 * setting the seat moves the height above it, so each later dimension is
 * checked against the piece as it now is.
 */
export function measureSizes(rig: ChairRig, model: StudioModel, params: RigParams): Record<SizeAxis, number> {
  const measured = rig.withShut(() => {
    rig.applyParams(params);
    return measureRig(rig, model);
  });
  return { w: measured.overall.w, h: measured.overall.h, d: measured.overall.d, seat: measured.seatHeight };
}
