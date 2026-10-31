"use client";

import { createContext, useContext } from "react";

import type { Theme } from "./theme-script";

/**
 * The context and its hook live apart from ThemeProvider on purpose. React
 * Refresh only hot-updates a module whose exports are all components, so while
 * useTheme sat alongside ThemeProvider every edit to the provider forced a full
 * page reload -- measured, not assumed. Splitting them keeps Fast Refresh.
 */

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return context;
}
