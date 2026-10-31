"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { reactionError, type MessageReaction } from "@/lib/message-reactions";
import type { ThreadEntry } from "./messenger-thread";

const EMPTY_REACTIONS: MessageReaction[] = [];

/** Shared by both inboxes. Polls like the message threads, and survives reload. */
export function useMessageReactions(entries: ThreadEntry[], userId: string | null) {
  const idsKey = entries.filter((entry) => (!entry.kind || entry.kind === "text" || entry.kind === "image")
    && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.id)).map((entry) => entry.id).sort().join(",");
  const scope = `${userId}:${idsKey}`;
  const [result, setResult] = useState<{ scope: string; rows: MessageReaction[]; error: string | null }>({ scope, rows: [], error: null });
  const [loadedScope, setLoadedScope] = useState("");
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    if (!userId || !idsKey) return;
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading || writing.current) return;
      loading = true;
      const readRevision = revision.current;
      try {
        const { data, error } = await createClient().from("shop_message_reactions")
          .select("message_id, user_id, emoji").in("message_id", idsKey.split(","));
        if (!cancelled && readRevision === revision.current) {
          if (!error) setLoadedScope(scope);
          setResult((current) => error
            ? { scope, rows: current.scope === scope ? current.rows : [], error: reactionError(error.message) }
            : { scope, rows: (data ?? []) as MessageReaction[], error: null });
        }
      } catch {
        if (!cancelled) setResult((current) => ({ scope, rows: current.scope === scope ? current.rows : [], error: reactionError("") }));
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [idsKey, userId, scope]);

  const rows = result.scope === scope ? result.rows : EMPTY_REACTIONS;
  const react = useCallback(async (messageId: string, emoji: string) => {
    if (!userId || loadedScope !== scope || writing.current || !idsKey.split(",").includes(messageId)) return;
    writing.current = true;
    revision.current += 1;
    setSaving(true);
    const previous = rows.find((row) => row.message_id === messageId && row.user_id === userId);
    try {
      const client = createClient();
      const { error } = previous?.emoji === emoji
        ? await client.from("shop_message_reactions").delete().eq("message_id", messageId).eq("user_id", userId)
        : await client.from("shop_message_reactions").upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: "message_id,user_id" });
      if (error) throw error;
      setResult((current) => current.scope !== scope ? current : ({ scope, error: null, rows: [
        ...current.rows.filter((row) => row.message_id !== messageId || row.user_id !== userId),
        ...(previous?.emoji === emoji ? [] : [{ message_id: messageId, user_id: userId, emoji }]),
      ] }));
    } catch (error) {
      setResult((current) => current.scope !== scope ? current : { ...current, error: reactionError(error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "")) });
    } finally {
      revision.current += 1;
      writing.current = false;
      setSaving(false);
    }
  }, [userId, idsKey, rows, scope, loadedScope]);

  return { rows, react, saving, ready: loadedScope === scope, error: result.scope === scope ? result.error : null };
}
