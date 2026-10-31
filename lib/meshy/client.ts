/**
 * A small typed client for Meshy's Image-to-3D API.
 *
 * This is the new front of the studio's upload pipeline: instead of a shop
 * owner needing a 3D model of their piece, they photograph it and Meshy
 * generates one, which then goes through exactly the same path an uploaded
 * .glb already does -- levelling, squaring, shell splitting, grouping, the
 * AI role pass, and the rig (see /dev/model-lab).
 *
 * Server-only. It holds MESHY_API_KEY, which must never reach the browser.
 *
 * The one setting that decides whether any of this is worth doing is
 * `model_type`. See MODEL_TYPE below.
 */

const OPENAPI_ROOT = "https://api.meshy.ai/openapi/v1";

/**
 * `smart-topology` (Meshy's meshy-t2) rather than the default `standard`,
 * because it is the only mode that returns NATIVELY SEPARATED PARTS.
 *
 * Everything downstream of an upload depends on the model splitting into
 * disconnected shells: that is how `splitMeshesIntoShells` finds legs, rails
 * and a headboard, how `groupShells` clusters them, and how the AI gets
 * something to label. A single fused surface -- which is what a generic
 * image-to-3D pass produces, with all the detail in the texture rather than
 * the geometry -- arrives as ONE shell, and the studio then offers a single
 * part with one finish and no rig. Nothing to resize, nothing to cost per
 * component, no blueprint worth printing.
 *
 * It is also the cheaper mode (5 credits against 20), which is a rare case of
 * the right choice being the affordable one.
 */
const MODEL_TYPE = "smart-topology";

/**
 * Face budget for the generated mesh. `smart-topology` accepts 100-15,000.
 *
 * At the ceiling. The pipeline's limits are counted in SHELLS, not faces --
 * it rejects an upload past 5,000 shells as a chunked scan -- and a piece of
 * furniture resolves into tens of shells however many triangles it carries.
 * Faces are what buy the shape of a turned leg or a moulded headboard, so
 * there is no reason to starve it. Raised from 12,000 when shops found some
 * generated pieces looked unfinished.
 */
const TARGET_POLYCOUNT = 15000;

/**
 * What each setting actually costs, measured against real tasks rather than
 * read off a changelog.
 *
 * Meshy bills smart-topology geometry at 5 credits and adds 10 more for
 * texturing (15 for 8k). The first three generations run here each consumed
 * 15 -- `consumed_credits` on the task record says so -- because texturing
 * was on by default.
 *
 * It is off by default now, because the texture buys this pipeline nothing.
 * Segmentation reads material NAMES, and a generated model carries exactly
 * one (`material-0`) whether it is textured or not. The studio then paints
 * the piece with its own finishes out of materials-db. All the texture
 * changes is what the "Original" finish looks like -- one option out of a
 * dozen -- for triple the price.
 */
export const CREDITS_UNTEXTURED = 5;
export const CREDITS_TEXTURED = 15;

export type MeshyStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type MeshyTask = {
  id: string;
  status: MeshyStatus;
  /** 0-100. */
  progress: number;
  modelUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  /**
   * What Meshy actually billed, straight off the task record.
   *
   * Reported rather than assumed: this pipeline was built on a documented
   * "5 credits" that turned out to be 15 in practice, because texturing is
   * added to the same task. A number the caller can see beats a number the
   * caller has to trust.
   */
  consumedCredits: number | null;
  /** A split task's own count of the parts it produced; null on every other kind. */
  partCount?: number | null;
};

/** Thrown for anything the caller should show a person, rather than a stack trace. */
export class MeshyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "MeshyError";
  }
}

function apiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) {
    throw new MeshyError(
      "The server has no MESHY_API_KEY configured. Add it to .env.local (get one at meshy.ai under Settings -> API).",
      500
    );
  }
  return key;
}

/**
 * Turns Meshy's error bodies into something worth reading.
 *
 * Out of credits and a bad key are the two failures a student plan actually
 * hits, and both arrive as a bare status code with a terse body. Saying which
 * one happened is the difference between "it broke" and "top up, or check the
 * key".
 */
