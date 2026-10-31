"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useState } from "react";
import ConfirmModal from "@/components/ui/confirm-modal";

/**
 * The refund conversation, as both sides see it.
 *
 * One component rather than one per dashboard: a refund is a single record with
 * two authors, and two implementations of it would drift into disagreeing about
 * the same row. Which half is editable comes from `viewer`.
 *
 * What this cannot do is move money. Payment on FurniCraft is a QR transfer
 * straight from the customer to the shop's own account -- the platform never
 * holds a peso -- so a refund is the same thing in reverse, and this records it
 * rather than performing it. Every string here is written to say so. A customer
 * who came away believing the platform will return their money would have been
 * misled by this screen, not by the shop.
 */

export type RefundState = {
  refund_status?: string | null;
  refund_reason?: string | null;
  refund_requested_at?: string | null;
  refund_declined_reason?: string | null;
  refund_decided_at?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
};

/** The statuses from which money may already have changed hands. */
const PAID_STATUSES = ["payment_submitted", "in_production", "completed"];

export function canAskForRefund(order: { status: string } & RefundState): boolean {
  if (!PAID_STATUSES.includes(order.status)) return false;
  // A request awaiting an answer, or one already paid, is not asked again. A
  // refusal may be appealed -- circumstances change, and the shop can refuse
  // again.
  return order.refund_status !== "requested" && order.refund_status !== "refunded";
}

/**
 * True while a refund request is sitting unanswered by the shop.
 *
 * Worth its own helper because of where refunds land. A refund is asked for
 * after money has moved, which in practice means the order says `completed` --
 * the piece was delivered and then something was wrong with it. `completed` is
 * not in SHOP_ACTIONABLE, so an order in exactly the state that has a customer
 * waiting on the shop sorts into the shop's history and dims. Every list that
 * decides what the shop still owes an answer to has to ask this alongside the
 * status, or the request is filed as finished business.
 */
export function needsRefundAnswer(order: RefundState): boolean {
  return order.refund_status === "requested";
}

/**
 * The refund's state as a chip, for order lists.
 *
 * Sits beside the status badge rather than replacing it, because both things
 * are true at once: the piece was completed, and the money is in dispute. Only
 * `requested` takes the accent; the two settled states are here so that a
 * refunded order does not read as an ordinary finished one, not to ask for
 * anything.
 */
