"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/time-ago";
import { notifySuccess } from "@/lib/saved-notice";

type Props = {
  /** Lets the sidebar badge stay in sync without duplicating this component's own thread-counting. */
  onNeedsReplyCountChange?: (count: number) => void;
};

type Audience = "all" | "customer" | "shop";

const AUDIENCES: Array<{ id: Audience; label: string }> = [
  { id: "all", label: "All" },
  { id: "customer", label: "Customers" },
  { id: "shop", label: "Shop owners" },
];

type SupportMessage = {
  id: string;
  user_id: string;
  sender_role: "user" | "admin";
  text: string;
  created_at: string;
};

/**
 * The admin side of components/support/support-chat.tsx: one thread per
 * account holder, newest activity first, whichever thread's last message
 * came from the user surfaced as needing a reply.
 */
export default function AdminSupportInbox({ onNeedsReplyCountChange }: Props = {}) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  // Who each writer is, from the same shop_owner flag the Users page reads.
  // An account that runs a shop is a shop owner here even when it also buys:
  // its questions are far more often about selling.
  const [shopOwners, setShopOwners] = useState<Set<string>>(new Set());
  const [audience, setAudience] = useState<Audience>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("support_messages")
      .select("id, user_id, sender_role, text, created_at")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as SupportMessage[];
    setMessages(rows);

    const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
    if (userIds.length > 0) {
      const [{ data: nameRows }, { data: roleRows }] = await Promise.all([
        supabase.from("user_display_names").select("id, full_name").in("id", userIds),
        supabase.from("user_profiles").select("id, shop_owner").in("id", userIds),
      ]);
      const next: Record<string, string> = {};
      for (const row of (nameRows ?? []) as Array<{ id: string; full_name: string | null }>) {
        next[row.id] = row.full_name || "Customer";
      }
      setNames(next);
      setShopOwners(
        new Set(
          ((roleRows ?? []) as Array<{ id: string; shop_owner: boolean | null }>)
            .filter((row) => row.shop_owner)
            .map((row) => row.id)
        )
      );
    }
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 6000);
    return () => window.clearInterval(interval);
  }, [load]);

  const threads = Array.from(new Set(messages.map((message) => message.user_id)))
    .map((userId) => {
      const thread = messages.filter((message) => message.user_id === userId);
      const last = thread[thread.length - 1];
      return { userId, thread, last, needsReply: last?.sender_role === "user" };
    })
    .sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());

  const needsReplyCount = threads.filter((entry) => entry.needsReply).length;
  useEffect(() => {
    onNeedsReplyCountChange?.(needsReplyCount);
  }, [needsReplyCount, onNeedsReplyCountChange]);

  const isShopOwner = (userId: string) => shopOwners.has(userId);
  const shownThreads = threads.filter((entry) =>
    audience === "all" ? true : audience === "shop" ? isShopOwner(entry.userId) : !isShopOwner(entry.userId)
  );
  const countFor = (id: Audience) =>
    id === "all" ? threads.length : threads.filter((entry) => isShopOwner(entry.userId) === (id === "shop")).length;
  const selectedThread = threads.find((entry) => entry.userId === selectedUserId) ?? null;

  const handleSend = async () => {
    const text = reply.trim();
    if (!text || !selectedUserId || sending) return;
    setSending(true);
    setReply("");
    const supabase = createClient();
    const { error } = await supabase
      .from("support_messages")
      .insert({ user_id: selectedUserId, sender_role: "admin", text });
    if (error) setReply(text);
    else {
      notifySuccess("Reply sent");
      await load();
    }
    setSending(false);
  };

  return (
    <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{uiText("Support")}</h2>
        {threads.some((entry) => entry.needsReply) ? (
          <span className="rounded-full bg-[rgba(231,76,60,0.12)] px-2.5 py-0.5 text-xs font-bold text-[#c0392b]">
            {threads.filter((entry) => entry.needsReply).length}{uiText(" awaiting reply")}</span>
        ) : null}
      </div>

      {threads.length > 0 ? (
        <div role="group" aria-label={uiText("Show conversations from")} className="mt-3 flex flex-wrap gap-1.5">
          {AUDIENCES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={audience === option.id}
              onClick={() => setAudience(option.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                audience === option.id
                  ? "border-[var(--fc-btn)] bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]"
                  : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
              }`}
            >
              {uiText(option.label)} <span className="tabular-nums opacity-80">{countFor(option.id)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {threads.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("No support messages yet.")}</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            {shownThreads.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--fc-muted)]">{audience === "shop" ? uiText("No conversations from shop owners.") : uiText("No conversations from customers.")}</p>
            ) : null}
            {shownThreads.map((entry) => (
              <button
                key={entry.userId}
                type="button"
                onClick={() => setSelectedUserId(entry.userId)}
                className={`block w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                  entry.userId === selectedUserId
                    ? "border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.08)]"
                    : "border-transparent hover:bg-[rgba(178,106,56,0.05)]"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-[var(--fc-text)]">
                    {names[entry.userId] || uiText("Customer")}
                  </span>
                  {entry.needsReply ? (
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#c0392b]" />
                  ) : null}
                </span>
                <span
                  className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
                    isShopOwner(entry.userId)
                      ? "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                      : "bg-[color-mix(in_srgb,var(--fc-muted)_14%,transparent)] text-[var(--fc-muted)]"
                  }`}
                >
                  {isShopOwner(entry.userId) ? uiText("Shop owner") : uiText("Customer")}
                </span>
                <span className="block truncate text-xs text-[var(--fc-muted)]">{entry.last.text}</span>
              </button>
            ))}
          </div>

          {selectedThread ? (
            <div className="flex min-h-[280px] flex-col">
              <p className="mb-2 text-sm font-semibold text-[var(--fc-text)]">
                {names[selectedThread.userId] || uiText("Customer")}
                <span className="ml-2 text-xs font-normal text-[var(--fc-muted)]">
                  {isShopOwner(selectedThread.userId) ? uiText("Shop owner") : uiText("Customer")}
                </span>
              </p>
              <div className="mb-3 max-h-72 flex-1 space-y-2 overflow-y-auto rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3">
                {selectedThread.thread.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.sender_role === "admin" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 break-words ${
                        message.sender_role === "admin"
                          ? "bg-[#8b5a2b] text-white"
                          : "bg-[rgba(178,106,56,0.1)] text-[var(--fc-text)]"
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]"><AdaptiveText text={message.text} /></p>
                      <p className={`mt-1 text-xs ${message.sender_role === "admin" ? "text-white/70" : "text-[var(--fc-muted)]"}`}>
                        {timeAgo(message.created_at, undefined, uiLanguage)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={uiText("Reply to {0}…", { 0: names[selectedThread.userId] || (isShopOwner(selectedThread.userId) ? uiText("this shop owner") : uiText("this customer")) })}
                  className="flex-1 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3.5 py-2 text-sm text-[var(--fc-text)] outline-none transition-colors focus:border-[var(--fc-accent)]"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !reply.trim()}
                  className="btn btn-primary shrink-0 px-4 py-2 text-sm transition-transform active:scale-[0.97] disabled:opacity-50"
                >{uiText("Send")}</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--fc-muted)]">{uiText("Select a conversation to read and reply.")}</p>
          )}
        </div>
      )}
    </div>
  );
}
