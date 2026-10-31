// Admin status is read from the request's session, so this segment blocks
// rather than prerendering a shell -- the same convention /admin and
// /protected use.
export const instant = false;

import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/supabase/admin";
import ModelLabClient from "./model-lab-client";

/**
 * The model lab is admin-only, decided on the server before any markup exists.
 *
 * It is a test harness, but it is not a harmless one: every photo it accepts
 * spends Meshy credits and every upload spends a Gemini call, both against
 * keys this project pays for. "Not linked anywhere" was never access control
 * -- the route ships in the production build and anyone who signs up could
 * reach it by typing the URL.
 *
 * A non-admin gets 404 rather than a redirect, so the route does not advertise
 * that it exists. The two API routes behind it make the same check for
 * themselves, because a page gate does nothing about a request sent directly.
 */
export default async function ModelLabPage() {
  if (!(await isAdmin())) notFound();
  return <ModelLabClient />;
}
