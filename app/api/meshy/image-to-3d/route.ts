import {
  createImageTo3dTask,
  createSplitTask,
  downloadModel,
  readTask,
  MeshyError,
  type GenerationMode,
  type MeshyStatus,
  type MeshyTaskKind,
} from "@/lib/meshy/client";
import { SPLIT_PROMPTS } from "@/lib/meshy/split-prompts";
import { HIGH_GAP_THRESHOLD, PartitionError, partitionBySplit } from "@/lib/meshy/split-partition";
import { isAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GENERATION_COST } from "@/lib/shops/allowance";
import { MODEL_BUCKET, modelPath } from "@/lib/meshy/stored-model";
import type { FurnitureCategoryId } from "@/components/design/studio/studio-models";

/**
 * Fronts Meshy's Image-to-3D API for the studio's upload flow.
 *
 * Server-side because it holds MESHY_API_KEY, exactly as
 * `/api/architect-analysis` holds the Google key. The browser sends a photo
 * and polls a task id; it never sees the key, and never fetches Meshy
 * directly (their download URLs are signed for their own origin and would be
 * refused cross-origin anyway).
 *
 * Three operations on one route, because they are one conversation:
 *   POST                      start a generation from a photo
 *   GET  ?taskId=             how is it going
 *   GET  ?taskId=&store=1     file the finished .glb in storage and say where
 *
 * Two kinds of generation behind the same three calls. Quick is one Meshy
 * task. High detail is a chain -- the model, painted in that same task when
 * a texture was asked for, then a split into parts that the original is cut
 * along -- and each poll advances it one step, so the chain
 * survives a closed tab exactly as a quick generation does: whoever polls
 * next carries it on. The task id the browser holds is always the FIRST
 * task's, and the chain's later tasks are looked up against it.
 *
 * Two callers: an approved shop making a template from a photo
 * (/protected/shop/generate), billed to its subscription, and the admin
 * test harness at /dev/model-lab, which proves the pipeline end to end.
 */

/**
 * Long enough for the download branch to pull a textured high-detail model --
 * two downloads, the texture carried across, one upload of about 10 MB.
 *
 * Stated rather than inherited, because the platform default is not one
 * number: with Fluid Compute a Vercel function gets 300 seconds, and without
 * it a Hobby project gets 10 -- which a multi-megabyte transfer on a poor
 * connection can genuinely exceed. Relying on whichever happens to apply is
 * how a route works in every test and times out for the one person on hotel
 * wifi.
 */
export const maxDuration = 60;

/** Refused before we spend a request on it; Meshy takes jpg/jpeg/png. */
const ACCEPTED_IMAGE = /^data:image\/(png|jpe?g);base64,/;

/**
 * Ceiling on the photos together, in characters of data URI -- which is what
 * actually crosses the wire, base64 being one byte per character.
 *
 * Set below Vercel's 4.5 MB serverless request-body limit, not above it. The
 * platform enforces that itself and cannot be configured out of it, so a
 * larger cap here would only mean the difference between a sentence
 * explaining the problem and an opaque 413 from the infrastructure. Several
 * photos share it: the browser shrinks each to its share first (see
 * lib/meshy/prepare-photo.ts). This is the backstop for a caller that did not.
 */
const MAX_IMAGE_CHARS = 4_000_000;

/** Meshy's multi-photo mode takes up to four views of the piece. */
const MAX_PHOTOS = 4;

const CATEGORIES = new Set<FurnitureCategoryId>(["chair", "table", "sofa", "cabinet", "bed", "bookshelf", "desk", "stool"]);

/** The value a claimed-but-not-yet-started step holds; see 20260921000200. */
const CLAIMED = "claimed";

function fail(error: string, status: number) {
  return Response.json({ error }, { status });
}

function handle(error: unknown) {
  if (error instanceof MeshyError) return fail(error.message, error.status);
  return fail(error instanceof Error ? error.message : "Meshy request failed.", 502);
}

type RequestBody = {
  /** One photo -- the original shape of this body, still accepted. */
  image?: string;
  /** Up to four views of the same piece. High detail only. */
  images?: string[];
  mode?: GenerationMode;
  /** What kind of piece it is; high detail tells the split which parts to look for. */
  category?: FurnitureCategoryId;
  /** Paints the model from the photo. Never costs the shop another generation. */
  textured?: boolean;
  /**
   * The shop the generation is billed to. Omitted only by /dev/model-lab,
   * which runs as an admin against no shop at all.
   */
  shopId?: string;
};

