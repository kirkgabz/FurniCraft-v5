/**
 * The problems the Support chat offers as tappable questions, before anyone
 * has to wait for a person.
 *
 * Separate from faq-data.ts on purpose: those explain how FurniCraft works,
 * these are what to do when something on screen is not working -- the errors
 * and dead ends people actually write in about. Split by who is asking,
 * because a shop and a customer hit different walls.
 *
 * Every answer describes what this app really does (the 5MB receipt limit, the
 * 5% minimum downpayment, payment details appearing only after a confirmed
 * quote). When the app changes, change the answer with it.
 *
 * Answered in the chat window only; nothing here is stored, so a tapped
 * question costs the support team nothing. The last line of every answer is
 * the way to a person.
 */

export type SupportAudience = "customer" | "shop";

export type TroubleshootingEntry = {
  id: string;
  question: string;
  answer: string;
};

const BOTH: TroubleshootingEntry[] = [
  {
    id: "page-loading",
    question: "A page keeps loading or shows nothing",
    answer:
      "• Refresh the page.\n" +
      "• Check your internet connection.\n" +
      "• Sign out, then sign in again. A sign-in that has expired can stop pages from loading.\n" +
      "• Try another browser, or a private window.\n\n" +
      "Still the same? Message support and tell us which page it is.",
  },
  {
    id: "studio-blank",
    question: "The 3D studio is blank or won't load",
    answer:
      "The studio needs a browser that can show 3D (WebGL).\n\n" +
      "• Update your browser to the latest version.\n" +
      "• Turn on hardware acceleration in your browser settings.\n" +
      "• Close other tabs and apps, especially on a phone.\n" +
      "• Try it on a computer if your phone is older.\n\n" +
      "Still blank? Message support with your device and browser.",
  },
  {
    id: "no-notification",
    question: "I didn't get a notification or email",
    answer:
      "• Open Notifications at the top of your dashboard. Every update is listed there, even if you missed the alert.\n" +
      "• Most updates are sent only there, not by email. The one order email FurniCraft sends tells a customer their furniture is ready for pick up.\n" +
      "• Customers can turn that email on or off in Settings. If it is on, check your spam or promotions folder.\n\n" +
      "Still missing? Message support with what you were waiting for.",
  },
];

const CUSTOMER: TroubleshootingEntry[] = [
  {
    id: "cant-send-order",
    question: "I can't send my order to a shop",
    answer:
      "The order summary says what is blocking it. The usual reasons:\n\n" +
      "• A piece has no furniture shop chosen yet. Choose one for it.\n" +
      "• No budget range yet. Fill in the lowest and highest you hope to spend.\n" +
      "• The highest figure is lower than the lowest one.\n" +
      "• A material in your design is not in that shop's stock. Edit the design, or move it to another shop.\n" +
      "• The shop has paused new orders. Move the piece to another shop.\n\n" +
      "None of these? Message support.",
  },
  {
    id: "no-payment-details",
    question: "I can't see the shop's payment details",
    answer:
      "A shop's GCash or bank details appear only after you confirm its quote. This keeps the shop's account private until you have agreed to the price.\n\n" +
      "• Open the order, go to Quote, and press Confirm quote.\n" +
      "• If you have confirmed and still see no details, the shop has not added them yet. Message the shop from the order.\n\n" +
      "Something else wrong? Message support.",
  },
  {
    id: "receipt-upload",
    question: "My payment receipt won't upload",
    answer:
      "• Use a photo or a PDF.\n" +
      "• Keep it under 5MB. A screenshot is usually small enough.\n" +
      "• Enter the reference number from your GCash or bank transfer; it is required.\n" +
      "• The order must be confirmed and not yet paid.\n\n" +
      "Still failing? Message support with the error you see.",
  },
  {
    id: "receipt-rejected",
    question: "The shop rejected my receipt",
    answer:
      "The shop could not match your receipt to a payment in its own account. Their reason is shown on the order.\n\n" +
      "• Check the amount and the reference number.\n" +
      "• Upload a new receipt from the same order.\n" +
      "• Message the shop if you are sure the payment went through.\n\n" +
      "If you and the shop cannot settle it, open the order's Message shop tab and use Report a problem, or message support.",
  },
  {
    id: "design-not-saved",
    question: "My design disappeared or didn't save",
    answer:
      "• Open My templates. Designs you saved are under Saved designs. Designs you changed but did not save are kept under Drafts.\n" +
      "• You need to be signed in for a design to be kept in your account.\n" +
      "• Adding a piece to the cart does not save it as a design. Look in Cart, and in Drafts.\n\n" +
      "Still missing? Message support with the design's name.",
  },
];

