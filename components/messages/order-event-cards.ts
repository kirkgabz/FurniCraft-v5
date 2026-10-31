import type { ThreadEntry } from "./messenger-thread";

export function eventOrderId(entry: ThreadEntry): string | null {
  if (entry.kind !== "order_event" || !entry.payload || typeof entry.payload !== "object") return null;
  const orderId = (entry.payload as { order_id?: unknown }).order_id;
  return typeof orderId === "string" ? orderId : null;
}

/**
 * The thread entry that stands for an order in chat: its latest card, which
 * is the only one `collapseOrderEvents` leaves on screen.
 */
export function orderEntryId(entries: ThreadEntry[], orderId: string): string | null {
  const cards = entries.filter((entry) => eventOrderId(entry) === orderId);
  return cards[cards.length - 1]?.id ?? null;
}

/**
 * One card per order. Every status change posts a fresh card, and a busy
 * order buried the conversation under them, so only the newest is kept --
 * at its own place in the thread, where the update happened -- and it carries
 * how many earlier cards it replaced.
 */
export function collapseOrderEvents(entries: ThreadEntry[]): Array<ThreadEntry & { replacedCards?: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const orderId = eventOrderId(entry);
    if (orderId) counts.set(orderId, (counts.get(orderId) ?? 0) + 1);
  }
  const remaining = new Map(counts);
  const kept: Array<ThreadEntry & { replacedCards?: number }> = [];
  for (const entry of entries) {
    const orderId = eventOrderId(entry);
    if (!orderId) {
      kept.push(entry);
      continue;
    }
    const left = (remaining.get(orderId) ?? 1) - 1;
    remaining.set(orderId, left);
    if (left === 0) kept.push({ ...entry, replacedCards: (counts.get(orderId) ?? 1) - 1 });
  }
  return kept;
}