export async function POST(request: Request) {
  // A generation costs real credits, so the checks here are the ones that
  // actually matter -- a page gate does nothing about a request sent straight
  // to this route by any signed-up account.
  //
  // Two callers, two gates. A shop owner is admitted by their subscription:
  // `consume_generation` decides, holding a row lock, and either returns the
  // remaining allowance or raises. /dev/model-lab has no shop behind it and is
  // admitted by the admin flag instead, exactly as this route always worked.
  const supabase = await createClient();
  const admin = await isAdmin();

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON body.", 400);
  }

  const shopId = typeof body.shopId === "string" ? body.shopId : null;
  if (!shopId && !admin) return new Response(null, { status: 404 });

  const mode: GenerationMode = body.mode === "detailed" ? "detailed" : "quick";
  const images = Array.isArray(body.images) ? body.images : typeof body.image === "string" ? [body.image] : [];
  if (images.length === 0 || images.length > MAX_PHOTOS || !images.every((image) => typeof image === "string" && ACCEPTED_IMAGE.test(image))) {
    return fail(`Send one to ${MAX_PHOTOS} photos as data URIs: data:image/png;base64,... (png or jpeg).`, 400);
  }
  if (mode === "quick" && images.length > 1) {
    return fail("More than one photo needs High detail; Quick builds from a single photo.", 400);
  }
  if (images.reduce((sum, image) => sum + image.length, 0) > MAX_IMAGE_CHARS) {
    return fail(
      "Those photos are too large to send together. They should have been downscaled in the browser first -- see prepare-photo.ts.",
      413
    );
  }
  const category = body.category && CATEGORIES.has(body.category) ? body.category : null;
  const textured = body.textured === true;
  const cost = GENERATION_COST[mode];

  // Spend the allowance BEFORE the key. A generation that is refused here has
  // cost nothing; one that is refused after the call has already been paid for.
  let remaining: number | null = null;
  if (shopId) {
    const { data, error } = await supabase.rpc("consume_generation", { p_shop_id: shopId, p_cost: cost });
    // The message is written for the shop owner by the function itself --
    // which allowance ran out, and when it resets -- so it is passed through.
    if (error) return fail(error.message, 402);
    remaining = typeof data === "number" ? data : null;
  }

  let taskId: string;
  try {
    ({ taskId } = await createImageTo3dTask(images, { textured, mode }));
  } catch (error) {
    // Meshy never delivered, so nothing was bought. Hand the generation back
    // without touching the retry allowance.
    if (shopId) {
      await supabase.rpc("refund_generation", { p_shop_id: shopId, p_reason: "api_failure", p_cost: cost });
    }
    return handle(error);
  }

  // Ownership of the task, so polling and downloading can be gated on it --
  // and, for high detail, the record the rest of the chain is advanced from.
  // A lab run records too when it is high detail, for the same reason.
  if (shopId || mode === "detailed") {
    await supabase.rpc("record_generation", {
      p_shop_id: shopId,
      p_task_id: taskId,
      p_mode: mode,
      p_category: category,
      p_textured: textured,
      p_photo_count: images.length,
    });
  }

  return Response.json({ taskId, remaining });
}

// ------------------------------------------------------------ the chain

type ChainRow = {
  mode: GenerationMode;
  category: FurnitureCategoryId | null;
  textured: boolean;
  photo_count: number;
  split_task_id: string | null;
  split_mode: "by_parts" | "auto" | null;
};

type Stage = "generating" | "separating" | "done";

/**
 * Where a generation stands, as the browser reads it.
 *
 * `rejected` marks a failure that is OURS rather than the photo's -- the
 * model was built and paid for, and could not be made into parts -- which is
 * what the shop is refunded for. `note` says something the shop should know
 * about a result that still arrived, such as parts that had to fall back to
 * the split's own rougher geometry.
 */
type ChainState = {
  status: MeshyStatus;
  progress: number;
  stage: Stage;
  error: string | null;
  rejected?: boolean;
  note?: string;
  /** Set once finished: the original model, and the split that says how to cut it. */
  wholeUrl?: string;
  splitUrl?: string;
  consumedCredits: number | null;
};

/**
 * How far through the whole chain each step's own 0-100 lands. Building the
 * model is most of the wait -- minutes against the split's seconds -- whether
 * or not it is painted along the way.
 */
