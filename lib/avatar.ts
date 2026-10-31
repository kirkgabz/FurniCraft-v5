/**
 * What a picked avatar is checked against before anything else happens.
 *
 * The resize itself used to live here, and it cropped to the centre. That is
 * components/ui/image-cropper.tsx now, so the person choosing the photo picks
 * the square. What is left is the pair of guards the file input needs -- is
 * it an image, and is it small enough to decode without trouble -- which the
 * customer and shop dashboards both apply.
 *
 * The result is still stored inline on the row, the same way an order or
 * template preview is, rather than in a storage bucket: an avatar is small
 * and painted constantly (sidebars, chat, order cards), which is the case
 * this app already prefers inline images for over a signed-URL fetch.
 */

export const AVATAR_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
