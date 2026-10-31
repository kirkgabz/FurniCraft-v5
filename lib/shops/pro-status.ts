import type { SupabaseClient } from "@supabase/supabase-js";
import { SHOPS_PUBLIC_TABLE } from "@/components/shops/shop-types";

/** Read the public subscription flag in one batch, without private billing data. */
export async function loadShopProIds(client: Pick<SupabaseClient, "from">, shopIds: string[]): Promise<Set<string>> {
  if (shopIds.length === 0) return new Set();
  try {
    const { data, error } = await client.from(SHOPS_PUBLIC_TABLE).select("id, is_pro").in("id", shopIds);
    // Keep shop browsing available on databases that predate the Pro flag.
    if (error) return new Set();
    return new Set((data ?? []).filter((row) => row.is_pro === true).map((row) => row.id as string));
  } catch {
    return new Set();
  }
}
