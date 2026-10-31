import type { Language } from "./language-context";

export type TranslationValues = Record<string, string | number | null | undefined>;

/** Format English interface copy without changing submitted values. */
export function translate(language: Language, key: string, values: TranslationValues = {}): string {
  // The public signature stays compatible with existing English callers.
  void language;
  return key.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name] ?? "") : token
  );
}
