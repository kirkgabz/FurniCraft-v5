"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Where the customer actually came from, rather than where each screen guesses
 * they came from.
 *
 * Every "Back" in the customer journey used to be a hardcoded destination:
 * the studio, the type picker and the order summary all pointed at
 * `/protected` no matter what opened them, so browsing into a shop and
 * designing from there returned you to the dashboard root -- losing the shop,
 * and losing which dashboard section you had been on. They were also built
 * three different ways (`<a href>`, `<Link>`, `router.push`), so some of those
 * returns full-reloaded the app and dropped client state on the way out.
 *
 * This records the trail instead. Each surface announces itself on mount, and
 * "Back" reads the entry before it. Re-entering a step you already visited
 * truncates the trail to that point, so moving back and forth cannot grow it
 * without bound.
 *
 * It lives in sessionStorage, which is per-tab and survives a reload: two tabs
 * mid-commission do not overwrite each other, and refreshing the studio does
 * not strand you.
 */

export type PathStep = {
  /** Where this step lives. Include the query when it carries state. */
  href: string;
  /** What the customer would call this step. */
  label: string;
};

/**
 * The commission, named once.
 *
 * The three surfaces of the flow each used to state their own position and
 * their own list of what came next, and they disagreed: the picker listed all
 * four steps, the cart listed one, and the studio rendered no trail at all
 * when it was opened from the picker -- which is how the steps vanished
 * halfway through. Reading the labels from here means a surface can say which
 * step it is and get the rest of the list for free.
 */
export const COMMISSION_STEPS = ["Pick a piece", "Shape it", "Review", "Send to shop"] as const;

export type CommissionStepLabel = (typeof COMMISSION_STEPS)[number];

/** The steps after this one, for CommissionPath's `upcoming`. */
export function stepsAfter(label: CommissionStepLabel): string[] {
  const index = COMMISSION_STEPS.indexOf(label);
  return index < 0 ? [] : COMMISSION_STEPS.slice(index + 1);
}

const STORAGE_KEY = "furnicraft_commission_path";
const EVENT = "furnicraft:commission-path";

function read(): PathStep[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (step): step is PathStep =>
        Boolean(step) &&
        typeof (step as PathStep).href === "string" &&
        typeof (step as PathStep).label === "string"
    );
  } catch {
    return [];
  }
}

function write(steps: PathStep[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
  } catch {
    // A full or disabled sessionStorage costs the trail, never the navigation:
    // every caller still has its own fallback destination.
  }
  // Same-tab listeners; the native `storage` event only fires on other tabs.
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Drops everything from `href` onward, so re-entering a step rewinds to it.
 * Navigating to or from the dashboard root (/protected) resets previous trails
 * so stale items from past designs do not linger as predecessors.
 */
function truncateTo(steps: PathStep[], href: string): PathStep[] {
  if (["/protected", "/protected/shop"].includes(href.split(/[?#]/)[0])) {
    return [];
  }
  const existing = steps.findIndex((step) => step.href === href);
  return existing >= 0 ? steps.slice(0, existing) : steps;
}

/**
 * Announce the current surface and read the trail behind it.
 *
 * Pass `null` for a surface that should read the trail without joining it
 * (a modal, or a screen you never want to return *to*).
 */
export function useCommissionPath(step: PathStep | null) {
  const [trail, setTrail] = useState<PathStep[]>([]);
  const href = step?.href ?? null;
  const label = step?.label ?? null;

  useEffect(() => {
    const sync = () => setTrail(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  useEffect(() => {
    if (!href || !label) return;
    const current = read();
    const rewound = truncateTo(current, href);
    const next = [...rewound, { href, label }];
    // Only write when something actually changed, or every render of a screen
    // that re-renders on state would fire a storage write and an event.
    const unchanged =
      next.length === current.length &&
      next.every((s, i) => s.href === current[i]?.href && s.label === current[i]?.label);
    if (!unchanged) write(next);
    setTrail(next);
  }, [href, label]);

  /** The step before this one, or null at the head of the trail. */
  const previous = trail.length > 1 ? trail[trail.length - 2] : null;

  const returnTo = useCallback(
    (fallback: PathStep) => previous ?? fallback,
    [previous]
  );

  const rewindTo = useCallback((target: string) => {
    write(truncateTo(read(), target));
  }, []);

  const clear = useCallback(() => write([]), []);

  return { trail, previous, returnTo, rewindTo, clear };
}

/**
 * Imperatively add a step to the trail from outside a component that mounts
 * with `useCommissionPath`. Useful for pages like the dashboard that navigate
 * to another route (the shop profile) and need the "Back" on that route to
 * point here rather than at whatever the trail happened to hold before.
 */
export function pushStep(step: PathStep) {
  const current = read();
  const rewound = truncateTo(current, step.href);
  const next = [...rewound, step];
  const unchanged =
    next.length === current.length &&
    next.every((s, i) => s.href === current[i]?.href && s.label === current[i]?.label);
  if (!unchanged) write(next);
}
