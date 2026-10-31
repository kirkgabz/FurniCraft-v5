"use client";

import { useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// These are the personal notifications emitted when a shop gives the customer
// something to act on. Accepting a quote is already a viewed customer action.
const ACTION_TYPES = ["order_quoted", "order_payment_rejected"];
type ActionNotification = { id: string; entity_id: string };

/** Reuse the account's persisted read state, including reads in the bell. */
export function useUnreadOrderActions(userId: string | null, viewedOrderId: string | null) {
  const channelId = useId();
  const [unread, setUnread] = useState<{ userId: string; orderIds: string[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelled = false;
    let request = 0;

    const load = async () => {
      const currentRequest = ++request;
      try {
        let rows: ActionNotification[] = [];
        // Avoid the API's default row cap hiding an action on an older order.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase
            .from("notifications")
            .select("id, entity_id")
            .eq("user_id", userId)
            .eq("audience", "personal")
            .eq("entity_type", "design_order")
            .in("type", ACTION_TYPES)
            .is("read_at", null)
            .order("id")
            .range(offset, offset + 499);
          if (cancelled || currentRequest !== request) return;
          if (error) throw error;
          rows.push(...(data ?? []) as ActionNotification[]);
          if (!data || data.length < 500) break;
        }

        // Opening the category alone never reads its orders. Only acknowledge
        // notifications fetched for the order actually visible to the customer;
        // a later notification keeps its own unread state.
        const viewed = document.visibilityState === "visible"
          ? rows.filter((row) => row.entity_id === viewedOrderId)
          : [];
        if (viewed.length) {
          const { error } = await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", userId)
            .in("id", viewed.map((row) => row.id))
            .is("read_at", null);
          if (error) {
            // Keep the dot if the acknowledgement failed; do not fake a read.
            console.error("Could not mark order actions viewed:", error);
          } else {
            const readIds = new Set(viewed.map((row) => row.id));
            rows = rows.filter((row) => !readIds.has(row.id));
          }
        }
        if (!cancelled && currentRequest === request) {
          setUnread({ userId, orderIds: [...new Set(rows.map((row) => row.entity_id))] });
        }
      } catch (error) {
        console.error("Could not load unread order actions:", error);
      }
    };

    const channel = supabase.channel(`order-actions-${channelId}-${userId}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => void load()
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") void load();
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    void load();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [userId, viewedOrderId, channelId]);

  // Do not display the previous account's unread state during an account switch.
  return unread?.userId === userId ? unread.orderIds : [];
}
