/**
 * What the studio tour says, and where it points.
 *
 * One list for every piece in the studio, not one per furniture type. Each
 * step names a control by its `data-tour` attribute, and StudioTour drops any
 * step whose control is not on the page before it starts -- so a chair simply
 * has no "Open the drawers" step, a customer has no "Publish as Template", and
 * a phone, where the analysis card is not rendered, has no analysis step. A
 * list per model would be eleven lists to keep in step with one another, and
 * ten of them would be wrong within a month of the next control being added.
 *
 * The wording is about what the control is FOR, not what it is called. A tour
 * that says "the Ruler button shows the ruler" has spent the reader's
 * attention and taught them nothing they could not read off the button.
 *
 * Kept apart from the component so the copy can be read, counted and checked
 * without a browser -- see scripts/verify-studio-tour.mts.
 */

import type { TourStep } from "./studio-tour";

export type StudioTourStep = TourStep & {
  /**
   * Whether the control only exists once a part is chosen. The studio supplies
   * the `onEnter` that does the choosing, because only it knows the parts.
   */
  needsSelection?: boolean;
};

export const STUDIO_TOUR_STEPS: StudioTourStep[] = [
  {
    id: "viewport",
    target: "viewport",
    title: "This is your piece",
    body:
      "Drag to turn it, scroll or pinch to zoom, and click any part of the piece itself to select it. " +
      "Everything you change is shown here at the real proportions a furniture shop would build to.",
    placement: "bottom",
  },
  {
    id: "parts",
    target: "parts",
    title: "Every part, listed",
    body:
      "The same parts you can click on the model. Pick one here to work on it, or use the eye to hide it " +
      "while you look at what is behind it — a hidden part is still built, still measured and still priced.",
  },
  {
    id: "finish",
    target: "finish",
    needsSelection: true,
    title: "Choose the material",
    body:
      "Real stock a Philippine furniture shop can buy — narra, kamagong, cane, glass, brass. Not sure? " +
      "“Help me choose” asks who the piece is for and what the room is like, then ranks the list for you.",
  },
  {
    id: "size",
    target: "size",
    needsSelection: true,
    title: "Change its dimensions",
    body:
      "Every slider is in centimetres and moves the real geometry, not a picture of it. The measurements " +
      "above update as you go, so you can build to a space you have already measured.",
  },
  {
    id: "analysis",
    target: "analysis",
    title: "Whether it will hold up",
    body:
      "Durability and material quality, worked out from the timber you chose and how thin you have made " +
      "things. If a leg gets too slender for the piece it carries, this is where you find out.",
  },
  {
    id: "measurements",
    target: "measurements",
    title: "The numbers that matter",
    body:
      "Overall size, and the one height that matters for this piece — seat, worktop or mattress — both " +
      "live. There is no price here on purpose: you give your budget when you send the design, and the " +
      "shop quotes it against their own materials.",
  },
  {
    id: "name",
    target: "name",
    title: "Name it",
    body: "What this design is called in your templates, in your cart and on the sheet the furniture shop builds from.",
  },
  {
    id: "ruler",
    target: "ruler",
    title: "Measure it on screen",
    body: "Lays width, height and depth onto the piece itself, so you can check a dimension without reading a slider.",
  },
  {
    id: "rotate",
    target: "rotate",
    title: "Turn it slowly",
    body: "Spins the piece so you can see every side without dragging. Press it again to stop.",
  },
  {
    id: "open-doors",
    target: "open-doors",
    title: "Look inside",
    body: "Opens the doors and drawers so you can see the compartments and how deep they are.",
  },
  {
    id: "blueprint",
    target: "blueprint",
    title: "The shop drawing",
    body:
      "A dimensioned elevation and plan with a component schedule — the drawing a carpenter actually works " +
      "from. Print it, or send it with the order.",
  },
  {
    id: "reset",
    target: "reset",
    title: "Start again",
    body: "Puts every part back to how the piece began. Only available once you have changed something.",
  },
  {
    id: "save",
    target: "save",
    title: "Keep it for later",
    body: "Saves the design to My templates under a name, so you can come back and carry on another day.",
  },
  {
    id: "publish",
    target: "publish",
    title: "Publish to your shop",
    body:
      "Shop owners only: puts this design on your storefront as a starting point customers can open in the " +
      "studio and make their own.",
  },
  {
    id: "cart",
    target: "cart",
    title: "Pieces you have added",
    body:
      "A commission is rarely one object. The cart holds the pieces you have finished so they reach a shop " +
      "as one order rather than six.",
  },
  {
    id: "add-to-cart",
    target: "add-to-cart",
    title: "Add this piece",
    body:
      "Puts this design in the cart with a quantity. From there you choose a shop, give your budget, and send " +
      "it — and they come back to you with a quote.",
  },
  {
    id: "buy-now",
    target: "buy-now",
    title: "Or buy just this one now",
    body:
      "Skips the cart: choose how many, then go straight to checkout with only this piece. Pick the shop, " +
      "give your budget and send it there. Anything already in your cart stays exactly where it is.",
  },
  {
    id: "back",
    target: "back",
    title: "Build something else",
    body: "Back to the pieces you can start from. Anything in your cart stays there.",
    placement: "bottom",
  },
  {
    // Phone and tablet only: the desktop toolbar shows these as buttons, so
    // there this step has nothing to point at and is dropped.
    id: "more",
    target: "more",
    title: "Everything else",
    body: "The blueprint, saving under a name, starting over, and this tour again are all in here.",
    placement: "bottom",
  },
  {
    id: "tutorial",
    target: "tutorial",
    title: "That is the whole studio",
    body: "Press this whenever you want the tour again — it will not start on its own after this.",
    placement: "bottom",
  },
];

