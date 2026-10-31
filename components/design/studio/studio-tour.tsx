"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * The studio's guided tour: a spotlight on one control at a time, with a card
 * saying what it does and a Next to move on.
 *
 * Built around the controls themselves rather than around a fixed script. Each
 * step names a `data-tour` attribute on a real element, and a step whose
 * element is not on the page is dropped before the tour starts. That is what
 * makes one list of steps correct for every piece in the studio: a chair has
 * no drawers, so the "Open drawers" step does not exist for a chair; only a
 * shop owner has "Publish as Template"; the cart button appears once there is
 * something in it. Writing a tour per furniture type would mean eleven lists
 * that have to be kept in step with one another, and ten of them would be
 * wrong within a month.
 *
 * Four things this has to get right, none of them obvious:
 *
 *   1. A step can only run if its control exists AND has a size. A panel
 *      hidden at this breakpoint measures 0x0 and would spotlight a point in
 *      the corner of the screen. Both are checked, and re-checked on resize.
 *   2. Some controls only exist after an action. Finish and Size appear when a
 *      part is selected, so those steps ask for the part first -- `onEnter`.
 *   3. The page moves. The target is scrolled into view, and the spotlight is
 *      re-measured on scroll, on resize, and whenever the element itself
 *      changes size.
 *   4. It must be escapable at every moment. Skip, Escape, and the backdrop
 *      all end it, and ending it is remembered so it does not reappear on the
 *      next visit.
 *
 * The dim is four panels around the target rather than one box-shadow or
 * clip-path. A hole punched with either of those is still one element covering
 * the control, which swallows the hover states and the tooltips underneath it;
 * four panels leave the control genuinely uncovered.
 */

export type TourStep = {
  id: string;
  /** The `data-tour` value on the element this step is about. */
  target: string;
  title: string;
  body: string;
  /**
   * Run before the step is shown -- for a control that does not exist until
   * something is selected. Must be idempotent: a tour stepped backwards and
   * forwards will run it more than once.
   */
  onEnter?: () => void;
  /**
   * Where the card goes relative to the target. "auto" picks whichever side
   * has room; the others are for the rare case where auto is right but ugly.
   */
  placement?: "auto" | "top" | "bottom";
};

/** How much room the spotlight leaves around the control it is lighting. */
const HALO_PX = 8;
/** The card's own width, and the gap it keeps from the control. */
const CARD_W = 320;
const CARD_GAP = 14;
/** Kept clear of the viewport edge so the card never sits flush against it. */
const EDGE = 12;

type Rect = { top: number; left: number; width: number; height: number };

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** An element is a usable target only if it is on the page and has a size. */
function usable(element: Element | null): element is Element {
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return box.width > 1 && box.height > 1;
}

/**
 * The first match that is actually on screen. A control can exist twice --
 * the studio's phone layout puts Add to cart in a bottom bar and the view
 * tools on the model, while the desktop toolbar keeps its own -- and only one
 * of each pair has a size at any width.
 */
export function findTourTarget(target: string): Element | null {
  const all = document.querySelectorAll(`[data-tour="${target}"]`);
  for (const element of all) if (usable(element)) return element;
  return all[0] ?? null;
}

/**
 * The steps that have something to point at.
 *
 * Takes the "is this control usable" test as an argument so the rule can be
 * exercised without a DOM -- see scripts/verify-studio-tour.mts. The bug that
 * made the Tutorial button appear to do nothing lived in the state around this
 * decision, not in the decision, and a check that could only read the source
 * could not tell the difference.
 */
export function resolveTourSteps<T extends { target: string; onEnter?: () => void }>(
  steps: T[],
  isUsable: (target: string) => boolean,
  /**
   * Whether the control is on the page at all, sized or not. A step that can
   * reveal its own control -- the studio's sidebar is tabbed, and a control on
   * the other tab measures 0x0 until the step's onEnter opens that tab -- is
   * kept when its control is present. A control not on the page is still
   * dropped: a chair still gets no "Open the drawers" step.
   */
  isPresent: (target: string) => boolean = () => false
): T[] {
  return steps.filter((step) => isUsable(step.target) || (step.onEnter !== undefined && isPresent(step.target)));
}

