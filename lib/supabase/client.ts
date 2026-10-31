import { createBrowserClient } from "@supabase/ssr";
import { forBrowserSession, toDocumentCookie } from "./session-cookies";

/**
 * The browser's Supabase client.
 *
 * Cookies are read and written here by hand, rather than left to the
 * library's own `document.cookie` handling, for one reason: the session must
 * end when the browser closes. See session-cookies.ts -- the library writes
 * its auth cookies with a 400-day lifetime that `cookieOptions` cannot
 * override, so the lifetime is dropped as each cookie is written. A deletion
 * (maxAge 0) still carries its lifetime, or the cookie would not go away.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return document.cookie
            .split("; ")
            .filter(Boolean)
            .map((pair) => {
              const eq = pair.indexOf("=");
              const name = eq < 0 ? pair : pair.slice(0, eq);
              const value = eq < 0 ? "" : pair.slice(eq + 1);
              return { name: decodeURIComponent(name), value: decodeURIComponent(value) };
            });
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            const keep = options?.maxAge === 0 ? options : forBrowserSession(options ?? {});
            document.cookie = toDocumentCookie(name, value, keep);
          }
        },
      },
    }
  );
}