async function explain(response: Response): Promise<never> {
  let detail = "";
  try {
    const body = await response.json();
    detail = body?.message ?? body?.error ?? "";
  } catch {
    // Non-JSON body -- the status alone will have to do.
  }

  if (response.status === 401 || response.status === 403) {
    throw new MeshyError(`Meshy rejected the API key${detail ? ` (${detail})` : ""}.`, response.status);
  }
  if (response.status === 402) {
    throw new MeshyError(
      `Out of Meshy credits${detail ? ` (${detail})` : ""}. A generation costs ${CREDITS_UNTEXTURED} credits, or ${CREDITS_TEXTURED} with textures.`,
      402
    );
  }
  if (response.status === 429) {
    throw new MeshyError("Meshy is rate-limiting this key. Wait a moment and try again.", 429);
  }
  throw new MeshyError(detail || `Meshy returned ${response.status}.`, response.status);
}

/**
 * Quick is the smart-topology generation above. Detailed is the chain
 * described in 20260921000100_detailed_generations.sql: a standard-mode model
 * with real detail in its geometry, which arrives fused into one surface and
 * is then split into parts.
 */
export type GenerationMode = "quick" | "detailed";

/**
 * The detailed model's face budget.
 *
 * Standard mode accepts up to 300,000, but the result is loaded on a
 * customer's phone. Measured on a real table: 80,000 asked for gave 79,092
 * faces and a 2.4 MB untextured file, and carried the fluting and rounded
 * corners the 15,000-face ceiling above could not. 60,000 keeps that detail
 * with room to spare on a phone.
 */
const DETAILED_POLYCOUNT = 60000;

/**
 * Meshy 6, pinned -- not `latest`, and not the newer 7.1.
 *
 * Measured on the same photograph of a pedestal coffee table, each textured
 * in one task and split with the same prompt:
 *
 *   meshy-6    the stone top and the dark plinth as photographed, and a split
 *              into 3 parts: top, pedestal, plinth.
 *   meshy-7.1  the stone top read as timber and the plinth as cream, and a
 *              split into 23 parts, most of them slivers of the fluting.
 *   7.1 + 2k   the same, plus a wavier fluting and a tabletop cut in half,
 *              for 5 credits more.
 *
 * 7.1 carves deeper detail, which is exactly what makes its splits shatter:
 * every flute becomes something the split can cut along, and the AI then has
 * two dozen groups to name instead of three. `geometry_resolution` is 7.1's
 * alone, so it is not offered here either.
 */
const DETAILED_AI_MODEL = "meshy-6";

/**
 * What the detailed chain costs at Meshy, from their pricing page and
 * confirmed against real tasks: 20 for a bare mesh, 30 with a 2K texture, and
 * 10 for the split that follows. Stated so the page a shop reads and the
 * platform's own bill are worked out from the same numbers.
 */
export const CREDITS_DETAILED_MESH = 20;
export const CREDITS_DETAILED_TEXTURED = 30;
export const CREDITS_SPLIT = 10;

/** Which Meshy endpoint a task lives under -- a task id alone does not say. */
export type MeshyTaskKind = "image-to-3d" | "multi-image-to-3d" | "print/split";

async function createTask(kind: MeshyTaskKind, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${OPENAPI_ROOT}/${kind}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) await explain(response);

  const reply = await response.json();
  const id = reply?.result;
  if (typeof id !== "string" || !id) {
    throw new MeshyError("Meshy accepted the request but returned no task id.", 502);
  }
  return id;
}

/**
 * Starts a generation and returns its task id and the endpoint it lives under.
 *
 * `images` are data URIs (`data:image/png;base64,...`), which is what a
 * browser file picker can produce without the photo ever needing a public
 * URL of its own -- a shop owner's snapshot of their own furniture shop should not
 * have to be hosted somewhere first.
 *
 * More than one photo is a detailed-only thing: Meshy's multi-photo mode has
 * no smart-topology option, so a quick generation reads the first photo only.
 */
