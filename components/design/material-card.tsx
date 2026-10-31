"use client";
import { materialLabel } from "@/components/language/material-label";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import type { MaterialProfile } from "./studio/materials-db";
import { MaterialSkin } from "./material-skin";

/** A shared visual choice for customer materials and the shop's stock list. */
export default function MaterialCard({ material, selected, onSelect, multiple = false, recommended = false, best = false, reasons = [], cautions = [], goesWith = null, compact = false, label }: {
  material: MaterialProfile;
  selected: boolean;
  onSelect: () => void;
  multiple?: boolean;
  recommended?: boolean;
  /** The advisor's single top pick for this part. */
  best?: boolean;
  /** Why it suits; the first two are shown. */
  reasons?: string[];
  /** Why it may not; the first is shown. */
  cautions?: string[];
  /** The other part it goes with, e.g. "Seat frame". */
  goesWith?: string | null;
  compact?: boolean;
  /** Shown instead of the finish's own name, e.g. its colour when listed under its material. */
  label?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const name = `${uiText(material.family ?? "")}: ${materialLabel(material, uiText)}`;
  const content = <>
    <MaterialSkin material={material} className={compact ? "h-7 w-7" : "h-16"}>
      {selected ? <span className={`absolute grid place-items-center rounded-full bg-[var(--fc-btn)] text-[var(--fc-bg)] shadow-sm ${compact ? "right-0.5 top-0.5 h-4 w-4" : "right-1.5 top-1.5 h-6 w-6"}`}>
        <svg viewBox="0 0 16 16" className={compact ? "h-3 w-3" : "h-4 w-4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7" /></svg>
      </span> : null}
    </MaterialSkin>
    <span className={`block font-semibold leading-snug ${compact ? "min-w-0 text-[11px]" : "mt-2 text-xs"}`}>{uiText(label ?? material.colorName ?? material.name)}</span>
    {best ? <span className="mt-1 inline-block rounded-full bg-[#1e7a4b] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">{uiText("Best match")}</span>
      : recommended ? <span className="mt-1 block text-[10px] font-semibold text-[#1e7a4b]">{uiText("Suits your preferences")}</span> : null}
    {!compact && (best || recommended) && reasons.length ? <span className="mt-0.5 block text-[10px] leading-snug text-[var(--fc-muted)]">{reasons.slice(0, 2).map((reason) => uiText(reason)).join(" · ")}</span> : null}
    {!compact && goesWith && (best || recommended) ? <span className="mt-0.5 block text-[10px] leading-snug text-[var(--fc-muted)]">{uiText("Goes with the {0}", { 0: uiText(goesWith).toLowerCase() })}</span> : null}
    {!compact && cautions.length ? <span className="mt-0.5 block text-[10px] leading-snug text-[var(--fc-danger)]">{uiText(cautions[0])}</span> : null}
  </>;
  const className = `min-w-0 rounded-xl border text-left text-[var(--fc-text)] transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] ${compact ? "flex min-h-11 items-center gap-2 p-1.5" : "block p-2"} ${
    selected ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)]" : "border-[var(--fc-border)] hover:border-[var(--fc-accent)]"
  }`;
  return multiple ? <label className={`${className} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--fc-accent)]`}>
    <input type="checkbox" className="sr-only" checked={selected} onChange={onSelect} aria-label={name} />
    {content}
  </label> : <button type="button" aria-label={name} aria-pressed={selected} onClick={onSelect} className={`${className} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fc-accent)]`}>
    {content}
  </button>;
}
