/**
 * Loads the Google Maps JavaScript API once per page, for the storefront
 * editor's draggable pin and its pin-to-address lookup.
 *
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY with the "Maps JavaScript API" and
 * "Geocoding API" enabled. The key is public by design -- it is in every page
 * that shows the map -- so restrict it in Google Cloud to this site's HTTP
 * referrers and to those two APIs. Without a key the editor falls back to the
 * keyless embedded map, which shows the pin but cannot move it.
 *
 * NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID is optional. Draggable "advanced" markers need
 * a map ID; Google's DEMO_MAP_ID works until one is created.
 */

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

const CALLBACK = "__furnicraftGoogleMapsReady";
let loading: Promise<void> | null = null;

export function loadGoogleMaps(): Promise<void> {
  if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error("No Google Maps API key is configured."));
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps loads in the browser only."));
  // `window.google` is typed as always present; at runtime it is not until loaded.
  if (typeof (window as { google?: { maps?: { importLibrary?: unknown } } }).google?.maps?.importLibrary === "function") {
    return Promise.resolve();
  }

  loading ??= new Promise<void>((resolve, reject) => {
    (window as unknown as Record<string, () => void>)[CALLBACK] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      v: "weekly",
      loading: "async",
      callback: CALLBACK,
      // Addresses and place names as a Philippine user would write them.
      region: "PH",
      language: "en",
    })}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Google Maps could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return loading;
}
