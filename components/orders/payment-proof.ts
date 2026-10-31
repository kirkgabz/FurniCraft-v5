import { createClient } from "@/lib/supabase/client";

/**
 * Storage helpers for the direct-payment flow.
 *
 * Money moves from the customer straight to the shop's GCash, bank or QR Ph
 * account. FurniCraft never touches it, cannot confirm it, and stores only two
 * things: the QR the shop wants shown, and the receipt the customer says proves
 * they paid. Approval is a human reading their own banking app.
 *
 * Both buckets are private (see
 * supabase/migrations/20260826000300_payment_storage.sql). The first path
 * segment is the row the object belongs to, which is what the storage policies
 * key on -- so these path builders are not cosmetic, and changing them without
 * changing the policies would break access.
 */

export const QR_BUCKET = "shop-payment-qr";
export const RECEIPT_BUCKET = "payment-receipts";

/** Signed URLs last an hour, matching how seller documents are read. */
const SIGNED_URL_TTL_SECONDS = 3600;

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

export function qrPath(shopId: string, fileName: string): string {
  return `${shopId}/qr_${Date.now()}.${extensionOf(fileName, "png")}`;
}

export function receiptPath(orderId: string, fileName: string): string {
  return `${orderId}/receipt_${Date.now()}.${extensionOf(fileName, "jpg")}`;
}

function extensionOf(fileName: string, fallback: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Anything unexpected becomes the fallback rather than being echoed into a
  // storage path.
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}

export type UploadResult = { path: string } | { error: string };

async function upload(bucket: string, path: string, file: File): Promise<UploadResult> {
  if (file.size > MAX_PROOF_BYTES) {
    return { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. Please keep it under 5MB.` };
  }
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return { error: "Upload a photo or a PDF of the receipt." };
  }

  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) return { error: error.message };
  return { path };
}

export function uploadQr(shopId: string, file: File): Promise<UploadResult> {
  return upload(QR_BUCKET, qrPath(shopId, file.name), file);
}

export function uploadReceipt(orderId: string, file: File): Promise<UploadResult> {
  return upload(RECEIPT_BUCKET, receiptPath(orderId, file.name), file);
}

/**
 * Resolves a stored path to a viewable URL. Returns null rather than throwing:
 * a missing or unreadable proof should leave the surrounding page intact.
 */
export async function signedUrlFor(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
