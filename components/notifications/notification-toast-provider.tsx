"use client";

import { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { followDeepLink } from "@/lib/deep-link";
import { notificationHref } from "@/components/support/open-support";
import {
  getActiveMessageConversation,
  isMessageNotification,
  messageConversationFromLink,
  sameMessageConversation,
  subscribeActiveMessageConversation,
  type MessageConversation,
} from "@/lib/message-notifications";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";
import {
  NotificationToastContainer,
  ToastNotification,
} from "./notification-toast";
import { playNotificationChime } from "./notification-sound";

export const CUSTOM_TOAST_EVENT = "furnicraft:toast";

/** How recent a notification must be to arrive as a toast. */
const FRESH_TOAST_MS = 2 * 60 * 1000;

/**
 * Toasts are wrapped in their own error boundary because this provider sits
 * above every page, at the root layout. Without one, any bug in the toast UI
 * -- this one already reached production as a crash on an untrusted `type`
 * field -- takes the whole app down rather than just losing the toast. React
 * error boundaries must be classes; there is no hook equivalent.
 */
class ToastErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Notification toast crashed; hiding it rather than the app:", error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

interface NotificationToastContextValue {
  showToast: (toast: Omit<ToastNotification, "id" | "created_at"> & { id?: string }) => void;
  dismissToast: (id: string) => void;
}

const NotificationToastContext = createContext<NotificationToastContextValue | null>(null);

export function useNotificationToast() {
  const ctx = useContext(NotificationToastContext);
  if (!ctx) {
    throw new Error("useNotificationToast must be used within a NotificationToastProvider");
  }
  return ctx;
}

export function NotificationToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<(ToastNotification & { conversation: MessageConversation | null })[]>([]);
  const router = useRouter();
  const userIdRef = useRef<string | null>(null);
  /** The last row toasted from realtime, so a duplicate INSERT event can't show it twice. */
  const lastToastedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const dismissVisibleConversation = () => {
      const active = getActiveMessageConversation();
      if (document.visibilityState !== "visible" || !active) return;
      setToasts((prev) => prev.filter((toast) => !sameMessageConversation(toast.conversation, active)));
    };
    dismissVisibleConversation();
    return subscribeActiveMessageConversation(dismissVisibleConversation);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    try {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
    } catch (err) {
      console.debug("Could not mark toast notification read:", err);
    }
  }, []);

  const handleToastClick = useCallback(
    (notification: ToastNotification) => {
      dismissToast(notification.id);
      void markNotificationRead(notification.id);
      const href = notificationHref(notification);
      if (href) followDeepLink(router, href);
    },
    [dismissToast, markNotificationRead, router]
  );

  const showToast = useCallback(
    async (rawToast: Omit<ToastNotification, "id" | "created_at"> & { id?: string }) => {
      let conversation = messageConversationFromLink(rawToast);
      // Older notifications link only to the dashboard. Resolve their message
      // instead of guessing a room from the sender, who may own several shops.
      if (!conversation && isMessageNotification(rawToast) && rawToast.entity_type === "shop_message" && rawToast.entity_id) {
        try {
          const { data } = await createClient()
            .from("shop_messages")
            .select("shop_id, sender_user_id")
            .eq("id", rawToast.entity_id)
            .maybeSingle();
          if (rawToast.audience === "shop" && data?.sender_user_id) {
            conversation = { audience: "shop", customerUserId: data.sender_user_id };
          } else if (rawToast.audience !== "shop" && data?.shop_id) {
            conversation = { audience: "personal", shopId: data.shop_id };
          }
        } catch {
          // If the room cannot be identified, keep the notification visible.
        }
      }
      const isBeingRead = () => document.visibilityState === "visible"
        && sameMessageConversation(conversation, getActiveMessageConversation());
      if (isBeingRead()) return;
      const id = rawToast.id || (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now()));
      let actorName = rawToast.actor_name || null;

      if (!actorName && rawToast.actor_user_id) {
        try {
          const supabase = createClient();
          const { data } = await supabase
            .from(USER_NAMES_TABLE)
            .select("full_name")
            .eq("id", rawToast.actor_user_id)
            .maybeSingle();
          if (data?.full_name) {
            actorName = data.full_name;
          }
        } catch {
          // Fallback gracefully without blocking toast
        }
      }

      // The user may have changed rooms while the actor name was loading.
      if (isBeingRead()) return;
      const toastItem: ToastNotification & { conversation: MessageConversation | null } = {
        id,
        type: rawToast.type,
        title: rawToast.title,
        body: rawToast.body,
        link: rawToast.link,
        actor_user_id: rawToast.actor_user_id,
        actor_name: actorName,
        entity_type: rawToast.entity_type,
        entity_id: rawToast.entity_id,
        created_at: new Date().toISOString(),
        audience: rawToast.audience,
        conversation,
      };

      playNotificationChime();

      setToasts((prev) => {
        // Prevent duplicate toasts by id
        if (prev.some((t) => t.id === toastItem.id)) return prev;
        // Keep max 4 toasts at a time
        return [toastItem, ...prev].slice(0, 4);
      });
    },
    []
  );

  // Subscribe to Supabase Realtime notifications
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    const initUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        userIdRef.current = data.user?.id ?? null;
      }
    };

    void initUser();

    // Listen for auth state changes to update current user reference
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      userIdRef.current = session?.user?.id ?? null;
    });

    const channel = supabase.channel("global-notifications-toast");
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      () => {
        // The row is read back rather than taken from the event. `payload.new`
        // was confirmed to arrive as a genuinely empty object for this table in
        // this environment -- not the malformed-partial case the guard this
        // replaced was written for, but actually empty, with no id to recover
        // from -- and every real notification is written by a SECURITY DEFINER
        // trigger, the same kind of write that was used to catch this, not a
        // client insert that could be special-cased instead. RLS already scopes
        // the select to this user's own rows, the same as every other query in
        // the app, so nothing further needs checking against the old payload's
        // user_id here.
        void (async () => {
          const { data } = await supabase
            .from("notifications")
            .select("id, type, title, body, link, actor_user_id, entity_type, entity_id, created_at, audience, read_at")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!data || data.id === lastToastedIdRef.current) return;
          // The event does not say whose row it was, so this reads "my
          // latest". When the new row was someone else's, that is an older
          // notification of mine -- often already read -- and it used to pop
          // up as if it had just arrived. A toast is for what has just
          // happened: unread, and from the last couple of minutes.
          const age = Date.now() - new Date(data.created_at).getTime();
          if (data.read_at || !(age < FRESH_TOAST_MS)) return;
          lastToastedIdRef.current = data.id;
          void showToast(data as ToastNotification);
        })();
      }
    );
    channel.subscribe();

    // Custom in-app event trigger
    const onCustomToast = (event: Event) => {
      const detail = (event as CustomEvent<ToastNotification>).detail;
      if (detail) {
        void showToast(detail);
      }
    };
    window.addEventListener(CUSTOM_TOAST_EVENT, onCustomToast);

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      supabase.removeChannel(channel);
      window.removeEventListener(CUSTOM_TOAST_EVENT, onCustomToast);
    };
  }, [showToast]);

  return (
    <NotificationToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastErrorBoundary>
        <NotificationToastContainer
          toasts={toasts}
          onDismiss={dismissToast}
          onClick={handleToastClick}
        />
      </ToastErrorBoundary>
    </NotificationToastContext.Provider>
  );
}