/**
 * When the tour opens by itself, and when it stops.
 *
 * Two facts, both per-device and both in localStorage rather than the
 * database: they are about one person's first day with the studio, not about
 * the account, and somebody opening the studio on a new phone has genuinely
 * not been shown it there.
 *
 *   SEEN_KEY   -- they finished it or skipped it
 *   FIRST_KEY  -- when this device first reached a loaded studio
 *
 * The rule is: a new arrival gets it without asking, and after a day it is
 * theirs to ask for. Both halves matter. Showing it once and never again
 * loses anyone who closed it by accident on their first minute; showing it on
 * every visit forever is the thing every person reading this has closed
 * angrily on some other product.
 *
 * So it opens by itself while BOTH are true: not yet dismissed, and within a
 * day of the first visit. After that the Tutorial button is the only way in,
 * which is what it is for.
 *
 * Every access is wrapped. A private window, cleared site data, or a browser
 * set to block storage all throw rather than returning empty, and the studio
 * must open regardless. A failed read means "not seen, first visit is now",
 * which shows the tour to somebody who may have seen it -- the harmless
 * direction, and the only one that cannot hide the studio behind an error.
 */
const SEEN_KEY = "furnicraft_studio_tour_seen_v1";
const FIRST_KEY = "furnicraft_studio_tour_first_v1";

/** How long the tour keeps offering itself to somebody new. */
export const STUDIO_TOUR_GRACE_MS = 24 * 60 * 60 * 1000;

export function hasSeenStudioTour(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markStudioTourSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do: the tour will offer itself again next time, which is a
    // better failure than the studio refusing to open.
  }
}

/**
 * Decides it, and records the first visit while it is here.
 *
 * The decision itself is `studioTourAutoOpens` below, which takes the two
 * facts as arguments so it can be exercised without a browser or a clock.
 */
export function shouldAutoOpenStudioTour(now: number = Date.now()): boolean {
  let firstAt: number | null = null;
  try {
    const stored = window.localStorage.getItem(FIRST_KEY);
    const parsed = stored === null ? Number.NaN : Number(stored);
    firstAt = Number.isFinite(parsed) ? parsed : null;
    if (firstAt === null) window.localStorage.setItem(FIRST_KEY, String(now));
  } catch {
    firstAt = null;
  }
  return studioTourAutoOpens({ seen: hasSeenStudioTour(), firstAt, now });
}

export function studioTourAutoOpens({
  seen,
  firstAt,
  now,
}: {
  seen: boolean;
  /** Null on the very first visit, or when storage cannot be read. */
  firstAt: number | null;
  now: number;
}): boolean {
  if (seen) return false;
  // No record yet: this IS the first visit, which is the one it must not miss.
  if (firstAt === null) return true;
  // A clock that has gone backwards, or a stored time in the future, would
  // otherwise read as "the grace period has not started" forever.
  if (firstAt > now) return true;
  return now - firstAt < STUDIO_TOUR_GRACE_MS;
}
