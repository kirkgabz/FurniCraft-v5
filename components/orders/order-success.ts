/**
 * What the success pill says after a write to an order went through.
 *
 * One table for every screen that moves an order -- the order page and both
 * dashboards -- so the same move is confirmed in the same words wherever it was
 * made. Read off the patch that was written, not off the order afterwards: a
 * receipt sent back and a quote accepted both land on "confirmed", and only the
 * patch says which happened.
 *
 * Returns null for a write that is not an action someone took (nothing to
 * confirm), so callers can pass every patch through it.
 */
export function orderSuccessMessage(
  patch: Record<string, unknown>,
  previousStatus?: string | null
): string | null {
  const status = typeof patch.status === "string" ? patch.status : null;
  const byCustomer = "customer_response" in patch;

  if (patch.refund_status === "requested") return "Refund request sent to the shop";
  if (patch.refund_status === "refunded") return "Refund recorded";
  if (patch.refund_status === "declined") return "Refund request answered";

  switch (status) {
    case "quoted":
      return previousStatus === "quoted" ? "Quote updated" : "Quote sent to the customer";
    case "confirmed":
      return byCustomer ? "Quote confirmed" : "Receipt sent back to the customer";
    case "payment_submitted":
      return "Receipt sent to the shop";
    case "in_production":
      return "Payment approved. Production started";
    case "completed":
      return "Order marked completed";
    case "declined":
      // Called off after the quote was accepted, by either side.
      if (previousStatus === "confirmed") return "Order cancelled";
      return byCustomer ? "Quote declined" : "Order declined";
    default:
      return null;
  }
}
