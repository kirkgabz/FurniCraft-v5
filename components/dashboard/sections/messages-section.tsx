"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { type Message } from "@/components/dashboard/customer-dashboard-types";
import { useLanguage } from "@/components/language/language-context";
import ConversationOrders, { type ConversationOrder } from "@/components/messages/conversation-orders";
import MessengerThread, { orderEntryId, scrollToThreadEntry } from "@/components/messages/messenger-thread";
import OrderPreviewCard, { asOrderEventPayload } from "@/components/orders/order-preview-card";
import { ShopIdentity } from "@/components/shops/shop-identity";
import { type Shop as ShopRecord } from "@/components/shops/shop-types";
import { IconPhone } from "@/components/solihiya/icons";
import { type ReportCategory } from "@/lib/report-topics";
import {
  QUICK_ANSWER_LABEL,
  QUICK_QUESTIONS_HEADING,
  quickAnswerNote,
  quickQuestionsFor,
  type AssistantLanguage,
} from "@/lib/shop-assistant";

export type MessagesSectionProps = {
  answerQuickQuestion: (shopId: string, questionId: string, question: string, language: AssistantLanguage) => Promise<void>;
  assistantThinkingFor: string | null;
  conversationShop: ShopRecord | null;
  /** This customer's orders with the shop in the open conversation. */
  conversationOrders: ConversationOrder[];
  currentThread: Message[];
  currentUserId: string | null;
  goToSection: (section: string) => void;
  handleSendMessage: () => Promise<void>;
  isMobileThreadOpen: boolean;
  isRealtimeConnected: boolean;
  isSendingPhoto: boolean;
  isShopOnline: (shop: { ownerUserId?: string | null; } | null) => boolean;
  messageDraft: string;
  myShopId: string | null;
  photoInputRef: RefObject<HTMLInputElement | null>;
  selectedShopId: string | null;
  setChatOrderId: Dispatch<SetStateAction<string | null>>;
  setIsCallSheetOpen: Dispatch<SetStateAction<boolean>>;
  setIsMobileThreadOpen: Dispatch<SetStateAction<boolean>>;
  setMessageDraft: Dispatch<SetStateAction<string>>;
  setPoliciesShopId: Dispatch<SetStateAction<string | null>>;
  setReportTarget: Dispatch<SetStateAction<{ targetId: string; topics: ReportCategory[]; title: string; context?: string; } | null>>;
  setSelectedShopId: Dispatch<SetStateAction<string | null>>;
  shopUnreadIds: Record<string, boolean>;
  shops: ShopRecord[];
};

