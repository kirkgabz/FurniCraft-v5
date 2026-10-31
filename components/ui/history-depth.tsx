"use client";

import { useEffect } from "react";

/**
 * Stamps every history entry with how deep into THIS app it is, so a Back
 * button can tell whether there is anything of ours behind it.
 *
 * The obvious test for "can I go back" is `window.history.length > 1`, and it
 * is wrong in the case that matters most. A tab that opens a link -- from an
 * email, a notification, a chat -- usually already holds one entry of its own
 * (a new-tab page, or `about:blank`), so `length` reads 2 on what is really
 * the first page of the app. `history.back()` then leaves the app and lands
 * the customer on a blank page, with a Back button that appears to have
 * broken the site. That is exactly what happened on the password-reset screen
 * when this was first built the easy way.
 *
 * The browser exposes no "is the previous entry mine" flag, so this writes
 * one. Each entry gets an `fcDepth`: 0 for the first page of the app in this
 * tab, one higher for each navigation after it. Depth 0 means the only thing
 * behind us belongs to somebody else, and Back should use its fallback
 * destination instead.
 *
 * Mounted once, in the root layout, rather than inside the Back buttons: the
 * count has to advance on EVERY navigation, including the many pages that
 * carry no Back button of their own. Stamping only where a button exists
 * would leave a page that was genuinely two steps in reading as the first.
 *
 * Entries are stamped with `replaceState`, which does not add history and does
 * not navigate -- and the browser preserves history state across a reload, so
 * refreshing a deep page keeps its depth rather than resetting to 0.
 */

/** The key we add to Next's own history state. Namespaced, since we do not own the object. */
const DEPTH_KEY = "fcDepth";
export const APP_NAVIGATION_EVENT = "furnicraft:navigation";

/**
 * Where the running count is kept between hard navigations.
 *
 * Module scope alone is not enough. A full page load -- a plain `<a href>`, a
 * redirect out of the auth flow, a form post -- starts a new JavaScript
 * context and loses the counter, so the page landed on would stamp itself 0
 * and its Back button would offer the fallback instead of the page the
 * customer was just on. sessionStorage is per tab and survives exactly that,
 * which is the shape of the problem.
 */
const SEQ_KEY = "furnicraft_nav_depth";

/**
 * The path recorded at each depth, so Back can see where it would land.
 *
 * `history.back()` is blind -- it cannot be asked what the previous entry is,
 * only told to go there -- and there is one destination that must never be
 * returned to: a sign-in screen. Signing in leaves /auth/login sitting in the
 * history directly behind the dashboard, so the dashboard's own Back button
 * sent people straight back out to the sign-in form. That was reported from the
 * settings section and is not specific to it: it is true of every page you
 * reach immediately after authenticating.
 *
 * Indexed by depth rather than pushed as a stack, so going back and then
 * forward down a different branch overwrites the stale tail instead of
 * leaving it to be read as the future.
 */
const PATHS_KEY = "furnicraft_nav_paths";

/**
 * Routes Back refuses to return to.
 *
 * Only the auth flow, and for one reason: those screens send you somewhere
 * else the moment they succeed, so "the page you were on before" is a page
 * that no longer wants you. Everything else in the app is a legitimate
 * destination.
 */
function isDeadEnd(path: string): boolean {
  return path.startsWith("/auth");
}

