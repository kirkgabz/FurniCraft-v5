"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/time-ago";
import { IconChevronDown } from "@/components/solihiya/icons";
import { troubleshootingFor, type SupportAudience, type TroubleshootingEntry } from "@/components/support/troubleshooting";

type SupportMessage = {
  id: string;
  sender_role: "user" | "admin";
  text: string;
  created_at: string;
};

/**
 * One line of the conversation, whatever produced it.
 *
 * The window used to draw saved messages first and the tapped questions after
 * them, so a message sent after tapping a question was drawn above the answer
 * and scrolled out of view -- it was saved, but looked as if it had not been
 * sent. Everything now goes into this one list and is drawn in time order.
 */
type ChatItem =
  | { kind: "message"; at: string; message: SupportMessage }
  | { kind: "pending"; at: string; key: string; text: string }
  | { kind: "asked"; at: string; key: string; entry: TroubleshootingEntry };

/**
 * A direct line to FurniCraft support. Polls rather than subscribes, matching
 * the same "realtime replacement" pattern already used for shop conversations
 * elsewhere in these dashboards, but at a slower interval -- a support reply is
 * not a live chat, and there is no need to hit the database every 1.5s for it.
 *
 * Above the conversation sits "Still stuck?": the common problems for this
 * kind of account, one per line. Tapping one puts the question in the
 * conversation and support's answer under it, straight from
 * troubleshooting.ts. Those answers live only in this window -- nothing is
 * written for them. Typing a message reaches the support team.
 */
export function SupportChat({
  userId,
  audience = "customer",
  name,
}: {
  userId: string;
  audience?: SupportAudience;
  /** Who the greeting is addressed to: a customer's first name, or the shop's name. */
  name?: string | null;
}) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  /** Messages on their way to the database, shown at once rather than after the round trip. */
  const [pending, setPending] = useState<Array<{ key: string; at: string; text: string }>>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  /** The questions tapped this visit, answered in the window and kept nowhere else. */
  const [asked, setAsked] = useState<Array<{ key: string; at: string; entry: TroubleshootingEntry }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const problems = troubleshootingFor(audience);
  // Never an email address: an account with no name set falls back to one,
  // and "Hi, ana.reyes@gmail.com!" reads worse than no name at all.
  const greetingName = name && !name.includes("@") ? name.trim() : "";

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("support_messages")
      .select("id, sender_role, text, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    // A failed poll keeps what is on screen. It used to replace the
    // conversation with an empty list, so one dropped request blanked the
    // whole history until the next poll four seconds later.
    if (error || !data) return;
    setMessages(data as SupportMessage[]);
  }, [userId]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(interval);
  }, [load]);

  const timeline = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...pending.map((item) => ({ kind: "pending" as const, at: item.at, key: item.key, text: item.text })),
      ...asked.map((item) => ({ kind: "asked" as const, at: item.at, key: item.key, entry: item.entry })),
    ];
    return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [messages, pending, asked]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [timeline.length]);

  const ask = (entry: TroubleshootingEntry) => {
    setAsked((current) => [
      ...current,
      { key: `${entry.id}-${Date.now()}`, at: new Date().toISOString(), entry },
    ]);
    requestAnimationFrame(() => scrollRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    const key = `pending-${Date.now()}`;
    setSendError(null);
    setDraft("");
    setPending((current) => [...current, { key, at: new Date().toISOString(), text }]);

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("support_messages")
        .insert({ user_id: userId, sender_role: "user", text: text.slice(0, 4000) });
      if (error) throw error;
      await load();
    } catch {
      // Back in the box, and said out loud: a message that silently reappears
      // in the input reads as the button not working.
      setDraft((current) => (current ? current : text));
      setSendError("Your message couldn't be sent. Check your connection and try again.");
    } finally {
      setPending((current) => current.filter((item) => item.key !== key));
    }
  };

  const supportBubble = "max-w-[85%] rounded-2xl bg-[rgba(178,106,56,0.1)] px-3 py-2 text-[var(--fc-text)] break-words";
  const userBubble = "max-w-[85%] rounded-2xl bg-[#8b5a2b] px-3 py-2 text-white break-words";

  return (
    <div className="mt-2">
      <p className="text-sm leading-relaxed text-[var(--fc-muted)]">
        {greetingName
          ? uiText("Hi, {0}! Choose a question below and support will answer it right away, or send a message to reach the FurniCraft team.", { 0: greetingName })
          : uiText("Hi! Choose a question below and support will answer it right away, or send a message to reach the FurniCraft team.")}
      </p>

      <h3 className="mb-2 mt-4 text-sm font-bold text-[var(--fc-text)]">{uiText("Still stuck?")}</h3>
      <ul className="m-0 list-none divide-y divide-[var(--fc-border)] overflow-hidden rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-0">
        {problems.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => ask(entry)}
              className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm font-medium text-[var(--fc-text)] transition-[background-color] duration-150 hover:bg-[var(--fc-cane-soft)] active:bg-[var(--fc-cane-soft)]"
            >
              <span className="min-w-0 flex-1">{uiText(entry.question)}</span>
              <IconChevronDown aria-hidden className="h-4 w-4 shrink-0 -rotate-90 text-[var(--fc-muted)]" />
            </button>
          </li>
        ))}
      </ul>

      {timeline.length ? (
        <div
          ref={scrollRef}
          aria-live="polite"
          className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3"
        >
          {timeline.map((item) => {
            if (item.kind === "asked") {
              return (
                <div key={item.key} className="space-y-2">
                  <div className="flex justify-end">
                    <div className={userBubble}>
                      <p className="text-sm">{uiText(item.entry.question)}</p>
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className={supportBubble}>
                      <p className="whitespace-pre-line text-sm leading-relaxed">{uiText(item.entry.answer)}</p>
                      <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("FurniCraft support")}</p>
                    </div>
                  </div>
                </div>
              );
            }
            if (item.kind === "pending") {
              return (
                <div key={item.key} className="flex justify-end">
                  <div className={`${userBubble} opacity-70`}>
                    <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{item.text}</p>
                    <p className="mt-1 text-xs text-white/70">{uiText("Sending…")}</p>
                  </div>
                </div>
              );
            }
            const { message } = item;
            const mine = message.sender_role === "user";
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={mine ? userBubble : supportBubble}>
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]"><AdaptiveText text={message.text} /></p>
                  <p className={`mt-1 text-xs ${mine ? "text-white/70" : "text-[var(--fc-muted)]"}`}>
                    {mine ? "" : uiText("FurniCraft support · ")}
                    {timeAgo(message.created_at, undefined, uiLanguage)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (sendError) setSendError(null);
          }}
          onKeyDown={(event) => {
            // Not while composing: Enter there picks a candidate, and sending
            // half a word in Chinese or Japanese input is the opposite of help.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void handleSend();
            }
          }}
          maxLength={4000}
          aria-label={uiText("Message FurniCraft support…")}
          placeholder={uiText("Message FurniCraft support…")}
          className="min-w-0 flex-1 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3.5 py-2 text-sm text-[var(--fc-text)] outline-none transition-colors focus:border-[var(--fc-accent)]"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!draft.trim()}
          className="btn btn-primary shrink-0 px-4 py-2 text-sm transition-transform active:scale-[0.97] disabled:opacity-50"
        >{uiText("Send")}</button>
      </div>
      {sendError ? (
        <p role="alert" className="mt-2 text-sm text-fc-danger">{uiText(sendError)}</p>
      ) : null}
    </div>
  );
}
