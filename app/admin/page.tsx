// Admin status is read from the request's session, so this segment blocks rather
// than prerendering a shell -- the same convention /protected uses.
export const instant = false;

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminApprovalPanel from "@/components/admin/admin-approval-panel";

/**
 * Admin access is decided on the server, from the signed-in user's `is_admin`
 * flag, before any markup is produced.
 *
 * This previously ran in the browser: a hardcoded username and password were
 * compared in client-side JavaScript, and passing the check simply set a
 * `furnicraft_admin_session=1` cookie that the page then looked for. Both the
 * credentials and the cookie value shipped to every visitor, so anyone could set
 * the cookie by hand and walk in.
 *
 * The page gate is only the visible half. Every query the panel makes is
 * additionally constrained by row-level security keyed on the same flag, so a
 * non-admin who reaches the API directly still sees nothing -- see
 * 2026-08-24-security-rls-and-admin-role.sql.
 *
 * A non-admin gets 404 rather than a redirect, so the route does not advertise
 * that an admin area exists.
 */
export default async function AdminPage() {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_admin) notFound();

  return <AdminApprovalPanel />;
}
