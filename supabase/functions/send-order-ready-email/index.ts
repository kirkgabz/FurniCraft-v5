import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Sends the "your furniture is ready for pick up" email.
 *
 * Called by the client right after a shop marks an order completed --
 * fire-and-forget from that side, since a failed email must never look like
 * a failed status change. This function is the only place that decides
 * whether to actually send: it re-reads the order and the customer's own
 * preference itself rather than trusting whatever the caller claims, because
 * the caller is a shop owner's browser, not something this should extend
 * trust to for arbitrary email content.
 *
 * verify_jwt is on, so only a signed-in FurniCraft session can invoke this at
 * all; the service-role client below is what then lets it read the order and
 * resolve the customer's auth email, which the shop's own RLS-scoped session
 * has no reason to be able to do directly.
 */

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// furnicraft.space is the verified sending domain in Resend, so this can
// reach any customer's real inbox rather than only the Resend account owner.
//
// It used to be mail.furnicraft.space, which never verified -- two attempts
// at it sit in Resend marked Failed, and the subdomain carries no DKIM or
// SPF records at all, only the root domain does. Resend answers a send from
// an unverified domain with 550 "The associated domain with your API key is
// not verified", so every order-ready email was being refused; this call is
// fire-and-forget and only logs, so nothing said so out loud.
const FROM_ADDRESS = "FurniCraft <orders@furnicraft.space>";

// supabase.functions.invoke() is a plain cross-origin fetch from the
// browser, so it preflights with an OPTIONS request carrying the
// authorization/apikey/content-type headers the client sends. Without a
// matching Access-Control-Allow-* response the browser blocks the whole
// call client-side (net::ERR_FAILED) before this code ever sees it.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let orderId: string | undefined;
  try {
    const body = await req.json();
    orderId = body?.order_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!orderId) {
    return jsonResponse({ error: "order_id is required" }, 400);
  }

  if (!RESEND_API_KEY) {
    // Not the caller's fault -- surfaced as a clear config error rather than
    // a silent no-op, so a missing secret is noticed instead of just meaning
    // no email ever goes out.
    return jsonResponse({ error: "RESEND_API_KEY is not configured for this project" }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: order, error: orderError } = await supabase
    .from("design_orders")
    .select("id, project_name, customer_user_id, shop_id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    return jsonResponse({ error: "Order not found" }, 404);
  }

  // A side effect of the completed transition, not a general "email this
  // customer" tool -- refuses to fire for anything else regardless of what a
  // caller asks for.
  if (order.status !== "completed") {
    return jsonResponse({ skipped: "Order is not completed" }, 200);
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("full_name, email_notify_order_ready")
    .eq("id", order.customer_user_id)
    .maybeSingle();

  if (profile?.email_notify_order_ready === false) {
    return jsonResponse({ skipped: "Customer has this email disabled" }, 200);
  }

  const { data: customerAuth, error: customerAuthError } = await supabase.auth.admin.getUserById(
    order.customer_user_id
  );
  const customerEmail = customerAuth?.user?.email;
  if (customerAuthError || !customerEmail) {
    return jsonResponse({ error: "Could not resolve the customer's email" }, 404);
  }

  const { data: shop } = await supabase
    .from("shops")
    .select("shop_name")
    .eq("id", order.shop_id)
    .maybeSingle();
  const shopName = shop?.shop_name || "the shop";
  const customerName = profile?.full_name || "there";

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [customerEmail],
      subject: `${order.project_name} is ready for pick up`,
      html: `
        <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #2B1810;">
          <h2 style="margin-bottom: 4px;">Your furniture is ready</h2>
          <p>Hi ${customerName},</p>
          <p><strong>${order.project_name}</strong> is finished and ready for pick up from <strong>${shopName}</strong>.</p>
          <p style="color: #6b5d52; font-size: 13px;">You can turn this email off anytime in FurniCraft under Settings.</p>
        </div>
      `,
    }),
  });

  if (!resendResponse.ok) {
    const errorText = await resendResponse.text();
    return jsonResponse({ error: `Resend rejected the email: ${errorText}` }, 502);
  }

  return jsonResponse({ sent: true }, 200);
});
