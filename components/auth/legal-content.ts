/**
 * The Terms and Conditions and the Privacy Policy a customer accepts at
 * sign-up, written as a deck of sections rather than one wall of text.
 *
 * Two rules govern what is written here, and both come from PRODUCT.md.
 *
 * The first is that nothing in this file may describe a FurniCraft that does
 * not exist. `shop-policies.ts` already refuses to present the platform's
 * standard terms as a named furniture shop's own commitment, for the reason that a
 * customer might act on them; the same care applies in the other direction. So
 * every clause below is traceable to how the product actually works: payment is
 * direct and manual, nothing in the system can verify it, orders move through a
 * seven-state lifecycle, access is enforced by row-level security, shops are
 * vetted on BIR registration and an ID. Nothing here promises escrow, refunds,
 * buyer protection, or a verification FurniCraft cannot perform.
 *
 * The second is that the reader is a first-timer on a phone. Sections are short
 * and named for what they cost the reader -- "Paying for your order", not
 * "Consideration" -- and the sentence that matters most in each one comes
 * first. The deck is paged in the dialog so the reader arrives at every section
 * deliberately instead of scrolling past all of them at once.
 */

export type LegalSection = {
  id: string;
  /** Which document the section belongs to, shown above its title. */
  doc: "Terms and Conditions" | "Privacy Policy";
  title: string;
  /** One paragraph per entry. */
  body: string[];
};

/** Shown in the dialog so a reader can tell a revision from the one they accepted. */
export const LEGAL_LAST_UPDATED = "17 October 2026";

const TERMS: LegalSection[] = [
  {
    id: "what-furnicraft-is",
    doc: "Terms and Conditions",
    title: "What FurniCraft is",
    body: [
      "FurniCraft is where you design a piece of furniture and send that design to an independent Philippine furniture shop. We are not the maker and not the seller.",
      "The agreement to build your piece, and to pay for it, is between you and the shop you choose. FurniCraft carries the design, the conversation and the record of what was agreed — it is not a party to the sale.",
      "Shops apply to trade here and are reviewed by an administrator against their BIR registration and a valid ID before they can accept orders. That review checks that a business exists. It is not a guarantee of any particular shop's work.",
    ],
  },
  {
    id: "your-account",
    doc: "Terms and Conditions",
    title: "Your account",
    body: [
      "Give your real name, phone number and address. A furniture shop uses them to quote the piece, ask you questions and deliver it, so an account with invented details is one that cannot be served.",
      "Keep your password to yourself. Anything done from your account is treated as done by you, so tell us through the Support screen in your dashboard if you think someone else has access.",
      "Use one account, and only make one if you are old enough to enter a contract where you live.",
    ],
  },
  {
    id: "designs-and-orders",
    doc: "Terms and Conditions",
    title: "Designs and orders",
    body: [
      "The design is the order. What you pose in the studio is what the shop receives — dimensions in centimetres, materials, finishes and a dimensioned drawing — not a screenshot with a caption.",
      "An order moves through fixed steps: you send it, the shop quotes it, you confirm, you pay the shop directly, the shop builds it, and it completes. A shop can also decline an order it cannot take.",
      "A quote is the shop's price for that design. Changing the design after a quote means the shop may need to quote again, and once work has started your piece may already be cut from timber — ask the shop before requesting a change.",
      "Each shop publishes its own terms for deposits, lead times, changes and cancellation. Those are the terms that govern your build, and they are worth reading before you send a design.",
    ],
  },
  {
    id: "paying",
    doc: "Terms and Conditions",
    title: "Paying for your order",
    body: [
      "You pay the shop directly, using the GCash or QR Ph details that shop publishes. No money passes through FurniCraft, and we never hold your payment.",
      "When you mark an order as paid and upload your receipt, you are telling the shop you have paid. FurniCraft cannot check that with any bank — the shop confirms it against its own records. Nothing in this app verifies a payment.",
      "Because of that, a dispute about money is between you and the shop. We can show what was designed, quoted and said in the thread; we cannot reverse a transfer, and we do not offer refunds or buyer protection on the shop's behalf.",
      "Nobody at FurniCraft will ever ask you to send money to us, or to an account other than the shop's own published details. Treat any such request as a scam and report it through Support.",
    ],
  },
  {
    id: "content-and-conduct",
    doc: "Terms and Conditions",
    title: "Your designs and conduct",
    body: [
      "Your designs stay yours. You let FurniCraft store them and show them to the shop you send them to, which is what makes an order work.",
      "Do not upload anything unlawful, or anything you do not have the right to share, and do not use messaging to harass a furniture shop or another customer. Fraud, abuse or impersonation can cost you access to the platform.",
    ],
  },
  {
    id: "availability",
    doc: "Terms and Conditions",
    title: "Availability, and what this is",
    body: [
      "FurniCraft is a student capstone project, provided as it is and without a service guarantee. It may be interrupted, changed or taken down, so keep your own copy of anything you would be sorry to lose.",
      "To the extent the law allows, FurniCraft is not liable for what a shop does or fails to do, or for loss arising from an interruption of the service. Nothing here limits rights you have under Philippine consumer law.",
      "If we change these terms, the date at the top of this document changes with them. Continuing to use FurniCraft after a change means accepting the version then published.",
    ],
  },
];

const PRIVACY: LegalSection[] = [
  {
    id: "what-we-store",
    doc: "Privacy Policy",
    title: "What we store",
    body: [
      "Your account details — name, email address, phone number and address — and the date you accepted these terms.",
      "Your saved designs, your orders and their history, the messages you exchange with a shop, any images you upload as a payment receipt, and reviews you leave on a completed order.",
      "We do not collect card numbers, bank sign-in details or GCash credentials. There is no payment gateway here, so those never reach FurniCraft at all.",
    ],
  },
  {
    id: "who-can-see-it",
    doc: "Privacy Policy",
    title: "Who can see it",
    body: [
      "The shop you send an order to sees what it needs to serve you: your design, your name and contact details, your messages and the receipt you upload. Other shops and other customers do not.",
      "An administrator reviewing a shop-owner application sees the business documents that applicant submitted. Customer accounts are not part of that review.",
      "This is enforced in the database itself, by row-level security policies, not only by what a screen chooses to display. A request for something that is not yours is refused at the source.",
    ],
  },
  {
    id: "keeping-and-removing",
    doc: "Privacy Policy",
    title: "Keeping it, and removing it",
    body: [
      "Your data is kept while your account exists. Orders and messages are also part of a shop's own record of a transaction, so a completed order's history is not erased from the shop's side when you leave.",
      "You can correct your details at any time from your dashboard, and you can ask for your account to be removed through the Support screen there.",
      "FurniCraft runs on Supabase for its database, authentication and file storage. Your data is held there and is not sold, and is not shared with advertisers.",
    ],
  },
];

/**
 * The deck the dialog pages through: the terms, then the privacy policy. One
 * continuous sequence rather than two dialogs, because a reader who opens
 * either link at sign-up is accepting both.
 */
export const LEGAL_DECK: LegalSection[] = [...TERMS, ...PRIVACY];

/** Where the Privacy Policy link should open the deck. */
export const PRIVACY_START_INDEX = TERMS.length;
