import { createClient } from "@/lib/supabase/server";

/**
 * Whether the signed-in user carries the `is_admin` flag.
 *
 * The check that `/admin` has always made, lifted out so the dev-only tooling
 * can make the same one. Read on the server from the session, never from
 * anything the browser can set -- an earlier version of the admin gate
 * compared a hardcoded password in client JavaScript and set a cookie, which
 * anyone could set by hand.
 *
 * A page gate alone is not access control. The routes that spend money on an
 * API key -- Meshy generation, the Gemini classification pass -- have to make
 * this check themselves, because a signed-in customer can call them directly
 * whatever the page does.
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return false;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  return profile?.is_admin === true;
}