export function RefundTag({ order }: { order: RefundState }) {
  const { t: uiText } = useUiLanguage();
  const state = order.refund_status ?? null;
  if (!state) return null;

  const tone =
    state === "requested"
      ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
      : state === "refunded"
        ? "border-[rgba(5,150,105,0.4)] bg-[rgba(5,150,105,0.1)] text-fc-online"
        : "border-[var(--fc-border)] bg-transparent text-[var(--fc-muted)]";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tone}`}
    >
      {state === "requested" ? uiText("Refund asked") : state === "refunded" ? uiText("Refunded") : uiText("Refund refused")}
    </span>
  );
}

function peso(value: number | null | undefined): string {
  return typeof value === "number" ? `₱${value.toLocaleString("en-US")}` : "—";
}

export function RefundPanel({
  order,
  viewer,
  busy,
  onRequest,
  onDecline,
  onRefund,
}: {
  order: { status: string; quoted_total?: number | null } & RefundState;
  viewer: "customer" | "shop";
  busy?: boolean;
  onRequest?: (reason: string) => void;
  onDecline?: (reason: string) => void;
  onRefund?: (amount: number, reference: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [asking, setAsking] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const state = order.refund_status ?? null;

  // Nothing has happened and nothing can: no panel at all rather than an empty
  // heading on every unpaid order.
  if (!state && (viewer === "shop" || !canAskForRefund(order))) return null;

  return (
    <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Its own colour, not the parent's. Dropped into a container that
            does not set one, this heading rendered near-black on the dark
            theme's near-black panel. */}
        <h2 className="font-display text-lg font-bold text-[var(--fc-text)]">{uiText("Refund")}</h2>
        {state ? (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              state === "refunded"
                ? "bg-[rgba(5,150,105,0.12)] text-fc-online"
                : state === "declined"
                  ? "bg-[rgba(192,57,43,0.12)] text-fc-danger"
                  : "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
            }`}
          >
            {state === "requested" ? uiText("Awaiting the shop") : state === "declined" ? uiText("Refused") : uiText("Refunded")}
          </span>
        ) : null}
      </div>

      {/* ---------------------------------------------------- the record ---- */}
      {order.refund_reason ? (
        <div className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">
            {viewer === "shop" ? uiText("The customer asked because") : uiText("You asked because")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fc-text)]">
            {order.refund_reason}
          </p>
        </div>
      ) : null}

      {state === "declined" && order.refund_declined_reason ? (
        <div className="mt-3 rounded-xl border border-[rgba(192,57,43,0.35)] bg-[rgba(192,57,43,0.08)] p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fc-danger">
            {viewer === "shop" ? uiText("You refused because") : uiText("The shop refused because")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fc-text)]">
            {order.refund_declined_reason}
          </p>
        </div>
      ) : null}

      {state === "refunded" ? (
        <div className="mt-3 grid gap-2 rounded-xl border border-[rgba(5,150,105,0.3)] bg-[rgba(5,150,105,0.08)] p-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Amount returned")}</p>
            <p className="mt-0.5 font-bold tabular-nums text-[var(--fc-text)]">{peso(order.refund_amount)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Reference")}</p>
            <p className="mt-0.5 font-mono text-sm text-[var(--fc-text)]">{order.refund_reference || "—"}</p>
          </div>
          <p className="text-[11px] leading-snug text-[var(--fc-muted)] sm:col-span-2">{uiText("The shop reports sending this directly to your account. FurniCraft never holds the money, so check your own bank or GCash to confirm it arrived, and message the shop if it has not.")}</p>
        </div>
      ) : null}

      {/* ------------------------------------------------------ what next --- */}
      {viewer === "customer" && !state ? (
        <>
          <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("You have submitted a payment for this order. If something has gone wrong, you can ask the shop to return it — they decide, and they send it directly.")}</p>
          <button
            type="button"
            onClick={() => setAsking(true)}
            disabled={busy}
            className="btn btn-secondary btn-sm mt-3"
          >{uiText("Request a refund")}</button>
        </>
      ) : null}

      {viewer === "customer" && state === "requested" ? (
        <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("The shop has been told. They will either send the money back and record the reference here, or explain why not.")}</p>
      ) : null}

      {viewer === "customer" && state === "declined" ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          disabled={busy}
          className="btn btn-secondary btn-sm mt-3"
        >{uiText("Ask again")}</button>
      ) : null}

      {viewer === "shop" && state === "requested" ? (
        <>
          <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Send the money from the same account that received it, then record it here. FurniCraft does not move it for you — this is the record that it happened.")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSettling(true)} disabled={busy} className="btn btn-primary btn-sm">{uiText("I have refunded this")}</button>
            <button type="button" onClick={() => setDeclining(true)} disabled={busy} className="btn btn-secondary btn-sm">{uiText("Refuse, with a reason")}</button>
          </div>
        </>
      ) : null}

      {/* --------------------------------------------------------- dialogs -- */}
      <ConfirmModal
        open={asking}
        title={uiText("Ask this shop for a refund?")}
        body="The shop decides, and sends any money back directly — FurniCraft does not hold it. Tell them what went wrong; a clear reason is answered faster than a vague one."
        confirmLabel={uiText("Send request")}
        busy={busy}
        reason={{
          label: "What went wrong?",
          placeholder: "e.g. The piece arrived with a cracked leg and I would rather not have it repaired.",
          required: true,
        }}
        onConfirm={(reason) => {
          setAsking(false);
          if (reason) onRequest?.(reason);
        }}
        onCancel={() => setAsking(false)}
      />

      <ConfirmModal
        open={declining}
        title={uiText("Refuse this refund?")}
        body="The customer sees your reason. Refusing does not close the order or stop them asking again."
        confirmLabel={uiText("Refuse refund")}
        tone="danger"
        busy={busy}
        reason={{
          label: "Why not?",
          placeholder: "e.g. The timber was cut to these measurements and cannot be re-used.",
          required: true,
        }}
        onConfirm={(reason) => {
          setDeclining(false);
          if (reason) onDecline?.(reason);
        }}
        onCancel={() => setDeclining(false)}
      />

      {settling ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--fc-scrim)] p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettling(false);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-2xl sm:p-6">
            <h3 className="text-lg font-bold text-[var(--fc-text)]">{uiText("Record the refund you sent")}</h3>
            <p className="mt-1.5 text-sm text-[var(--fc-muted)]">{uiText("Only after the transfer has actually left your account. This is what the customer will check against their own statement.")}</p>

            <label className="mt-4 block text-sm font-semibold text-[var(--fc-text)]" htmlFor="refund-amount">{uiText("Amount returned")}</label>
            <input
              id="refund-amount"
              type="number"
              min={0}
              max={order.quoted_total ?? undefined}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={order.quoted_total ? String(order.quoted_total) : "0"}
              className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-transparent px-3 py-2 text-[var(--fc-text)]"
            />
            {order.quoted_total ? (
              <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("A partial refund is fine. The quote was ")}{peso(order.quoted_total)}{uiText("; more than that is refused by the database.")}</p>
            ) : null}

            <label className="mt-3 block text-sm font-semibold text-[var(--fc-text)]" htmlFor="refund-reference">{uiText("Transfer reference")}</label>
            <input
              id="refund-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={uiText("e.g. GCash ref 8021 4477 1930")}
              className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-transparent px-3 py-2 text-[var(--fc-text)]"
            />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setSettling(false)} className="btn btn-secondary btn-sm" disabled={busy}>{uiText("Cancel")}</button>
              <button
                type="button"
                disabled={busy || !amount.trim() || !reference.trim()}
                onClick={() => {
                  const value = Number(amount);
                  if (!Number.isFinite(value) || value < 0) return;
                  setSettling(false);
                  onRefund?.(value, reference.trim());
                }}
                className="btn btn-primary btn-sm"
              >
                {busy ? uiText("Saving…") : uiText("Record refund")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
