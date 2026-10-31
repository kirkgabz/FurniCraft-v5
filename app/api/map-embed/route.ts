import { NextResponse } from "next/server";

import { isGoogleMapsHost, isShortMapsLink, parseGoogleMapsUrl } from "@/lib/google-maps";

/**
 * Follows a shop's short Google Maps share link (maps.app.goo.gl/…) to the full
 * URL behind it and returns where it points.
 *
 * Server-side because a browser cannot: the short-link host sends no CORS
 * headers, so a fetch from the page never sees the redirect. The full link is
 * what carries the place's coordinates (see lib/google-maps.ts).
 *
 * The URL comes from the request, so this would be an open proxy if it
 * followed redirects blindly. It does not: every hop is checked against the
 * Google hosts in isGoogleMapsHost before it is requested, redirects are
 * followed by hand with a hop limit, and only the parsed location is returned,
 * never the body of anything fetched.
 */

const MAX_HOPS = 5;
const TIMEOUT_MS = 5000;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  if (!raw || raw.length > 800 || !isShortMapsLink(raw)) {
    return NextResponse.json({ error: "Not a Google Maps share link." }, { status: 400 });
  }

  let current = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    // A hop that already says where the place is needs no further request.
    const target = parseGoogleMapsUrl(current);
    if (target) {
      return NextResponse.json(
        { target },
        // A shared place link does not move. Private, not CDN-cached: the
        // session proxy can attach a refreshed auth cookie to this response.
        { headers: { "Cache-Control": "private, max-age=86400" } }
      );
    }

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FurniCraft map preview)" },
      });
    } catch {
      return NextResponse.json({ error: "Could not reach Google Maps." }, { status: 502 });
    }

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;

    const next = new URL(location, current);
    if (next.protocol !== "https:" || !isGoogleMapsHost(next.hostname)) break;
    current = next.toString();
  }

  return NextResponse.json({ error: "That link does not point at a place." }, { status: 422 });
}
