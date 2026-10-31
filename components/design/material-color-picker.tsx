"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useMemo, useState } from "react";
import { MaterialSkin } from "./material-skin";
import { materialById, type MaterialProfile } from "./studio/materials-db";
import { STOCK_COLOR_CATEGORIES, stockColorCategory, stockColorLabel, stockMaterialGroup } from "@/lib/shops/material-stock";

type Entry = {
  material: MaterialProfile;
  recommended?: boolean;
  best?: boolean;
  reasons?: string[];
  cautions?: string[];
  goesWith?: string | null;
};

/**
 * Choose a material, then one of its colours -- one step at a time.
 *
 * This used to show everything at once: a wrapping row of categories, a
 * scrolling list of materials, and under it a second scrolling list of every
 * colour in labelled groups with a sentence each. Two scroll boxes inside a
 * scrolling sidebar is what made the panel feel endless.
 *
 * Now it is a drill-down. The first step is the materials of one category as a
 * compact grid; picking one opens its colours as swatches, with a way back. A
 * material with a single finish is chosen straight from the grid. Nothing
 * scrolls inside the panel, and browsing never changes the design -- only
 * picking a colour does.
 */
export default function MaterialColorPicker({
  materials,
  selectedId,
  selectedHex,
  onSelect,
  categories = [],
  activeCategory,
  onCategory,
}: {
  materials: Entry[];
  selectedId?: string;
  selectedHex?: string;
  onSelect: (material: MaterialProfile) => void;
  /** The kinds of stock this part can take; a row of them shows when there is more than one. */
  categories?: Array<{ id: string; label: string; count: number; suits: boolean }>;
  activeCategory?: string | null;
  onCategory?: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();

  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; items: Entry[] }>();
    for (const entry of materials) {
      const group = stockMaterialGroup(entry.material);
      const current = grouped.get(group.id);
      if (current) current.items.push(entry);
      else grouped.set(group.id, { ...group, items: [entry] });
    }
    return [...grouped.values()];
  }, [materials]);

  const selected = materialById(selectedId);
  const selectedGroupId = selected ? stockMaterialGroup(selected).id : null;
  const isChosen = (material: MaterialProfile) =>
    selectedId === material.id || (!selectedId && selectedHex?.toLowerCase() === material.hex.toLowerCase());

  // Opens on the colours of what the part is already in, which is the change
  // most often wanted; otherwise on the materials.
  const [openGroupId, setOpenGroupId] = useState<string | null>(() =>
    selectedGroupId && groups.some((group) => group.id === selectedGroupId && group.items.length > 1) ? selectedGroupId : null
  );
  const open = groups.find((group) => group.id === openGroupId) ?? null;

  if (!groups.length) return null;

  // ---------------------------------------------------------- step 2: colours
  if (open) {
    return (
      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenGroupId(null)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--fc-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fc-muted)] transition-colors hover:text-[var(--fc-text)] [@media(pointer:coarse)]:min-h-11"
          >
            <span aria-hidden>←</span> {uiText("Materials")}
          </button>
          <p className="min-w-0 truncate text-sm font-bold text-[var(--fc-text)]">{uiText(open.label)}</p>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--fc-muted)]">
            {uiText("{0} colors", { 0: open.items.length })}
          </span>
        </div>

        <div role="group" aria-label={uiText("{0} colors", { 0: open.label })} className="mt-2.5 space-y-2.5">
          {STOCK_COLOR_CATEGORIES.map((category) => {
            const colors = open.items.filter(({ material }) => stockColorCategory(material) === category.id);
            if (!colors.length) return null;
            return (
              <section key={category.id}>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">{uiText(category.label)}</h4>
                <div className="mt-1.5 grid grid-cols-5 gap-x-1.5 gap-y-2">
                  {colors.map(({ material, best, recommended }) => {
                    const chosen = isChosen(material);
                    const name = stockColorLabel(material);
                    return (
                      <button
                        key={material.id}
                        type="button"
                        aria-pressed={chosen}
                        title={uiText(name)}
                        onClick={() => onSelect(material)}
                        className="group flex min-w-0 flex-col items-center gap-1 rounded-lg p-0.5 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fc-accent)]"
                      >
                        <span className={`relative rounded-full p-0.5 ${chosen ? "ring-2 ring-[var(--fc-ink-accent)]" : "ring-1 ring-transparent group-hover:ring-[var(--fc-border)]"}`}>
                          <MaterialSkin material={material} className="h-9 w-9 rounded-full" />
                          {best || recommended ? (
                            <span aria-label={uiText(best ? "Best match" : "Suits your preferences")} className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--fc-panel)] bg-[#1e7a4b]" />
                          ) : null}
                        </span>
                        <span className={`w-full truncate text-[10px] leading-tight ${chosen ? "font-bold text-[var(--fc-ink-accent)]" : "text-[var(--fc-muted)]"}`}>
                          {uiText(name)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------- step 1: materials
  return (
    <div className="mt-3 min-w-0">
      {categories.length > 1 ? (
        // One line that scrolls sideways instead of wrapping onto three.
        <div
          role="group"
          aria-label={uiText("Material category")}
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {categories.map((category) => {
            const on = category.id === activeCategory;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={on}
                onClick={() => onCategory?.(category.id)}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors [@media(pointer:coarse)]:min-h-11 ${
                  on
                    ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                    : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                }`}
              >
                {category.suits ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#1e7a4b]" /> : null}
                {uiText(category.label)}
                <span className="tabular-nums opacity-70">{category.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div role="group" aria-label={uiText("Choose material")} className="mt-2 grid grid-cols-2 gap-1.5">
        {groups.map((group) => {
          const current = group.id === selectedGroupId;
          const single = group.items.length === 1;
          const shown =
            group.items.find(({ material }) => material.id === selectedId)?.material ??
            group.items.find(({ material }) => !material.baseMaterialId)?.material ??
            group.items[0].material;
          const best = group.items.some((entry) => entry.best);
          const suits = !best && group.items.some((entry) => entry.recommended);
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={current}
              onClick={() => (single ? onSelect(group.items[0].material) : setOpenGroupId(group.id))}
              className={`flex min-w-0 items-center gap-2 rounded-xl border p-1.5 pr-2 text-left transition-colors [@media(pointer:coarse)]:min-h-11 ${
                current
                  ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)]"
                  : "border-[var(--fc-border)] hover:bg-[rgba(178,106,56,0.06)]"
              }`}
            >
              <MaterialSkin material={shown} className="h-8 w-8" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs font-semibold ${current ? "text-[var(--fc-ink-accent)]" : "text-[var(--fc-text)]"}`}>
                  {uiText(group.label)}
                </span>
                <span className="block truncate text-[10px] text-[var(--fc-muted)]">
                  {single ? uiText(stockColorLabel(shown)) : uiText("{0} colors", { 0: group.items.length })}
                </span>
              </span>
              {best ? (
                <span className="shrink-0 rounded-full bg-[#1e7a4b] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">{uiText("Best")}</span>
              ) : suits ? (
                <span aria-label={uiText("Suits your preferences")} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#1e7a4b]" />
              ) : !single ? (
                <span aria-hidden className="shrink-0 text-xs text-[var(--fc-muted)]">›</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
