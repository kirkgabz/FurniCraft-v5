/**
 * The photo attached to a report.
 *
 * Private bucket, read through signed URLs -- see
 * supabase/migrations/20261026120000_report_photos.sql. The storage policies
 * read the reporter out of the first path segment, so this module is the only
 * place allowed to build a path.
 *
 * Photos go through the chat-photo downscaler, which also strips EXIF (and with
 * it any GPS position a phone wrote into the picture).
 */

export const REPORT_PHOTO_BUCKET = "report-photos";

const SIGNED_URL_TTL_SECONDS = 3600;

export function reportPhotoPath(reporterUserId: string, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const safe = /^(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : "jpg";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${reporterUserId}/${Date.now()}_${suffix}.${safe}`;
}

export type ReportPhotoUpload = { path: string } | { error: string };

export async function uploadReportPhoto(reporterUserId: string, file: File): Promise<ReportPhotoUpload> {
  const { prepareChatPhoto } = await import("@/lib/chat-photos");
  const prepared = await prepareChatPhoto(file);
  if ("error" in prepared) return prepared;

  const path = reportPhotoPath(reporterUserId, prepared.file.name);
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const { error } = await supabase.storage.from(REPORT_PHOTO_BUCKET).upload(path, prepared.file, {
    contentType: prepared.file.type,
    upsert: false,
  });
  if (error) return { error: error.message };
  return { path };
}

/** Best effort: a report that failed to save should not leave its photo behind. */
export async function removeReportPhoto(path: string): Promise<void> {
  try {
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().storage.from(REPORT_PHOTO_BUCKET).remove([path]);
  } catch {
    // Nothing to tell the reporter; an orphaned file is only clutter.
  }
}

export async function reportPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { createClient } = await import("@/lib/supabase/client");
  const { data, error } = await createClient()
    .storage.from(REPORT_PHOTO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
