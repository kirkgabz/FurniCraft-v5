"use client";

import { createContext, useContext } from "react";
import { translate, type TranslationValues } from "./translations";

export type Language = "en";
export type LanguageContextValue = {
  language: Language;
  locale: "en-PH";
  t: (key: string, values?: TranslationValues) => string;
};

/** English copy and Philippine number/date formatting across every role. */
export const ENGLISH_INTERFACE: LanguageContextValue = {
  language: "en",
  locale: "en-PH",
  t: (key, values) => translate("en", key, values),
};
export const LanguageContext = createContext(ENGLISH_INTERFACE);

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
