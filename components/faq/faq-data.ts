/**
 * The FAQ widget's entire knowledge base and matcher.
 *
 * Deliberately not a call to a general-purpose model: a chat box that can say
 * anything is also a chat box that can be steered into describing the admin
 * panel, the database, or an internal policy nobody meant to publish. This
 * only ever recites one of the answers below, chosen by how well the
 * question's words overlap with an entry's -- so what it can say is exactly
 * this file's contents, nothing invented and nothing dug up from elsewhere.
 * A question that doesn't match well enough gets the "no answer" reply
 * instead of a guess.
 */

export type FaqEntry = {
  id: string;
  /** Shown verbatim as a quick-question chip, for entries where `quick` is true. */
  question: string;
  /** Extra words a real question might use, beyond what's already in `question`. */
  keywords: string[];
  answer: string;
  /** Featured as a tappable suggestion above the conversation. */
  quick?: boolean;
  /**
   * Which group this answer sits under on the Support page.
   *
   * A classification of answers that already existed, not new content. The
   * count shown beside a topic is how many of these carry it, so the number
   * and the list under it cannot drift apart.
   */
  topic: FaqTopicId;
};

export type FaqTopicId = "designing" | "money" | "orders" | "account";

export const FAQ_TOPICS: Array<{ id: FaqTopicId; label: string; blurb: string }> = [
  {
    id: "designing",
    label: "Designing & sending",
    blurb: "The studio, templates, and getting a design to a furniture shop.",
  },
  { id: "money", label: "Quotes & payment", blurb: "What a quote covers, downpayments, and refunds." },
  {
    id: "orders",
    label: "Your orders",
    blurb: "Statuses, messages from a shop, notifications and reviews.",
  },
  { id: "account", label: "Account & selling", blurb: "Settings, deleting an account, and opening a shop." },
];

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "what-is-furnicraft",
    topic: "designing",
    question: "What is FurniCraft?",
    keywords: ["about", "platform", "site", "website", "app", "furnicraft"],
    quick: true,
    answer:
      "FurniCraft is a platform for designing custom furniture in a 3D studio and sending that exact design to an independent Philippine furniture shop to build.\n\n" +
      "How it works, from start to finish:\n" +
      "• Design: pick a piece in the studio and change its parts, materials and measurements (in centimetres, or another unit you prefer).\n" +
      "• Send: add it to your cart, choose a shop, give your budget, and send. The shop receives the design itself, not a picture of it.\n" +
      "• Quote: the shop sends back a price and the downpayment it needs. You accept or decline.\n" +
      "• Pay: you pay the downpayment straight to the shop and upload your receipt. The shop checks it and starts building.\n" +
      "• Done: the shop marks the order completed, and you can leave a review.\n\n" +
      "FurniCraft is not the maker or the seller. The agreement and the payment are between you and the shop, and FurniCraft never holds your money.",
  },
  {
    id: "how-design-studio-works",
    topic: "designing",
    question: "How does the 3D design studio work?",
    keywords: ["design", "studio", "customize", "customise", "3d", "resize", "furniture", "editor", "measurements", "centimeters", "centimetres"],
    quick: true,
    answer:
      "Start by picking a piece: chairs, tables, sofas, cabinets, beds, bookshelves, desks or stools. Then:\n" +
      "• Drag to turn it, scroll or pinch to zoom, and click any part to select it. Every part is also listed beside the model, and you can hide one to see what is behind it.\n" +
      "• Choose a material for each part from real stock a Philippine furniture shop can buy, such as narra, kamagong, cane, glass and brass. \"Help me choose\" can rank them for you.\n" +
      "• Change its dimensions with sliders. They move the real model, and the overall size updates as you go. Sizes show in centimetres unless you pick another unit: millimetres, metres, inches, or feet and inches.\n" +
      "• Check durability: the studio checks the piece as you change it and warns you about weak spots, such as a shelf or seat that would sag, or a joint too thin for its material.\n" +
      "• Measure on screen, open the doors and drawers to look inside, and view the shop drawing, a dimensioned plan a carpenter can build from.\n\n" +
      "There is no price in the studio on purpose. You give a budget when you send the design, and the shop quotes it against its own materials.\n\n" +
      "When you are done, Save keeps it in My templates, or Add to cart gets it ready to send. A guided tour in the studio shows every control.",
  },
  {
    id: "send-to-shop",
    topic: "designing",
    question: "How do I send my design to a shop?",
    keywords: ["send", "order", "commission", "shop", "furniture shop", "submit"],
    answer:
      "1. In the studio, press Add to cart and choose how many you want (1 to 50).\n" +
      "2. Open your cart. Pieces are grouped by shop. Choose a shop for any piece that does not have one yet. Pressing \"Choose this shop\" on a shop's page sets where your orders go.\n" +
      "3. For each shop, give a budget range (required) and, if you like, a title, notes, and up to 4 reference images.\n" +
      "4. Send. Each shop gets its own order with the design file itself, so they open the exact piece you built, with its measurements and materials.\n\n" +
      "A piece you started from a shop's published template can only be sent to that shop.\n\n" +
      "After sending, follow the order under Orders in your dashboard. It starts as \"Needs quote\" until the shop prices it.",
  },
  {
    id: "how-quotes-work",
    topic: "money",
    question: "How do quotes and downpayment work?",
    keywords: ["quote", "quoted", "price", "downpayment", "deposit", "percent", "cost", "estimate"],
    quick: true,
    answer:
      "After the shop reviews your design and budget, it sends a quote. A quote has:\n" +
      "• The total price for the order.\n" +
      "• A downpayment percentage, at least 5% and at most 100%. The downpayment amount in pesos is worked out for you.\n" +
      "• Sometimes a breakdown, line by line (for example materials, labour, finishing, delivery or a discount). When there is one, it always adds up to the total.\n\n" +
      "You will get a notification, and the order shows \"Quoted\". Open it under Orders and choose:\n" +
      "• Accept: the order moves to \"Downpayment due\" and the shop's payment details appear.\n" +
      "• Decline: the order ends, and you can say why.\n\n" +
      "Nothing is paid until you accept and send the downpayment yourself. The shop may also revise a quote before you answer.",
  },
  {
    id: "how-payment-works",
    topic: "money",
    question: "How do I pay for my order?",
    keywords: ["pay", "payment", "gcash", "qr", "qr ph", "receipt", "money", "bank"],
    quick: true,
    answer:
      "You pay the shop directly. FurniCraft has no payment gateway and never holds or touches the money.\n\n" +
      "1. Accept the quote. The order shows \"Downpayment due\" with the amount to send.\n" +
      "2. Pay using the shop's payment details shown on the order: its QR code (GCash, QR Ph), or the e-wallet or bank account name and number the shop gives. They appear only after you accept the quote.\n" +
      "3. Upload a photo, screenshot or PDF of your receipt (under 5MB) and enter the reference number from your transfer. Both are required.\n" +
      "4. The order shows \"Receipt to check\". The shop checks its own GCash or bank app, then approves it and starts building (\"In production\").\n\n" +
      "If the shop rejects the receipt, the order goes back to \"Downpayment due\" with the shop's reason, and you can upload a new one.\n\n" +
      "Nobody from FurniCraft will ever ask you to send money to FurniCraft, or to any account other than the shop's own published details.",
  },
  {
    id: "order-statuses",
    topic: "orders",
    question: "What do the different order statuses mean?",
    keywords: ["status", "statuses", "quoted", "confirmed", "production", "completed", "declined", "track", "progress"],
    answer:
      "Every order moves through the same steps, in this order:\n" +
      "• Needs quote: the shop has your design and is pricing it.\n" +
      "• Quoted: the shop sent a price. Accept or decline it.\n" +
      "• Downpayment due: you accepted. Pay the shop and upload your receipt.\n" +
      "• Receipt to check: the shop is confirming your payment against its own records.\n" +
      "• In production: the shop confirmed your payment and is building your piece.\n" +
      "• Completed: the shop has finished. You can now leave a review.\n" +
      "• Declined: the order was called off by you or the shop, usually with a reason. This is final.\n\n" +
      "You can cancel your own order yourself while it is at Needs quote, Quoted or Downpayment due, because no money has moved yet. After you have uploaded a receipt, cancelling is no longer a button: talk to the shop, and use a refund request if money needs to come back.\n\n" +
      "Open Orders in your dashboard and select an order to see exactly where it stands. You get a notification whenever it changes.",
  },
  {
    id: "messaging-shops",
    topic: "orders",
    question: "Can I message a shop directly?",
    keywords: ["message", "messages", "chat", "talk", "contact", "conversation"],
    answer:
      "Yes. Open Messages in your dashboard, or press Message on a shop's page.\n\n" +
      "You have one conversation with each shop. Order updates appear in it as order cards, such as a new quote, your receipt, or a status change, with buttons that open the order and its 3D design.\n\n" +
      "Above the message box there is a row of quick questions, such as the shop's opening hours. Tapping one gives an instant answer taken only from what the shop has published on its page. Those quick questions are not sent to the shop. Anything you type yourself goes to the shop.\n\n" +
      "You get a notification when the shop replies.",
  },
  {
    id: "reviews",
    topic: "orders",
    question: "How do reviews and ratings work?",
    keywords: ["review", "reviews", "rating", "ratings", "rate", "feedback", "anonymous", "stars"],
    quick: true,
    answer:
      "You can review a shop once you have a completed order with it. A review has:\n" +
      "• A rating from 1 to 5 stars.\n" +
      "• A comment, if you want to add one.\n" +
      "• Three quick questions: was the piece as described, was communication clear, and would you recommend the shop.\n\n" +
      "You can choose \"Post as an anonymous reviewer\", and your review then shows as Anonymous on the shop's page.\n\n" +
      "You have one review per shop. Writing again updates it, and you can delete it.\n\n" +
      "Shop pages show the average rating, the number of reviews, and every review. A shop can report a review it believes is abusive, and FurniCraft's admins decide whether to remove it.",
  },
  {
    id: "become-a-seller",
    topic: "account",
    question: "How do I become a seller / open a shop?",
    keywords: ["seller", "shop owner", "open a shop", "apply", "sell", "furniture shop", "become"],
    quick: true,
    answer:
      "From your dashboard, choose Become a Seller and fill in the two-step application:\n" +
      "1. Your shop: shop name, description, business address, and a link where the shop can be found (for example its Facebook page).\n" +
      "2. Verification: the name exactly as registered with the BIR, a copy of your BIR Certificate of Registration (Form 2303), and a valid government ID such as a PhilID, driver's license or passport. Each file must be under 10 MB.\n\n" +
      "A FurniCraft administrator checks the shop name and BIR name against your documents before approving. While you wait, you can already prepare your storefront. It goes live to customers once you are approved.\n\n" +
      "Approval confirms that a registered business exists. It is not a guarantee of any particular shop's work.",
  },
  {
    id: "shop-dashboard",
    topic: "account",
    question: "What can a shop do from their dashboard?",
    keywords: ["shop dashboard", "shop owner", "orders", "templates", "storefront", "manage"],
    answer:
      "The shop dashboard has these sections:\n" +
      "• Dashboard: what is waiting on the shop today.\n" +
      "• Storefront: edit the shop page (logo, cover, details, address and map, photos, policies), set payment details, choose the materials you work in, and add optional links to Facebook, Instagram or your own website.\n" +
      "• Orders: designs customers have sent. Send quotes (with an optional line-by-line breakdown and a private cost sheet), approve a receipt to start production or reject it, mark orders completed, and answer refund requests.\n" +
      "• Templates: publish 3D pieces customers can open in the studio and make their own.\n" +
      "• Messages: one conversation with each customer.\n" +
      "• Reviews: what customers said, with the option to report an abusive review.\n" +
      "• Subscription: your plan, photo generations left, and upgrading to Pro.\n" +
      "• Support: the Help centre, and a chat with FurniCraft support.\n" +
      "• Settings: appearance, accepting new orders, deactivating the shop, pricing for your cost sheet, customer service, and deleting your account.",
  },
  {
    id: "refunds",
    topic: "money",
    question: "How do refunds work?",
    keywords: ["refund", "refunds", "cancel", "money back"],
    answer:
      "You can request a refund once money may have changed hands: when the order is at Receipt to check, In production or Completed. Before that, simply cancel the order.\n\n" +
      "1. Open the order and choose Request a refund, then say what went wrong.\n" +
      "2. The shop answers in one of two ways:\n" +
      "• Declines, with a reason. If circumstances change, you can ask again.\n" +
      "• Marks it refunded, recording the amount sent back (never more than the quoted total) and the transfer reference, such as a GCash reference number.\n\n" +
      "Both of you are notified at each step.\n\n" +
      "Because you paid the shop directly, the shop sends the money back itself. FurniCraft records the request and the outcome, but it cannot reverse a transfer or refund on a shop's behalf.",
  },
  {
    id: "notifications",
    topic: "orders",
    question: "How do notifications work?",
    keywords: ["notification", "notifications", "email", "alert", "bell"],
    answer:
      "The notification bell at the top of your dashboard shows a count of what is new. Tapping a notification takes you straight to the order or conversation it is about.\n\n" +
      "You are notified about:\n" +
      "• New messages from a shop.\n" +
      "• Every change to your orders: a quote, a payment approved or rejected, production starting, the order completed, or the order declined.\n" +
      "• Refund updates.\n" +
      "• Replies from FurniCraft support.\n\n" +
      "You can also get an email when a shop marks your furniture ready for pick up. Turn on \"Order ready emails\" in Settings.",
  },
  {
    id: "settings",
    topic: "account",
    question: "What can I change in Settings?",
    keywords: ["settings", "appearance", "dark mode", "theme", "preferences", "account"],
    answer:
      "Settings in your dashboard has:\n" +
      "• Appearance: switch between light mode and dark mode.\n" +
      "• Order ready emails: get an email when a shop marks your furniture ready for pick up, as well as the notification in FurniCraft.\n" +
      "• Delete account: schedules your account for permanent deletion.\n\n" +
      "Support has its own section in both the customer and the shop dashboard. Shop owners find the shop's own settings, such as accepting new orders, under Settings in the shop dashboard.",
  },
  {
    id: "delete-account",
    topic: "account",
    question: "How do I delete my account?",
    keywords: ["delete", "deletion", "remove account", "close account"],
    answer:
      "Go to Settings and choose Delete account, then confirm.\n\n" +
      "• You are signed out straight away.\n" +
      "• After 30 days, your personal details are removed and the account can never be signed in to again. Order records stay, so the shop or customer on the other side of each order keeps its history.\n" +
      "• Changed your mind? Sign back in any time before the 30 days are up. That cancels the deletion and restores full access.\n\n" +
      "Once the 30 days pass, the deletion cannot be undone.",
  },
  {
    id: "templates",
    topic: "designing",
    question: "What are design templates?",
    keywords: ["template", "templates", "starting point", "room concept", "draft"],
    answer:
      "Templates are designs you can open in the studio as a starting point instead of a blank piece. There are two kinds:\n" +
      "• Yours: designs you saved with Save in the studio, and your drafts. Find them under My templates in your dashboard.\n" +
      "• A shop's: pieces a shop has published on its page for customers to make their own. You will find them on each shop's page, and room concepts from the shop you have chosen appear under My templates.\n\n" +
      "Opening a template loads the full 3D design, so you can change it like any other piece.\n\n" +
      "A design started from a shop's template stays with that shop. It can only be sent to the shop that published it.",
  },
  {
    id: "cart",
    topic: "designing",
    question: "Can I send more than one piece in an order?",
    keywords: ["cart", "multiple pieces", "several", "set", "many items"],
    answer:
      "Yes. Your cart holds up to 12 different pieces, each with its own quantity from 1 to 50, so a whole set (a table and six matching chairs, for example) can go together.\n\n" +
      "Pieces can go to different shops. The cart groups them by shop, and sending creates one order per shop, each with its own quote, payment and conversation.\n\n" +
      "Your cart is kept on this device until you send it. Nothing in it reaches a shop or is priced until you press send.",
  },
  {
    id: "contact-support",
    topic: "account",
    question: "How do I contact FurniCraft support?",
    keywords: ["support", "help", "contact", "customer service", "problem", "issue"],
    quick: true,
    answer:
      "• Open Support in your dashboard, customer or shop, and choose Support. Shop owners can also use Customer service in the shop's Settings.\n" +
      "• Under Still stuck?, tap a common problem for an answer straight away, or type a message at the bottom of the chat.\n\n" +
      "Your messages go to FurniCraft's admin team, who reply in the same conversation. You will get a \"FurniCraft support replied\" notification when they do.\n\n" +
      "Your support conversation is private between you and FurniCraft. Shops and other customers cannot see it.\n\n" +
      "For questions about a specific order, such as the price, timing or the piece itself, message the shop directly from Messages.",
  },
];

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "do", "does", "did",
  "how", "what", "when", "where", "why", "who", "which",
  "can", "could", "should", "would", "will", "shall",
  "i", "im", "my", "me", "you", "your", "it", "its", "this", "that", "these", "those",
  "to", "for", "of", "in", "on", "at", "by", "with", "about", "and", "or", "so", "if",
  "have", "has", "had", "get", "got", "just", "please", "want", "need",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/**
 * How much a query's words overlap one entry's question + keywords, as a
 * fraction of the query's own word count -- a short, on-topic question then
 * scores as well as a long one. A word that isn't an exact hit still counts
 * for a partial share when it's a common prefix of at least 4 letters
 * ("review" / "reviews", "pay" is too short to count, "payment" / "paying"
 * does), which is a cheap stand-in for plurals and verb endings without
 * pulling in a real stemmer for a handful of FAQ entries.
 */
