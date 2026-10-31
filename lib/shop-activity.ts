import { createClient } from "@/lib/supabase/client";

/**
 * Records that a shop owner is using FurniCraft, for the inactivity rule in
 * supabase/migrations/20261028090000_shop_inactivity.sql: warned at 30 and 60
 * days without activity, deactivated at 90, and brought back by coming back.
 *
 * Called from the shop dashboard and a shop's order page -- where every shop
 * action happens. The database throttles it, so calling it on each visit is
 * fine.
 *
 * Returns true when this visit reactivated a shop the rule had deactivated, so
 * the caller can say so. Never throws: activity tracking must not be the thing
 * that breaks a dashboard (and before the migration is applied the function
 * simply does not exist yet).
 */
export const SHOP_INACTIVE_DEACTIVATE_DAYS = 90;

export async function touchShopActivity(): Promise<{ reactivated: boolean }> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("touch_shop_activity");
    if (error || !Array.isArray(data)) return { reactivated: false };
    return { reactivated: data.some((row: { reactivated?: boolean }) => row.reactivated === true) };
  } catch {
    return { reactivated: false };
  }
}
