// Reads the signed-in user, so this segment blocks rather than prerendering a
// shell -- the same convention /protected and /admin use.
export const instant = false;

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShopProfile from "@/components/shops/shop-profile";
import { loadShopProfile } from "@/components/shops/shop-profile-data";

/**
 * A shop's own page: who they are, what they make, how to reach them.
 *
 * Everything comes from shops_public, the same view the shop browser reads, so
 * a storefront edit shows up here without anything being copied between them.
 * The gallery is fetched here rather than on demand because on this page the
 * photos are the point, not an extra someone might expand.
 *
 * The queries themselves live in loadShopProfile, which the owner dashboard's
 * Storefront section calls too -- so the preview an owner is shown of their own
 * shop is built from the same rows as the page a customer opens, rather than a
 * second query that can quietly fall behind this one.
 *
 * shops_public exposes approved shops only, so an id for a pending or rejected
 * application is a 404 -- the route cannot be used to discover applications
 * that were never approved.
 */
export default async function ShopPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) notFound();

  const [profile, { data: viewerProfile }] = await Promise.all([
    loadShopProfile(supabase, shopId),
    // Which shop the viewer's next order goes to, so the page can say whether
    // it is this one. The customer dashboard's Shops list opens this page
    // rather than carrying its own Select button.
    supabase.from("user_profiles").select("selected_shop_id").eq("id", userData.user.id).maybeSingle(),
  ]);
  if (!profile) notFound();

  return (
    <ShopProfile
      shop={profile.shop}
      ownerName={profile.ownerName}
      viewerUserId={userData.user.id}
      viewerSelectedShopId={(viewerProfile?.selected_shop_id as string | null | undefined) ?? null}
      averageRating={profile.averageRating}
      reviewCount={profile.reviewCount}
      templates={profile.templates}
    />
  );
}
