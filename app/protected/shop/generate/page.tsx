export const instant = false;
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePendingDeletion } from "@/lib/account-deletion";
import { SUBSCRIPTION_COLUMNS, toAllowance } from "@/lib/shops/allowance";
import GenerateTemplate, { type PendingGeneration } from "@/components/shops/generate-template";

/**
 * Where an approved shop turns a photograph of its own piece into a template.
 *
 * Gated here to approved shops, and again where it actually matters: the
 * generation route bills this shop's subscription before it spends anything,
 * and the labelling route only answers for a generation this shop paid for.
 * This page gate only decides who is shown the form.
 */
export default async function GenerateTemplatePage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = error ? undefined : (data?.claims?.sub as string | undefined);
  if (!userId) redirect("/auth/login");

  const { blocked } = await resolvePendingDeletion(supabase, userId);
  if (blocked) redirect("/auth/login?deleted=1");

  const { data: shop } = await supabase
    .from("shops")
    .select("id, shop_name")
    .eq("user_id", userId)
    .eq("status", "approved")
    .maybeSingle();
  if (!shop) redirect("/protected/shop");

  // Both read through RLS as this shop, and either may fail -- before the
  // subscriptions migration is applied the tables do not exist. Neither
  // failure stops the page: the route enforces the allowance whatever this
  // shows, so the worst case is a shop told less than it could be.
  const [subscription, generations] = await Promise.all([
    supabase.from("shop_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("shop_id", shop.id).maybeSingle(),
    supabase
      .from("shop_generations")
      .select("task_id, created_at, mode, category, textured")
      .eq("shop_id", shop.id)
      .eq("outcome", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return (
    <GenerateTemplate
      shop={{ id: shop.id as string, name: (shop.shop_name as string | null) || "Your shop" }}
      initialAllowance={subscription.data ? toAllowance(subscription.data, Date.now()) : null}
      pending={(generations.data ?? []).map((row) => ({
        taskId: row.task_id as string,
        createdAt: row.created_at as string,
        mode: row.mode === "detailed" ? "detailed" : "quick",
        category: (row.category as PendingGeneration["category"]) ?? null,
        textured: row.textured === true,
      }))}
    />
  );
}
