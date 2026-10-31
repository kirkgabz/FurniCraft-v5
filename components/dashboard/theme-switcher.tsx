"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useTheme } from "@/components/theme/theme-context";

export function ThemeSwitcher() {
  const { t: uiText } = useUiLanguage();
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn btn-secondary btn-sm"
    >
      {theme === "dark" ? uiText("Light mode") : uiText("Dark mode")}
    </button>
  );
}
