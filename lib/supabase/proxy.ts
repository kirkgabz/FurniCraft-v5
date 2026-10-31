import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { forBrowserSession } from "./session-cookies";
import { isSuspensionActive, SUSPENDED_PATH, SUSPENSIONS_TABLE } from "@/lib/account-suspension";

// Whether Supabase is configured at all. Lives here rather than in lib/utils
// because it reads process.env at module scope, and lib/utils is imported by
// every ui/* component through cn() -- which made a styling helper unusable
// outside Next.js.
const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          // This is the write that decides how long a session lasts: it runs
          // on nearly every request, as getClaims below refreshes the tokens.
          // No lifetime, so the session ends with the browser -- see
          // session-cookies.ts. A deletion (maxAge 0) keeps its own.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              options?.maxAge === 0 ? options : forBrowserSession(options ?? {}),
            ),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly signed out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly signed out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (
    request.nextUrl.pathname !== "/" &&
    !user &&
    // The picker-preview capture page (app/dev/piece-shots), opened by a
    // headless browser with no session. Development only; the page itself
    // also 404s in any other build.
    !(process.env.NODE_ENV === "development" && request.nextUrl.pathname === "/dev/piece-shots") &&
    // A shared template link (app/t/[templateId]): public to look at; the
    // page asks for a sign-in only to customize or order.
    !request.nextUrl.pathname.startsWith("/t/") &&
    // A shop's shared order link (app/o/[token]): public to look at, and the
    // whole point is that it reaches someone with no account yet. The page
    // asks for one only when they take the order.
    !request.nextUrl.pathname.startsWith("/o/") &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    // no user, potentially respond by redirecting the user to the sign-in page
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // Already signed in: the sign-in and sign-up forms have nothing to offer, and
  // landing on one -- which pressing Back after signing in used to do -- looks
  // exactly like having been signed out. Password reset, email verification and
  // the confirm callback stay reachable while signed in, because those links
  // are opened that way on purpose.
  if (user && (request.nextUrl.pathname === "/auth/login" || request.nextUrl.pathname === "/auth/sign-up")) {
    const url = request.nextUrl.clone();
    url.pathname = "/protected";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Carry any session cookies getClaims refreshed on this request -- see the
    // note below about keeping browser and server in sync.
    supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  // A suspended account sees only the suspension page. Checked on page loads
  // only (not API calls or assets) to keep it to one small read; what actually
  // stops a suspended account acting is the database's own policies -- see
  // 20261027120000_account_suspensions. Before that migration is applied the
  // read fails and nobody is redirected.
  const path = request.nextUrl.pathname;
  if (
    user &&
    request.method === "GET" &&
    !path.startsWith("/auth") &&
    !path.startsWith("/api") &&
    (request.headers.get("accept") ?? "").includes("text/html")
  ) {
    const { data: suspension } = await supabase
      .from(SUSPENSIONS_TABLE)
      .select("suspended_until")
      .eq("user_id", user.sub)
      .maybeSingle();
    if (isSuspensionActive(suspension as { suspended_until: string | null } | null)) {
      const url = request.nextUrl.clone();
      url.pathname = SUSPENDED_PATH;
      url.search = "";
      const redirect = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
