/**
 * A shop's address as the parts a Philippine address is made of -- province,
 * city or municipality, barangay, street, ZIP -- picked from the PSGC lists in
 * public/ph-address/ (see scripts/build-ph-address.mts).
 *
 * It is stored as one line in the existing `address` column, not as new
 * columns: "Street, Barangay, City, Province, ZIP". Everything that already
 * reads `address` keeps showing a readable line, and the picker reads the parts
 * back out by splitting from the END -- the last four parts never contain a
 * comma, so whatever is left at the front is the street, commas and all.
 *
 * An address typed before the picker existed ("Puerto") does not split into
 * these parts; parsePhAddress returns null for it, and nothing pins it on a
 * map, because a map of a guess is worse than no map.
 */

export type PhAddress = {
  street: string;
  barangay: string;
  city: string;
  province: string;
  zip: string;
};

export const ZIP_PATTERN = /^\d{4}$/;

/** Sources of the picker's lists, served from /public. */
export const PH_ADDRESS_BASE = "/ph-address";
export type PhProvince = { code: string; name: string };
export type PhCity = { code: string; name: string; barangays: string[] };

export function formatPhAddress(address: PhAddress): string {
  return [address.street.trim(), address.barangay, address.city, address.province, address.zip.trim()]
    .filter(Boolean)
    .join(", ");
}

export function parsePhAddress(line: string | null | undefined): PhAddress | null {
  const parts = (line ?? "").split(",").map((part) => part.trim());
  // The ZIP is required by the picker, and is what tells its line apart from
  // free text that happens to have three commas in it.
  if (parts.length < 4 || !ZIP_PATTERN.test(parts[parts.length - 1])) return null;
  const zip = parts.pop()!;
  const province = parts.pop()!;
  const city = parts.pop()!;
  const barangay = parts.pop()!;
  if (!province || !city || !barangay) return null;
  return { street: parts.join(", "), barangay, city, province, zip };
}

/**
 * The text Google Maps is asked to find. Manila's barangays carry their
 * district in brackets ("Barangay 1 (Tondo I/II)"), which reads better to a
 * geocoder as its own part.
 */
export function phAddressMapQuery(address: PhAddress): string {
  const barangay = address.barangay.replace(/\s*\(([^)]+)\)\s*$/, ", $1");
  return [address.street, barangay, address.city, `${address.province} ${address.zip}`.trim(), "Philippines"]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Reading a dropped pin back into the picker's lists
//
// Google's reverse geocoder names places its own way -- "Puerto Princesa"
// where the PSGC says "City of Puerto Princesa", "Brgy. San Pedro", accents or
// none -- so names are compared after normalising both sides. Nothing here
// invents a name: a part that does not match an entry in the official list is
// left for the owner to choose.

/** Address parts read from a geocoder result, by Google component type. */
export type GeoParts = {
  /** administrative_area_level_1 / _2, most specific last. */
  provinces: string[];
  /** locality, administrative_area_level_3, … */
  cities: string[];
  /** sublocality, neighborhood, administrative_area_level_4 / _5, … */
  barangays: string[];
  zip: string;
  street: string;
};

export function normalisePlaceName(name: string): string {
  return name
    .normalize("NFD")
    // Strip the accents NFD split off: "Española" and "Espanola" are one place.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(city of|municipality of|city|municipality|barangay|brgy|bgy|brg)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const METRO_MANILA_NAMES = new Set(["metro manila", "national capital region", "ncr"]);

export function matchProvince(provinces: PhProvince[], parts: GeoParts): PhProvince | null {
  // The most specific name first: a province, before the region it is in.
  for (const candidate of [...parts.provinces].reverse()) {
    const wanted = normalisePlaceName(candidate);
    if (METRO_MANILA_NAMES.has(candidate.toLowerCase().trim()) || wanted === "metro manila" || wanted === "national capital region") {
      const ncr = provinces.find((p) => p.code === "metro-manila");
      if (ncr) return ncr;
    }
    const match = provinces.find((p) => normalisePlaceName(p.name) === wanted);
    if (match) return match;
  }
  return null;
}

export function matchCity(cities: PhCity[], parts: GeoParts): PhCity | null {
  for (const candidate of [...parts.cities, ...parts.provinces]) {
    const wanted = normalisePlaceName(candidate);
    if (!wanted) continue;
    const match = cities.find((c) => normalisePlaceName(c.name) === wanted);
    if (match) return match;
  }
  return null;
}

export function matchBarangay(city: PhCity, parts: GeoParts): string | null {
  for (const candidate of parts.barangays) {
    const wanted = normalisePlaceName(candidate);
    if (!wanted) continue;
    const match = city.barangays.find((b) => normalisePlaceName(b) === wanted);
    if (match) return match;
  }
  return null;
}
