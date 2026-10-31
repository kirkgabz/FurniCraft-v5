/**
 * Client-side image downscaling for storefront photos.
 *
 * Shop photos are persisted as data URLs on the shop row (the same approach
 * design_orders already uses for reference images), so an unresized 12MP phone
 * photo would put several megabytes of base64 into a row that every customer
 * browsing shops has to download. Resizing before upload keeps a cover image in
 * the low hundreds of kilobytes while still looking sharp on a wide card.
 */

export type DownscaleOptions = {
  /** Longest edge of the result, in pixels. */
  maxDimension: number;
  /** JPEG quality, 0-1. */
  quality: number;
};

export const COVER_IMAGE_OPTIONS: DownscaleOptions = { maxDimension: 1600, quality: 0.82 };
export const GALLERY_IMAGE_OPTIONS: DownscaleOptions = { maxDimension: 1400, quality: 0.78 };
/** A shop logo is read at 32-96px; 256 leaves room for high-density screens. */
export const LOGO_IMAGE_OPTIONS: DownscaleOptions = { maxDimension: 256, quality: 0.85 };

/** Rejects anything that is not an image before we try to decode it. */
export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file could not be read as an image."));
    image.src = dataUrl;
  });
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

/**
 * Reads an image file and returns a downscaled JPEG data URL. Images already
 * within the size limit are still re-encoded, which is what strips EXIF (and
 * with it any embedded GPS location) from photos taken on a phone.
 */
export async function fileToDownscaledDataUrl(
  file: File,
  options: DownscaleOptions = GALLERY_IMAGE_OPTIONS
): Promise<string> {
  if (!isImageFile(file)) throw new Error("Only image files can be uploaded.");

  const original = await readAsDataUrl(file);
  const image = await loadImage(original);

  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longest > options.maxDimension ? options.maxDimension / longest : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;

  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", options.quality);
}


/** Where the crop window sits on the source image, in its own pixels. */
export type SquareCrop = {
  /** Left edge of the window on the source image. */
  x: number;
  /** Top edge of the window on the source image. */
  y: number;
  /** Width and height of the window -- square, because every crop here is. */
  side: number;
};

export type CropOutput = {
  /** Width and height of the result, in pixels. */
  side: number;
  type: "image/jpeg" | "image/png";
  /** Ignored for PNG, which is lossless. */
  quality?: number;
};

/**
 * Renders a chosen square of an image at the size it will be stored.
 *
 * PNG is not a stylistic choice: a payment QR is read by a camera, and JPEG
 * puts ringing on exactly the hard black-and-white edges a scanner needs. A
 * face has no such edges and compresses far smaller as JPEG, so avatars and
 * logos stay JPEG.
 *
 * Re-encoding also strips EXIF, and with it the GPS coordinates a phone
 * writes into a photo -- the same reason fileToDownscaledDataUrl re-encodes
 * images that are already small enough.
 */
export async function cropToSquareDataUrl(
  source: string,
  crop: SquareCrop,
  output: CropOutput
): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = output.side;
  canvas.height = output.side;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");

  // A crop dragged to the very edge can land a fraction of a pixel outside
  // the image, which paints a transparent hairline down one side. Clamping
  // here rather than in the dialog keeps that correctness with the drawing.
  const side = Math.max(1, Math.min(crop.side, image.naturalWidth, image.naturalHeight));
  const x = Math.max(0, Math.min(crop.x, image.naturalWidth - side));
  const y = Math.max(0, Math.min(crop.y, image.naturalHeight - side));

  // White rather than transparent: a JPEG cannot carry an alpha channel, and
  // a PNG QR with a see-through quiet zone scans badly on a dark page.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, output.side, output.side);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x, y, side, side, 0, 0, output.side, output.side);

  return canvas.toDataURL(output.type, output.type === "image/png" ? undefined : output.quality ?? 0.85);
}

/** A data URL as a File, for the uploads that take one (the payment QR). */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const [header, encoded] = dataUrl.split(",");
  const type = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type });
}

/** Rough byte size of a data URL, for showing the user what a photo will cost. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
