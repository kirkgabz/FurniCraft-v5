import { createSecretClient } from "@/lib/supabase/secret";
import { MODEL_BUCKET } from "@/lib/meshy/stored-model";

/**
 * One shop-written offer, read for someone who may not be signed in -- the
 * public page a shared link opens (app/o/[token]).
 *
 * The same shape as lib/shops/shared-template.ts, and for the same reason:
 * order_offers is readable only by the shop that wrote it, so this reads with
 * the secret key and applies the customer-facing rules itself.
 *
 *   - the offer has not been claimed, and has not expired;
 *   - its shop is one customers can see: approved, active, not suspended --
 *     the shops_public view's own condition.
 *
 * Anything else is "not found", whichever rule it failed, so a link cannot be
 * used to learn that a suspended shop or a spent offer exists.
 *
 * The price is read here rather than trusted from anywhere later: the page
 * only displays it, and claim_order_offer copies it from this same row when
 * the order is actually made.
 */

export type SharedOffer = {
  token: string;
  projectName: string;
  furnitureType: string | null;
  cadState: unknown;
  previewUrl: string | null;
  /** Pesos. */
  quotedTotal: number;
  downpaymentPercent: number;
  notes: string | null;
  shop: { id: string; name: string; logoUrl: string | null; allowedMaterials: string[] | null };
  /** Signed URL to the generated model's file; null for a shipped model. */
  modelUrl: string | null;
};

export type SharedOfferResult =
  | { kind: "found"; offer: SharedOffer }
  /** No such link, already used, expired, or the shop is no longer visible. */
  | { kind: "missing" }
  /** The secret key is not in the environment, so nothing can be read. */
  | { kind: "unconfigured" };

/** 32 hex characters, as order_offers.token's default produces. */
const TOKEN = /^[0-9a-f]{32}$/i;
const MODEL_URL_TTL_SECONDS = 600;

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length
    ? value.filter((entry): entry is string => typeof entry === "string")
    : null;
}

function peso(value: unknown): number | null {
  const amount = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(amount) ? amount : null;
}

export async function loadSharedOffer(token: string): Promise<SharedOfferResult> {
  if (!TOKEN.test(token)) return { kind: "missing" };
  const supabase = createSecretClient();
  if (!supabase) return { kind: "unconfigured" };

  const { data: row } = await supabase
    .from("order_offers")
    // One literal string, not a concatenation: supabase-js reads the select
    // at the type level, and only a literal tells it what the row holds.
    .select("token, shop_id, project_name, furniture_type, cad_state, preview_url, model_path, quoted_total, downpayment_percent, notes, expires_at, claimed_order_id")
    .eq("token", token)
    .maybeSingle();
  if (!row || row.claimed_order_id) return { kind: "missing" };

  if (row.expires_at && new Date(row.expires_at as string).getTime() <= Date.now()) {
    return { kind: "missing" };
  }

  const total = peso(row.quoted_total);
  const percent = peso(row.downpayment_percent);
  if (total === null || percent === null) return { kind: "missing" };

  const { data: shop } = await supabase
    .from("shops")
    .select("id, shop_name, logo_url, allowed_materials")
    .eq("id", row.shop_id as string)
    .eq("status", "approved")
    .eq("is_active", true)
    .is("suspended_at", null)
    .maybeSingle();
  if (!shop) return { kind: "missing" };

  let modelUrl: string | null = null;
  if (typeof row.model_path === "string" && row.model_path) {
    const { data: signed } = await supabase.storage
      .from(MODEL_BUCKET)
      .createSignedUrl(row.model_path, MODEL_URL_TTL_SECONDS);
    modelUrl = signed?.signedUrl ?? null;
  }

  return {
    kind: "found",
    offer: {
      token: row.token as string,
      projectName: (row.project_name as string) || "Your order",
      furnitureType: (row.furniture_type as string | null) ?? null,
      cadState: row.cad_state,
      previewUrl: typeof row.preview_url === "string" ? row.preview_url : null,
      quotedTotal: total,
      downpaymentPercent: percent,
      notes: (row.notes as string | null) ?? null,
      shop: {
        id: shop.id as string,
        name: (shop.shop_name as string | null) || "Shop",
        logoUrl: (shop.logo_url as string | null) ?? null,
        allowedMaterials: stringList(shop.allowed_materials),
      },
      modelUrl,
    },
  };
}
