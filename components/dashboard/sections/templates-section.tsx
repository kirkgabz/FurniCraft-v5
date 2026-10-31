"use client";

import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useId, useMemo, useState } from "react";
import { type CustomerDesign } from "@/components/dashboard/customer-dashboard-types";
import { CustomerDesignCard } from "@/components/dashboard/customer-order-parts";

/** Drafts shown before "Show all": two rows of two on a phone. */
const DRAFT_PREVIEW_COUNT = 4;

export type TemplatesSectionProps = {
  deletingDesignId: string | null;
  draftDesigns: CustomerDesign[];
  handleOpenCustomerDesign: (design: CustomerDesign) => void;
  isDeletingDrafts: boolean;
  isLoadingCustomerDesigns: boolean;
  /** Asks to delete the picked drafts; the dashboard confirms first. */
  onDeleteDrafts: (designs: CustomerDesign[]) => void;
  savedDesigns: CustomerDesign[];
  setDesignPendingDelete: Dispatch<SetStateAction<CustomerDesign | null>>;
};

/**
 * My templates: the customer's drafts and saved designs.
 *
 * The dashboard owns the data and handlers; this section owns its category tabs.
 */
export default function TemplatesSection({
  deletingDesignId,
  draftDesigns,
  handleOpenCustomerDesign,
  isDeletingDrafts,
  isLoadingCustomerDesigns,
  onDeleteDrafts,
  savedDesigns,
  setDesignPendingDelete,
}: TemplatesSectionProps) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const categoryId = useId();
  const [category, setCategory] = useState<"saved" | "draft">("saved");
  const categories = [
    { id: "saved", label: "Saved designs", count: savedDesigns.length, loading: isLoadingCustomerDesigns },
    { id: "draft", label: "Drafts", count: draftDesigns.length, loading: isLoadingCustomerDesigns },
  ] as const;
  // Drafts pile up -- every studio session leaves one -- so only the latest
  // few show until asked. Sixty drafts in full were most of an 18,000px page.
  const [showAllDrafts, setShowAllDrafts] = useState(false);
  const visibleDrafts = showAllDrafts ? draftDesigns : draftDesigns.slice(0, DRAFT_PREVIEW_COUNT);
  // Picked for a bulk delete. Read through the current drafts, so a draft
  // deleted (or a list reloaded) drops out of the selection by itself.
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set());
  const pickedDrafts = useMemo(() => draftDesigns.filter((design) => pickedIds.has(design.id)), [draftDesigns, pickedIds]);
  const allPicked = draftDesigns.length > 0 && pickedDrafts.length === draftDesigns.length;
  const togglePicked = (id: string) =>
    setPickedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section>
      <div
        role="tablist"
        aria-label={uiText("Template categories")}
        className="flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:thin]"
      >
        {categories.map((item, index) => {
          const selected = category === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${categoryId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${categoryId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setCategory(item.id)}
              onKeyDown={(event) => {
                let nextIndex = index;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % categories.length;
                else if (event.key === "ArrowLeft") nextIndex = (index + categories.length - 1) % categories.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = categories.length - 1;
                else return;
                event.preventDefault();
                setCategory(categories[nextIndex].id);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
              }}
              className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 rounded-t-lg px-3 pb-3 pt-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fc-accent)] sm:px-4 ${
                selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:bg-[var(--fc-panel)] hover:text-[var(--fc-text)]"
              }`}
            >
              {uiText(item.label)}
                <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                  selected ? "bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]" : "bg-[var(--fc-border)] text-[var(--fc-muted)]"
                }`}>
                  {item.loading ? "…" : item.count}
                </span>
              {selected ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" /> : null}
            </button>
          );
        })}
      </div>

      {([
        { id: "saved", designs: savedDesigns },
        { id: "draft", designs: visibleDrafts },
      ] as const).map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`${categoryId}-panel-${item.id}`}
          aria-labelledby={`${categoryId}-tab-${item.id}`}
          hidden={category !== item.id}
          tabIndex={0}
          className="pt-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fc-accent)]"
        >
          {isLoadingCustomerDesigns ? (
            <p role="status" className="text-sm text-[var(--fc-muted)]">{uiText("Loading your designs…")}</p>
          ) : item.designs.length === 0 ? (
            <>
              <p className="rounded-2xl border-2 border-dashed border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-4 text-center text-sm font-semibold text-[var(--fc-text)]">{uiText("No design found.")}</p>
              {draftDesigns.length === 0 && savedDesigns.length === 0 ? (
                <button type="button" onClick={() => router.push("/customize-furniture")} className="btn btn-secondary btn-sm mt-3">
                  {uiText("Open the studio")}
                </button>
              ) : null}
            </>
          ) : (
            <>
              {item.id === "draft" ? (
                // "Select all" means every draft, not only the few on screen
                // before "Show all": clearing out a pile is what it is for.
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2">
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--fc-text)]">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      ref={(node) => {
                        if (node) node.indeterminate = pickedDrafts.length > 0 && !allPicked;
                      }}
                      onChange={() => setPickedIds(allPicked ? new Set() : new Set(draftDesigns.map((design) => design.id)))}
                      disabled={isDeletingDrafts}
                      className="h-4 w-4 cursor-pointer accent-[var(--fc-ink-accent)]"
                    />
                    {uiText("Select all ({0})", { 0: draftDesigns.length })}
                  </label>
                  <span className="text-sm tabular-nums text-[var(--fc-muted)]">
                    {uiText("{0} selected", { 0: pickedDrafts.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteDrafts(pickedDrafts)}
                    disabled={pickedDrafts.length === 0 || isDeletingDrafts}
                    className="btn btn-danger-ghost btn-sm ml-auto disabled:opacity-50"
                  >
                    {isDeletingDrafts ? uiText("Deleting…") : uiText("Delete selected")}
                  </button>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {item.designs.map((design) => (
                  <CustomerDesignCard
                    key={design.id}
                    design={design}
                    busy={deletingDesignId === design.id}
                    onOpen={() => handleOpenCustomerDesign(design)}
                    onDelete={() => setDesignPendingDelete(design)}
                    {...(item.id === "draft"
                      ? { selected: pickedIds.has(design.id), onToggleSelect: () => togglePicked(design.id) }
                      : {})}
                  />
                ))}
              </div>
              {item.id === "draft" && draftDesigns.length > DRAFT_PREVIEW_COUNT ? (
                <button
                  type="button"
                  onClick={() => setShowAllDrafts((open) => !open)}
                  aria-expanded={showAllDrafts}
                  className="btn btn-secondary btn-sm mt-3 w-full sm:w-auto"
                >
                  {showAllDrafts ? uiText("Show fewer drafts") : uiText("Show all {0} drafts", { 0: draftDesigns.length })}
                </button>
              ) : null}
            </>
          )}
        </div>
      ))}

    </section>
  );
}
