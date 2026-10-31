import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a generated model, so that paying for it once is enough.
 *
 * Browser-side, and the same shape as `components/orders/payment-proof.ts`:
 * a private bucket, the owning row as the first path segment, and reads
 * through a signed URL. See the migration
 * 20260910000200_generated_model_storage.sql -- the path builder here is not
 * cosmetic, it is what the storage policy keys on.
 *
 * Two writers. The raw download is filed by the server, in the Meshy route,
 * the moment the model exists -- it has to be, because a Vercel Function
 * cannot hand a 6-7 MB model back to the browser at all (4.5 MB cap). The
 * canonical scene only exists once the browser has levelled and labelled
 * it, so it is filed from here, straight from the browser to storage, where
 * that cap does not apply.
 */

export const MODEL_BUCKET = "generated-models";

/** An hour, matching how receipts and seller documents are read. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Named by the Meshy task rather than by a timestamp, unlike the receipt
 * paths this otherwise copies. A task id already identifies the generation
 * uniquely and is the handle everything else uses for it, so this makes the
 * stored object traceable back to the run -- and re-uploading the same task
 * overwrites rather than accumulating copies of one model.
 */
export function modelPath(userId: string, taskId: string): string {
  return `${userId}/${taskId}.glb`;
}


/** The inverse of `modelPath`: which generation a stored path belongs to. */
export function taskIdFromModelPath(path: string | null | undefined): string | null {
  const match = typeof path === "string" ? /^[^/]+\/(.+)\.glb$/.exec(path) : null;
  return match ? match[1] : null;
}

export type StoreResult = { path: string } | { error: string };

/**
 * Stores the finished model and returns the path it went to.
 *
 * Never throws: a generation that succeeded but could not be filed is still a
 * usable model on screen, and losing it to an exception would be worse than
 * carrying on without the copy.
 */
export async function storeGeneratedModel(taskId: string, model: Blob): Promise<StoreResult> {
  const supabase = createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { error: "Not signed in, so the model could not be kept." };

  const path = modelPath(userData.user.id, taskId);
  const { error } = await supabase.storage.from(MODEL_BUCKET).upload(path, model, {
    upsert: true,
    contentType: "model/gltf-binary",
  });
  if (error) return { error: error.message };
  return { path };
}

/**
 * Resolves a stored path to a URL the viewer can load.
 *
 * Returns null rather than throwing, so a model whose file has gone missing
 * leaves the rest of the page intact -- the caller falls back to the copy it
 * already has in memory.
 */
export async function signedModelUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(MODEL_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export type StoredModel = { taskId: string; path: string; createdAt: string; bytes: number };

/**
 * Every model this user has generated and kept, newest first.
 *
 * The point of filing them is being able to come back: the pipeline that
 * turns a .glb into an editable piece has changed repeatedly, and re-running
 * a stored generation through it costs nothing, where generating the same
 * photograph again costs credits. A listing is what makes that possible --
 * without it the files are paid for, kept, and unreachable.
 */
export async function listStoredModels(): Promise<StoredModel[]> {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase.storage
    .from(MODEL_BUCKET)
    .list(userData.user.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error || !data) return [];

  return data
    .filter((entry) => entry.name.endsWith(".glb"))
    .map((entry) => ({
      taskId: entry.name.replace(/\.glb$/, ""),
      path: `${userData.user.id}/${entry.name}`,
      createdAt: entry.created_at ?? "",
      bytes: (entry.metadata as { size?: number } | null)?.size ?? 0,
    }));
}

/** Fetches a stored model back as a File, ready for the same pipeline an upload uses. */
export async function fetchStoredModel(path: string): Promise<File | null> {
  const url = await signedModelUrl(path);
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new File([blob], `${path.split("/").pop() ?? "model.glb"}`, { type: "model/gltf-binary" });
}
