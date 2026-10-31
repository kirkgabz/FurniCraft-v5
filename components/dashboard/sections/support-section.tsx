"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/components/language/language-context";
import { IconChevronDown, IconSettings } from "@/components/solihiya/icons";
import { SupportChat } from "@/components/support/support-chat";
import { FAQ_ENTRIES, FAQ_TOPICS, type FaqTopicId } from "@/components/faq/faq-data";
import type { SupportAudience } from "@/components/support/troubleshooting";
import { OPEN_SUPPORT_EVENT, takeSupportChatRequest } from "@/components/support/open-support";

export type SupportSectionProps = {
  currentUserId: string | null;
  /** Who is asking: decides which common problems the Support chat offers. */
  audience?: SupportAudience;
  /** The name the Support greeting uses: a customer's first name, or the shop's name. */
  userName?: string | null;
};

type HelpView = "help" | "support";

/**
 * Help, in one place.
 *
 * The answers and the people used to be two separate things: a floating FAQ
 * widget that followed you around the dashboard, and this page, which was a
 * chat box and nothing else. Someone with a question had to guess which of the
 * two would answer it. They are now one page, in the order the design file
 * sets out and in the order the question actually gets resolved: the topics,
 * then the answers themselves, and only at the bottom the offer to
 * talk to somebody.
 *
 * The FAQ list is the same FAQ_ENTRIES the widget recited, so there is still
 * exactly one copy of every answer.
 *
 * The page opens on two choices and nothing else: Help centre (the topics and
 * the frequently asked questions) and Support (the chat, opening on the common
 * problems with instant answers, then a person). Choosing one opens it under
 * the two; choosing it again closes it. One shows at a time, so neither has to
 * be scrolled past to reach the other.
 */
