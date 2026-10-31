/**
 * How a length is printed, in whatever unit the reader works in.
 *
 * Every dimension in the app is stored and measured in centimetres -- the
 * studio, the saved design, the order and the shop's quote all read cm, and
 * that stays the one source of truth. A unit here only changes how a number
 * already in hand is written, the way a price can be shown in a second
 * currency without the ledger changing currency. So converting can never
 * change a design: the blueprint in millimetres and the blueprint in inches
 * are drawn from the same centimetres.
 *
 * Precision follows what the source can honour. A measurement is kept to
 * 0.1 cm, so millimetres are whole, metres carry three places, inches two,
 * and feet-and-inches round to the eighth of an inch a tape measure reads.
 */

export type LengthUnit = "cm" | "mm" | "m" | "in" | "ft";

export const LENGTH_UNITS: Array<{ id: LengthUnit; label: string; name: string }> = [
  { id: "cm", label: "cm", name: "Centimetres" },
  { id: "mm", label: "mm", name: "Millimetres" },
  { id: "m", label: "m", name: "Metres" },
  { id: "in", label: "in", name: "Inches" },
  { id: "ft", label: "ft-in", name: "Feet and inches" },
];

export const DEFAULT_LENGTH_UNIT: LengthUnit = "cm";

export function isLengthUnit(value: unknown): value is LengthUnit {
  return LENGTH_UNITS.some((unit) => unit.id === value);
}

export function lengthUnitLabel(unit: LengthUnit): string {
  return LENGTH_UNITS.find((entry) => entry.id === unit)?.label ?? unit;
}

export function lengthUnitName(unit: LengthUnit): string {
  return LENGTH_UNITS.find((entry) => entry.id === unit)?.name ?? unit;
}

const EIGHTHS = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];

/** 90 cm -> 2′ 11⅜″. Rounded to the nearest eighth of an inch. */
export function feetAndInches(cm: number): string {
  const sign = cm < 0 ? "-" : "";
  const eighths = Math.round((Math.abs(cm) / 2.54) * 8);
  const feet = Math.floor(eighths / 96);
  const rest = eighths - feet * 96;
  const inches = Math.floor(rest / 8);
  const fraction = EIGHTHS[rest % 8];
  const inchPart = inches === 0 && fraction ? fraction : `${inches}${fraction}`;
  return feet === 0 ? `${sign}${inchPart}″` : `${sign}${feet}′ ${inchPart}″`;
}

/** Trims a fixed-point number's trailing zeros: 1.800 -> 1.8, 2.000 -> 2. */
function trim(value: number, places: number): string {
  return `${Number(value.toFixed(places))}`;
}

/**
 * The number alone, without its unit -- for a table whose column heading
 * already says the unit. Feet-and-inches carries its own marks, since ′ and ″
 * ARE its unit.
 */
export function formatLengthValue(cm: number, unit: LengthUnit): string {
  switch (unit) {
    case "mm":
      return trim(cm * 10, 0);
    case "m":
      return trim(cm / 100, 3);
    case "in":
      return trim(cm / 2.54, 2);
    case "ft":
      return feetAndInches(cm);
    default:
      return trim(cm, 1);
  }
}

/** The number with its unit: "90 cm", "900 mm", "0.9 m", "35.43 in", "2′ 11⅜″". */
export function formatLength(cm: number, unit: LengthUnit): string {
  return unit === "ft" ? feetAndInches(cm) : `${formatLengthValue(cm, unit)} ${unit}`;
}

/**
 * A second reading beside the first, so nobody has to convert in their head:
 * a metric unit is paired with feet-and-inches, an imperial one with cm.
 */
export function formatLengthWithAlternate(cm: number, unit: LengthUnit): string {
  const alternate: LengthUnit = unit === "in" || unit === "ft" ? "cm" : "ft";
  return `${formatLength(cm, unit)} (${formatLength(cm, alternate)})`;
}

const STORAGE_KEY = "fc-length-unit";

/**
 * The reader's last choice, remembered on this device only. A convenience,
 * not a setting: it can come back empty (a private window, cleared site data)
 * and the page falls back to centimetres.
 */
export function readPreferredLengthUnit(): LengthUnit {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLengthUnit(stored) ? stored : DEFAULT_LENGTH_UNIT;
  } catch {
    return DEFAULT_LENGTH_UNIT;
  }
}

export function writePreferredLengthUnit(unit: LengthUnit): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // Storage can be unavailable; the choice still applies to this page.
  }
}
