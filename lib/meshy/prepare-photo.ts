/**
 * Turns a photo off a camera roll into something small enough to POST.
 *
 * BROWSER-ONLY -- it uses canvas. Deliberately a separate file from
 * `client.ts`, which is server-only and holds the API key: importing the
 * wrong one of those two into the wrong half of the app is a mistake worth
 * making impossible to do by accident.
 *
 * The size limit is not ours to raise. A photo reaches the API route as a
 * base64 data URI in a JSON body, and Vercel caps a serverless function's
 * request body at 4.5 MB -- an infrastructure limit, not a setting, so no
 * amount of config changes it. Base64 inflates by about a third, so a 4 MB
 * phone photo becomes a 5.3 MB body and fails in production while working
 * perfectly on a laptop against `next dev`. That is the worst shape of bug:
 * invisible until it is live.
 *
 * Downscaling is the honest fix rather than a workaround, because the
 * resolution was never doing anything. The generations that produced the best
 * results here were a 231x400 thumbnail and a 900x900 render; what
 * image-to-3D needs is the whole piece in frame against a plain background,
 * not megapixels.
 */

/**
 * Longest edge of the image actually sent.
 *
 * Comfortably above the inputs that have produced good models here and far
 * below anything a phone shoots. Raising it buys detail the generator does
 * not use and costs body size that the platform will refuse.
 */
const MAX_EDGE_PX = 1536;

/**
 * The same, when the photo is one of several views sent together. Four
 * 1536px photos cannot share one request body at any sensible JPEG quality;
 * 1024px each is still well above what the generator reads.
 */
const MULTI_VIEW_MAX_EDGE_PX = 1024;

/** JPEG quality to try first, then the fallbacks if the result is still too big. */
const QUALITY_LADDER = [0.9, 0.8, 0.7, 0.55];

/**
 * The ceiling this aims to land under, in characters of data URI.
 *
 * Well inside Vercel's 4.5 MB body limit, leaving room for the JSON around
 * it and for the fact that base64 length is not perfectly predictable from
 * the encoder's output.
 */
const TARGET_CHARS = 3_500_000;

export type PreparedPhoto = {
  /** `data:image/jpeg;base64,...`, ready to send. */
  dataUri: string;
  width: number;
  height: number;
  /** Original file size and the encoded size, for telling the user what happened. */
  originalBytes: number;
  encodedBytes: number;
};

/**
 * Decodes, downscales and re-encodes a photo for the Meshy request.
 *
 * `imageOrientation: "from-image"` matters more than it looks: a phone writes
 * a sideways photo with an EXIF rotation flag rather than rotating the
 * pixels, and a canvas that ignores the flag would hand the generator a
 * chair lying on its side -- which it would faithfully model lying on its
 * side.
 *
 * Encoded as JPEG on a white ground. The alternative, PNG, is far larger for
 * a photograph, and a transparent PNG flattened onto a canvas defaults to
 * BLACK, which reads as part of the subject: a render with a cut-out
 * background would come back as a piece of furniture with a dark slab
 * attached. White is both smaller and the plain background this works best
 * against.
 */
export async function preparePhotoForMeshy(file: File, sharing = 1): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  // Several views of one piece travel in one request body, so each gets its
  // share of the ceiling -- and a smaller edge to start from, so the share is
  // met by resolution rather than by crushing the JPEG quality.
  const targetChars = TARGET_CHARS / Math.max(1, sharing);
  const maxEdge = sharing > 1 ? MULTI_VIEW_MAX_EDGE_PX : MAX_EDGE_PX;

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser would not give a 2D canvas to resize the photo with.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITY_LADDER) {
      const dataUri = canvas.toDataURL("image/jpeg", quality);
      if (dataUri.length <= targetChars || quality === QUALITY_LADDER[QUALITY_LADDER.length - 1]) {
        return {
          dataUri,
          width,
          height,
          originalBytes: file.size,
          // Roughly: base64 carries 3 bytes in every 4 characters.
          encodedBytes: Math.round((dataUri.length * 3) / 4),
        };
      }
    }

    // Unreachable -- the loop always returns on its final rung.
    throw new Error("Could not encode the photo small enough to send.");
  } finally {
    bitmap.close();
  }
}
