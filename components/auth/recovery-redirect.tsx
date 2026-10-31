"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const UPDATE_PASSWORD_PATH = "/auth/update-password";
const SIGNED_IN_PATH = "/protected";
const LOGIN_PATH = "/auth/login";

/**
 * Completes any auth link that lands anywhere in the app.
 *
 * Every emailed link here -- confirm your address, magic link, password reset,
 * email change -- comes back through the implicit flow, meaning Supabase puts
 * the session in the URL *fragment* and sends the browser to a destination it
 * chooses. If the app's requested redirect is not on the project's allow-list,
 * Supabase quietly substitutes the project's Site URL, which is an origin with
 * no path. The link then lands on the home page.
 *
 * That is where this stopped working. The home page never creates a Supabase
 * browser client, so nothing ever read the fragment: the tokens sat in the
 * address bar, no session was stored, and the visitor was left looking at the
 * landing page apparently signed out. A magic link that "does nothing" is this.
 *
 * So the fragment is claimed explicitly rather than by hoping some component
 * further down happens to instantiate a client and pick it up. setSession
 * stores it wherever the link landed, and only then does the page move:
 *
 *   recovery      -> the form that changes a password
 *   anything else -> the dashboard, signed in
 *   an error      -> the sign-in page, with the reason shown
 *
 * A failed or expired link used to be the most silent case of all: Supabase
 * returns error_description in the same fragment, nothing read it, and the
 * visitor got the landing page with no hint that their link had expired.
 *
 * All of this is deliberately client-side. A fragment is never sent to the
 * server, so no amount of middleware can see one.
 */
export default function AuthLinkHandler() {
  const { t: uiText } = useUiLanguage();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { hash, search, pathname } = window.location;

    // Supabase reports failures on the query string as well as the fragment,
    // depending on where it gave up, so both are worth reading.
    const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const query = new URLSearchParams(search);

    // A fragment carrying `error` on any page here can only have come from
    // Supabase. A query string is not so exclusive -- ?error= is ordinary --
    // so that branch additionally requires the error_description Supabase
    // always sends, rather than claiming every ?error= in the app.
    const fragmentError = fragment.get("error");
    const queryError = query.get("error_description") ? query.get("error") : null;
    const errorCode = fragmentError ?? queryError;
    const errorDescription =
      fragment.get("error_description") ?? (queryError ? query.get("error_description") : null);
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const type = fragment.get("type");

    if (!errorCode && !accessToken) return;

    // Already where it needs to be, with a client that will read the fragment.
    if (accessToken && type === "recovery" && pathname === UPDATE_PASSWORD_PATH) return;

    setBusy(true);

    const clearFragment = () => {
      // Tokens should not linger in the address bar or in history.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };

    const run = async () => {
      if (errorCode || !accessToken || !refreshToken) {
        const reason = errorDescription || errorCode || "That link is no longer valid.";
        clearFragment();
        window.location.replace(`${LOGIN_PATH}?error=${encodeURIComponent(reason)}`);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      clearFragment();

      if (error) {
        window.location.replace(`${LOGIN_PATH}?error=${encodeURIComponent(error.message)}`);
        return;
      }

      // A recovery link proves control of the inbox, not knowledge of the
      // password, so it goes to the form that sets a new one rather than
      // straight into the account.
      window.location.replace(type === "recovery" ? UPDATE_PASSWORD_PATH : SIGNED_IN_PATH);
    };

    void run();
  }, []);

  if (!busy) return null;

  // Without this the landing page sits there looking like the link did nothing,
  // which is the complaint this whole component exists to answer.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--fc-bg)] text-[var(--fc-text)]"
    >
      <p className="text-sm font-semibold">{uiText("Signing you in…")}</p>
    </div>
  );
}
