"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useId } from "react";

/**
 * A phone field with the country picked rather than typed.
 *
 * Every phone input here was a bare text box with a "+63 …" placeholder, which
 * is a hint, not a control: it neither helps someone outside the Philippines nor
 * stops anyone entering a number in whichever shape they please. The stored
 * value keeps its single-column text form -- "+63 9171234567" -- so nothing in
 * the database or the rest of the app changes; only the way it is entered does.
 *
 * The list is short on purpose. It covers the Philippines and the countries its
 * diaspora and trade actually run through, rather than all 195 in a select
 * nobody can scroll. Add a row when someone needs one.
 */

export type Country = {
  /**
   * ISO-3166 alpha-2. Doubles as the option value, since dial codes are not
   * unique -- +1 is the US, Canada and most of the Caribbean.
   */
  code: string;
  name: string;
  dial: string;
};

/**
 * The flag emoji for an ISO-3166 alpha-2 code, built from the two Unicode
 * regional-indicator symbols rather than pasted in by hand -- 24 hand-typed
 * flag glyphs is 24 chances to paste the wrong one with no visual difference
 * in a code editor to catch it. U+1F1E6 ("REGIONAL INDICATOR SYMBOL LETTER
 * A") sits 127397 code points above 'A', so the same offset from each of the
 * code's two letters gives the pair the font renders as one flag.
 */
export function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 127397 + letter.charCodeAt(0)));
}

export const COUNTRIES: Country[] = [
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "VN", name: "Vietnam", dial: "+84" },
  { code: "HK", name: "Hong Kong", dial: "+852" },
  { code: "TW", name: "Taiwan", dial: "+886" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "ES", name: "Spain", dial: "+34" },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

/**
 * Splits a stored number back into a country and the rest.
 *
 * Longest dial code first, or "+1" would claim "+1242" and every Bahamian
 * number would come back as American. Where several countries share a code the
 * first listed wins -- +1 resolves to the US, which is a coin toss the UI lets
 * the user correct.
 */
export function splitPhone(value: string): { country: Country; number: string } {
  const raw = value ?? "";
  if (!raw.trim()) return { country: DEFAULT_COUNTRY, number: "" };

  const leading = raw.trimStart();
  const byLength = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  const match = byLength.find((country) => leading.startsWith(country.dial));
  if (!match) return { country: DEFAULT_COUNTRY, number: leading };

  // Drop only the single separator space that joinPhone added, never a trim:
  // trimming here deletes the space the person is in the middle of typing.
  const rest = leading.slice(match.dial.length);
  return { country: match, number: rest.startsWith(" ") ? rest.slice(1) : rest };
}

/**
 * Recombines the two halves into the single string the column stores.
 *
 * The number is kept exactly as typed rather than trimmed. This field is
 * controlled -- every keystroke round-trips through joinPhone and back through
 * splitPhone -- so trimming here made a space impossible to type at all: press
 * space after "917", the value is rebuilt without it, and the field re-renders
 * as "917". Nobody could enter "917 123 4567", which is how a Philippine mobile
 * number is normally written.
 *
 * `trim()` still decides whether the field counts as empty, so a value of only
 * spaces stores nothing rather than a bare dial code.
 */
export function joinPhone(country: Country, number: string): string {
  return number.trim() ? `${country.dial} ${number}` : "";
}

export default function PhoneInput({
  value,
  onChange,
  id,
  placeholder = "917 123 4567",
  className = "",
  inputClassName = "",
  disabled = false,
}: {
  /** The stored form, e.g. "+63 9171234567". */
  value: string;
  onChange: (next: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  /** Applied to the number field, so callers keep their own field styling. */
  inputClassName?: string;
  disabled?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const generatedId = useId();
  const inputId = id ?? `phone-${generatedId}`;
  const { country, number } = splitPhone(value);

  return (
    <div className={`flex gap-2 ${className}`}>
      {/* A real <select> still drives this -- native keyboard, screen-reader
          and mobile-picker behaviour for free -- but it sits invisible on top
          of a styled stand-in, because the box closed to a native <select>
          can only ever show its selected <option>'s raw text. With flags and
          full names in the options (below), that text is longer than this
          field is wide, so the closed state clipped mid-word (see the "PH +63
          — Ph" it used to show). The stand-in shows a short flag + code
          instead and never overflows; the <option> list underneath -- where
          the browser gives text all the room it needs -- still carries the
          flag, the dial code and the full country name. */}
      <div className="relative w-28 shrink-0">
        <select
          aria-label={uiText("Country calling code")}
          disabled={disabled}
          value={country.code}
          onChange={(event) => {
            const next = COUNTRIES.find((entry) => entry.code === event.target.value);
            // Recombining with the number already typed is what puts the new
            // dial code in front of it automatically -- picking Philippines
            // turns "917 123 4567" into "+63 917 123 4567" without the person
            // having to type the +63 themselves.
            if (next) onChange(joinPhone(next, number));
          }}
          className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        >
          {COUNTRIES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {flagOf(entry.code)} {entry.name} ({entry.dial})
            </option>
          ))}
        </select>
        <div
          aria-hidden
          className={`flex h-full items-center gap-1 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-2 py-2 text-sm text-[var(--fc-text)] transition peer-focus-visible:border-[var(--fc-ink-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--fc-ink-accent)]/30 ${
            disabled ? "opacity-60" : ""
          }`}
        >
          <span className="text-base leading-none">{flagOf(country.code)}</span>
          <span className="truncate">{country.dial}</span>
          <span className="ml-auto text-[var(--fc-muted)]">▾</span>
        </div>
      </div>
      <input
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        // Digits, spaces and the separators people actually type. Letters are
        // dropped as they are typed rather than rejected on submit.
        value={number}
        onChange={(event) => onChange(joinPhone(country, event.target.value.replace(/[^\d\s()-]/g, "")))}
        placeholder={placeholder}
        className={inputClassName || "w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)]"}
      />
    </div>
  );
}
