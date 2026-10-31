"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeContext, type ThemeContextValue } from "./theme-context";
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from "./theme-script";

/**
 * Light/dark theming, replacing next-themes.
 *
 * next-themes renders its "no flash" boot script from inside its own client
 * component, which React 19 warns about -- scripts rendered by a client
 * component are never executed. There is no prop to disable it and 0.4.6 is the
 * latest release, so the small amount of logic involved is owned here instead:
 * THEME_BOOT_SCRIPT (see ./theme-script) is rendered by the server layout to
 * avoid a flash of the wrong palette, and this provider re-asserts the stored
 * choice once it mounts -- the script alone is not enough, see the mount effect.
 *
 * Behaviour matches the previous configuration: class-based switching, light by
 * default, the system preference ignored, and transitions suppressed mid-swap.
 */

/** Applies the theme to the document, without animating the colour change. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;

  // Every themed colour is a CSS variable, so swapping the class would animate
  // each one wherever a transition is set. Suppress transitions for the swap.
  const freeze = document.createElement("style");
  freeze.appendChild(
    document.createTextNode("*,*::before,*::after{transition:none!important;animation:none!important}")
  );
  document.head.appendChild(freeze);

  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;

  // Reading a computed style forces the class change to flush while transitions
  // are still suppressed; without it, removing the node below happens in the
  // same frame and the colours animate anyway. The value itself is discarded --
  // it is parked on the node purely so the read cannot be optimised away.
  freeze.dataset.flush = window.getComputedStyle(document.body).opacity;
  document.head.removeChild(freeze);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts at the default so the first client render matches the server HTML.
  // The boot script has already put the real theme on <html>; the effect below
  // adopts it, which is why the toggle briefly reads as "light" and then
  // corrects rather than causing a visible flash.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    // Read the stored choice rather than the class currently on <html>. The boot
    // script sets that class, but it does not always survive: on a dynamic
    // segment that calls notFound(), React client-renders the shell and resets
    // <html> to what the server tree says, which has no class -- so a dark-mode
    // user would land on a light page. localStorage is the source of truth, so
    // re-assert it here, touching the DOM only when it is actually wrong.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Blocked storage: fall back to whatever the boot script managed to set.
    }
    const active: Theme =
      stored === "dark" || stored === "light"
        ? stored
        : document.documentElement.classList.contains("dark")
          ? "dark"
          : DEFAULT_THEME;

    setThemeState(active);
    if (!document.documentElement.classList.contains(active)) applyTheme(active);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage: the choice just won't persist.
    }
  }, []);

  // Keep other tabs in step, the way next-themes did.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = event.newValue === "dark" ? "dark" : "light";
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

