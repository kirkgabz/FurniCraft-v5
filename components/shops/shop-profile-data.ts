/**
 * Loads everything a shop's public page shows, in one place.
 *
 * Two screens render that page now: `/shops/[shopId]`, which a customer opens,
 * and the Storefront section of the shop owner's dashboard, which shows the
 * owner the same thing. Written twice they would drift -- a column added to
 * one query and not the other means the owner is shown a storefront that is
 * not the one customers get, which is the single thing that section exists to
 * rule out.
 *
 * Deliberately free of `next/*`: the customer page calls this with the server
 * Supabase client and the dashboard calls it with the browser one. Both are
 * the same supabase-js surface, and the row policies do the rest -- nothing
 * here widens what the caller may read.
 *
 * Reads only. It selects; it never writes.
 */

import {
  SHOPS_PUBLIC_TABLE,
  SHOP_LIST_COLUMNS,
  parseGallery,
  type Shop,
  type ShopTemplate,
} from "@/components/shops/shop-types";
import { parseSocialLinks } from "@/components/shops/social-links";
import { rangesFrom } from "@/lib/shops/price-range";

export type ShopProfileData = {
  shop: Shop;
  ownerName: string | null;
  averageRating: number | null;
  reviewCount: number;
  templates: ShopTemplate[];
};

/**
 * The narrowest slice of a Supabase client this needs, so neither caller has
 * to care which one it holds.
 */
type QueryClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type ShopRow = {
  id: string;
  user_id: string | null;
  shop_name: string | null;
  description: string | null;
  address: string | null;
  tagline: string | null;
  cover_image_url: string | null;
  logo_url: string | null;
  phone: string | null;
  hours: string | null;
  policies: string | null;
  social_links: unknown;
  map_url: string | null;
  gallery: unknown;
  allowed_materials: string[] | null;
  accepting_orders: boolean | null;
};

/**
 * Returns null when there is no such shop to show.
 *
 * `shops_public` exposes approved shops only, so a pending or rejected
 * application reads as absent here -- which is why the customer route can turn
 * this into a 404 without leaking that the id ever existed.
 */
export async function loadShopProfile(
  supabase: QueryClient,
  shopId: string
): Promise<ShopProfileData | null> {
  const { data } = await supabase
    .from(SHOPS_PUBLIC_TABLE)
    .select(`${SHOP_LIST_COLUMNS}, gallery`)
    .eq("id", shopId)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as ShopRow;

  const shop: Shop = {
    id: row.id,
    name: row.shop_name || "Shop",
    specialty: row.tagline || row.description || "Furniture shop",
    location: row.address || "Location pending",
    ownerUserId: row.user_id,
    description: row.description,
    coverImageUrl: row.cover_image_url ?? null,
    logoUrl: row.logo_url ?? null,
    phone: row.phone ?? null,
    hours: row.hours ?? null,
    policies: row.policies ?? null,
    socialLinks: parseSocialLinks(row.social_links),
    mapUrl: row.map_url ?? null,
    allowedMaterials: row.allowed_materials ?? null,
    // Null is a row read before the column existed, not a closed shop.
    acceptingOrders: row.accepting_orders !== false,
    gallery: parseGallery(row.gallery),
  };

  // Pro, for the badge beside the name. Its own query rather than one more
  // column above, because a select naming a column the database does not have
  // fails outright -- and the select above failing reads as "no such shop",
  // a 404 for every shop until 20261017000100_shops_public_is_pro is applied.
  // Here a missing column only means no badge.
  const { data: proRow, error: proError } = await supabase
    .from(SHOPS_PUBLIC_TABLE)
    .select("is_pro")
    .eq("id", shopId)
    .maybeSingle();
  shop.isPro = !proError && (proRow as { is_pro?: boolean | null } | null)?.is_pro === true;

  // The price range, on its own for the same reason: before
  // 20261101100000_shop_price_range is applied it is simply not shown.
  const { data: rangeRow, error: rangeError } = await supabase
    .from(SHOPS_PUBLIC_TABLE)
    .select("id, price_range_min, price_range_max")
    .eq("id", shopId)
    .maybeSingle();
  shop.priceRange = !rangeError && rangeRow ? rangesFrom([rangeRow as { id: string }])[shopId] ?? null : null;

  // The owner's display name. user_display_names is the view that exists
  // precisely so other people's names may be shown.
  let ownerName: string | null = null;
  if (row.user_id) {
    const { data: nameRow } = await supabase
      .from("user_display_names")
      .select("full_name")
      .eq("id", row.user_id)
      .maybeSingle();
    ownerName = (nameRow as { full_name?: string | null } | null)?.full_name ?? null;
  }

  const { data: ratingRow } = await supabase
    .from("shop_ratings")
    .select("average_rating, review_count")
    .eq("shop_id", shopId)
    .maybeSingle();
  const rating = ratingRow as { average_rating: number | string | null; review_count: number } | null;

  const { data: templateRows } = await supabase
    .from("design_templates")
    // is_hidden rows come back only to the shop that owns them (RLS), which
    // lists them marked as hidden so it can show them again.
    .select("id, title, description, tag, cad_state, preview_url, allowed_materials, is_hidden")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  const templates: ShopTemplate[] = ((templateRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    tag: string | null;
    cad_state: unknown;
    preview_url: string | null;
    allowed_materials: string[] | null;
    is_hidden: boolean | null;
  }>).map((template) => ({
    id: template.id,
    title: template.title,
    description: template.description,
    tag: template.tag,
    cadState: template.cad_state,
    previewUrl: template.preview_url,
    allowedMaterials: template.allowed_materials,
    isHidden: Boolean(template.is_hidden),
  }));

  return {
    shop,
    ownerName,
    averageRating: rating ? Number(rating.average_rating ?? 0) : null,
    reviewCount: rating?.review_count ?? 0,
    templates,
  };
}
