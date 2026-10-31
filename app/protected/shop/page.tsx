export const instant = false;
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePendingDeletion } from "@/lib/account-deletion";
import ShopDashboardPage from "@/components/dashboard/shop-dashboard-page";

export default async function ShopPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  const user = data.claims as {
    sub?: string;
    email?: string | null;
    name?: string | null;
    user_metadata?: { full_name?: string | null; name?: string | null } | null;
  } | null;

  if (user?.sub) {
    const { blocked, cancelled } = await resolvePendingDeletion(supabase, user.sub);
    if (blocked) redirect("/auth/login?deleted=1");
    if (cancelled) redirect("/protected/shop?deletion_cancelled=1");
  }

  // See the identical comment in app/protected/page.tsx: this used to be
  // handed to a prop called `userEmail`, which is why the shop owner's name
  // could appear where their email should.
  const fallbackName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.name ||
    user?.email ||
    "User";

  return <ShopDashboardPage userEmail={user?.email ?? null} fallbackName={fallbackName} />;
}
