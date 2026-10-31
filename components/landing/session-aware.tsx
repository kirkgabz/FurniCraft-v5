import { Suspense, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * One thing for a signed-in visitor, another for everyone else, on a page that
 * is otherwise prerendered.
 *
 * The public pages offered "Sign in" and "Create an account" to people who were
 * already signed in, and reached by pressing Back from the dashboard that read
 * exactly like having been signed out. The session is read inside Suspense so
 * the rest of the page keeps prerendering under cacheComponents. The signed-out
 * version is the fallback because it is what a first visit sees anyway: nothing
 * changes for a new visitor, and a signed-in one sees their links a moment
 * later rather than waiting on the whole page.
 */
export default function SessionAware({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  return (
    <Suspense fallback={signedOut}>
      <Resolved signedIn={signedIn} signedOut={signedOut} />
    </Suspense>
  );
}

async function Resolved({ signedIn, signedOut }: { signedIn: ReactNode; signedOut: ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return <>{data?.claims ? signedIn : signedOut}</>;
}
