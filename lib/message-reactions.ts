export const MESSAGE_REACTIONS = ["❤️", "😆", "😮", "😢", "😡", "👍"] as const;
export type MessageReaction = { message_id: string; user_id: string; emoji: string };

export function reactionSummary(rows: MessageReaction[], messageId: string): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.message_id === messageId) counts.set(row.emoji, (counts.get(row.emoji) ?? 0) + 1);
  }
  return MESSAGE_REACTIONS.filter((emoji) => counts.has(emoji))
    .map((emoji) => `${emoji}${counts.get(emoji)! > 1 ? ` ${counts.get(emoji)}` : ""}`).join(" ");
}

export function reactionError(message: string): string {
  return /shop_message_reactions|schema cache/i.test(message)
    ? "Reactions are not available yet. Please contact FurniCraft support."
    : "Your reaction could not be saved. Please try again.";
}
