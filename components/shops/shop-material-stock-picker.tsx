"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useId, useMemo, useState } from "react";
import MaterialCard from "@/components/design/material-card";
import { MaterialSkin } from "@/components/design/material-skin";
import { MATERIALS, MATERIAL_CATEGORIES, type MaterialCategoryId } from "@/components/design/studio/materials-db";
import { materialStockIssues, selectedStockMaterials, STOCK_COLOR_CATEGORIES, STOCK_MATERIALS, stockColorCategory, stockColorLabel } from "@/lib/shops/material-stock";

/** Materials first, then the catalog colors the owner actually supplies. */
export default function ShopMaterialStockPicker({ value, onChange, onValidationChange }: {
  value: string[];
  onChange: (value: string[]) => void;
  onValidationChange: (issues: string[]) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const headingId = useId();
  const [categoryId, setCategoryId] = useState<MaterialCategoryId>("solid-wood");
  // An enabled material with no selected color must remain visible and invalid.
  const [enabledDrafts, setEnabledDrafts] = useState<string[]>([]);
  const enabled = useMemo(() => [...new Set([...selectedStockMaterials(value), ...enabledDrafts])], [value, enabledDrafts]);
  const issues = useMemo(() => materialStockIssues(value, enabled), [value, enabled]);
  const selected = new Set(value);
  const unknown = value.filter((id) => !MATERIALS.some((material) => material.id === id));
  useEffect(() => onValidationChange(issues), [issues, onValidationChange]);
  // What was ticked before "Select all", so a second press undoes it instead
  // of leaving the owner to untick hundreds of colours by hand. Any other
  // change ends the undo: it would no longer be undoing just the select-all.
  const [beforeSelectAll, setBeforeSelectAll] = useState<{ value: string[]; drafts: string[] } | null>(null);

  const setColors = (ids: string[], on: boolean) => {
    setBeforeSelectAll(null);
    const next = new Set(value);
    ids.forEach((id) => on ? next.add(id) : next.delete(id));
    // Preserve old unknown IDs until the owner explicitly removes them.
    onChange([...MATERIALS.filter((material) => next.has(material.id)).map((material) => material.id), ...unknown]);
  };
  return (
    <fieldset aria-labelledby={headingId} aria-describedby={`${headingId}-help ${headingId}-issues`} className="min-w-0">
      <legend id={headingId} className="text-sm font-semibold text-[var(--fc-text)]">{uiText("Available materials and colors ")}<span className="text-fc-danger">{uiText("(required)")}</span></legend>
      <p id={`${headingId}-help`} className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Select each material you can supply locally, then choose its available colors below. Paintable and dyed materials include primary, secondary, pastel, neutral and earth-tone choices. Select at least one color for every material; customers see only your saved choices in the design studio.")}</p>
      <p aria-live="polite" className="mt-2 text-xs font-semibold text-[var(--fc-text)]">{enabled.length}{uiText(" materials selected · ")}{value.length - unknown.length}{uiText(" colors selected")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={beforeSelectAll !== null}
          className="btn btn-ghost text-xs"
          onClick={() => {
            if (beforeSelectAll) {
              setEnabledDrafts(beforeSelectAll.drafts);
              onChange(beforeSelectAll.value);
              setBeforeSelectAll(null);
              return;
            }
            setBeforeSelectAll({ value, drafts: enabledDrafts });
            setEnabledDrafts([]);
            onChange(MATERIALS.map((material) => material.id));
          }}
        >
          {beforeSelectAll ? uiText("Undo select all") : uiText("Select all")}
        </button>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => { setBeforeSelectAll(null); setEnabledDrafts([]); onChange([]); }}>{uiText("Clear selection")}</button>
      </div>
      <div role="group" aria-label={uiText("Material category")} className="my-3 flex flex-wrap gap-2">
        {MATERIAL_CATEGORIES.filter((category) => STOCK_MATERIALS.some((group) => group.category === category.id)).map((category) => (
          <button key={category.id} type="button" aria-pressed={categoryId === category.id} onClick={() => setCategoryId(category.id)} className={`rounded-full border px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fc-accent)] ${categoryId === category.id ? "border-[var(--fc-accent)] bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]" : "border-[var(--fc-border)] text-[var(--fc-text)]"}`}>
            {uiText(category.label)} ({STOCK_MATERIALS.filter((group) => group.category === category.id && enabled.includes(group.id)).length})
          </button>
        ))}
      </div>
      <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-2xl border border-[var(--fc-border)] p-3">
        {STOCK_MATERIALS.filter((group) => group.category === categoryId).map((group) => {
          const checked = enabled.includes(group.id);
          const count = group.colors.filter((color) => selected.has(color.id)).length;
          return <section key={group.id} className="rounded-xl border border-[var(--fc-border)] p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[var(--fc-text)]">
              <input type="checkbox" checked={checked} onChange={() => {
                setBeforeSelectAll(null);
                setEnabledDrafts((prev) => checked ? prev.filter((id) => id !== group.id) : [...prev, group.id]);
                if (checked) setColors(group.colors.map((color) => color.id), false);
              }} className="h-5 w-5 shrink-0 accent-[var(--fc-accent)]" />
              <MaterialSkin material={group.colors.find((color) => !color.baseMaterialId) ?? group.colors[0]} className="h-7 w-7" />
              <span className="flex-1">{uiText(group.label)}</span><span className="text-xs font-normal text-[var(--fc-muted)]">{count}{uiText(" colors")}</span>
            </label>
            {checked ? <div role="group" aria-label={uiText("{0} available colors", { 0: group.label })}>
              <p className={`mb-2 text-xs ${count ? "text-[var(--fc-muted)]" : "font-semibold text-fc-danger"}`}>{uiText("Choose at least one available color (required).")}</p>
              {STOCK_COLOR_CATEGORIES.map((category) => {
                const colors = group.colors.filter((color) => stockColorCategory(color) === category.id);
                if (!colors.length) return null;
                const allOn = colors.every((color) => selected.has(color.id));
                return <div key={category.id} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-[var(--fc-text)]">{uiText(category.label)}</h4>
                    {/* Ticks or clears just this row of colours for just this material. */}
                    <button
                      type="button"
                      aria-label={uiText("{0} {1}: {2}", { 0: allOn ? uiText("Clear") : uiText("Select all"), 1: uiText(group.label), 2: uiText(category.label) })}
                      onClick={() => {
                        setEnabledDrafts((prev) => prev.includes(group.id) ? prev : [...prev, group.id]);
                        setColors(colors.map((color) => color.id), !allOn);
                      }}
                      className="rounded-full px-2 py-1 text-[11px] font-semibold text-[var(--fc-ink-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]"
                    >
                      {allOn ? uiText("Clear") : uiText("Select all")}
                    </button>
                  </div>
                  <p className="mb-2 text-[11px] text-[var(--fc-muted)]">{uiText(category.description)}</p>
                  <div className="grid grid-cols-2 gap-2">{colors.map((color) => <MaterialCard key={color.id} material={color} label={stockColorLabel(color)} multiple compact selected={selected.has(color.id)} onSelect={() => {
                    setEnabledDrafts((prev) => prev.includes(group.id) ? prev : [...prev, group.id]);
                    setColors([color.id], !selected.has(color.id));
                  }} />)}</div>
                </div>;
              })}
            </div> : null}
          </section>;
        })}
      </div>
      <div id={`${headingId}-issues`} aria-live="polite" className="mt-3 text-xs text-fc-danger">
        {issues.length ? <ul className="list-inside list-disc">{issues.map((issue) => <li key={issue}>{uiText(issue)}</li>)}</ul> : <p className="text-[var(--fc-muted)]">{uiText("Every selected material has at least one available color.")}</p>}
        {unknown.length ? <button type="button" className="mt-2 underline" onClick={() => onChange(value.filter((id) => !unknown.includes(id)))}>{uiText("Remove unavailable catalog colors")}</button> : null}
      </div>
    </fieldset>
  );
}
