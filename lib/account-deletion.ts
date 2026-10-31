import type { SupabaseClient } from "@supabase/supabase-js";

const GRACE_PERIOD_DAYS = 30;

/**
 * Runs once per protected-page load, server-side, right after auth. A
 * pending deletion is meant to be undone by nothing more than signing back
 * in -- there is no separate "cancel" button to hunt for, because by the
 * time someone would click it they've already been signed out.
 *
 * The >=30-days branch should be unreachable in normal operation (the daily
 * cron sweep runs first and soft-deletes the account, which fails auth
 * before this ever runs) -- it exists only so a missed or delayed sweep
 * fails closed instead of quietly leaving a stale countdown letting someone
 * back in.
 */
export async function resolvePendingDeletion(
  supabase: SupabaseClient,
  userId: string
): Promise<{ blocked: boolean; cancelled: boolean }> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("deletion_requested_at")
    .eq("id", userId)
    .maybeSingle();

  const requestedAt = profile?.deletion_requested_at as string | null | undefined;
  if (!requestedAt) return { blocked: false, cancelled: false };

  const elapsedMs = Date.now() - new Date(requestedAt).getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);

  if (elapsedDays >= GRACE_PERIOD_DAYS) {
    await supabase.auth.signOut();
    return { blocked: true, cancelled: false };
  }

  await supabase.from("user_profiles").update({ deletion_requested_at: null }).eq("id", userId);
  return { blocked: false, cancelled: true };
}
