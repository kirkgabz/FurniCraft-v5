import type { SupabaseClient } from "@supabase/supabase-js";

export type SellerApplication = {
  shopName: string;
  description: string;
  address: string;
  phone: string;
  socialLinks: Array<{ label: string; url: string }>;
  birRegisteredName: string;
  birDocument: File;
  validId: File;
};

/** Largest document the seller-documents bucket takes (its file_size_limit). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** What the seller-documents bucket accepts, by extension. */
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Types phones report for those same files, including the non-standard ones. */
const TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The extension and content type a document is stored under, or null when it
 * is not one the bucket takes.
 *
 * Read from the name or, failing that, the reported type -- and the content
 * type always comes from this table, never from the file. Phones are loose on
 * both: Android pickers can hand over "1000012345" with no extension, or
 * report a JPEG as "image/jpg" or "". The bucket checks the type exactly, so
 * sending what the phone said failed the upload for a perfectly good photo,
 * while the name check above it had passed.
 */
export function documentFormat(file: File): { extension: string; contentType: string } | null {
  const named = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (named && DOCUMENT_TYPES[named]) return { extension: named, contentType: DOCUMENT_TYPES[named] };
  const fromType = TYPE_EXTENSIONS[file.type.toLowerCase()];
  return fromType ? { extension: fromType, contentType: DOCUMENT_TYPES[fromType] } : null;
}

/** Supabase database failures are plain objects, not necessarily Error instances. */
export function applicationErrorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : "Failed to submit your application. Please try again.";
}

/** Save private documents, then the pending row read by the admin's Applications queue. */
export async function submitSellerApplication(supabase: SupabaseClient, application: SellerApplication): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("You need to be signed in to submit a shop-owner request.");
  const user = userData.user;
  const { data: existing, error: existingError } = await supabase.from("shops")
    .select("status").eq("user_id", user.id).in("status", ["pending", "approved"]);
  if (existingError) throw existingError;
  if (existing?.some((shop) => shop.status === "approved")) throw new Error("You already have an approved shop, so there's nothing to apply for.");
  if (existing?.length) throw new Error("Your shop application is already with the admin for review. You'll be notified once it's decided.");

  for (const file of [application.birDocument, application.validId]) {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error("Each document must be 10MB or smaller.");
    if (!documentFormat(file)) throw new Error("Upload your documents as PDF, JPEG, PNG, or WebP files.");
  }

  const documents = supabase.storage.from("seller-documents");
  const uploaded: string[] = [];
  let cleanupSafe = true;
  const attempt = crypto.randomUUID();
  const upload = async (file: File, label: string, prefix: string) => {
    const { extension, contentType } = documentFormat(file)!;
    const path = `${user.id}/${prefix}_${attempt}.${extension}`;
    // Re-wrapped so the upload carries the type the bucket accepts rather than
    // whatever the phone reported; see documentFormat.
    const { error } = await documents.upload(path, new Blob([file], { type: contentType }), { contentType });
    if (error) throw new Error(`Failed to upload ${label}: ${error.message}`);
    uploaded.push(path);
    return path;
  };

  try {
    const birPath = await upload(application.birDocument, "BIR document", "bir_document");
    const idPath = await upload(application.validId, "valid ID", "valid_id");
    // A network failure may arrive after a committed insert. In that case,
    // keep the files so a pending application never loses its documents.
    cleanupSafe = false;
    const { data, error } = await supabase.from("shops").insert({
      user_id: user.id,
      email: user.email ?? "unknown@email.com",
      shop_name: application.shopName.trim(),
      description: application.description.trim() || null,
      address: application.address.trim(),
      phone: application.phone.trim() || null,
      social_links: application.socialLinks,
      bir_registered_name: application.birRegisteredName.trim(),
      bir_document_url: birPath,
      valid_id_url: idPath,
      status: "pending",
    }).select("id").single();
    if (error) {
      cleanupSafe = /^(22|23|42|P0001)/.test(error.code);
      if (error.code === "23505") throw new Error("Your shop application is already with the admin for review. You'll be notified once it's decided.");
      throw error;
    }
    return data.id as string;
  } catch (error) {
    // A failed second upload/insert must not leave sensitive orphan documents.
    // Cleanup is best effort; preserve the original failure if storage is down.
    if (cleanupSafe && uploaded.length) await documents.remove(uploaded).catch(() => {});
    throw error;
  }
}