function span(stage: Exclude<Stage, "done">, progress: number): number {
  const [from, to] = stage === "generating" ? [0, 70] : [70, 99];
  return Math.round(from + ((to - from) * Math.max(0, Math.min(100, progress))) / 100);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

const SEPARATE_FAILED =
  "The model was built, but it couldn't be separated into parts, so there is nothing for a customer to resize or refinish.";

/**
 * Advances a high-detail chain by at most one step and reports where it is.
 *
 * Every step is claimed before it is started (claim_generation_step), so two
 * polls landing together cannot each start -- and each pay for -- the same
 * split. A poll that loses the claim just reports the step as under way.
 */
async function advanceChain(supabase: Supabase, taskId: string, row: ChainRow): Promise<ChainState> {
  const kind: MeshyTaskKind = row.photo_count > 1 ? "multi-image-to-3d" : "image-to-3d";
  const working = (stage: Exclude<Stage, "done">, progress: number, credits: number | null = null): ChainState => ({
    status: "IN_PROGRESS",
    progress: span(stage, progress),
    stage,
    error: null,
    consumedCredits: credits,
  });

  // ---- 1. the detailed model
  const model = await readTask(taskId, kind);
  if (model.status !== "SUCCEEDED") {
    return {
      status: model.status,
      progress: span("generating", model.progress),
      stage: "generating",
      error: model.error,
      consumedCredits: model.consumedCredits,
    };
  }

  // ---- 2. the split
  if (!row.split_task_id) {
    const { data: claimed } = await supabase.rpc("claim_generation_step", { p_task_id: taskId, p_step: "split" });
    if (claimed !== true) return working("separating", 0);
    const prompt = row.category ? SPLIT_PROMPTS[row.category] : undefined;
    try {
      // With no kind to name parts for, auto is the only honest request. It
      // is still recorded against the first attempt's slot, so a failure
      // gets its one auto retry like any other.
      const splitId = await createSplitTask(taskId, prompt ? "by_parts" : "auto", prompt);
      await supabase.rpc("set_generation_stage", { p_task_id: taskId, p_split_task_id: splitId, p_split_mode: "by_parts" });
    } catch (error) {
      return { status: "FAILED", progress: 0, stage: "separating", error: `${SEPARATE_FAILED} (${messageOf(error)})`, rejected: true, consumedCredits: null };
    }
    return working("separating", 0);
  }
  if (row.split_task_id === CLAIMED) return working("separating", 0);

  const split = await readTask(row.split_task_id, "print/split");
  const splitFailed =
    split.status === "FAILED" || split.status === "CANCELED" || (split.status === "SUCCEEDED" && (split.partCount ?? 2) < 2);
  if (splitFailed) {
    // The one retry: named parts can fail where Meshy's own judgement does not.
    if (row.split_mode === "by_parts") {
      const { data: claimed } = await supabase.rpc("claim_generation_step", { p_task_id: taskId, p_step: "split_auto" });
      if (claimed === true) {
        try {
          const splitId = await createSplitTask(taskId, "auto");
          await supabase.rpc("set_generation_stage", { p_task_id: taskId, p_split_task_id: splitId, p_split_mode: "auto" });
        } catch (error) {
          return { status: "FAILED", progress: 0, stage: "separating", error: `${SEPARATE_FAILED} (${messageOf(error)})`, rejected: true, consumedCredits: null };
        }
      }
      return working("separating", 0);
    }
    return { status: "FAILED", progress: 0, stage: "separating", error: SEPARATE_FAILED, rejected: true, consumedCredits: split.consumedCredits };
  }
  if (split.status !== "SUCCEEDED" || !split.modelUrl) return working("separating", split.progress, split.consumedCredits);

  // Nothing follows the split. A texture, when one was asked for, was painted
  // in the first task and rides on the model this divides -- the split drops
  // it from its own output, which costs nothing here because the parts are cut
  // from the original (see finishedModel).
  return {
    status: "SUCCEEDED",
    progress: 100,
    stage: "done",
    error: null,
    wholeUrl: model.modelUrl ?? undefined,
    splitUrl: split.modelUrl,
    consumedCredits: split.consumedCredits,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The bytes to keep for a finished chain: the original model divided into the
 * split's parts, texture and all.
 *
 * Divided rather than taken from the split, because the split's own geometry
 * is damaged around every cut and carries neither shading normals nor texture
 * coordinates (see split-partition.ts). Cutting the original keeps all three.
 * If dividing fails, the split's geometry is still a working template --
 * rougher and unpainted, but whole -- so it is kept rather than the piece
 * being lost. Dividing can also succeed and still be a bad match -- a
 * moving part caught open in a source photo can fuse with its neighbour in
 * the original reconstruction, which no amount of nearest-part voting can
 * un-fuse -- so a strained mean gap (see HIGH_GAP_THRESHOLD) still keeps the
 * piece but says so, rather than handing over a template with a part that
 * quietly absorbed its neighbour and no way for the shop to know why.
 */
async function finishedModel(state: ChainState): Promise<{ bytes: ArrayBuffer; note?: string }> {
  const split = await downloadModel(state.splitUrl!);
  if (!state.wholeUrl) return { bytes: split, note: state.note };
  try {
    const divided = partitionBySplit(await downloadModel(state.wholeUrl), split);
    const note =
      divided.meanGap > HIGH_GAP_THRESHOLD
        ? "Some part boundaries on this piece may be unreliable -- often a sign that a door, drawer or lid was caught open in one of the photos, and fused with what's behind it. Check the parts before publishing; retrying with the piece closed usually fixes it."
        : state.note;
    return { bytes: divided.glb, note };
  } catch (error) {
    if (!(error instanceof PartitionError)) throw error;
    return {
      bytes: split,
      note: `The parts could not be cut from the original model (${error.message}), so this piece arrives with the rougher, unpainted geometry the split itself produced.`,
    };
  }
}

export async function GET(request: Request) {
  // Polling and storing are gated too: a task id is not a secret, and storing
  // files a model this project paid to generate. `may_read_generation`
  // resolves the task back to the shop that paid for it, so holding the id is
  // not by itself enough -- admins still pass for /dev/model-lab, whose tasks
  // belong to no shop.
  const params = new URL(request.url).searchParams;
  const taskId = params.get("taskId");
  if (!taskId) return fail("Missing taskId.", 400);

  const supabase = await createClient();
  const { data: mayRead } = await supabase.rpc("may_read_generation", { p_task_id: taskId });
  if (mayRead !== true) return new Response(null, { status: 404 });

  try {
    const { data: row } = await supabase
      .from("shop_generations")
      .select("mode, category, textured, photo_count, split_task_id, split_mode")
      .eq("task_id", taskId)
      .maybeSingle<ChainRow>();
    const detailed = row?.mode === "detailed";

    let modelUrl: string | null;
    let chain: ChainState | null = null;
    if (detailed) {
      chain = await advanceChain(supabase, taskId, row);
      if (params.get("store") !== "1") {
        const { wholeUrl: _whole, splitUrl: _split, ...visible } = chain;
        return Response.json({ id: taskId, ...visible });
      }
      modelUrl = chain.status === "SUCCEEDED" ? (chain.splitUrl ?? null) : null;
      if (!modelUrl) return fail(`That generation is ${chain.status.toLowerCase()}, so there is nothing to keep yet.`, 409);
    } else {
      const task = await readTask(taskId);
      if (params.get("store") !== "1") {
        return Response.json(task);
      }
      if (task.status !== "SUCCEEDED" || !task.modelUrl) {
        return fail(`That task is ${task.status.toLowerCase()}, so there is nothing to keep yet.`, 409);
      }
      modelUrl = task.modelUrl;
    }

    // Filed straight into storage from here, and never sent back through this
    // function. A Vercel Function may answer with at most 4.5 MB, and a
    // textured model is 6-10 MB: proxying the bytes worked on a laptop and
    // would have failed on every textured or higher-detail generation in
    // production. The browser is told where the file went instead, and reads
    // it from storage, which has no such cap. Doing it here also means what
    // was paid for is kept the moment it exists, whether or not the tab that
    // asked for it is still open.
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return new Response(null, { status: 404 });

    const kept = chain ? await finishedModel(chain) : { bytes: await downloadModel(modelUrl), note: undefined };
    const path = modelPath(userData.user.id, taskId);
    const { error: uploadError } = await supabase.storage
      .from(MODEL_BUCKET)
      .upload(path, kept.bytes, { upsert: true, contentType: "model/gltf-binary" });
    if (uploadError) {
      return fail(`The model is ready, but it couldn't be saved (${uploadError.message}). Try again in a moment.`, 502);
    }

    // Short-lived: it only has to last until the browser has fetched the file.
    const { data: signed, error: signError } = await supabase.storage
      .from(MODEL_BUCKET)
      .createSignedUrl(path, 600);
    if (signError || !signed?.signedUrl) {
      return fail("The model was saved, but a link to it couldn't be made. Try again in a moment.", 502);
    }

    return Response.json({ path, signedUrl: signed.signedUrl, bytes: kept.bytes.byteLength, note: kept.note ?? null });
  } catch (error) {
    return handle(error);
  }
}
