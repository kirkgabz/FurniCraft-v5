"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useId, useState } from "react";
import MaterialCard from "@/components/design/material-card";
import { MaterialSkin } from "@/components/design/material-skin";
import {
  MATERIALS,
  groupByCategory,
  type MaterialCategoryId,
} from "@/components/design/studio/materials-db";

/**
 * Which finishes a shop will build a template in.
 *
 * One picker for every place a shop sets this -- the dashboard's publish and
 * edit form, and the storefront's edit form. They used to be written twice,
 * looked nothing alike, and one of them showed no colours at all.
 *
 * Select only materials and colours the furniture shop can supply. An empty stock
 * list is unconfirmed; checkout requires a declared list before ordering.
 */

/**
 * The catalogue by category, then by family, computed once.
 *
 * The same categories the studio opens with, so a shop ticking its stock and a
 * customer choosing from it are looking at the same sections. One category is
 * shown at a time: the whole catalogue as one ticked list ran to sixty-odd
 * chips in a scrolling box, and a shop that only wanted to untick its metals
 * had to scroll past every timber to reach them. The category chips carry their
 * own ticked counts, so what is hidden is still accounted for.
 */
const CATEGORIES = groupByCategory(
  MATERIALS,
  MATERIALS.map((material) => ({ material }))
).map(({ category, label, families }) => ({
  category,
  label,
  ids: families.flatMap(({ items }) => items.map(({ material }) => material.id)),
  families: families.map(({ family, items }) => ({
    label: family ?? label,
    materials: items.map(({ material }) => material),
  })),
}));

const ALL_IDS = MATERIALS.map((material) => material.id);

const PILL =
  "rounded-full border border-[var(--fc-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fc-ink-accent)] transition-[background-color,border-color,transform,opacity] duration-150 ease-out hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
const GROUP_TOGGLE =
  "rounded-full px-2 py-0.5 text-[11px] font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.97]";

export default function AllowedFinishesPicker({
  value,
  onChange,
  label = "Materials and colors you can supply",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const headingId = useId();
  const [categoryId, setCategoryId] = useState<MaterialCategoryId>(CATEGORIES[0].category);
  const category = CATEGORIES.find((entry) => entry.category === categoryId) ?? CATEGORIES[0];
  const categoryAllOn = category.ids.every((id) => value.includes(id));
  const selected = new Set(value);
  const total = ALL_IDS.length;

  const summary =
    value.length === 0
      ? "No materials declared. Customers can preview, but must confirm stock before ordering."
      : value.length === total
        ? "Every material and color selected. Keep only stock you can supply."
        : `Customers can pick from the ${value.length} material colors you can supply.`;

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(value);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    // Kept in catalogue order, so the saved list reads the way the picker does.
    onChange(ALL_IDS.filter((id) => next.has(id)));
  };

  return (
    <fieldset aria-labelledby={headingId} className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={headingId} className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">
          {uiText(label)}
        </span>
        <div className="flex gap-1.5">
          <button type="button" className={PILL} disabled={value.length === total} onClick={() => onChange(ALL_IDS)}>{uiText("Select all")}</button>
          <button type="button" className={PILL} disabled={value.length === 0} onClick={() => onChange([])}>{uiText("Clear")}</button>
        </div>
      </div>
      <p aria-live="polite" className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("Select only materials and colors you can supply locally. ")}{uiText(summary)}
      </p>

      {/* First the category, then its finishes. Each chip shows how many of its
          finishes are ticked, so a category the shop has not opened still says
          whether anything in it is offered. */}
      <div role="group" aria-label={uiText("Material category")} className="mt-2 flex flex-wrap gap-1.5">
        {CATEGORIES.map((entry) => {
          const on = entry.category === category.category;
          const ticked = entry.ids.filter((id) => selected.has(id)).length;
          return (
            <button
              key={entry.category}
              type="button"
              aria-pressed={on}
              onClick={() => setCategoryId(entry.category)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
                on
                  ? "border-[var(--fc-btn)] bg-[var(--fc-btn)] text-[var(--fc-bg)]"
                  : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:border-[var(--fc-accent)] hover:text-[var(--fc-text)]"
              }`}
            >
              {uiText(entry.label)}{" "}
              <span className="font-mono tabular-nums opacity-80">
                {ticked}/{entry.ids.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-2xl border border-[var(--fc-border)] p-3">
        {category.families.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[var(--fc-text)]">{uiText(category.label)}</span>
            <button
              type="button"
              className={GROUP_TOGGLE}
              aria-label={uiText("{0} {1} finishes", { 0: categoryAllOn ? "Clear" : "Select all", 1: category.label.toLowerCase() })}
              onClick={() => setMany(category.ids, !categoryAllOn)}
            >
              {categoryAllOn ? uiText("Clear category") : uiText("Select all")}
            </button>
          </div>
        ) : null}
        {category.families.map(({ label: groupLabel, materials }) => {
          const onCount = materials.filter((material) => selected.has(material.id)).length;
          const allOn = onCount === materials.length;
          return (
            <section key={groupLabel} role="group" aria-label={uiText(groupLabel)}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
                  <MaterialSkin material={materials.find((material) => !material.baseMaterialId) ?? materials[0]} className="h-7 w-7" />
                  {uiText(groupLabel)}{" "}
                  <span className="font-mono font-semibold tabular-nums">
                    {onCount}/{materials.length}
                  </span>
                </h4>
                <button
                  type="button"
                  className={GROUP_TOGGLE}
                  aria-label={uiText("{0} {1} finishes", { 0: allOn ? "Clear" : "Select all", 1: groupLabel.toLowerCase() })}
                  onClick={() => setMany(materials.map((material) => material.id), !allOn)}
                >
                  {allOn ? uiText("Clear") : uiText("Select all")}
                </button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {materials.map((material) => (
                  <MaterialCard
                    key={material.id}
                    material={material}
                    multiple
                    compact
                    selected={selected.has(material.id)}
                    onSelect={() => setMany([material.id], !selected.has(material.id))}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </fieldset>
  );
}
