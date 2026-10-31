/** A conversation is scoped to the account's customer or shop inbox. */
export type MessageConversation =
  | { audience: "personal"; shopId: string }
  | { audience: "shop"; customerUserId: string };

type MessageNotification = {
  type: string;
  link: string | null;
  audience?: string;
};

export function isMessageNotification(notification: MessageNotification): boolean {
  return typeof notification.type === "string" && notification.type.startsWith("message");
}

/** Read the conversation from the same deep links emitted by the message trigger. */
export function messageConversationFromLink(notification: MessageNotification): MessageConversation | null {
  if (!isMessageNotification(notification) || !notification.link) return null;
  try {
    const url = new URL(notification.link, "https://furnicraft.local");
    if (url.origin !== "https://furnicraft.local" || url.searchParams.get("section") !== "messages") return null;
    const shopId = url.searchParams.get("shop");
    const customerUserId = url.searchParams.get("customer");
    if (url.pathname === "/protected" && shopId && notification.audience !== "shop") {
      return { audience: "personal", shopId };
    }
    if (url.pathname === "/protected/shop" && customerUserId && notification.audience !== "personal") {
      return { audience: "shop", customerUserId };
    }
  } catch {
    // A missing or malformed target must not hide an incoming notification.
  }
  return null;
}

export function sameMessageConversation(a: MessageConversation | null, b: MessageConversation | null): boolean {
  if (!a || !b || a.audience !== b.audience) return false;
  return a.audience === "personal" && b.audience === "personal"
    ? a.shopId === b.shopId
    : a.audience === "shop" && b.audience === "shop" && a.customerUserId === b.customerUserId;
}

// Tab-local state: effects release it when a route is hidden by Next Activity.
let current: { owner: symbol; conversation: MessageConversation } | null = null;
const listeners = new Set<() => void>();

export function getActiveMessageConversation(): MessageConversation | null {
  return current?.conversation ?? null;
}

export function subscribeActiveMessageConversation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function registerActiveMessageConversation(conversation: MessageConversation): () => void {
  const owner = Symbol();
  current = { owner, conversation };
  listeners.forEach((listener) => listener());
  return () => {
    // A previously visible thread's cleanup must not clear a newer thread.
    if (current?.owner !== owner) return;
    current = null;
    listeners.forEach((listener) => listener());
  };
}