/**
 * Where the card goes, and which way its arrow points.
 *
 * Measured height in, coordinates out, no DOM -- so the one case that broke
 * this can be run in a test: the opening step's target is the whole 3D
 * viewport, and a card placed "below" it landed below the bottom of the
 * window. The ring was visible and the card was not, which read as the
 * Tutorial button doing nothing at all.
 *
 * Below if it fits, else above if it fits, else laid over the target itself --
 * which is the only answer left for a target that fills the screen. The result
 * is clamped into the viewport on both axes regardless: a card nobody can read
 * is the one failure this component cannot recover from, so the clamp is not
 * a fallback, it is the last line.
 */
export function placeTourCard({
  rect,
  viewportW,
  viewportH,
  cardHeight,
  placement,
}: {
  rect: Rect;
  viewportW: number;
  viewportH: number;
  cardHeight: number;
  placement?: TourStep["placement"];
}): { top: number; left: number; arrow: "up" | "down" | null; arrowX: number } {
  const below = rect.top + rect.height + HALO_PX + CARD_GAP;
  const above = rect.top - HALO_PX - CARD_GAP - cardHeight;
  const fitsBelow = below + cardHeight + EDGE <= viewportH;
  const fitsAbove = above >= EDGE;

  const wantsTop = placement === "top";
  const wantsBottom = placement === "bottom";

  let top: number;
  let arrow: "up" | "down" | null;
  if (wantsBottom && fitsBelow) {
    top = below;
    arrow = "up";
  } else if (wantsTop && fitsAbove) {
    top = above;
    arrow = "down";
  } else if (fitsBelow) {
    top = below;
    arrow = "up";
  } else if (fitsAbove) {
    top = above;
    arrow = "down";
  } else {
    // Nowhere outside the target to stand. Sit inside it, low enough to leave
    // the control itself visible above the card.
    top = Math.min(
      viewportH - cardHeight - EDGE,
      Math.max(EDGE, rect.top + rect.height - cardHeight - EDGE)
    );
    arrow = null;
  }

  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, viewportH - cardHeight - EDGE));

  const left = Math.min(
    Math.max(EDGE, rect.left + rect.width / 2 - CARD_W / 2),
    Math.max(EDGE, viewportW - CARD_W - EDGE)
  );

  // The arrow points at the middle of the control, not at the middle of the
  // card -- those are the same only when the card had room to centre itself.
  const targetCentre = rect.left + rect.width / 2;
  const arrowX = Math.min(Math.max(20, targetCentre - left), CARD_W - 20);

  return { top, left, arrow, arrowX };
}

/**
 * Whether a tour should close itself because there is nothing to show.
 *
 * `live === null` means the filter has not run yet. Treating that as "nothing
 * to show" is what closed the tour in the same commit it opened in: the filter
 * effect had only queued its update, so the guard read the initial value and
 * shut the tour before it could ever paint.
 */
export function tourHasNothingToShow(live: unknown[] | null, stepCount: number): boolean {
  if (live === null) return false;
  return live.length === 0 && stepCount > 0;
}

