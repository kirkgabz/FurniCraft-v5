"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Where the nail cocks back, ready to be driven: anything you can act on. */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  "select",
  "label[for]",
  '[role="button"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="submit"]',
  'input[type="button"]',
  'input[type="file"]',
  'input[type="range"]',
  'input[type="color"]',
  '[data-cursor="nail"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where a caret matters more than a nail. Inside these the native text cursor
 * is handed back (globals.css) and the nail hides. Kept in sync with the
 * matching :is() list in globals.css.
 */
const TEXT_SELECTOR = [
  "textarea",
  '[contenteditable="true"]',
  "input:not([type])",
  'input[type="text"]',
  'input[type="email"]',
  'input[type="password"]',
  'input[type="search"]',
  'input[type="number"]',
  'input[type="tel"]',
  'input[type="url"]',
  'input[type="date"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="time"]',
  'input[type="week"]',
].join(",");

/** Longest of the strike's animations plus a frame, after which the DOM goes. */
const STRIKE_LIFETIME_MS = 820;
/** How long the tracked nail wears its driven-in state before it can retrigger. */
const DRIVE_MS = 700;
/**
 * A machine-gunned mouse button should not be able to stack a hundred hammers.
 * Older strikes are dropped rather than queued, so the newest one always plays.
 */
const MAX_STRIKES = 5;

/**
 * Splinters, in degrees around the entry point, with how far each travels and
 * how late it leaves. Weighted up and to the sides -- wood does not spit chips
 * back into the hole the nail just went down -- and deliberately uneven in all
 * three numbers: evenly spaced chips of equal length leaving together stop
 * being splinters and become a cartoon starburst.
 */
const CHIPS: ReadonlyArray<{ angle: number; distance: number; lag: number }> = [
  { angle: -176, distance: 44, lag: 0 },
  { angle: -128, distance: 53, lag: 18 },
  { angle: -84, distance: 37, lag: 6 },
  { angle: -41, distance: 47, lag: 26 },
  { angle: 12, distance: 33, lag: 12 },
];

type Strike = {
  id: number;
  x: number;
  y: number;
};

