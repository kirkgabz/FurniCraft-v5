"use client";

import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { MATERIAL_TAGS, type MaterialTagId } from "@/components/design/studio/material-tags";

const LABELS = new Map(MATERIAL_TAGS.map((tag) => [tag.id, tag.label]));

/** What a piece is made of, as small chips. Renders nothing for a piece with no tags. */
export function MaterialTagChips({
  tags,
  tone = "default",
  className = "",
}: {
  tags: MaterialTagId[];
  /** "onDark" for chips laid over a photo. */
  tone?: "default" | "onDark";
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  if (tags.length === 0) return null;
  return (
    <ul aria-label={uiText("Made with")} className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((id) => (
        <li
          key={id}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5 ${
            tone === "onDark" ? "border-white/35 text-white/90" : "border-[var(--fc-border)] text-[var(--fc-muted)]"
          }`}
        >
          {uiText(LABELS.get(id) ?? id)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Narrow a list to one material. Offers only the tags something in the list
 * actually carries -- a filter that can only ever answer "nothing" is noise --
 * and hides itself when there is nothing to choose between.
 *
 * One row that scrolls sideways on a phone rather than wrapping into a block of
 * chips above the very list it filters.
 */
export function MaterialTagFilter({
  tags,
  value,
  onChange,
  label,
  className = "",
}: {
  tags: MaterialTagId[];
  value: MaterialTagId | null;
  onChange: (next: MaterialTagId | null) => void;
  label: string;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  if (tags.length === 0) return null;
  const options: Array<{ id: MaterialTagId | null; text: string }> = [
    { id: null, text: "Any material" },
    ...tags.map((id) => ({ id, text: LABELS.get(id) ?? id })),
  ];
  return (
    <div role="group" aria-label={uiText(label)} className={`-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 ${className}`}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id ?? "any"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] [@media(pointer:coarse)]:min-h-11 ${
              on
                ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-[var(--fc-ink-accent)]"
                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:border-[var(--fc-accent)] hover:text-[var(--fc-text)]"
            }`}
          >
            {uiText(option.text)}
          </button>
        );
      })}
    </div>
  );
}
