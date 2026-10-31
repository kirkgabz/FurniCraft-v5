"use client";

import { useEffect } from "react";
import { registerActiveMessageConversation, type MessageConversation } from "@/lib/message-notifications";

/** A selected room on a phone's hidden pane is not a conversation being read. */
export function useActiveMessageConversation(conversation: MessageConversation | undefined, mobileOpen: boolean) {
  const audience = conversation?.audience;
  const peerId = conversation?.audience === "personal" ? conversation.shopId : conversation?.customerUserId;

  useEffect(() => {
    if (!audience || !peerId) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    let release: (() => void) | undefined;
    const sync = () => {
      release?.();
      release = undefined;
      if (document.visibilityState !== "visible" || (!desktop.matches && !mobileOpen)) return;
      release = registerActiveMessageConversation(
        audience === "personal" ? { audience, shopId: peerId } : { audience, customerUserId: peerId }
      );
    };
    sync();
    desktop.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      release?.();
      desktop.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [audience, peerId, mobileOpen]);
}
