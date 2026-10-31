import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Daily sweep for accounts whose 30-day deletion countdown has elapsed.
 *
 * Not a "delete the user" job -- design_orders.customer_user_id and
 * design_templates.created_by are ON DELETE NO ACTION, so a literal delete
 * from auth.users would fail for almost any real account (it would have to
 * take the other party's order history down with it). Instead: scrub this
 * account's own personal fields, then soft-delete the auth user (the second
 * argument to admin.deleteUser keeps the auth.users row so every foreign key
 * into it stays valid, while permanently disabling sign-in).
 *
 * Called only by the pg_cron job in 20260830000500_account_deletion.sql,
 * authenticated by a shared secret rather than a Supabase JWT -- there is no
 * user session behind a cron tick for verify_jwt to check.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const GRACE_PERIOD_DAYS = 30;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: dueProfiles, error: queryError } = await supabase
    .from("user_profiles")
    .select("id")
    .not("deletion_requested_at", "is", null)
    .is("deleted_at", null)
    .lte("deletion_requested_at", cutoff);

  if (queryError) {
    return new Response(JSON.stringify({ error: queryError.message }), { status: 500 });
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const profile of dueProfiles ?? []) {
    try {
      // Scrub app-level personal fields the auth soft-delete never touches.
      const { error: profileError } = await supabase
        .from("user_profiles")
        .update({
          full_name: "Deleted user",
          phone: null,
          address: null,
          avatar_url: null,
          deleted_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
      if (profileError) throw profileError;

      // A shop with no reachable owner has no business staying in the
      // customer-facing directory.
      const { error: shopError } = await supabase
        .from("shops")
        .update({ is_active: false })
        .eq("user_id", profile.id);
      if (shopError) throw shopError;

      // Keeps the auth.users row (and therefore every order/template FK into
      // it) intact, but scrubs identifying auth fields and disables sign-in
      // for good.
      const { error: authError } = await supabase.auth.admin.deleteUser(profile.id, true);
      if (authError) throw authError;

      results.push({ id: profile.id, ok: true });
    } catch (err) {
      results.push({ id: profile.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
