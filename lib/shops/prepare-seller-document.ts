import { documentFormat, MAX_DOCUMENT_BYTES } from "./submit-application";

/** Long edge of a re-encoded photo: still sharp enough to read an ID or a BIR form. */
const MAX_EDGE_PX = 3000;
const JPEG_QUALITY = 0.85;

/**
 * Gets a document picked on a phone into a shape the seller-documents bucket
 * takes, or explains why it cannot.
 *
 * Two things phones hand over that the bucket refuses, and that used to stop
 * an application dead on mobile:
 * - an iPhone photo kept as HEIC, which is not a type the bucket stores; and
 * - a camera photo over the 10MB limit, which a 50MP sensor produces as a
 *   matter of course.
 * Both are redrawn as a JPEG here, in the browser, before anything is sent.
 * Everything else that is already acceptable is returned untouched.
 */
export async function prepareSellerDocument(file: File): Promise<{ file: File } | { error: string }> {
  const heic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
  const format = documentFormat(file);

  if (!heic && !format) return { error: "Upload your documents as PDF, JPEG, PNG, or WebP files." };
  if (format?.contentType === "application/pdf") {
    return file.size > MAX_DOCUMENT_BYTES ? { error: "Each document must be 10MB or smaller." } : { file };
  }
  if (!heic && file.size <= MAX_DOCUMENT_BYTES) return { file };

  const jpeg = await redrawAsJpeg(file);
  if (!jpeg) {
    return {
      error: heic
        ? "This photo is in HEIC format, which this browser cannot convert. Take a screenshot of it, or upload a JPEG or PDF instead."
        : "Each document must be 10MB or smaller.",
    };
  }
  if (jpeg.size > MAX_DOCUMENT_BYTES) return { error: "Each document must be 10MB or smaller." };
  return { file: jpeg };
}

/**
 * Decodes the image the way the page would show it and saves it as a JPEG no
 * longer than MAX_EDGE_PX. Through an <img> rather than createImageBitmap:
 * Safari decodes HEIC there, and both honour the photo's EXIF rotation, so a
 * portrait ID is not sent sideways. Null when the browser cannot decode it.
 */
async function redrawAsJpeg(file: File): Promise<File | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return null;
    const base = file.name.replace(/\.[^.]*$/, "") || "document";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
