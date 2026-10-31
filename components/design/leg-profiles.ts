// Shared turned-leg (baluster) profile math. Pure geometry, no three.js/React
// dependency. Originally shared between a parametric 3D lathe mesh and the 2D
// blueprint so the two could never drift apart; the studio replaced that
// parametric mesh with real GLTF models, so this now only feeds the blueprint
// (blueprint-svg.ts) -- kept as its own module rather than folded in, since a
// future parametric or preview mesh could still want the exact same profile.

export type ProfilePoint = { t: number; r: number };

// Radius multiplier at each normalized height (t: 0 = foot, 1 = top block),
// modeled on a classic baluster/bobbin turning: flared foot, ankle ring,
// long taper into a bulb, neck ring, then a plain post into the apron.
export const TURNED_LEG_PROFILE: ProfilePoint[] = [
  { t: 0.0, r: 0.9 },
  { t: 0.035, r: 0.55 },
  { t: 0.07, r: 0.55 },
  { t: 0.1, r: 1.0 },
  { t: 0.13, r: 0.55 },
  { t: 0.17, r: 0.62 },
  { t: 0.46, r: 1.18 },
  { t: 0.62, r: 1.32 },
  { t: 0.76, r: 0.66 },
  { t: 0.8, r: 0.88 },
  { t: 0.835, r: 0.6 },
  { t: 0.88, r: 0.64 },
  { t: 1.0, r: 0.64 },
];

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Radius multiplier (relative to the leg's nominal half-width) at height t (0..1). */
export function turnedLegProfileScale(t: number, points: ProfilePoint[] = TURNED_LEG_PROFILE): number {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const local = b.t === a.t ? 0 : (clamped - a.t) / (b.t - a.t);
      return a.r + (b.r - a.r) * smoothstep(local);
    }
  }
  return points[points.length - 1].r;
}

/** Absolute radius (in the same units as baseRadius) at height t (0..1). */
export function turnedLegRadiusAt(t: number, baseRadius: number, points?: ProfilePoint[]): number {
  return baseRadius * turnedLegProfileScale(t, points);
}

/** `samples + 1` radii evenly spaced from foot (index 0) to top (index samples). */
export function turnedLegRadii(samples: number, baseRadius: number, points?: ProfilePoint[]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= samples; i++) out.push(turnedLegRadiusAt(i / samples, baseRadius, points));
  return out;
}
