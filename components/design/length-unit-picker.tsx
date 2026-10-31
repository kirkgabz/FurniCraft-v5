"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import {
  LENGTH_UNITS,
  DEFAULT_LENGTH_UNIT,
  readPreferredLengthUnit,
  writePreferredLengthUnit,
  type LengthUnit,
} from "./length-units";

/**
 * The unit a reader prefers, remembered on their device.
 *
 * Starts at centimetres on the server and in the first render, then picks up
 * the remembered choice once mounted, so the server and client agree on the
 * first paint. Every picker on the page shares the stored choice: whoever
 * reads blueprints in inches reads the order table in inches too.
 */
export function usePreferredLengthUnit(): [LengthUnit, (unit: LengthUnit) => void] {
  const [unit, setUnit] = useState<LengthUnit>(DEFAULT_LENGTH_UNIT);
  useEffect(() => setUnit(readPreferredLengthUnit()), []);
  const choose = (next: LengthUnit) => {
    setUnit(next);
    writePreferredLengthUnit(next);
  };
  return [unit, choose];
}

/** cm, mm, m, in, ft-in -- as a row of choices, or as a dropdown where there is no room for one. */
export default function LengthUnitPicker({
  value,
  onChange,
  tone = "app",
  variant = "radios",
}: {
  value: LengthUnit;
  onChange: (unit: LengthUnit) => void;
  /** "sheet" sits on the white drawing sheet, "app" on the app's own panels. */
  tone?: "app" | "sheet";
  /**
   * "radios" is the pill of five, for anywhere with a line to spare.
   *
   * "select" is for the places that have not got one: in the order detail's
   * spec header the pill sits beside the scale readout inside a column that
   * is half a modal wide, so the five options wrapped onto a second line and
   * the control read as two broken rows rather than one choice. A native
   * select is one line at any width, and on a phone it opens the system
   * picker instead of asking a thumb to find a 36px pill.
   */
  variant?: "radios" | "select";
}) {
  const { t: uiText } = useUiLanguage();
  const sheet = tone === "sheet";

  if (variant === "select") {
    return (
      <label className="inline-flex items-center">
        <span className="sr-only">{uiText("Measurement unit")}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as LengthUnit)}
          /* 16px below sm so iOS does not zoom the page when it takes focus,
             and min-h-11 so the tap target clears the thumb minimum. */
          className={`min-h-11 cursor-pointer rounded-full border bg-transparent py-1 pl-3 pr-2 text-[16px] font-semibold outline-none transition-colors duration-150 sm:min-h-0 sm:py-1.5 sm:text-xs ${
            sheet
              ? "border-[#1f3d5c]/30 text-[#14293d] focus:border-[#1f3d5c]"
              : "border-[var(--fc-border)] text-[var(--fc-text)] focus:border-[var(--fc-accent)]"
          }`}
        >
          {LENGTH_UNITS.map((option) => (
            <option key={option.id} value={option.id}>
              {uiText(option.name)} ({uiText(option.label)})
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={uiText("Measurement unit")}
      className={`inline-flex flex-wrap rounded-full border p-0.5 text-xs font-semibold ${
        sheet ? "border-[#1f3d5c]/30" : "border-[var(--fc-border)]"
      }`}
    >
      {LENGTH_UNITS.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={uiText(option.name)}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
              on
                ? sheet
                  ? "bg-[#1f3d5c] text-white"
                  : "bg-fc-btn text-fc-btn-fg"
                : sheet
                  ? "text-[#5b7590] hover:text-[#14293d]"
                  : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
            }`}
          >
            {uiText(option.label)}
          </button>
        );
      })}
    </div>
  );
}
