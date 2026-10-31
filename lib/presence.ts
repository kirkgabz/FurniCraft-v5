"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Who is actually online, from Supabase Realtime Presence.
 *
 * Before this, every shop rendered "🟢 Online" because the field was the
 * literal `true` -- a green dot that meant nothing, on five different screens.
 * An indicator that is always on is worse than no indicator: it reads as
 * information and is not.
 *
 * Presence rather than a `last_seen_at` column on purpose. A timestamp needs a
 * heartbeat write per user per interval, and answers "was here recently"
 * instead of "is here"; presence is held by the socket the client already has
 * open for messages, and the answer disappears when the tab does. It costs one
 * extra channel and no schema.
 *
 * Everyone signed in joins the same channel, so a customer can see whether a
 * shop owner is at their desk and a shop can see whether the customer they are
 * mid-conversation with is still there.
 */

const PRESENCE_CHANNEL = "online-users";

export function useOnlineUsers(currentUserId: string | null): Set<string> {
  const [onlineIds, setOnlineIds] = useState<string[]>([]);

  useEffect(() => {
    if (!currentUserId) {
      setOnlineIds([]);
      return;
    }

    const supabase = createClient();
    // Keying presence by user id makes presenceState() a map of user id ->
    // that user's open tabs, so the keys are the answer with no digging.
    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: currentUserId } },
    });

    const sync = () => setOnlineIds(Object.keys(channel.presenceState()));

    channel.on("presence", { event: "sync" }, sync);
    channel.on("presence", { event: "join" }, sync);
    channel.on("presence", { event: "leave" }, sync);

    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Tracking is what puts this user into everyone else's list. The payload
      // is deliberately empty of anything identifying: the key is the user id,
      // and a presence channel is readable by every other subscriber.
      void channel.track({ online_at: new Date().toISOString() });
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  // A Set for the callers, rebuilt only when the membership actually changes --
  // presence sync fires on every join and leave, including other people's.
  return useMemo(() => new Set(onlineIds), [onlineIds]);
}
