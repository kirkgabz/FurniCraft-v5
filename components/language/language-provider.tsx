"use client";

import { useEffect } from "react";
import { ENGLISH_INTERFACE, LanguageContext } from "./language-context";

/** Existing language preferences no longer affect the interface. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = "en";
    try { window.localStorage.removeItem("language"); } catch { /* Storage may be unavailable. */ }
  }, []);
  return <LanguageContext.Provider value={ENGLISH_INTERFACE}>{children}</LanguageContext.Provider>;
}
