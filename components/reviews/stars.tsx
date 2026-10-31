"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


/**
 * Star primitives, shared by everything that shows or collects a rating.
 *
 * Two components rather than one with an `editable` flag: a read-only rating is
 * a piece of text and belongs in a <span>, while collecting one is a group of
 * radio buttons and has to be reachable by keyboard. Trying to be both produced
 * a div full of click handlers that a keyboard user could not operate.
 */

const FULL = "★";
const EMPTY = "☆";

/** How the number reads in a sentence: "4.5" but "5", never "5.00". */
export function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A rating as text. `value` may be fractional (an average), in which case it is
 * rounded to the nearest whole star for the glyphs -- the exact figure is
 * printed beside them, so nothing is lost by not drawing half stars.
 */
export function Stars({
  value,
  size = "sm",
  className = "",
}: {
  value: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  const sizeClass = size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-sm";

  return (
    <span
      className={`inline-flex items-center leading-none tracking-[0.08em] text-[#d99a2b] ${sizeClass} ${className}`}
      aria-label={uiText("{0} out of 5 stars", { 0: formatRating(value) })}
    >
      <span aria-hidden>
        {FULL.repeat(filled)}
        <span className="text-[var(--fc-border)]">{EMPTY.repeat(5 - filled)}</span>
      </span>
    </span>
  );
}

/**
 * Collects a rating. Rendered as a radiogroup so arrow keys and screen readers
 * work; the visual is entirely in the labels.
 */
export function StarPicker({
  value,
  onChange,
  disabled = false,
  name = "rating",
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  name?: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <span role="radiogroup" aria-label={uiText("Rating")} className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value;
        return (
          <label
            key={star}
            className={`cursor-pointer text-2xl leading-none transition ${
              disabled ? "cursor-not-allowed opacity-60" : "hover:scale-110"
            } ${active ? "text-[#d99a2b]" : "text-[var(--fc-border)]"}`}
          >
            <input
              type="radio"
              name={name}
              value={star}
              checked={value === star}
              disabled={disabled}
              onChange={() => onChange(star)}
              className="sr-only"
            />
            <span aria-hidden>{active ? FULL : EMPTY}</span>
            <span className="sr-only">{star}{uiText(star === 1 ? " star" : " stars")}</span>
          </label>
        );
      })}
    </span>
  );
}

/**
 * The one-line summary that sits under a shop's name: stars, the average, and
 * how many people it is based on. Renders an invitation instead when a shop has
 * no reviews, because "0.0 ★" reads like a bad score rather than no score.
 */
export function RatingLine({
  average,
  count,
  className = "",
}: {
  average: number | null;
  count: number;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  if (!count || average == null) {
    return <span className={`text-xs text-[var(--fc-muted)] ${className}`}>{uiText("No reviews yet")}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Stars value={average} />
      <span className="text-xs font-semibold text-[var(--fc-text)]">{formatRating(average)}</span>
      <span className="text-xs text-[var(--fc-muted)]">
        ({count}{uiText(count === 1 ? " review" : " reviews")})
      </span>
    </span>
  );
}