export async function createImageTo3dTask(
  images: string | string[],
  options: { textured?: boolean; mode?: GenerationMode } = {}
): Promise<{ taskId: string; kind: MeshyTaskKind }> {
  const photos = Array.isArray(images) ? images : [images];
  const mode = options.mode ?? "quick";

  if (mode === "quick") {
    const textured = options.textured ?? false;
    const taskId = await createTask("image-to-3d", {
      image_url: photos[0],
      model_type: MODEL_TYPE,
      target_polycount: TARGET_POLYCOUNT,
      should_texture: textured,
      // Only meaningful alongside a texture, and sending it otherwise invites
      // being billed for a map nothing asked for.
      ...(textured ? { enable_pbr: true } : {}),
      // glTF only: it is the one format the whole pipeline speaks, and asking
      // for the others just spends time producing files nothing reads.
      target_formats: ["glb"],
    });
    return { taskId, kind: "image-to-3d" };
  }

  // Textured in this one task when a texture was asked for. The split used to
  // refuse a textured model, which is why the texture was once painted on
  // afterwards and carried back across; it accepts one now, and drops the
  // texture from its own output -- which costs nothing here, because the
  // parts are cut from THIS model and keep its texture and its UVs.
  const textured = options.textured ?? false;
  const detailed = {
    ai_model: DETAILED_AI_MODEL,
    should_remesh: true,
    topology: "triangle",
    target_polycount: DETAILED_POLYCOUNT,
    should_texture: textured,
    ...(textured ? { enable_pbr: true, texture_resolution: "2k" } : {}),
    target_formats: ["glb"],
  };
  if (photos.length > 1) {
    return { taskId: await createTask("multi-image-to-3d", { image_urls: photos.slice(0, 4), ...detailed }), kind: "multi-image-to-3d" };
  }
  return { taskId: await createTask("image-to-3d", { image_url: photos[0], model_type: "standard", ...detailed }), kind: "image-to-3d" };
}

/**
 * Splits a detailed model into parts.
 *
 * `by_parts` names the parts to look for (see split-prompts.ts), which is what
 * made a coffee table come back as top, pedestal and plinth rather than
 * arbitrary slices. `auto` is the fallback when that fails.
 *
 * Meshy built this for 3D printing, which shows in two defaults that are
 * wrong here and so are stated: `assembled` keeps every part where it stood
 * rather than laying them flat on a print bed, and no connectors, which would
 * cut pegs and sockets into the furniture.
 */
export async function createSplitTask(inputTaskId: string, mode: "by_parts" | "auto", prompt?: string): Promise<string> {
  return createTask("print/split", {
    input_task_id: inputTaskId,
    mode,
    ...(mode === "by_parts" && prompt ? { prompt: prompt.slice(0, 600) } : {}),
    layout: "assembled",
    connectors: false,
    target_formats: ["glb"],
  });
}

/** Reads a task's current state. Safe to call repeatedly; this is the polling half. */
export async function readTask(taskId: string, kind: MeshyTaskKind = "image-to-3d"): Promise<MeshyTask> {
  const response = await fetch(`${OPENAPI_ROOT}/${kind}/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    // A poll must never be served from a cache, or the task looks stuck.
    cache: "no-store",
  });

  if (!response.ok) await explain(response);

  const body = await response.json();
  return {
    id: body?.id ?? taskId,
    status: (body?.status as MeshyStatus) ?? "PENDING",
    progress: typeof body?.progress === "number" ? body.progress : 0,
    modelUrl: body?.model_urls?.glb ?? null,
    thumbnailUrl: body?.thumbnail_url ?? null,
    error: body?.task_error?.message ?? null,
    consumedCredits: typeof body?.consumed_credits === "number" ? body.consumed_credits : null,
    partCount: typeof body?.part_count === "number" ? body.part_count : null,
  };
}

/**
 * Fetches the finished model, server-side.
 *
 * Fetched here rather than by the browser, because Meshy's download links
 * are signed for their own origin and a cross-origin fetch from the studio
 * would be refused. The caller files the bytes straight into storage rather
 * than returning them: a Vercel Function may answer with at most 4.5 MB,
 * which a textured model exceeds.
 */
export async function downloadModel(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new MeshyError(`Could not download the generated model (${response.status}).`, 502);
  }
  return response.arrayBuffer();
}
