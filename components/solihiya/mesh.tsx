/**
 * Solihiya: the hand-caned lattice on the seat and back of nearly every
 * Filipino heirloom chair.
 *
 * This draws the weave rather than shipping a picture of it. Real cane webbing
 * is six passes -- verticals, horizontals, and two diagonal sets -- crossing
 * into octagonal openings, and the reason it reads as woven rather than as a
 * printed grid is that the passes sit at different depths. That is what the
 * per-set opacity below is doing: the diagonals ride over the square grid, so
 * the eye resolves an over-under, not a plaid.
 *
 * It is openwork, so it has no ground of its own: whatever sits behind shows
 * through the holes. Every use puts it over the page's own surface.
 */

type MeshProps = {
  /** Distance between strands, in px. Larger reads as coarser cane. */
  pitch?: number;
  /** Strand weight, in px. */
  strand?: number;
  /** Overall strength of the weave against its ground, 0-1. */
  opacity?: number;
  className?: string;
  /** Unique per instance: two patterns sharing an id collide in one document. */
  id: string;
};

export default function SolihiyaMesh({
  pitch = 26,
  strand = 1.25,
  opacity = 0.5,
  className,
  id,
}: MeshProps) {
  const patternId = `solihiya-${id}`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ opacity }}
      width="100%"
      height="100%"
    >
      <defs>
        <pattern id={patternId} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          {/* The square ground pass: warp and weft. */}
          <g stroke="var(--fc-cane)" strokeWidth={strand} strokeLinecap="square" opacity="0.62">
            <line x1="0" y1="0" x2="0" y2={pitch} />
            <line x1="0" y1="0" x2={pitch} y2="0" />
          </g>
          {/* The two diagonal passes, riding over the grid to open the octagons.
              Slightly heavier and brighter, because in real caning these are the
              strands that sit proudest of the panel and catch the light. */}
          <g stroke="var(--fc-cane)" strokeWidth={strand * 1.15} strokeLinecap="square" opacity="0.34">
            <line x1="0" y1="0" x2={pitch} y2={pitch} />
            <line x1={pitch} y1="0" x2="0" y2={pitch} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

/**
 * A single woven cell, used wherever one unit of the lattice has to stand for
 * one thing: a step in a commission, a part of a chair, a shop in a list.
 *
 * `state` is the whole point. A caned panel shows you what has been woven and
 * what is still bare warp, and this carries that literally: `woven` is a
 * finished step you may return to, `active` is the one being worked, and
 * `warp` is a step whose threads are strung but not yet filled.
 */
export function SolihiyaCell({
  state = "warp",
  size = 34,
  className,
  id,
}: {
  state?: "woven" | "active" | "warp";
  size?: number;
  className?: string;
  id: string;
}) {
  const cellId = `cell-${id}`;
  const strandOpacity = state === "woven" ? 0.9 : state === "active" ? 1 : 0.28;
  const stroke = state === "active" ? "var(--fc-btn)" : "var(--fc-cane)";

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 34 34"
      className={className}
    >
      <defs>
        <clipPath id={cellId}>
          <rect width="34" height="34" rx="3" />
        </clipPath>
      </defs>
      {/* Strands run in pairs, offset either side of centre, so they enclose an
          opening rather than meeting in the middle.

          The first version put a vertical, a horizontal and both diagonals
          through the single point (17,17), which is the construction of an
          asterisk -- at 22px in the commission list these rendered as little
          sparkles, which is both wrong for caning (openwork has a hole, that is
          what makes it openwork) and one of the more recognisable machine-made
          design tells.

          No diagonals here: eight strands inside 22px turns to mud. The full
          mesh keeps them, where there is room for the octagon to read. */}
      <g clipPath={`url(#${cellId})`} stroke={stroke} strokeWidth="1.6" opacity={strandOpacity}>
        <line x1="12" y1="-4" x2="12" y2="38" />
        <line x1="22" y1="-4" x2="22" y2="38" />
        {/* Warp is strung and waiting: the verticals exist, nothing crosses them
            yet. Weaving a cell is what lays the weft in. */}
        {state !== "warp" ? (
          <>
            <line x1="-4" y1="12" x2="38" y2="12" />
            <line x1="-4" y1="22" x2="38" y2="22" />
          </>
        ) : null}
      </g>
      <rect
        width="33"
        height="33"
        x="0.5"
        y="0.5"
        rx="3"
        fill="none"
        stroke={state === "active" ? "var(--fc-btn)" : "var(--fc-border)"}
        strokeWidth="1"
      />
    </svg>
  );
}
