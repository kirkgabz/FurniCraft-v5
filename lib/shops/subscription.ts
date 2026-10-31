import { createClient } from "@/lib/supabase/client";

/**
 * Client helpers for the Pro subscription: where the platform is paid, what a
 * shop has filed, and uploading the receipt and the platform's QR.
 *
 * BROWSER-ONLY. Both buckets are private and read through short-lived links.
 * Receipts sit under the shop's id -- the storage policy in 20260910000100
 * keys on that first path segment -- and the QR sits in platform-assets,
 * which only an admin can write (20260911000300).
 *
 * The amount on a claim is never sent from here. The database prices it
 * (price_subscription_payment), so a shop cannot file a claim for less.
 */

export const SUBSCRIPTION_RECEIPT_BUCKET = "subscription-receipts";
export const PLATFORM_ASSET_BUCKET = "platform-assets";

/** Same ceiling as order receipts: a phone screenshot, not a scan of a ledger. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 3600;

export type PlatformSettings = {
  proPricePhp: number;
  paymentQrPath: string | null;
  paymentAccountName: string | null;
  paymentNote: string | null;
};

export type PaymentStatus = "pending" | "approved" | "rejected";

export type SubscriptionPayment = {
  id: string;
  shopId: string;
  amount: number | null;
  reference: string | null;
  receiptPath: string | null;
  status: PaymentStatus;
  rejectedReason: string | null;
  submittedAt: string;
  verifiedAt: string | null;
};

export const PAYMENT_COLUMNS =
  "id, shop_id, amount, reference, receipt_url, status, rejected_reason, submitted_at, verified_at";

type PaymentRow = {
  id: string;
  shop_id: string;
  amount: number | string | null;
  reference: string | null;
  receipt_url: string | null;
  status: string;
  rejected_reason: string | null;
  submitted_at: string;
  verified_at: string | null;
};

export function toPayment(row: PaymentRow): SubscriptionPayment {
  return {
    id: row.id,
    shopId: row.shop_id,
    // numeric arrives as a string from PostgREST.
    amount: row.amount === null ? null : Number(row.amount),
    reference: row.reference,
    receiptPath: row.receipt_url,
    status: row.status === "approved" || row.status === "rejected" ? row.status : "pending",
    rejectedReason: row.rejected_reason,
    submittedAt: row.submitted_at,
    verifiedAt: row.verified_at,
  };
}

/** A payment an admin recorded as a grant rather than a shop paid. */
export function isGrant(payment: SubscriptionPayment): boolean {
  return payment.status === "approved" && (payment.amount ?? 0) === 0;
}

export const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Pinned to the shops' own time zone, so server and browser print the same day. */
export const SUBSCRIPTION_DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" };
export const DAY = new Intl.DateTimeFormat("en-PH", SUBSCRIPTION_DATE_OPTIONS);

export async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  const { data } = await createClient()
    .from("platform_settings")
    .select("pro_price_php, payment_qr_path, payment_account_name, payment_note")
    .eq("id", true)
    .maybeSingle();
  if (!data) return null;
  return {
    proPricePhp: Number(data.pro_price_php),
    paymentQrPath: data.payment_qr_path,
    paymentAccountName: data.payment_account_name,
    paymentNote: data.payment_note,
  };
}

/** A viewable link, or null -- a missing file should leave the page intact. */
export async function signedLink(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await createClient().storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function extensionOf(fileName: string, fallback: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Anything unexpected becomes the fallback rather than being echoed into a
  // storage path.
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback;
}

function problemWith(file: File, allowPdf: boolean): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. Please keep it under 5MB.`;
  }
  const isImage = file.type.startsWith("image/");
  if (!isImage && !(allowPdf && file.type === "application/pdf")) {
    return allowPdf ? "Upload a photo, screenshot or PDF of the receipt." : "Upload an image of the QR code.";
  }
  return null;
}

/**
 * Files a shop's claim that it paid: the receipt first, then the pending row
 * pointing at it. If the row is refused, the receipt is removed again rather
 * than left behind with nothing referring to it.
 */
export async function submitSubscriptionPayment(
  shopId: string,
  reference: string,
  receipt: File
): Promise<{ ok: true } | { error: string }> {
  const problem = problemWith(receipt, true);
  if (problem) return { error: problem };

  const supabase = createClient();
  const path = `${shopId}/receipt_${Date.now()}.${extensionOf(receipt.name, "jpg")}`;
  const { error: uploadError } = await supabase.storage.from(SUBSCRIPTION_RECEIPT_BUCKET).upload(path, receipt);
  if (uploadError) return { error: uploadError.message };

  const { error } = await supabase.from("subscription_payments").insert({
    shop_id: shopId,
    reference: reference.trim() || null,
    receipt_url: path,
    status: "pending",
  });
  if (error) {
    await supabase.storage.from(SUBSCRIPTION_RECEIPT_BUCKET).remove([path]);
    // subscription_payments_one_pending: one claim waiting at a time.
    if (error.code === "23505") {
      return { error: "You already have a payment waiting for review. You'll be notified as soon as it's checked." };
    }
    return { error: error.message };
  }
  return { ok: true };
}

/** Admin only -- the bucket's write policy refuses anyone else. */
export async function uploadPlatformQr(file: File): Promise<{ path: string } | { error: string }> {
  const problem = problemWith(file, false);
  if (problem) return { error: problem };
  const path = `payment/qr_${Date.now()}.${extensionOf(file.name, "png")}`;
  const { error } = await createClient().storage.from(PLATFORM_ASSET_BUCKET).upload(path, file);
  if (error) return { error: error.message };
  return { path };
}
