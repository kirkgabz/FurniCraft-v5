/**
 * Theme constants and the pre-paint boot script.
 *
 * Deliberately separate from theme-provider.tsx: the server layout imports
 * THEME_BOOT_SCRIPT, and Next drops out of Fast Refresh into a full page reload
 * whenever a file that exports a React component also exports values consumed
 * from outside the React rendering tree. Keeping these here means editing the
 * provider hot-reloads instead of reloading the page.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME: Theme = "light";

/**
 * Runs before first paint, from the server-rendered document head, so the page
 * never flashes the wrong palette. Kept dependency-free and self-contained
 * because it executes before any bundle has loaded.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(t!=="dark"&&t!=="light"){t=${JSON.stringify(
  DEFAULT_THEME
)};}var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(t);e.style.colorScheme=t;}catch(_){}})();`;
