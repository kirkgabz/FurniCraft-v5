import { createClient } from "@/lib/supabase/client";

/**
 * Fires the "your furniture is ready for pick up" email after an order is
 * marked completed. Fire-and-forget on purpose, from both call sites (the
 * order page and the shop dashboard): the status change is what matters and
 * has already succeeded by the time this runs, so a slow or failed email
 * must never look like a failed "Mark completed" to the shop owner clicking
 * the button. Failures are only logged.
 *
 * The function itself re-checks the order's status and the customer's own
 * preference before sending anything -- this just triggers it.
 *
 * The logging reads the function's response body rather than only the error
 * object, because invoke() reports a non-2xx as the bare line "Edge Function
 * returned a non-2xx status code" and throws the body away. That is how a
 * real fault stayed invisible for weeks: Resend was refusing every send with
 * 550 "The associated domain with your API key is not verified" -- the
 * sender was on mail.furnicraft.space, which never verified -- and the one
 * line that would have named it was the line being discarded.
 */
export function sendOrderReadyEmail(orderId: string) {
  const supabase = createClient();
  void supabase.functions
    .invoke("send-order-ready-email", { body: { order_id: orderId } })
    .then(async ({ error }) => {
      if (!error) return;
      // FunctionsHttpError carries the response; FunctionsFetchError and
      // FunctionsRelayError do not, so the body is optional.
      const response: Response | undefined = (error as { context?: Response }).context;
      let detail = "";
      try {
        const body = await response?.clone().json();
        if (body?.error) detail = ` -- ${body.error}`;
        else if (body?.skipped) detail = ` -- skipped: ${body.skipped}`;
      } catch {
        // A non-JSON or already-consumed body tells us nothing extra; the
        // error itself is still logged below.
      }
      console.error(`send-order-ready-email failed: ${error.message}${detail}`);
    });
}
