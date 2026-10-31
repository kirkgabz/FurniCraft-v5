/**
 * What a customer can report, and what it is called on both sides of the desk.
 *
 * One file rather than a list in the report dialog and a second list in the
 * admin queue, because the two have to agree about more than wording. The
 * category a customer picks decides which table the admin then reads for
 * context, and a category the queue does not know how to resolve renders as a
 * ticket with no evidence attached -- which is the one thing a moderation
 * queue must never do.
 *
 * ---------------------------------------------------------------------------
 * Why `category` is separate from `target_type`
 *
 * `reports.target_type` says which table the reported thing lives in. It
 * cannot say what went wrong, and for orders that is most of the question: a
 * payment dispute, a refund the shop never answered, and a piece that arrived
 * broken are three different desks' worth of work, and all three are
 * target_type 'design_order' pointing at the same row.
 *
 * So `category` records what the reporter said it was about, and `target_type`
 * stays exactly as it was -- which is also why this needed no change to the
 * target_type CHECK constraint.
 */

/** The tables a report can point at. Unchanged from 20260825000800. */
export type ReportTargetType = "shop_message" | "shop" | "design_order" | "shop_review";

/** What the report is about, as the reporter described it. */
export type ReportCategory = "chat" | "payment" | "refund" | "order" | "review" | "shop";

export type ReportTopic = {
  category: ReportCategory;
  targetType: ReportTargetType;
  /** Tab label in the admin queue, and the heading of the report dialog. */
  label: string;
  /** One line under the heading, saying what this topic is for. */
  blurb: string;
  /**
   * The reasons offered, most common first.
   *
   * A fixed list rather than a free-text box alone, for two reasons that pull
   * the same way: a queue of hand-typed reasons cannot be counted or sorted,
   * and someone angry enough to report something writes a worse description of
   * it than a list would have given them. Details stay free-text underneath,
   * because the list can never cover everything.
   */
  reasons: string[];
};

export const REPORT_TOPICS: Record<ReportCategory, ReportTopic> = {
  chat: {
    category: "chat",
    targetType: "shop_message",
    label: "Chat",
    blurb: "A message or photo someone sent you in a conversation.",
    reasons: [
      "Abusive or threatening language",
      "Harassment or unwanted contact",
      "Asking me to pay outside FurniCraft",
      "Scam or fraudulent offer",
      "Spam or advertising",
      "Shared someone's private information",
      "Something else",
    ],
  },
  payment: {
    category: "payment",
    targetType: "design_order",
    label: "Payment",
    blurb: "A problem with paying for this order.",
    reasons: [
      "I paid but the shop says they did not receive it",
      "The shop is asking for more than the quoted amount",
      "The shop asked me to pay to a different account",
      "I was asked to pay again for the same order",
      "The payment details shown look wrong or unsafe",
      "My receipt was rejected without a reason",
      "Something else",
    ],
  },
  refund: {
    category: "refund",
    targetType: "design_order",
    label: "Refund",
    blurb: "A problem with a refund you asked for.",
    reasons: [
      "The shop has not answered my refund request",
      "The refund was agreed but the money never arrived",
      "The refund was declined unfairly",
      "The amount returned was less than agreed",
      "The shop is refusing to discuss it",
      "Something else",
    ],
  },
  order: {
    category: "order",
    targetType: "design_order",
    label: "Order",
    blurb: "A problem with the order itself.",
    reasons: [
      "The piece is nothing like what I ordered",
      "It arrived damaged",
      "It is very late, or has stopped moving",
      "The shop has gone quiet",
      "The shop cancelled without explaining",
      "Something else",
    ],
  },
  review: {
    category: "review",
    targetType: "shop_review",
    label: "Review",
    blurb: "A review comment that should not be on the site.",
    reasons: [
      "Abusive or offensive language",
      "Not a real customer",
      "Spam or advertising",
      "Shared someone's private information",
      "Written about a different shop",
      "Something else",
    ],
  },
  shop: {
    category: "shop",
    targetType: "shop",
    label: "Shop",
    blurb: "A problem with a shop rather than one order.",
    reasons: [
      "Pretending to be a business it is not",
      "Listings that are not their own work",
      "Repeatedly takes payment and does not deliver",
      "Offensive content on the storefront",
      "Something else",
    ],
  },
};

/** The topics a customer picks between when reporting from an order. */
export const ORDER_TOPICS: ReportCategory[] = ["payment", "refund", "order"];

/** Queue tabs, in the order the admin sees them. */
export const TICKET_FILTERS: ReportCategory[] = ["chat", "payment", "refund", "order", "review", "shop"];

/**
 * The category of a report row, including rows filed before categories existed.
 *
 * Reports predating the column have `category` null, and every one of them is
 * a review report -- that was the only report button in the app. Rather than
 * an UPDATE across live moderation history to write down something the row
 * already implies, the fallback is worked out here from target_type, which is
 * the thing that was actually recorded at the time.
 */
export function categoryOf(report: {
  category?: string | null;
  target_type: string;
}): ReportCategory {
  const stated = report.category;
  if (stated && stated in REPORT_TOPICS) return stated as ReportCategory;

  switch (report.target_type) {
    case "shop_review":
      return "review";
    case "shop_message":
      return "chat";
    case "shop":
      return "shop";
    // An uncategorised order report cannot be narrowed further than "order" --
    // which is exactly the ambiguity the category column was added to end.
    default:
      return "order";
  }
}

export function topicOf(report: { category?: string | null; target_type: string }): ReportTopic {
  return REPORT_TOPICS[categoryOf(report)];
}

/** Longest reason or detail we will store, matching the reviews report button. */
export const MAX_REASON_LENGTH = 500;
export const MAX_DETAILS_LENGTH = 2000;
