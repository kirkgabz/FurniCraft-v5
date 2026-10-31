import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import {
  buildGenericPrompt,
  AiResponse,
  PIECE_NOUNS,
  ROLE_VOCAB_BY_FAMILY,
  type GenericShellGroupInfo,
  type Box3Like,
} from "@/lib/architect-analysis/generic-classify";
import type { FurnitureFamily } from "@/components/design/studio/studio-config";
import { isAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Labels an unfamiliar model's shell groups by structural role. Server-side
 * because it holds GOOGLE_GENERATIVE_AI_API_KEY -- the same key and model
 * `scripts/architect-analysis.mts` uses from the CLI.
 *
 * Two callers. /dev/model-lab is admitted as an admin. A shop owner turning a
 * photo into a template is admitted only with the `taskId` of a generation
 * their shop paid for, and every call spends one of that generation's capped
 * labelling passes (consume_analysis) -- so the Gemini spend a shop can cause
 * is bounded by Meshy spend it has already been billed for.
 */

type RequestBody = {
  displayName?: string;
  upAxis?: "x" | "y" | "z";
  modelBox?: Box3Like;
  groups?: GenericShellGroupInfo[];
  imageDataUrl?: string;
  legend?: Array<{ groupIndex: number; color: string }>;
  /** Which vocabulary to offer. Omitted means "generic", the chair/table list this route shipped with. */
  family?: FurnitureFamily;
  /** What kind of piece, when the caller knows; only the prompt's own name for the piece changes. */
  category?: string;
  /** The image has each group's number printed on it; see renderGroupsToDataUrl. */
  numbered?: boolean;
  /** The generation being labelled. Required of everyone but an admin. */
  taskId?: string;
};

export async function POST(request: Request) {
  // Every call spends a Gemini request against this project's key, so the
  // route makes its own check rather than trusting whichever page called it.
  // 404 rather than 403, matching /admin: the route does not advertise itself
  // to someone who may not use it.
  const admin = await isAdmin();
  let body: RequestBody | null = null;
  try {
    body = await request.json();
  } catch {
    // Answered after the gate, so a non-admin gets the same 404 either way.
  }

  const supabase = await createClient();
  const taskId = typeof body?.taskId === "string" && body.taskId ? body.taskId : null;
  if (!admin) {
    if (!taskId) return new Response(null, { status: 404 });
    const { data: mayRead } = await supabase.rpc("may_read_generation", { p_task_id: taskId });
    if (mayRead !== true) return new Response(null, { status: 404 });
  }
  if (!body) return Response.json({ error: "Invalid JSON body." }, { status: 400 });

  const { displayName, upAxis, modelBox, groups, imageDataUrl, legend } = body;
  if (
    typeof displayName !== "string" ||
    (upAxis !== "x" && upAxis !== "y" && upAxis !== "z") ||
    !modelBox ||
    !Array.isArray(groups) ||
    groups.length === 0
  ) {
    return Response.json({ error: "Missing or invalid required fields." }, { status: 400 });
  }

  // Defaulting rather than rejecting: this field did not exist until beds
  // did, and an older caller that never sends it still means the chair/table
  // vocabulary it was written against.
  const family: FurnitureFamily = body.family ?? "generic";
  if (!(family in ROLE_VOCAB_BY_FAMILY)) {
    return Response.json(
      { error: `Unknown family "${family}". Options: ${Object.keys(ROLE_VOCAB_BY_FAMILY).join(", ")}.` },
      { status: 400 }
    );
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      { error: "The server has no GOOGLE_GENERATIVE_AI_API_KEY configured (set it in .env.local)." },
      { status: 500 }
    );
  }

  // Spent before the call and not handed back if it fails: a pass the caller
  // could return is a pass that could be spent forever. See consume_analysis.
  let analysesRemaining: number | null = null;
  if (!admin && taskId) {
    const { data, error } = await supabase.rpc("consume_analysis", { p_task_id: taskId });
    // The message is written for the shop by the function itself.
    if (error) return Response.json({ error: error.message }, { status: 429 });
    analysesRemaining = typeof data === "number" ? data : null;
  }

  const category = typeof body.category === "string" && Object.hasOwn(PIECE_NOUNS, body.category) ? body.category : undefined;
  const prompt = buildGenericPrompt({ displayName, upAxis, family, category, numbered: body.numbered === true }, groups, modelBox, legend);
  const imageMatch = typeof imageDataUrl === "string" ? /^data:image\/png;base64,(.+)$/.exec(imageDataUrl) : null;

  try {
    const result = await generateObject({
      model: google("gemini-3.5-flash-lite"),
      schema: AiResponse,
      ...(imageMatch
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: prompt },
                  { type: "image" as const, image: Buffer.from(imageMatch[1], "base64") },
                ],
              },
            ],
          }
        : { prompt }),
    });
    return Response.json({ groups: result.object.groups, analysesRemaining });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "AI classification failed." }, { status: 502 });
  }
}
