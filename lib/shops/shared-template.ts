import { createSecretClient } from "@/lib/supabase/secret";
import { MODEL_BUCKET } from "@/lib/meshy/stored-model";

/**
 * One template, read for someone who may not be signed in -- the public page
 * a shared link opens (app/t/[templateId]).
 *
 * The database only lets signed-in users read templates and their models, so
 * this reads with the secret key instead and applies the customer-facing rules
 * itself. They are the same rules a signed-in customer is held to:
 *
 *   - the template is not hidden by its shop (design_templates_select_visible);
 *   - its shop is one customers can see: approved, active, not suspended (the
 *     shops_public view's own condition).
 *
 * Anything else is "not found", whichever rule it failed, so the link cannot
 * be used to learn that a hidden template or a suspended shop exists.
 *
 * Read only, one row, chosen columns. The generated model is handed out as a
 * signed URL that lasts ten minutes -- long enough to load the page, not a
 * permanent public address for the file.
 */

export type SharedTemplate = {
  id: string;
  title: string;
  description: string | null;
  tag: string | null;
  cadState: unknown;
  previewUrl: string | null;
  allowedMaterials: string[] | null;
  shop: { id: string; name: string; allowedMaterials: string[] | null };
  /** Signed URL to the generated model's file; null for a shipped model. */
  modelUrl: string | null;
};

export type SharedTemplateResult =
  | { kind: "found"; template: SharedTemplate }
  | { kind: "missing" }
  /** The secret key is not in the environment, so nothing can be read for a visitor. */
  | { kind: "unconfigured" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_URL_TTL_SECONDS = 600;

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length ? value.filter((entry): entry is string => typeof entry === "string") : null;
}

export async function loadSharedTemplate(templateId: string): Promise<SharedTemplateResult> {
  if (!UUID.test(templateId)) return { kind: "missing" };
  const supabase = createSecretClient();
  if (!supabase) return { kind: "unconfigured" };

  const { data: row } = await supabase
    .from("design_templates")
    .select("id, shop_id, title, description, tag, cad_state, preview_url, allowed_materials, is_hidden, model_path")
    .eq("id", templateId)
    .maybeSingle();
  if (!row || row.is_hidden === true || !row.cad_state) return { kind: "missing" };

  const { data: shop } = await supabase
    .from("shops")
    .select("id, shop_name, allowed_materials")
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
    // A generated piece without its file cannot be shown; the page says so.
    modelUrl = signed?.signedUrl ?? null;
  }

  return {
    kind: "found",
    template: {
      id: row.id as string,
      title: (row.title as string) || "Template",
      description: (row.description as string | null) ?? null,
      tag: (row.tag as string | null) ?? null,
      cadState: row.cad_state,
      previewUrl: typeof row.preview_url === "string" ? row.preview_url : null,
      allowedMaterials: stringList(row.allowed_materials),
      shop: {
        id: shop.id as string,
        name: (shop.shop_name as string | null) || "Shop",
        allowedMaterials: stringList(shop.allowed_materials),
      },
      modelUrl,
    },
  };
}
