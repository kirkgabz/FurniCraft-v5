"use client";

import { useLanguage } from "./language-context";
import type { TranslationValues } from "./translations";

/** A client boundary for interface copy rendered by Server Components. */
export function UiText({ text, values }: { text: string; values?: TranslationValues }) {
  const { t } = useLanguage();
  return t(text, values);
}
