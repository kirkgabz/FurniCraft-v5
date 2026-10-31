import { generateObject } from "ai";
import { google } from "@ai-sdk/google";

import { createClient } from "@/lib/supabase/server";
import { materialById } from "@/components/design/studio/materials-db";
import {
  AssistantReply,
  MAX_QUESTION_CHARS,
  buildSystemPrompt,
  looksLikeAQuestion,
  sanitiseQuestion,
  type ShopFacts,
} from "@/lib/shop-assistant";

/**
 * Answers a customer's message from the shop's own published information.
 *
 * Server-side for two separate reasons, and both matter. The first is the
 * obvious one: GOOGLE_GENERATIVE_AI_API_KEY lives here and must never reach a
 * browser. The second is the one that makes the feature trustworthy -- the
 * shop's information is loaded HERE, from the database, rather than accepted
 * from the client. A route that took the shop's terms as a request parameter
 * would let anyone put words in a furniture shop's mouth by editing a fetch.
 *
 * ---------------------------------------------------------------------------
 * Nothing here writes to the database
 *
 * The answer is returned to the caller and forgotten. It is not inserted into
 * `shop_messages`, and that is a deliberate decision rather than a shortcut:
 *
 *  - The assistant only ever restates what the shop already published, so
 *    there is nothing for the shop to review, correct or disown. A machine
 *    reading a furniture shop's own opening hours back to a customer is not a
 *    statement the furniture shop needs to be accountable for.
 *  - `shop_messages` is the record of what two PEOPLE said to each other. It
 *    is what a dispute is judged on and what an admin reads on a report.
 *    Putting machine text in it, however well labelled, makes that record
 *    something else.
 *  - The insert policy on that table is `sender_user_id = auth.uid()`, so the
 *    only way to write an answer "from the shop" would be a service-role key
 *    or a security-definer function. Both are real privileges to hand a
 *    feature that does not need them.
 *
 * The customer's own question IS stored, by the ordinary send path, so the
 * shop still sees exactly what was asked and answers it properly.
 *
 * ---------------------------------------------------------------------------
 * Who may call it
 *
 * A signed-in user, about a shop that is approved and visible. The shop is
 * read through `shops_public`, the view that exists to exclude the applicant's
 * email and their uploaded BIR and ID documents; payment account details live
 * in another table this route never touches. So the grounding corpus is, by
 * construction, only what the customer could have read on the storefront
 * themselves.
 */

/** Per-user throttle, so one tab cannot spend the API budget. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
/**
 * In memory, which is the honest scope for it. This resets when the server
 * restarts and is not shared between instances, so it is a courtesy brake on
 * an ordinary user rather than a defence against a determined one -- the real
 * ceiling is the API quota. Said plainly here so nobody later mistakes it for
 * rate limiting.
 */
const recent = new Map<string, number[]>();

function overLimit(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(userId, hits);
  if (recent.size > 500) {
    for (const [id, times] of recent) if (!times.some((t) => now - t < WINDOW_MS)) recent.delete(id);
  }
  return hits.length > MAX_PER_WINDOW;
}

type Body = { shopId?: unknown; message?: unknown };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const shopId = typeof body.shopId === "string" ? body.shopId : null;
  const question = sanitiseQuestion(body.message);
  if (!shopId || !question) {
    return Response.json(
      { error: `A shopId and a message of 2-${MAX_QUESTION_CHARS} characters are required.` },
      { status: 400 }
    );
  }

  // Cheap local refusal before anything costs money: not everything a customer
  // types is a question, and a machine answering "ok thanks" is noise.
  if (!looksLikeAQuestion(question)) {
    return Response.json({ canAnswer: false, answer: "", needsShop: false });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return Response.json({ error: "Sign in to use the shop assistant." }, { status: 401 });
  }

  if (overLimit(userData.user.id)) {
    return Response.json(
      { error: "That is a lot of questions at once. Give it a minute." },
      { status: 429 }
    );
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    // 503 rather than 500: the code is fine, the deployment is not configured,
    // and the client treats this as "quietly show nothing" rather than as a bug.
    return Response.json(
      { error: "The shop assistant is not configured on this server (GOOGLE_GENERATIVE_AI_API_KEY)." },
      { status: 503 }
    );
  }

  // The shop, as any visitor could already read it.
  const { data: shopRow } = await supabase
    .from("shops_public")
    .select("id, shop_name, tagline, description, address, phone, hours, policies, social_links, map_url")
    .eq("id", shopId)
    .maybeSingle();

  if (!shopRow) {
    return Response.json({ error: "That shop is not available." }, { status: 404 });
  }

  const { data: templateRows } = await supabase
    .from("design_templates")
    .select("title, tag, description, allowed_materials")
    .eq("shop_id", shopId)
    // The assistant answers customers; a hidden piece is not on offer.
    .eq("is_hidden", false)
    .limit(12);

  const row = shopRow as {
    shop_name: string;
    tagline: string | null;
    description: string | null;
    address: string | null;
    phone: string | null;
    hours: string | null;
    policies: string | null;
    social_links: unknown;
    map_url: string | null;
  };

  const facts: ShopFacts = {
    name: row.shop_name,
    tagline: row.tagline,
    description: row.description,
    address: row.address,
    phone: row.phone,
    hours: row.hours,
    policies: row.policies,
    mapUrl: row.map_url,
    socials: Array.isArray(row.social_links)
      ? (row.social_links as Array<{ label?: string | null; url?: string | null }>)
      : null,
    templates: (templateRows ?? []).map((t) => {
      const template = t as {
        title: string;
        tag: string | null;
        description: string | null;
        allowed_materials: string[] | null;
      };
      return {
        title: template.title,
        tag: template.tag,
        description: template.description,
        // Ids become names here rather than in the prompt builder, because
        // "wood-narra" is a database key and "Narra" is the thing the shop and
        // the customer both actually say.
        materials:
          template.allowed_materials
            ?.map((id) => materialById(id)?.name)
            .filter((name): name is string => Boolean(name)) ?? null,
      };
    }),
  };

  try {
    const result = await generateObject({
      model: google("gemini-3.5-flash-lite"),
      schema: AssistantReply,
      system: buildSystemPrompt(facts),
      // The customer's words are a user message, never spliced into the
      // system prompt. Everything above is instruction, this is data -- which
      // is the only structural defence against a message that tries to talk
      // the assistant out of its own rules.
      prompt: question,
    });

    const { canAnswer, answer, needsShop } = result.object;
    const text = answer.trim();
    if (!canAnswer || !text) {
      return Response.json({ canAnswer: false, answer: "", needsShop });
    }
    return Response.json({ canAnswer: true, answer: text, needsShop });
  } catch (err) {
    // A failure here must never look like a failure to send the message: the
    // customer's message is already saved and on its way to the shop.
    console.error("shop-assistant failed:", err);
    return Response.json({ error: "The assistant could not answer just now." }, { status: 502 });
  }
}
