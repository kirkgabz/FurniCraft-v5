/**
 * The order lifecycle, in one place.
 *
 *   pending_quote -> quoted -> confirmed -> payment_submitted -> in_production -> completed
 *                 \_________ declined ______________/
 *
 * The authority for these transitions is the database: guard_design_order_columns
 * in supabase/migrations/20260826000100_order_state_machine.sql rejects any move
 * that is not listed there, whichever client attempts it. What lives here is the
 * UI's view of the same table -- what to call each state, and which buttons to
 * offer -- so the two are easy to compare when either changes.
 *
 * Payment is a direct QR transfer to the shop. FurniCraft never holds the money,
 * which is why `payment_submitted` exists at all: the customer says they have
 * paid, and the shop confirms against its own GCash or bank app before anything
 * moves. Nothing here can verify a payment, and nothing here pretends to.
 */

export type OrderStatus =
  | "pending_quote"
  | "quoted"
  | "confirmed"
  | "payment_submitted"
  | "in_production"
  | "completed"
  | "declined";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending_quote",
  "quoted",
  "confirmed",
  "payment_submitted",
  "in_production",
  "completed",
  "declined",
];

type StatusMeta = {
  /** Shown on the badge. */
  label: string;
  /** What the shop owner is waiting on, or should do next. */
  shopHint: string;
  /** What the customer is waiting on, or should do next. */
  customerHint: string;
  /** Tailwind classes for the badge. */
  tone: string;
};

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending_quote: {
    label: "Needs quote",
    shopHint: "Send the customer a price and downpayment.",
    customerHint: "Waiting for the shop to price your design.",
    tone: "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]",
  },
  quoted: {
    label: "Quoted",
    shopHint: "Waiting for the customer to accept your quote.",
    customerHint: "Review the quote and confirm or decline it.",
    tone: "bg-[rgba(58,86,136,0.14)] text-[#3a5688]",
  },
  confirmed: {
    label: "Downpayment due",
    shopHint: "Waiting for the customer to pay and upload a receipt.",
    customerHint: "Pay the downpayment with the shop's QR, then upload the receipt.",
    tone: "bg-[rgba(192,138,62,0.18)] text-[#8a6118]",
  },
  payment_submitted: {
    label: "Receipt to check",
    shopHint: "Check your GCash or bank app, then approve or reject the receipt.",
    customerHint: "The shop is checking your payment.",
    tone: "bg-[rgba(231,156,76,0.2)] text-[#8a5a12]",
  },
  in_production: {
    label: "In production",
    shopHint: "Building. Mark completed when it ships.",
    customerHint: "Your piece is being built.",
    tone: "bg-[rgba(53,111,82,0.16)] text-[#356f52]",
  },
  completed: {
    label: "Completed",
    shopHint: "Done.",
    customerHint: "Done — you can leave the shop a review.",
    tone: "bg-[rgba(53,111,82,0.16)] text-[#356f52]",
  },
  declined: {
    label: "Declined",
    shopHint: "No longer active.",
    customerHint: "No longer active.",
    tone: "bg-[rgba(192,57,43,0.14)] text-[#a8452c]",
  },
};

/** Falls back rather than throwing: a stored value we do not recognise should not blank the page. */
export function orderStatusMeta(status: string): StatusMeta {
  return (
    ORDER_STATUS_META[status as OrderStatus] ?? {
      label: status.replace(/_/g, " "),
      shopHint: "",
      customerHint: "",
      tone: "bg-[rgba(122,105,96,0.14)] text-[var(--fc-muted)]",
    }
  );
}

/** Mirrors the shop half of the database guard. */
export const SHOP_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending_quote: ["quoted", "declined"],
  quoted: ["quoted", "declined"],
  // Accepted but never paid: the shop can let the slot go.
  confirmed: ["declined"],
  payment_submitted: ["in_production", "confirmed", "declined"],
  in_production: ["completed"],
};

/**
 * Mirrors the customer half of the database guard.
 *
 * A customer may stop their own order at any point before money is
 * involved. From payment_submitted onward a transfer may already have
 * happened, so cancelling is a refund conversation between two people
 * rather than a state either side can assert alone.
 */
export const CUSTOMER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  pending_quote: ["declined"],
  quoted: ["confirmed", "declined"],
  confirmed: ["payment_submitted", "declined"],
};

/** Statuses a customer can still call off themselves, because nothing has been paid. */
export function customerCanCancel(status: string): boolean {
  return customerCanMove(status, "declined");
}

export function shopCanMove(from: string, to: OrderStatus): boolean {
  return (SHOP_TRANSITIONS[from as OrderStatus] ?? []).includes(to);
}

export function customerCanMove(from: string, to: OrderStatus): boolean {
  return (CUSTOMER_TRANSITIONS[from as OrderStatus] ?? []).includes(to);
}

/** Statuses that still need someone to act, for the "needs response" counts. */
export const SHOP_ACTIONABLE: OrderStatus[] = ["pending_quote", "payment_submitted", "in_production"];
export const CUSTOMER_ACTIONABLE: OrderStatus[] = ["quoted", "confirmed"];

export const DOWNPAYMENT_MIN_PERCENT = 5;

/** Pesos, from a quote. Mirrors the generated column on design_orders. */
export function downpaymentOf(total: number | null, percent: number | null): number | null {
  if (total == null || percent == null) return null;
  return Math.round(total * percent) / 100;
}

export function formatPeso(value: number | null | undefined): string {
  if (value == null) return "—";
  return `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What the customer said they hoped to spend, as a range.
 *
 * Null when the order predates budgets, which is the caller's cue to fall back
 * to the estimate that order still carries. Whole pesos, no centavos: a budget
 * is a round intention, and "₱18,000.00 to ₱26,000.00" reads like an invoice
 * for a number nobody has committed to.
 */
export function formatBudget(
  min: number | null | undefined,
  max: number | null | undefined
): string | null {
  if (min == null || max == null) return null;
  const n = (value: number) => Number(value).toLocaleString("en-PH", { maximumFractionDigits: 0 });
  // One peso sign, not two, and a hyphen rather than the word "to". Written
  // out in full this ran to 19 characters and was clipped to "₱1,000 to ₱..."
  // in the orders table, which is worse than no second figure at all.
  return `₱${n(min)}-${n(max)}`;
}