export default function StudioTour({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[];
  open: boolean;
  /** `completed` is true only if the last step was reached. */
  onClose: (completed: boolean) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  /**
   * The steps that survived the "is this control on the page" filter.
   *
   * Null until that has been worked out, and an array -- possibly empty --
   * afterwards. The distinction is the whole of a bug that stopped the tour
   * opening at all: this was `[]` initially, and the guard further down closes
   * a tour with no usable steps. On the first render after mounting, the
   * filter effect has only QUEUED its state update, so the guard ran against
   * the initial empty array, read it as "nothing to point at", and closed the
   * tour in the same commit it opened in. Pressing Tutorial did nothing,
   * visibly, for that reason.
   */
  const [live, setLive] = useState<TourStep[] | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** The card's real height, so it can be placed rather than guessed at. */
  const [cardH, setCardH] = useState(0);

  /**
   * The steps that actually have something to point at, worked out when the
   * tour opens rather than on every render: the answer must not change under
   * the reader's feet mid-tour, or pressing Next twice could skip a step or
   * land on a different one than the counter promised.
   */
  useEffect(() => {
    if (!open) {
      setLive(null);
      return;
    }
    // Usable now, or on the page but on a tab its own onEnter opens.
    setLive(resolveTourSteps(steps, (target) => usable(findTourTarget(target)), (target) => findTourTarget(target) !== null));
    setIndex(0);
  }, [open, steps]);

  const step = live?.[index] ?? null;
  const total = live?.length ?? 0;

  // A control that only exists once something is chosen.
  useEffect(() => {
    step?.onEnter?.();
  }, [step]);

  /** Measures the target, after bringing it into view. */
  const measure = useCallback(() => {
    if (!step) return;
    const element = findTourTarget(step.target);
    if (!usable(element)) {
      setRect(null);
      return;
    }
    setRect(rectOf(element));
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const element = findTourTarget(step.target);
    if (element) {
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    // After the smooth scroll has had a frame to start, and again once it has
    // had time to finish -- measuring only before it would pin the spotlight
    // to where the control used to be.
    measure();
    const soon = window.setTimeout(measure, 60);
    const settled = window.setTimeout(measure, 420);
    return () => {
      window.clearTimeout(soon);
      window.clearTimeout(settled);
    };
  }, [open, step, measure]);

  /** The page can move under a step: a panel opens, the window resizes. */
  useEffect(() => {
    if (!open || !step) return;
    const onMove = () => measure();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);

    const element = findTourTarget(step.target);
    const observer =
      element && typeof ResizeObserver !== "undefined" ? new ResizeObserver(onMove) : null;
    if (element && observer) observer.observe(element);

    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      observer?.disconnect();
    };
  }, [open, step, measure]);

  const finish = useCallback(
    (completed: boolean) => {
      setRect(null);
      onClose(completed);
    },
    [onClose]
  );

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const next = useCallback(() => {
    setIndex((current) => {
      if (current + 1 >= total) {
        finish(true);
        return current;
      }
      return current + 1;
    });
  }, [total, finish]);

  /** Keyboard, because a tour that traps a keyboard user is worse than none. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, finish]);

  useEffect(() => {
    if (open && step) nextRef.current?.focus();
  }, [open, step, index]);

  /**
   * Re-measured per step: the body text differs, so the card's height does.
   * A layout effect, so the placement above never paints at the wrong height
   * first and then jumps.
   */
  useLayoutEffect(() => {
    if (!open || !step) return;
    const measured = cardRef.current?.getBoundingClientRect().height ?? 0;
    if (measured > 0 && Math.abs(measured - cardH) > 1) setCardH(measured);
  }, [open, step, index, cardH]);

  /**
   * A tour with nothing to point at is not a tour. This happens if every
   * control is missing -- a viewport too small for the toolbar, a model that
   * failed to load -- and showing a dimmed screen with an empty card would be
   * worse than quietly not starting.
   */
  useEffect(() => {
    // `live === null` means the filter has not run yet, which is not the same
    // as having found nothing -- see the note on the state itself.
    if (open && tourHasNothingToShow(live, steps.length)) finish(false);
  }, [open, live, steps.length, finish]);

  /**
   * Where the card goes, and which way its arrow points.
   *
   * Measured, not estimated. The first version assumed a 190px card and
   * honoured `placement: "bottom"` unconditionally -- so on the opening step,
   * whose target is the whole 3D viewport, "below the target" was below the
   * bottom of the window and the card rendered off-screen. The ring was
   * visible and nothing else, which read as the Tutorial button doing nothing.
   *
   * So: below if it fits, else above if it fits, else laid over the target
   * itself -- which is the right answer for a target that fills the screen,
   * because there is no outside left to sit in. The result is clamped to the
   * viewport in both axes regardless, since a card nobody can read is the one
   * failure this component cannot recover from.
   */
  const card = useMemo(
    () =>
      rect
        ? placeTourCard({
            rect,
            viewportW: typeof window === "undefined" ? 0 : window.innerWidth,
            viewportH: typeof window === "undefined" ? 0 : window.innerHeight,
            cardHeight: cardH || 190,
            placement: step?.placement,
          })
        : null,
    [rect, step, cardH]
  );

  if (!open || !step) return null;

  return (
    <div className="studio-tour" role="dialog" aria-modal="true" aria-label={uiText("Design studio tour")}>
      {/* The dim, as four panels around the control rather than one sheet over
          it -- see the note at the top of this file. Clicking any of them ends
          the tour, which is what a reader who has seen enough will try. */}
      {rect ? (
        <>
          <div
            className="studio-tour-scrim"
            style={{ top: 0, left: 0, width: "100vw", height: Math.max(0, rect.top - HALO_PX) }}
            onClick={() => finish(false)}
          />
          <div
            className="studio-tour-scrim"
            style={{
              top: rect.top + rect.height + HALO_PX,
              left: 0,
              width: "100vw",
              height: "100vh",
            }}
            onClick={() => finish(false)}
          />
          <div
            className="studio-tour-scrim"
            style={{
              top: Math.max(0, rect.top - HALO_PX),
              left: 0,
              width: Math.max(0, rect.left - HALO_PX),
              height: rect.height + HALO_PX * 2,
            }}
            onClick={() => finish(false)}
          />
          <div
            className="studio-tour-scrim"
            style={{
              top: Math.max(0, rect.top - HALO_PX),
              left: rect.left + rect.width + HALO_PX,
              width: "100vw",
              height: rect.height + HALO_PX * 2,
            }}
            onClick={() => finish(false)}
          />
          <div
            aria-hidden
            className="studio-tour-ring"
            style={{
              top: rect.top - HALO_PX,
              left: rect.left - HALO_PX,
              width: rect.width + HALO_PX * 2,
              height: rect.height + HALO_PX * 2,
            }}
          />
        </>
      ) : (
        <div className="studio-tour-scrim" style={{ inset: 0 }} onClick={() => finish(false)} />
      )}

      <div
        ref={cardRef}
        className="studio-tour-card"
        style={card ? { top: card.top, left: card.left, width: CARD_W } : undefined}
      >
        {/* Points at the control, from whichever edge faces it. Absent only
            when the card had to be laid over the target, where an arrow would
            be pointing at the card's own background. */}
        {card?.arrow ? (
          <span
            aria-hidden
            className={`studio-tour-arrow studio-tour-arrow--${card.arrow}`}
            style={{ left: card.arrowX }}
          />
        ) : null}
        <div className="studio-tour-count">{uiText("Step ")}{index + 1}{uiText(" of ")}{total}
        </div>
        <h2 className="studio-tour-title">{uiText(step.title)}</h2>
        <p className="studio-tour-body">{uiText(step.body)}</p>

        <div className="studio-tour-actions">
          <button type="button" className="studio-tour-skip" onClick={() => finish(false)}>{uiText("Skip tutorial")}</button>
          <div className="studio-tour-nav">
            <button
              type="button"
              className="studio-tour-back"
              onClick={back}
              disabled={index === 0}
            >{uiText("Back")}</button>
            <button ref={nextRef} type="button" className="studio-tour-next" onClick={next}>
              {index + 1 >= total ? uiText("Finish") : uiText("Next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
