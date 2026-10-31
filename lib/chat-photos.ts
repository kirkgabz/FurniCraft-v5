// Nothing is imported at the top of this file on purpose. The downscaler and
// the Supabase client are both pulled in lazily, inside the two functions that
// need them, so that scripts/verify-chat-photos.mts can load this module under
// plain node and exercise the path builder -- the one piece here that the
// storage policies depend on being character-for-character right. Both are
// browser-only anyway, so this costs nothing at runtime.

/**
 * Photos sent inside a shop-customer conversation.
 *
 * The bucket is private and read through short-lived signed URLs, the same as
 * payment receipts -- see supabase/migrations/20260914000200_chat_photos.sql,
 * which also explains why the path shape below is load-bearing rather than
 * cosmetic. The storage policies parse the conversation out of the path, so
 * this module is the only place allowed to build one.
 */

export const CHAT_PHOTO_BUCKET = "chat-photos";

/** Matches the receipt reader: long enough to look at, short enough to expire. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** The cap on what actually leaves the browser, i.e. after downscaling. */
export const MAX_CHAT_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * What a `kind: "image"` message carries in `payload`.
 *
 * The signed URL is deliberately absent: it expires within the hour, so a URL
 * stored in the row would be a dead link by the time anyone scrolled back to
 * it. The path is the durable thing, and the URL is minted on display.
 */
export type ChatPhoto = {
  path: string;
  /** Pixel size after downscaling, used to reserve the bubble's shape. */
  width: number;
  height: number;
};

/** The text stored beside an image, so list previews and reports read sensibly. */
export const CHAT_PHOTO_TEXT = "\u{1F4F7} Photo";

export function chatPhotoPath(shopId: string, customerUserId: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const safe = /^(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : "jpg";
  // A random suffix as well as the clock: two photos picked in the same
  // millisecond are rare, and would silently overwrite each other.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${shopId}/${customerUserId}/${Date.now()}_${suffix}.${safe}`;
}

/**
 * Reads whatever is in a message's `payload` column and returns a photo only
 * if it really is one.
 *
 * Defensive on purpose: `payload` is untyped jsonb shared with order events,
 * and a thread that threw on one malformed row would take the whole
 * conversation down with it.
 */
export function asChatPhoto(payload: unknown): ChatPhoto | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const path = record.path;
  if (typeof path !== "string" || path.length === 0) return null;
  const width = typeof record.width === "number" && record.width > 0 ? record.width : 0;
  const height = typeof record.height === "number" && record.height > 0 ? record.height : 0;
  return { path, width, height };
}

export type PreparedPhoto = { file: File; width: number; height: number } | { error: string };

/**
 * Validates and downscales a picked image, in the browser, before anything is
 * uploaded.
 *
 * A raw 8MB phone photo is not rejected, it is shrunk; the cap is what catches
 * the genuinely enormous, and it reports the size the customer can act on --
 * the one after resizing, since that is the one that failed.
 */
export async function prepareChatPhoto(file: File): Promise<PreparedPhoto> {
  // The storefront downscaler, at the cover image's settings. Re-encoding is
  // not only about size: it is what strips EXIF, and with it the GPS
  // coordinates a phone writes into a photo taken at home. A customer
  // photographing their own living room for a maker they have never met
  // should not be handing over their address as well, which is why every
  // photo goes through it -- including ones already small enough not to need
  // resizing.
  const { COVER_IMAGE_OPTIONS, dataUrlBytes, fileToDownscaledDataUrl, formatBytes, isImageFile } =
    await import("@/lib/image-utils");

  if (!isImageFile(file)) {
    return { error: "That is not an image. Pick a photo to send." };
  }

  let dataUrl: string;
  try {
    dataUrl = await fileToDownscaledDataUrl(file, COVER_IMAGE_OPTIONS);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That photo could not be read." };
  }

  const bytes = dataUrlBytes(dataUrl);
  if (bytes > MAX_CHAT_PHOTO_BYTES) {
    return { error: `That photo is still ${formatBytes(bytes)} after resizing. Please keep it under 5MB.` };
  }

  const { width, height } = await measure(dataUrl);
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return {
    file: new File([dataUrlToBytes(dataUrl)], `${name}.jpg`, { type: "image/jpeg" }),
    width,
    height,
  };
}

/**
 * Natural size of the downscaled image. Resolves to 0x0 rather than throwing if
 * it cannot be read, which costs the bubble only its placeholder shape.
 */
function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve({ width: 0, height: 0 });
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}

function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

export type ChatPhotoUpload = { photo: ChatPhoto } | { error: string };

/**
 * Uploads one photo for a conversation.
 *
 * `customerUserId` is the customer's id whichever side is sending: the pair
 * (shop, customer) IS the conversation, and the storage policies read it out of
 * the path. A shop owner sending a photo still files it under the customer they
 * are talking to.
 */
export async function uploadChatPhoto(
  shopId: string,
  customerUserId: string,
  file: File
): Promise<ChatPhotoUpload> {
  const prepared = await prepareChatPhoto(file);
  if ("error" in prepared) return prepared;

  const path = chatPhotoPath(shopId, customerUserId, prepared.file.name);
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { error } = await supabase.storage.from(CHAT_PHOTO_BUCKET).upload(path, prepared.file, {
    contentType: prepared.file.type,
    upsert: false,
  });
  if (error) return { error: error.message };

  return { photo: { path, width: prepared.width, height: prepared.height } };
}

/**
 * Mints a viewable URL for a stored photo. Returns null rather than throwing:
 * one unreadable photo should leave the rest of the conversation intact.
 */
export async function chatPhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(CHAT_PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
