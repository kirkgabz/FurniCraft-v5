/**
 * Google's geocoder, both ways, for the storefront editor's pin: an address to
 * a point when the owner picks it from the lists, and a point back to address
 * parts when they drag the pin. Requires loadGoogleMaps() to have resolved.
 */

import type { GeoParts } from "@/lib/ph-address";

export type LatLng = { lat: number; lng: number };

async function geocoder(): Promise<google.maps.Geocoder> {
  const { Geocoder } = (await google.maps.importLibrary("geocoding")) as google.maps.GeocodingLibrary;
  return new Geocoder();
}

/** Where Google puts an address, kept to the Philippines. Null when it finds nothing. */
export async function geocodeAddress(query: string): Promise<LatLng | null> {
  try {
    const { results } = await (await geocoder()).geocode({
      address: query,
      componentRestrictions: { country: "PH" },
    });
    const location = results[0]?.geometry.location;
    return location ? { lat: location.lat(), lng: location.lng() } : null;
  } catch {
    // ZERO_RESULTS arrives as a rejection.
    return null;
  }
}

const BARANGAY_TYPES = [
  "sublocality_level_1",
  "sublocality",
  "neighborhood",
  "administrative_area_level_5",
  "administrative_area_level_4",
  "sublocality_level_2",
];
const CITY_TYPES = ["locality", "administrative_area_level_3"];
const PROVINCE_TYPES = ["administrative_area_level_1", "administrative_area_level_2"];

/**
 * The address parts at a point. Google returns several results from most to
 * least precise; each part is taken from the first result that has it, so a
 * street-level result supplies the street and a wider one fills any gap.
 */
export async function reverseGeocode(point: LatLng): Promise<GeoParts | null> {
  let results: google.maps.GeocoderResult[];
  try {
    ({ results } = await (await geocoder()).geocode({ location: point }));
  } catch {
    return null;
  }
  if (!results.length) return null;

  const named = (types: string[]): string[] => {
    const names: string[] = [];
    for (const type of types) {
      for (const result of results) {
        for (const component of result.address_components) {
          if (component.types.includes(type) && !names.includes(component.long_name)) names.push(component.long_name);
        }
      }
    }
    return names;
  };
  const first = (type: string) =>
    results.flatMap((r) => r.address_components).find((c) => c.types.includes(type))?.long_name ?? "";

  const zip = first("postal_code");
  return {
    provinces: named(PROVINCE_TYPES),
    cities: named(CITY_TYPES),
    barangays: named(BARANGAY_TYPES),
    zip: /^\d{4}$/.test(zip) ? zip : "",
    street: [first("street_number"), first("route")].filter(Boolean).join(" ").replace(/^Unnamed Road$/i, ""),
  };
}