/** A compact desktop pointer. Touch and narrow screens use native interaction. */
export function NailCursor() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<HTMLSpanElement | null>(null);
  const [hasMouse, setHasMouse] = useState(false);
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  /** Every pending removal, cancelled together if the tree unmounts mid-strike. */
  const later = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, ms);
    timersRef.current.add(timer);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  // React to device/viewport changes, including attaching a mouse or resizing.
  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 768px) and (hover: hover) and (pointer: fine)"
    );
    const sync = () => setHasMouse(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  /** The class that takes the system arrow away, held only while we draw one. */
  useEffect(() => {
    if (!hasMouse) return;
    const root = document.documentElement;
    root.classList.add("nail-cursor");
    return () => root.classList.remove("nail-cursor");
  }, [hasMouse]);

  useEffect(() => {
    if (!hasMouse) return;
    const root = rootRef.current;
    if (!root) return;

    /**
     * An element that sets its own cursor from script is telling us something
     * no selector can. The 3D studio is the case that matters: it writes
     * `pointer` onto its canvas when the ray hits a part of the piece and
     * `grab` when it does not (furniture-studio.tsx). Taking the system cursor
     * away without reading that would silently delete the studio's only signal
     * that a part is selectable, so the nail carries it instead.
     */
    const declaredCursor = (target: Element | null) =>
      target && "style" in target ? (target as HTMLElement).style.cursor : "";

    let lastTarget: Element | null = null;
    let lastDeclared = "";

    const classify = (target: Element | null, declared: string) => {
      const over = !target
        ? ""
        : target.closest(TEXT_SELECTOR)
          ? "text"
          : declared === "pointer" || target.closest(INTERACTIVE_SELECTOR)
            ? "interactive"
            : "";
      if (root.dataset.over !== over) root.dataset.over = over;
    };

    /**
     * Written straight to style rather than through React state. A pointermove
     * re-render per frame would put the whole page's reconciliation on the
     * critical path of moving a mouse, and this element's only job is to move.
     *
     * Classification rides along on the move, because a page can change what is
     * under a still-hovered element without any pointerover firing -- again the
     * studio, where the canvas stays the target while the part under the ray
     * changes. The selector matching is skipped unless the element or the
     * cursor it declares actually changed, so the common case is two property
     * reads and a transform write.
     */
    const place = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        hide();
        return;
      }
      root.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      if (root.dataset.visible !== "true") root.dataset.visible = "true";

      const target = event.target instanceof Element ? event.target : null;
      const declared = declaredCursor(target);
      if (target !== lastTarget || declared !== lastDeclared) {
        lastTarget = target;
        lastDeclared = declared;
        classify(target, declared);
      }
    };

    const hide = () => {
      root.dataset.visible = "false";
      delete root.dataset.press;
    };

    /**
     * relatedTarget is null exactly when the pointer left the document -- out of
     * the window, or into browser chrome. Without this the nail parks itself at
     * the edge of the viewport and reads as a stuck graphic.
     */
    const maybeHide = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };

    const press = (event: PointerEvent) => {
      if (event.pointerType === "mouse") root.dataset.press = "true";
    };
    const release = () => {
      delete root.dataset.press;
    };

    window.addEventListener("pointermove", place, { passive: true });
    window.addEventListener("pointerdown", place, { passive: true });
    document.addEventListener("pointerout", maybeHide, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    window.addEventListener("pointercancel", release, { passive: true });
    window.addEventListener("blur", hide);

    return () => {
      window.removeEventListener("pointermove", place);
      window.removeEventListener("pointerdown", place);
      document.removeEventListener("pointerout", maybeHide);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", hide);
    };
  }, [hasMouse]);

  /** Mouse clicks only; touch and pen never create cursor effects. */
  useEffect(() => {
    if (!hasMouse) return;
    const timers = timersRef.current;
    const add = (x: number, y: number) => {
      const id = nextIdRef.current++;
      setStrikes((current) => [
        ...current.slice(-(MAX_STRIKES - 1)),
        { id, x, y },
      ]);
      later(
        () => setStrikes((current) => current.filter((s) => s.id !== id)),
        STRIKE_LIFETIME_MS
      );
    };

    /**
     * Drives the tracked nail -- the drawn cursor, which only a mouse has.
     *
     * Cleared and re-set around a forced reflow so a fast second click
     * restarts the animation instead of being swallowed by the one still
     * running.
     */
    const driveCursor = () => {
      const art = artRef.current;
      if (!art) return;
      delete art.dataset.strike;
      void art.offsetWidth;
      art.dataset.strike = "true";
      later(() => {
        if (artRef.current) delete artRef.current.dataset.strike;
      }, DRIVE_MS);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      add(event.clientX, event.clientY);
      driveCursor();
    };

    window.addEventListener("pointerdown", down, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", down);
      timers.forEach(clearTimeout);
      timers.clear();
      // Clear in-flight effects when the device or viewport becomes ineligible.
      setStrikes([]);
    };
  }, [hasMouse, later]);

  if (!hasMouse) return null;

  return (
    <>
      <div ref={rootRef} className="nail-cursor-root" aria-hidden="true">
        <span ref={artRef} className="nail-cursor-art">
          <span className="nail-cursor-halo" />
          <NailArt className="nail-cursor-svg" />
        </span>
      </div>
      <div className="nail-strike-layer" aria-hidden="true">
        {strikes.map((strike) => (
          <div
            key={strike.id}
            className="nail-strike"
            style={{ transform: `translate3d(${strike.x}px, ${strike.y}px, 0) scale(${24 / 44})` }}
          >
            <span className="nail-strike-ring" />
            <span className="nail-strike-ring nail-strike-ring--wide" />
            <span className="nail-strike-flash" />
            {CHIPS.map((chip) => (
              <span
                key={chip.angle}
                className="nail-strike-chip"
                style={
                  {
                    "--chip-angle": `${chip.angle}deg`,
                    "--chip-distance": `${chip.distance}px`,
                    "--chip-lag": `${chip.lag}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
            <HammerArt className="nail-strike-hammer" />
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The nail, drawn on the solihiya grammar: mitred joins, square caps, the shaft
 * on the lattice's 45 degrees. Its tip is at (4,4) in a 44-unit box, and the
 * negative margin in globals.css pulls that point onto the hotspot, so the
 * geometry here can stay readable instead of being written around an offset.
 */
function NailArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="44"
      height="44"
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className="nail-art-body">
        {/* Shaft: a taper from the point out to the width of the head. The
            point is a 2.4-unit flat centred on (4,4) rather than a true spike.
            Drawn to a spike, the contrast halo -- which is painted under the
            fill and is near-black in dark mode -- closes over the last few
            units and eats the tip, which is the one part of this that has to
            stay visible, because it is the hotspot. */}
        <polygon points="4.85,3.15 31.1,26.9 26.9,31.1 3.15,4.85" />
        {/* Head: a flat disc seen edge-on, square across the shaft's axis. */}
        <rect
          className="nail-art-head"
          x="21.5"
          y="28.25"
          width="19"
          height="5.5"
          rx="1"
          transform="rotate(-45 31 31)"
        />
        {/* One highlight, on the head rather than down the shaft. The shaft is
            a taper only three units wide at its widest, so a line drawn on it
            sits half outside the silhouette and casts the drop shadow back
            across the nail as a dark hairline. There is room on the head. */}
        <rect
          className="nail-art-sheen"
          x="23"
          y="31.9"
          width="16"
          height="1.5"
          rx="0.7"
          transform="rotate(-45 31 31)"
        />
      </g>
    </svg>
  );
}

/**
 * The hammer, drawn already in its landed pose so the swing is a single
 * rotation about the grip -- both the honest arc and the cheap one.
 *
 * The geometry is the part worth being careful about. A nail whose point is at
 * the hotspot has its head down-right of it, which means driving that nail is a
 * push up-left along the shaft, which means the hammer comes from down-right
 * with the face square to the shaft. So: grip at the top right, where a right
 * hand comes in from; handle running down-left; head crossing it at right
 * angles at the far end; the brass face on the up-left side of that head,
 * meeting the nail head-on. Drawn head-along-handle instead, which is the easy
 * mistake, it reads as a fork on a stick rather than a hammer.
 */
function HammerArt({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <polygon className="nail-hammer-handle" points="61.2,5.2 66.8,10.8 34.3,43.3 28.7,37.7" />
      <polygon className="nail-hammer-grip" points="58.6,7.8 64.2,13.4 58.3,19.3 52.7,13.7" />
      {/* The head, square across the handle. Its own frame is axis-aligned so
          the claw can be drawn by eye, then turned onto the shaft's diagonal. */}
      <g transform="rotate(45 31.5 40.5)">
        <rect className="nail-hammer-face" x="12.5" y="32" width="5" height="17" rx="1.5" />
        {/* Face end, block, and the two claw prongs around their notch as one
            silhouette -- the notch is what makes it a hammer and not a mallet
            at twenty pixels on a phone. */}
        <path
          className="nail-hammer-head"
          d="M15.5,33 L40,32 L52,29.5 L53.5,33 L43,37.5 L43,43.5 L53.5,48 L52,51.5 L40,49 L15.5,48 Z"
        />
      </g>
    </svg>
  );
}
