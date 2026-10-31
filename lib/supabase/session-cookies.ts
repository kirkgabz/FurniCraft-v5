import type { SerializeOptions } from "cookie";

/**
 * Signing in lasts as long as the browser is open, and no longer.
 *
 * Supabase keeps the session in cookies -- that is what lets a page render
 * already signed in, rather than flashing a signed-out shell while the
 * browser asks. Those cookies are written with a 400-day lifetime, and
 * `@supabase/ssr` sets that itself, AFTER whatever `cookieOptions` a caller
 * passes (see `setCookieOptions` in its cookies.js), so the lifetime cannot
 * be configured away. It is stripped here instead, at each of the three
 * places a cookie is actually written: the browser client, the server client
 * and the proxy that refreshes sessions.
 *
 * A cookie with no Max-Age and no Expires is a "session cookie", which the
 * browser drops when it closes. So the piece being customised on a shared
 * computer -- a furniture shop's, a library's -- is not left open behind whoever
 * used it last.
 *
 * What this does NOT do, and cannot:
 *
 *   - Closing one TAB signs nobody out; the cookie belongs to the browser,
 *     not the tab, which is what keeps a second tab of the studio working.
 *   - A browser told to reopen its last tabs ("Continue where you left off"
 *     in Chrome, session restore in Firefox) restores session cookies with
 *     them. Phones, where the browser is rarely closed at all, are the same.
 *
 * Neither is worth chasing with a sign-out on tab close: `pagehide` fires on
 * an ordinary reload and on every navigation away, so it would sign people
 * out mid-checkout. For a real guarantee the session has to expire server
 * side, which is Supabase's own JWT expiry setting, not a cookie.
 */
export function forBrowserSession<T extends SerializeOptions>(options: T): T {
  const session = { ...options };
  delete session.maxAge;
  delete session.expires;
  return session;
}

/** The same, as a `document.cookie` string: `name=value; Path=/; SameSite=Lax`. */
export function toDocumentCookie(name: string, value: string, options: SerializeOptions): string {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.sameSite) {
    const sameSite = options.sameSite === true ? "Strict" : options.sameSite;
    parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  }
  if (options.secure) parts.push("Secure");
  // Deliberately no Max-Age and no Expires -- see forBrowserSession. A
  // deletion still needs one, and the caller passes maxAge: 0 for that.
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}