export default function SupportSection({ currentUserId, audience = "customer", userName }: SupportSectionProps) {
  const { t: uiText } = useUiLanguage();
  const { t } = useLanguage();
  /**
   * Nothing chosen yet: the page is just the two choices -- unless this was
   * opened from a "support replied" notification, which lands on Support.
   */
  const [view, setView] = useState<HelpView | null>(() => (takeSupportChatRequest() ? "support" : null));

  // The same request while this page is already showing.
  useEffect(() => {
    const open = () => {
      if (takeSupportChatRequest()) setView("support");
    };
    window.addEventListener(OPEN_SUPPORT_EVENT, open);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, open);
  }, []);
  const [topic, setTopic] = useState<FaqTopicId | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  /** Counts come from the list itself, so a topic can never claim answers it has not got. */
  const countFor = useMemo(() => {
    const counts = new Map<FaqTopicId, number>();
    for (const entry of FAQ_ENTRIES) counts.set(entry.topic, (counts.get(entry.topic) ?? 0) + 1);
    return counts;
  }, []);

  const visible = useMemo(
    () => FAQ_ENTRIES.filter((entry) => !topic || entry.topic === topic),
    [topic]
  );

  return (
    <section id="support" className="space-y-7">
      <div>
        <p
          className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {t("Help centre")}
        </p>
        <h1 className="mt-2 font-display text-[1.6rem] font-bold leading-tight tracking-[-0.03em] text-[var(--fc-text)] lg:text-[2rem]">
          {t("How can we help?")}
        </h1>
        <p className="mt-1.5 text-[var(--fc-muted)]">
          {t("Choose Help centre for answers, or Support to fix a problem or reach our team.")}
        </p>
      </div>

      <div role="tablist" aria-label={t("Help centre")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            {
              id: "help",
              label: "Help centre",
              blurb: "Frequently asked questions about designing, quotes, orders and your account.",
            },
            {
              id: "support",
              label: "Support",
              blurb: "Fix a problem with instant answers, or message the FurniCraft team.",
            },
          ] as const
        ).map((item) => {
          const selected = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`help-view-${item.id}`}
              aria-selected={selected}
              aria-expanded={selected}
              aria-controls={`help-panel-${item.id}`}
              onClick={() => setView(selected ? null : item.id)}
              className={`flex min-h-[88px] items-center gap-3 rounded-2xl border p-5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
                selected
                  ? "border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.08)]"
                  : "border-[var(--fc-border)] bg-[var(--fc-panel)] hover:bg-[var(--fc-cane-soft)]"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block font-display text-lg font-bold ${selected ? "text-[var(--fc-ink-accent)]" : "text-[var(--fc-text)]"}`}>
                  {t(item.label)}
                </span>
                <span className="mt-1 block text-sm leading-snug text-[var(--fc-muted)]">{uiText(item.blurb)}</span>
              </span>
              <IconChevronDown
                aria-hidden
                className={`h-5 w-5 shrink-0 text-[var(--fc-muted)] transition-transform duration-200 ease-fc ${selected ? "rotate-180" : ""}`}
              />
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="help-panel-help" aria-labelledby="help-view-help" hidden={view !== "help"} className="space-y-7">

      {/* The topic cards. Selecting one narrows the list below rather than
          opening a page of its own: there are seventeen answers in total, and
          a second screen to hold four of them would be ceremony. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FAQ_TOPICS.map((entry) => {
          const count = countFor.get(entry.id) ?? 0;
          const active = topic === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTopic(active ? null : entry.id)}
              className={`flex min-h-[44px] flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] ${
                active
                  ? "border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.06)]"
                  : "border-[var(--fc-border)] bg-[var(--fc-panel)] hover:bg-[var(--fc-cane-soft)]"
              }`}
            >
              <span className="font-semibold text-[var(--fc-text)]">{uiText(entry.label)}</span>
              <span className="text-sm leading-snug text-[var(--fc-muted)]">{uiText(entry.blurb)}</span>
              <span className="mt-auto pt-1 text-xs font-semibold text-[var(--fc-ink-accent)]">
                {count} {count === 1 ? uiText("answer") : uiText("answers")}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="font-display text-lg font-bold text-[var(--fc-text)]">
            {topic ? FAQ_TOPICS.find((entry) => entry.id === topic)?.label : t("Frequently asked questions")}
          </h2>
          {topic ? (
            <button
              type="button"
              onClick={() => {
                setTopic(null);
              }}
              className="min-h-[44px] text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline"
            >
              {t("Show all")}
            </button>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">
            {t("No answers in this topic. Try Support.")}
          </p>
        ) : (
          <ul className="m-0 mt-3 list-none divide-y divide-[var(--fc-border)] overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-0">
            {visible.map((entry) => {
              const open = openId === entry.id;
              return (
                <li key={entry.id}>
                  <h3 className="m-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : entry.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition-[background-color] duration-150 hover:bg-[var(--fc-cane-soft)]"
                    >
                      <span className="min-w-0 flex-1 font-semibold text-[var(--fc-text)]">
                        {uiText(entry.question)}
                      </span>
                      <IconChevronDown
                        aria-hidden
                        className={`h-4 w-4 shrink-0 text-[var(--fc-muted)] transition-transform duration-200 ease-fc ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </h3>
                  {open ? (
                    // pre-line: answers are written in short paragraphs and
                    // "•" lists, separated by line breaks in faq-data.ts.
                    <div className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-[var(--fc-muted)]">
                      {uiText(entry.answer)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      </div>

      {/* Stays mounted while hidden, so a half-typed message survives a switch. */}
      <div
        role="tabpanel"
        id="help-panel-support"
        aria-labelledby="help-view-support"
        hidden={view !== "support"}
        className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5"
      >
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[var(--fc-text)]">
          <IconSettings aria-hidden className="h-4 w-4" />
          {t("FurniCraft support")}
        </h2>
        <div className="mt-2">{currentUserId ? <SupportChat userId={currentUserId} audience={audience} name={userName} /> : null}</div>
      </div>
    </section>
  );
}