function readPaths(): Array<string | null> {
  try {
    const raw = window.sessionStorage.getItem(PATHS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.map((x) => typeof x === "string" ? x : null) : [];
  } catch {
    return [];
  }
}

function recordPath(depth: number, path: string, pushed = false) {
  try {
    const paths = pushed ? readPaths().slice(0, depth) : readPaths();
    paths[depth] = path;
    window.sessionStorage.setItem(PATHS_KEY, JSON.stringify(paths));
  } catch {
    // Losing the record costs Back its dead-end check, so it falls back
    // rather than going back -- the safe direction.
  }
}

/** Where Back would land, or null when there is nothing of ours behind us. */
export function previousPathInApp(): string | null {
  if (typeof window === "undefined") return null;
  const depth = (window.history.state as { fcDepth?: unknown } | null)?.[DEPTH_KEY];
  if (typeof depth !== "number" || depth <= 0) return null;
  return readPaths()[depth - 1] ?? null;
}

/**
 * The depth of the entry we last saw. Module scope rather than a ref because
 * it has to survive this component remounting between routes, which it does:
 * the value is what a newly pushed entry counts up from.
 */
let lastDepth: number | null = null;

function rememberedDepth(): number | null {
  if (lastDepth !== null) return lastDepth;
  try {
    const raw = window.sessionStorage.getItem(SEQ_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    // A blocked or full sessionStorage costs the count across hard loads and
    // nothing else: Back falls back rather than misfiring.
    return null;
  }
}

function remember(depth: number) {
  lastDepth = depth;
  try {
    window.sessionStorage.setItem(SEQ_KEY, String(depth));
  } catch {
    // See above.
  }
}

/**
 * Whether Back should call `history.back()` rather than use its fallback.
 *
 * False at the head of the tab's history, and false when the previous path
 * is unknown or belongs to the auth flow (unless navigating within auth).
 */
export function canGoBackInApp(): boolean {
  if (typeof window === "undefined") return false;
  const depth = (window.history.state as { fcDepth?: unknown } | null)?.[DEPTH_KEY];
  if (typeof depth !== "number" || depth <= 0) return false;
  const previous = readPaths()[depth - 1];
  return Boolean(previous && (!isDeadEnd(previous) || window.location.pathname.startsWith("/auth/")));
}

/** Track native hash/query changes as well as Next route transitions. */
export function trackHistoryDepth(): () => void {
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const path = () => window.location.pathname;
  const depthOf = () => {
    const depth = history.state?.[DEPTH_KEY];
    return typeof depth === "number" && Number.isFinite(depth) && depth >= 0 ? depth : null;
  };
  /**
   * Tells listeners after the current call stack unwinds, never inside it.
   *
   * React calls replaceState from a useInsertionEffect, and an insertion
   * effect may not schedule updates. Dispatching synchronously put every
   * listener inside that effect, so one that answers with setState -- which
   * FurnitureTypePicker does, to follow ?type in the URL -- threw
   * "useInsertionEffect must not schedule updates" and left the picker out
   * of step with the address bar.
   *
   * A microtask runs once React has returned from the commit, by which point
   * location is already the new one, so listeners still read what they
   * expect. Coalesced, because a burst of replaceState calls in one tick is
   * one navigation as far as anyone listening is concerned.
   */
  let announcing = false;
  const announce = () => {
    if (announcing) return;
    announcing = true;
    queueMicrotask(() => {
      announcing = false;
      window.dispatchEvent(new Event(APP_NAVIGATION_EVENT));
    });
  };
  const save = (depth: number, pushed = false) => {
    remember(depth);
    recordPath(depth, path(), pushed);
    announce();
  };
  const stamp = () => {
    let depth = depthOf();
    if (depth === null) {
      const previous = rememberedDepth();
      // A hard navigation counts only when it actually came from this app.
      // Session storage can also survive a visit to an unrelated site.
      const referrer = document.referrer;
      const fromApp = referrer && new URL(referrer).origin === window.location.origin;
      depth = fromApp && previous !== null ? previous + 1 : 0;
      originalReplace.call(history, { ...history.state, [DEPTH_KEY]: depth }, "");
    }
    save(depth);
  };
  stamp();

  const push: History["pushState"] = function (data, unused, url) {
    const depth = (depthOf() ?? 0) + 1;
    originalPush.call(history, { ...data, [DEPTH_KEY]: depth }, unused, url);
    save(depth, true);
  };
  const replace: History["replaceState"] = function (data, unused, url) {
    const depth = depthOf() ?? 0;
    originalReplace.call(history, { ...history.state, ...data, [DEPTH_KEY]: depth }, unused, url);
    save(depth);
  };
  history.pushState = push;
  history.replaceState = replace;
  const onPop = () => onHash();
  const onHash = () => {
    // A native location.hash assignment creates an unstamped entry. Back and
    // Forward reach entries already stamped by pushState or the prior event.
    if (depthOf() === null) {
      const depth = (rememberedDepth() ?? 0) + 1;
      originalReplace.call(history, { ...history.state, [DEPTH_KEY]: depth }, "");
      save(depth, true);
    } else {
      save(depthOf()!);
    }
  };
  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", onHash);
  return () => {
    if (history.pushState === push) history.pushState = originalPush;
    if (history.replaceState === replace) history.replaceState = originalReplace;
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("hashchange", onHash);
  };
}

export default function HistoryDepth() {
  useEffect(trackHistoryDepth, []);
  return null;
}
