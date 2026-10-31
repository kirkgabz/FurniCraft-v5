import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client that holds the project's secret key, and so passes every
 * row-level policy.
 *
 * SERVER-ONLY. The key is read from a variable without the NEXT_PUBLIC_
 * prefix, so Next never bundles it for the browser, and this throws if it is
 * somehow called there anyway. Use it only for one narrow, read-only job whose
 * access rules are written out in the calling code -- today, the public
 * shared-template page (lib/shops/shared-template.ts), which a visitor opens
 * without signing in.
 *
 * Null when the key is not configured, so the caller can say "not set up"
 * instead of failing.
 */
export function createSecretClient() {
  if (typeof window !== "undefined") throw new Error("createSecretClient must never run in the browser.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // SUPABASE_SECRET_KEY is the new sb_secret_ key; the legacy service_role JWT works the same way here.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