/**
 * Messages: the conversation list (FurniCraft Support pinned first on a phone) and the open thread.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function MessagesSection({
  answerQuickQuestion,
  assistantThinkingFor,
  conversationShop,
  conversationOrders,
  currentThread,
  currentUserId,
  goToSection,
  handleSendMessage,
  isMobileThreadOpen,
  isRealtimeConnected,
  isSendingPhoto,
  isShopOnline,
  messageDraft,
  myShopId,
  photoInputRef,
  selectedShopId,
  setChatOrderId,
  setIsCallSheetOpen,
  setIsMobileThreadOpen,
  setMessageDraft,
  setPoliciesShopId,
  setReportTarget,
  setSelectedShopId,
  shopUnreadIds,
  shops,
}: MessagesSectionProps) {
  const { t: uiText } = useUiLanguage();
  const { language } = useLanguage();
  return (
    <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 shadow-sm">
      {/* The conversation list widens with the window; the thread does not.
          A chat is prose, and at 1920 this thread measured 1290px across, which
          is a line nobody can track back to the start of. Capping the thread
          and letting the list take the rest spends the width on seeing more
          shop names at once, which is the part that benefits from it. */}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[minmax(260px,1fr)_minmax(0,900px)]">
        {/* min-w-0: a grid item defaults to min-width:auto, so this
            column refused to shrink below the widest shop name it
            holds ("Nanahoshi Futuristic Furniture Shop") and pushed
            the rows out past the card instead. The truncate on the
            name and tagline could never fire until the column was
            allowed to be narrower than its content. */}
        <aside className="min-w-0 space-y-3 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-[var(--fc-text)]">{uiText("Conversations")}</h3>
              <p className="text-sm text-[var(--fc-muted)]">{uiText("Talk with multiple shops")}</p>
            </div>
          </div>
          {/* Support, pinned. On a phone it is not in any menu of its
              own: it is a conversation, so it lives with the others.
              From lg up the sidebar's Support item reaches it as well. */}
          <button
            type="button"
            onClick={() => goToSection("support")}
            className="relative w-full rounded-2xl border border-transparent px-3 py-3 text-left transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.99] lg:hidden"
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-verify)_14%,transparent)] text-[var(--fc-verify)]"
              >
                <IconPhone className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[var(--fc-text)]">{uiText("FurniCraft Support")}</span>
                <p className="truncate text-sm text-[var(--fc-muted)]">{uiText("Questions about orders, payments or your account")}</p>
              </div>
            </div>
          </button>
          {/* Your own shop is not in here: you are not your own
              customer, and its inbox is /protected/shop. */}
          {shops
            .filter((shop) => shop.id !== myShopId)
            .map((shop) => {
              const isUnread = Boolean(shopUnreadIds[shop.id]);

            return (
              <button
                key={shop.id}
                type="button"
                onClick={() => {
                  setSelectedShopId(shop.id);
                  setIsMobileThreadOpen(true);
                }}
                className={`relative w-full rounded-2xl border px-3 py-3 text-left transition ${selectedShopId === shop.id ? "border-fc-ink-accent bg-[rgba(178,106,56,0.1)]" : "border-transparent bg-[var(--fc-panel)]"}`}
              >
                {isUnread ? (
                  <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-fc-danger ring-2 ring-[var(--fc-panel)]" />
                ) : null}
                <div className="flex items-center gap-3">
                  <ShopIdentity shop={shop} size="lg" online={isShopOnline(shop)} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate pr-4 font-semibold text-[var(--fc-text)]">{shop.name}</span>
                    <p className="truncate text-sm text-[var(--fc-muted)]">{shop.specialty}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        {/* From lg up this is the right-hand pane. On a phone the thread
            covers the screen instead, so the list stays mounted behind
            it and comes back with the header's arrow -- hidden rather
            than unmounted, so the desktop pane never depends on a piece
            of phone-only state. */}
        <div className={isMobileThreadOpen ? "" : "hidden lg:block"}>
          {!conversationShop ? (
            <div className="hidden h-full min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--fc-border)] p-6 text-center lg:flex">
              <h4 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Select a shop to start chatting")}</h4>
              <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("You can message multiple furniture shops without losing context.")}</p>
            </div>
          ) : (
            <MessengerThread
              notificationConversation={currentUserId ? { audience: "personal", shopId: conversationShop.id } : undefined}
              isMobileThreadOpen={isMobileThreadOpen}
              title={conversationShop.name}
              titleHref={`/shops/${conversationShop.id}`}
              subtitle={
                assistantThinkingFor === conversationShop.id ? uiText("Loading answer…") : isRealtimeConnected ? conversationShop.specialty : uiText("Connecting…")
              }
              avatar={<ShopIdentity shop={conversationShop} size="sm" />}
              headerAvatar={<ShopIdentity shop={conversationShop} size="sm" />}
              isOnline={isShopOnline(conversationShop)}
              entries={currentThread}
              currentUserId={currentUserId}
              draft={messageDraft}
              onDraftChange={setMessageDraft}
              onSend={handleSendMessage}
              onBack={() => setIsMobileThreadOpen(false)}
              /* Always offered now. The button used to appear only
                 when a number was on file, which meant a customer
                 looking for one saw nothing at all and could not tell
                 whether the shop had no number or the app had no
                 button. The sheet answers that question either way. */
              onCall={() => setIsCallSheetOpen(true)}
              onPickPhoto={() => photoInputRef.current?.click()}
              isSendingPhoto={isSendingPhoto}
              assistantLabel={QUICK_ANSWER_LABEL[language]}
              assistantNote={quickAnswerNote(conversationShop.name)}
              composerAbove={
                <div>
                  <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
                    {QUICK_QUESTIONS_HEADING[language]}
                  </p>
                  {/* One row, scrolled sideways rather than wrapped:
                      wrapped, nine chips take half the screen on a
                      phone and push the conversation out of view. */}
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                    {quickQuestionsFor(language).map((question) => (
                      <button
                        key={question.id}
                        type="button"
                        disabled={assistantThinkingFor === conversationShop.id}
                        onClick={() => void answerQuickQuestion(conversationShop.id, question.id, question.text, language)}
                        className="shrink-0 rounded-full border border-[var(--fc-border)] bg-[rgba(178,106,56,0.07)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-ink-accent)] transition-colors hover:bg-[rgba(178,106,56,0.16)] active:scale-[0.98] disabled:opacity-50"
                      >
                        {question.text}
                      </button>
                    ))}
                  </div>
                </div>
              }
              onReportMessage={(entry) =>
                setReportTarget({
                  targetId: entry.id,
                  topics: ["chat"],
                  title: "Report this message",
                  // Quoted back into the dialog so nobody reports the
                  // message above or below the one they meant.
                  context: entry.text,
                })
              }
              headerExtra={
                /* The terms dialog shows itself once per shop and then
                   stays out of the way, which leaves a customer mid-
                   conversation with no way back to the deposit and lead
                   time they half-remember. This reopens it, and
                   deliberately ignores the seen-state -- an explicit
                   request is not a prompt to suppress. */
                <button
                  type="button"
                  onClick={() => setPoliciesShopId(conversationShop.id)}
                  className="shrink-0 font-semibold underline underline-offset-2"
                >{uiText("View terms")}</button>
              }
              pinned={
                <ConversationOrders
                  orders={conversationOrders}
                  onOpenOrder={(orderId) => setChatOrderId(orderId)}
                  onShowInChat={(orderId) => {
                    const entryId = orderEntryId(currentThread, orderId);
                    return entryId ? () => void scrollToThreadEntry(entryId) : null;
                  }}
                />
              }
              renderEventCard={(entry) => {
                const payload = asOrderEventPayload(entry.payload);
                return payload ? (
                  <OrderPreviewCard payload={payload} onViewOrderDetails={setChatOrderId} />
                ) : null;
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