function scoreEntry(queryTokens: string[], entry: FaqEntry): number {
  const bag = tokenize(`${entry.question} ${entry.keywords.join(" ")}`);
  if (bag.length === 0 || queryTokens.length === 0) return 0;

  let hits = 0;
  for (const token of queryTokens) {
    if (bag.includes(token)) {
      hits += 1;
      continue;
    }
    const partial = bag.some(
      (word) => Math.min(word.length, token.length) >= 4 && (word.startsWith(token) || token.startsWith(word))
    );
    if (partial) hits += 0.7;
  }
  return hits / queryTokens.length;
}

/** Below this, the best match is treated as a coincidence rather than an answer. */
const MATCH_THRESHOLD = 0.5;

export function answerFaq(question: string): { entry: FaqEntry | null; score: number } {
  const queryTokens = tokenize(question);
  if (queryTokens.length === 0) return { entry: null, score: 0 };

  let best: FaqEntry | null = null;
  let bestScore = 0;
  for (const entry of FAQ_ENTRIES) {
    const score = scoreEntry(queryTokens, entry);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  return bestScore >= MATCH_THRESHOLD ? { entry: best, score: bestScore } : { entry: null, score: bestScore };
}

export const FAQ_FALLBACK_ANSWER =
  "I don't have a provided answer for that one. I can only answer from FurniCraft's own feature list -- try asking about designing furniture, sending an order, payments, reviews, becoming a seller, or your account settings.";

export const FAQ_QUICK_QUESTIONS = FAQ_ENTRIES.filter((entry) => entry.quick);
