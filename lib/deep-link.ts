"use client";

import { useEffect, useRef } from "react";

/**
 * Opening a notification that points at the page you are already on.
 *
 * The dashboards read `?section=` and `?shop=` once, on mount, deliberately:
 * `useSearchParams` opts a route out of static prerendering unless it is
 * wrapped in Suspense, and arrival is the only moment those params normally
 * matter. That holds right up until a notification links to the page the
 * customer is already looking at -- then `router.push` performs a client
 * navigation that never remounts the component, the mount effect does not run
 * again, and the notification appears to do nothing.
 *
 * So same-page links are delivered as an event instead of a navigation. The
 * page applies them from its own handler, which is the same code path arrival
 * uses.
 *
 * Nothing here touches history. Rewriting the URL underneath the App Router
 * with `pushState`/`replaceState` desynchronises Next's own history state,
 * which is what makes the back button start skipping entries.
 */

export const DEEP_LINK_EVENT = "furnicraft:deep-link";

type Router = { push: (href: string) => void };

/**
 * Send the visitor to `href`, whether or not it is the page they are on.
 *
 * Cross-page links go through the router as normal. Same-page links are
 * announced to whoever is listening, because the router alone cannot deliver
 * them.
 */
export function followDeepLink(router: Router, href: string) {
  if (typeof window === "undefined") return;

  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    router.push(href);
    return;
  }

  if (url.pathname !== window.location.pathname) {
    router.push(href);
    return;
  }

  window.dispatchEvent(new CustomEvent(DEEP_LINK_EVENT, { detail: url.search }));
}

/**
 * Run `apply` for the params this page arrived with, and again whenever a
 * same-page deep link is followed.
 *
 * `apply` receives the query string, so a caller reads exactly the keys it
 * knows about and ignores the rest.
 */
export function useDeepLink(apply: (params: URLSearchParams) => void) {
  /**
   * The query this page instance arrived with, captured once per mount and
   * kept for as long as this component stays mounted.
   *
   * Callers apply the arrival params and then clear the address bar, so the
   * effect destroys its own input. React runs mount effects twice in
   * development: the first pass consumed `?section=orders` and stripped it,
   * the second found an empty query and applied nothing, and the section fell
   * back to its initial value -- a deep link visibly did nothing while having
   * plainly been processed. Reading through a ref makes the effect idempotent
   * across that: both passes see the query this mount arrived with, whatever
   * has happened to the URL in between.
   *
   * This was module-scoped rather than a ref for exactly one wrong reason:
   * "module scope is one document" is true for a page that full-reloads
   * between navigations, and false the moment the App Router moves between
   * two pages that both call this hook without one -- the second page's
   * mount read the FIRST page's already-consumed (and by then irrelevant)
   * cached search, because the module had never been reloaded to clear it.
   * A ref fixes that for free: it is scoped to this component instance, so a
   * genuine unmount-and-remount onto a new page starts with a clean `null`,
   * while a same-instance Strict Mode double-invoke still shares the one
   * value set on its first pass.
   */
  const arrivalSearchRef = useRef<string | null>(null);
  /**
   * True only for the instant after an arrival is applied: long enough for
   * React's Strict Mode re-run of this effect to replay it, and no longer.
   *
   * Next keeps a page you leave alive but hidden, and shows that same instance
   * again when you come back, re-running its effects -- the dashboard is not
   * remounted on the way back from a shop page. With the arrival captured once
   * per mount, Message on a shop's page landed on /protected?section=messages&
   * shop=... and the dashboard re-applied the query it had first arrived with
   * (usually none), so it stayed on whatever section it was on and no chat
   * opened. So the URL is read again on every run: a query present now is a
   * new arrival. An empty one replays the previous arrival only within that
   * Strict Mode instant; a page shown again later with nothing in its address
   * is left on the section it was on, not thrown back to an old link.
   */
  const replayRef = useRef(false);

  useEffect(() => {
    const search = window.location.search;
    if (search) {
      arrivalSearchRef.current = search;
      apply(new URLSearchParams(search));
      replayRef.current = true;
      // A macrotask: Strict Mode's second pass runs inside the same commit.
      window.setTimeout(() => {
        replayRef.current = false;
      }, 0);
    } else if (replayRef.current && arrivalSearchRef.current) {
      apply(new URLSearchParams(arrivalSearchRef.current));
    }

    const onDeepLink = (event: Event) => {
      const search = (event as CustomEvent<string>).detail ?? "";
      apply(new URLSearchParams(search));
    };

    window.addEventListener(DEEP_LINK_EVENT, onDeepLink);
    return () => window.removeEventListener(DEEP_LINK_EVENT, onDeepLink);
    // `apply` is expected to be stable (useCallback) or intentionally fresh;
    // re-subscribing on identity change is cheap and keeps it current.
  }, [apply]);
}
