import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { forBrowserSession } from "./session-cookies";

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // Written without a lifetime, so signing in lasts only as long as
            // the browser stays open; see session-cookies.ts. A deletion
            // (maxAge 0) keeps its own, or the cookie would never go away.
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                options?.maxAge === 0 ? options : forBrowserSession(options ?? {}),
              ),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
    },
  );
}