const SHOP: TroubleshootingEntry[] = [
  {
    id: "shop-not-visible",
    question: "Customers can't find my shop",
    answer:
      "A shop is listed for customers only when all of these are true:\n\n" +
      "• FurniCraft has approved your shop application.\n" +
      "• Your shop is active. Check Deactivate shop in Settings.\n" +
      "• Your shop or account has not been suspended by FurniCraft.\n\n" +
      "A shop that has paused new orders is still listed; customers just cannot choose it until you start accepting orders again.\n\n" +
      "All of these are fine and it is still hidden? Message support.",
  },
  {
    id: "cant-send-quote",
    question: "I can't send a quote",
    answer:
      "• Enter a total price, or add breakdown lines; the total is then their sum.\n" +
      "• The downpayment must be between 5% and 100%.\n" +
      "• A quote can only be sent or changed until the customer confirms it.\n\n" +
      "The error is shown under the quote form. Still stuck? Message support with what it says.",
  },
  {
    id: "customer-no-payment-details",
    question: "A customer says they can't see my payment details",
    answer:
      "Customers see your payment details only after they confirm your quote.\n\n" +
      "• Ask them to open the order and press Confirm quote.\n" +
      "• Check that your GCash or bank details and QR are saved under Storefront → Payment details.\n\n" +
      "Both done and still empty for them? Message support.",
  },
  {
    id: "generation-failed",
    question: "My photo-to-3D generation failed",
    answer:
      "• Use a photo of the whole piece against a plain background.\n" +
      "• Enter the piece's real height before adding the photo.\n" +
      "• If the model comes out in a form FurniCraft cannot use, that generation goes back to your allowance while this period's retries last. A result you simply do not like is not returned.\n" +
      "• If you closed the page while it was running, open Make a template from a photo again and pick it up under Unfinished, without spending again.\n\n" +
      "Still failing? Message support with the time it happened.",
  },
  {
    id: "template-hidden",
    question: "My template doesn't show on my shop page",
    answer:
      "• In Templates, check it is not marked Hidden from customers.\n" +
      "• Make sure your shop is active in Settings.\n" +
      "• Refresh the page after publishing.\n\n" +
      "Still not showing? Message support with the template's name.",
  },
  {
    id: "receipt-wont-open",
    question: "I can't open a customer's receipt",
    answer:
      "Each press of View receipt opens the receipt in a new tab through a fresh private link.\n\n" +
      "• If nothing opens, your browser may have blocked the new tab. Allow pop-ups for FurniCraft and press View receipt again.\n\n" +
      "Still won't open? Message support with the order's name.",
  },
  {
    id: "pro-not-active",
    question: "My Pro subscription hasn't switched on",
    answer:
      "FurniCraft checks your payment proof against its own account before switching your shop to Pro. You get a notification when it is done.\n\n" +
      "• Make sure the reference number you entered matches your receipt.\n\n" +
      "Taking longer than you expected? Message support.",
  },
];

export function troubleshootingFor(audience: SupportAudience): TroubleshootingEntry[] {
  return audience === "shop" ? [...SHOP, ...BOTH] : [...CUSTOMER, ...BOTH];
}
