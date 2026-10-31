/** Shared shape for a storefront, used by the customer browser and the owner editor. */

import type { SocialLink } from "@/components/shops/social-links";

export type ShopPhoto = {
  url: string;
  caption?: string;
};

/** A shop-published starting point a customer can load straight into the studio. */
export type ShopTemplate = {
  id: string;
  title: string;
  description: string | null;
  tag: string | null;
  /** Present only once the shop has attached a real studio design; see design_templates. */
  cadState: unknown;
  previewUrl: string | null;
  /** Finishes the shop will build this in. null means no restriction. */
  allowedMaterials?: string[] | null;
  /**
   * Hidden by the shop (design_templates.is_hidden). Customers never receive
   * these rows at all (RLS); only the owning shop does, to un-hide them.
   */
  isHidden?: boolean;
};

export type Shop = {
  id: string;
  name: string;
  /** Short line under the shop name -- the owner's tagline, or their description. */
  specialty: string;
  location: string;
  ownerUserId?: string | null;
  description?: string | null;
  coverImageUrl?: string | null;
  /** The shop's logo (shops.logo_url). Absent: ShopLogo draws its initials. */
  logoUrl?: string | null;
  gallery?: ShopPhoto[];
  phone?: string | null;
  hours?: string | null;
  /** Shop-authored terms: deposits, lead times, cancellations, warranty. */
  policies?: string | null;
  /**
   * Finish ids this shop can supply. Null or absent is unconfirmed stock;
   * catalogue previews remain available, but checkout requires a declaration.
   *
   * Narrower than a template's own list and applied on top of it -- see
   * `combineAllowedMaterials`. A customer is bound by both, and the overlap is
   * what the studio offers.
   */
  allowedMaterials?: string[] | null;
  /** Places the shop can also be found: Facebook, Instagram, a website. */
  socialLinks?: SocialLink[];
  /**
   * Owner-pasted map link for the address. Prose like "Tinuigiban Heights,
   * PPC" is enough to read and not enough to travel to, and geocoding it
   * would be a guess -- so the pin comes from the owner, or not at all.
   */
  mapUrl?: string | null;
  /**
   * Whether the shop is taking new commissions right now (shops.accepting_orders).
   *
   * A paused shop is still listed, still readable and still messageable --
   * only "Choose this shop" closes. Absent is treated as open, so a row read
   * before the column existed does not silently shut a shop down.
   */
  acceptingOrders?: boolean;
  /**
   * On FurniCraft Pro right now (shops_public.is_pro, derived from the
   * subscription). Shown as a badge; says the shop subscribes, nothing about
   * the quality of its work. Absent reads as not Pro.
   */
  isPro?: boolean;
  /** The shop's own price range (20261101100000); absent when it set none. */
  priceRange?: { min: number; max: number } | null;
};

/** Shown for shops that have not uploaded a cover photo yet. */
export const SHOP_PLACEHOLDER_IMAGE = "/images/shop.webp";

export const MAX_GALLERY_PHOTOS = 8;

/**
 * Normalises the `gallery` jsonb column, which is written by the owner editor
 * but read straight from the database, so it has to tolerate anything.
 */
export function parseGallery(value: unknown): ShopPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: ShopPhoto[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      photos.push({ url: entry });
      continue;
    }
    if (entry && typeof entry === "object") {
      const url = (entry as { url?: unknown }).url;
      if (typeof url !== "string" || !url) continue;
      const caption = (entry as { caption?: unknown }).caption;
      photos.push({ url, caption: typeof caption === "string" ? caption : undefined });
    }
  }
  return photos.slice(0, MAX_GALLERY_PHOTOS);
}

/** Cover photo for a shop, falling back to the shared storefront illustration. */
export function shopCoverImage(shop: Pick<Shop, "coverImageUrl" | "gallery">): string {
  if (shop.coverImageUrl) return shop.coverImageUrl;
  const first = shop.gallery?.[0]?.url;
  return first || SHOP_PLACEHOLDER_IMAGE;
}

/** Deterministic initials badge, so a shop reads consistently before photos load. */
export function shopInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "S";
}

/**
 * Read source for anything customer-facing. `shops_public` is a view over
 * `shops` that exposes approved shops only, without the applicant's email or
 * their uploaded BIR/ID document paths -- the base table is restricted to
 * its owner and to admins.
 */
export const SHOPS_PUBLIC_TABLE = "shops_public";

/** Columns the customer-facing shop list needs. Gallery is fetched only on demand. */
export const SHOP_LIST_COLUMNS =
  "id, user_id, shop_name, description, address, tagline, cover_image_url, phone, hours, policies, " +
  "social_links, map_url, allowed_materials, logo_url, accepting_orders";

/** View exposing only id + display name, for labelling other people in the UI. */
export const USER_NAMES_TABLE = "user_display_names";
