/**
 * Turning the Google Maps link a shop owner pasted into a map a customer can
 * see on the storefront.
 *
 * The link is the source of truth (see the 2026-08-27 shop_map_url migration):
 * the owner copied it from their own place in Google Maps, so the pin in it is
 * the one place we are sure is right. Geocoding the prose address instead would
 * be a guess. So everything here reads the location OUT of the link, in order
 * of how exact each part is:
 *
 *   1. `!3d<lat>!4d<lng>` in the `data=` blob -- the place's own pin. A shared
 *      place link always carries it, and it is exact.
 *   2. `q=` / `query=` / `ll=` / `center=` holding a "lat,lng" pair.
 *   3. `@<lat>,<lng>,<zoom>z` in the path -- where the map was centred when the
 *      link was copied. Close to the place, not always on it, so it ranks below
 *      the pin.
 *   4. A text query (`q=`, or the name in `/maps/place/<name>/`), which Google
 *      resolves itself. Only used when there are no coordinates at all.
 *
 * Short share links (maps.app.goo.gl, goo.gl/maps) carry none of this until
 * they are followed; that happens server-side in app/api/map-embed.
 */

export type MapTarget =
  | { kind: "coords"; lat: number; lng: number }
  | { kind: "query"; query: string };

/** Hosts a shop's map link may point at, and that a short link may redirect through. */
const GOOGLE_MAPS_HOST = /^(?:www\.|maps\.)?google\.[a-z.]{2,6}$/i;
const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
/** Google can bounce a server through its cookie-consent page before the map. */
const CONSENT_HOST = /^consent\.google\.[a-z.]{2,6}$/i;

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** A short share link that has to be followed before it says where anything is. */
export function isShortMapsLink(raw: string): boolean {
  const url = parseUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  return host === "goo.gl" && url.pathname.startsWith("/maps");
}

/** True for any host this module will read or follow; used to keep the resolver on Google. */
export function isGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GOOGLE_MAPS_HOST.test(host) || SHORT_LINK_HOSTS.has(host) || CONSENT_HOST.test(host);
}

function inRange(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    // 0,0 is the Gulf of Guinea, and what a broken link decodes to.
    !(lat === 0 && lng === 0)
  );
}

function coords(lat: number, lng: number): MapTarget | null {
  return inRange(lat, lng) ? { kind: "coords", lat, lng } : null;
}

const LAT_LNG_PAIR = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/**
 * Where a full Google Maps URL points, or null when it is not a Google Maps
 * link or carries no location (a directions link, a bare /maps).
 */
export function parseGoogleMapsUrl(raw: string): MapTarget | null {
  let url = parseUrl(raw);
  if (!url) return null;

  // The consent page carries the real destination in `continue`.
  if (CONSENT_HOST.test(url.hostname)) {
    const next = url.searchParams.get("continue");
    url = next ? parseUrl(next) : null;
    if (!url) return null;
  }

  if (!GOOGLE_MAPS_HOST.test(url.hostname)) return null;
  const isMapsPath = url.pathname.startsWith("/maps") || url.hostname.toLowerCase().startsWith("maps.");
  if (!isMapsPath) return null;
  // A route between two places has no single place to pin.
  if (url.pathname.startsWith("/maps/dir")) return null;

  // decodeURIComponent can throw on a stray "%"; a link that bad has nothing to read.
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const whole = path + url.search;

  // 1. The place's own pin. The last pair wins: it is the one in the place's
  //    !8m2 block, after any nearby-feature entries.
  const pins = [...whole.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  if (pins.length) {
    const [, lat, lng] = pins[pins.length - 1];
    const pin = coords(Number(lat), Number(lng));
    if (pin) return pin;
  }

  // 2. An explicit "lat,lng" in the query string.
  const params = url.searchParams;
  for (const key of ["q", "query", "ll", "center", "daddr"]) {
    const value = params.get(key);
    const match = value?.match(LAT_LNG_PAIR);
    if (match) {
      const pair = coords(Number(match[1]), Number(match[2]));
      if (pair) return pair;
    }
  }

  // 3. The map's centre when the link was copied.
  const at = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const centre = coords(Number(at[1]), Number(at[2]));
    if (centre) return centre;
  }

  // 4. Text Google will look up itself.
  const text = params.get("q") ?? params.get("query");
  if (text?.trim()) return { kind: "query", query: text.trim() };
  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place) {
    const name = place[1].replace(/\+/g, " ").trim();
    if (name) return { kind: "query", query: name };
  }

  return null;
}

function targetQuery(target: MapTarget): string {
  return target.kind === "coords" ? `${target.lat},${target.lng}` : target.query;
}

/**
 * The iframe src for a target. With NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY set it is
 * the documented Maps Embed API (free, no usage quota); without one it is the
 * keyless `output=embed` map Google serves to anyone, so the feature works
 * before a key exists. Both drop a pin on the coordinates.
 */
export function googleMapsEmbedUrl(target: MapTarget, zoom = 17): string {
  const q = targetQuery(target);
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  if (key) {
    const params = new URLSearchParams({ key, q, zoom: String(zoom) });
    return `https://www.google.com/maps/embed/v1/place?${params}`;
  }
  const params = new URLSearchParams({ q, z: String(zoom), output: "embed" });
  return `https://maps.google.com/maps?${params}`;
}

/** Google's documented cross-platform directions link; opens the Maps app on a phone. */
export function googleMapsDirectionsUrl(target: MapTarget): string {
  const params = new URLSearchParams({ api: "1", destination: targetQuery(target) });
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Google's documented link to a place or search; opens the Maps app on a phone. */
export function googleMapsSearchUrl(target: MapTarget): string {
  const params = new URLSearchParams({ api: "1", query: targetQuery(target) });
  return `https://www.google.com/maps/search/?${params}`;
}

/**
 * The link stored as a shop's map_url when the owner places the pin in the
 * editor: Google's documented search link with the exact coordinates, which
 * parseGoogleMapsUrl reads straight back as the pin (its `query=lat,lng`).
 * Six decimals is about 10 cm -- finer than a pin dropped by hand.
 */
export function googleMapsPinUrl(lat: number, lng: number): string {
  return googleMapsSearchUrl({ kind: "coords", lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
}
