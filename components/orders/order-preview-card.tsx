"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPeso, orderStatusMeta } from "@/components/orders/order-status";
import { IconChevronDown, IconFurniture } from "@/components/solihiya/icons";
import { QuoteBreakdownList } from "@/components/orders/quote-breakdown";
import { parseQuoteLines } from "@/components/orders/quote-lines";

/**
 * An order event rendered inside the chat.
 *
 * These rows are written by the emit_order_event_message trigger, never by a
 * client -- the insert policy on shop_messages only accepts kind = 'text' from
 * a user, so a customer cannot post a card claiming their order was paid.
 *
 * The payload is a snapshot of the moment: a quote card keeps saying PHP 20,000
 * after the order is re-quoted, because that is what the conversation said at
 * the time. Only the thumbnail is read live from the order, because
 * preview_url is a base64 data URL far too large to copy into every message.
 */

export type OrderEventPayload = {
  event?: string;
  order_id?: string;
  project_name?: string;
  furniture_type?: string | null;
  status?: string;
  quoted_total?: number | string | null;
  downpayment_percent?: number | string | null;
  downpayment_amount?: number | string | null;
  /** The breakdown as it was when this card was posted; see quote-lines.ts. */
  quote_lines?: unknown;
  decline_reason?: string | null;
  /** "customer" or "shop_owner" -- who ended it. */
  declined_by?: string | null;
  /** Set only on the payment_submitted -> confirmed rejection, by the shop. */
  payment_rejected_reason?: string | null;
};

/** Narrows an unknown jsonb column without trusting its shape. */
export function asOrderEventPayload(value: unknown): OrderEventPayload | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.order_id !== "string") return null;
  return record as OrderEventPayload;
}

const EVENT_HEADLINE: Record<string, string> = {
  order_placed: "Order placed",
  order_quoted: "Quote issued",
  order_requoted: "Quote revised",
  order_confirmed: "Quote accepted — downpayment due",
  order_payment_submitted: "Downpayment receipt uploaded",
  order_payment_rejected: "Receipt rejected — please re-upload",
  order_in_production: "Downpayment confirmed — in production",
  order_completed: "Order completed",
  order_declined: "Order declined",
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function OrderPreviewCard({
  payload,
  className = "",
  onViewOrderDetails,
}: {
  payload: OrderEventPayload;
  className?: string;
  /**
   * Opens the order over the conversation instead of navigating away from it.
   * Omitted where there is no dialog to open into (a standalone page), and the
   * button falls back to the order URL.
   */
  onViewOrderDetails?: (orderId: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  const orderId = payload.order_id ?? "";
  const status = payload.status ?? "pending_quote";
  const meta = orderStatusMeta(status);
  const total = toNumber(payload.quoted_total);
  const percent = toNumber(payload.downpayment_percent);
  const due = toNumber(payload.downpayment_amount);
  const quoteLines = parseQuoteLines(payload.quote_lines);

  // Read live, and only once per card. RLS already limits this to the customer
  // and the shop, which is exactly who can see the conversation.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    void (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("design_orders")
        .select("preview_url")
        .eq("id", orderId)
        .maybeSingle();
      if (!cancelled) setThumbnail((data as { preview_url?: string | null } | null)?.preview_url ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (!orderId) return null;

  return (
    <article
      className={`w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--fc-border)] px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]">
          {EVENT_HEADLINE[payload.event ?? ""] ?? uiText("Order update")}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${meta.tone}`}>
          {uiText(meta.label)}
        </span>
      </div>

      <div className="flex gap-3 p-3">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)]">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="h-full w-full object-contain" />
          ) : (
            <IconFurniture aria-hidden className="h-7 w-7 opacity-40" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[var(--fc-text)]">
            {payload.project_name ?? uiText("Design order")}
          </p>
          {payload.furniture_type ? (
            <p className="truncate text-[11px] text-[var(--fc-muted)]">{payload.furniture_type}</p>
          ) : null}
          <p className="mt-0.5 font-mono text-[10px] text-[var(--fc-muted)]">#{orderId.slice(0, 8)}</p>

          {total != null ? (
            <p className="mt-1 text-xs text-[var(--fc-text)]">
              <strong>{formatPeso(total)}</strong>
              {percent != null ? (
                <span className="text-[var(--fc-muted)]">
                  {" · "}
                  {percent}{uiText("% down")}{due != null ? ` (${formatPeso(due)})` : ""}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* The breakdown this quote was sent with -- from the card's own
          payload, so a revised quote's card and the one before it each keep
          what they said, and the customer can compare them. */}
      {quoteLines.length > 0 ? (
        <details className="group border-t border-[var(--fc-border)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-[var(--fc-ink-accent)] [@media(pointer:coarse)]:min-h-11 [&::-webkit-details-marker]:hidden">{uiText("See breakdown · ")}{quoteLines.length} {quoteLines.length === 1 ? uiText("line") : uiText("lines")}
            <IconChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <QuoteBreakdownList lines={quoteLines} className="px-3 pb-3" />
        </details>
      ) : null}

      {/* A decline in the conversation used to read as the single word
          "declined", which is the half of the message that helps nobody --
          the other party learns it is over but not what to change. */}
      {payload.status === "declined" && payload.decline_reason ? (
        <p className="border-t border-[var(--fc-border)] px-3 py-2 text-xs leading-relaxed text-[var(--fc-text)]">
          <span className="font-semibold text-[var(--fc-danger)]">
            {payload.declined_by === "customer" ? uiText("Customer's reason") : uiText("Shop's reason")}:
          </span>{" "}
          {payload.decline_reason}
        </p>
      ) : null}

      {/* Rejecting a receipt used to read as a plain "downpayment due" card,
          identical to the very first quote acceptance -- nothing said the
          upload had been refused, let alone why. */}
      {payload.event === "order_payment_rejected" && payload.payment_rejected_reason ? (
        <p className="border-t border-[var(--fc-border)] px-3 py-2 text-xs leading-relaxed text-[var(--fc-text)]">
          <span className="font-semibold text-[var(--fc-danger)]">{uiText("Why it was rejected:")}</span>{" "}
          {payload.payment_rejected_reason}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-[var(--fc-border)] px-3 py-2">
        <button
          type="button"
          onClick={() =>
            onViewOrderDetails ? onViewOrderDetails(orderId) : router.push(`/protected/orders/${orderId}`)
          }
          className="btn btn-primary btn-sm"
        >{uiText("View order details")}</button>
        <button
          type="button"
          onClick={() => router.push(`/protected/orders/${orderId}?open=studio`)}
          className="btn btn-secondary btn-sm"
        >{uiText("Inspect 3D design")}</button>
      </div>
    </article>
  );
}
