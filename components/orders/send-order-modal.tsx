"use client";

import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { Modal } from "@/components/ui/modal";
import type { DesignTemplate } from "@/components/dashboard/customer-dashboard-types";

/**
 * A shop writing an order for a customer it has been talking to.
 *
 * Orders have only ever gone one way -- a customer designs a piece and sends
 * it to a workshop -- which left nothing for the ordinary case of agreeing a
 * piece in chat, or a walk-in standing at the bench. The shop's only move was
 * to ask the customer to go and build the design themselves.
 *
 * It starts at 'quoted' rather than 'pending_quote', which is the whole point:
 * the shop already knows what it is charging, so the customer's first action
 * is to accept or decline something concrete instead of waiting for the shop
 * to quote itself. From there the existing machine takes over unchanged --
 * confirmed, payment_submitted, in_production, completed.
 *
 * The customer has to have messaged this shop. That is enforced in the
 * database by design_orders_insert_shop_owner, not here: this dialog only
 * opens from inside a conversation, so the rule is already satisfied by the
 * time anyone sees it, and the policy is what stops it being bypassed.
 */

/** Matches design_orders_downpayment_percent_check. */
const MIN_DOWNPAYMENT = 5;
const MAX_DOWNPAYMENT = 100;
const NO_DESIGN = "none";

export function SendOrderModal({
  open,
  onClose,
  shopId,
  shopOwnerUserId,
  customerUserId,
  customerName,
  templates,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  shopId: string;
  /** Written to quoted_by, which the insert policy checks against auth.uid(). */
  shopOwnerUserId: string;
  /** Null when the dialog was opened outside a conversation: link only. */
  customerUserId: string | null;
  customerName: string;
  templates: DesignTemplate[];
  onSent: (orderId: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [templateId, setTemplateId] = useState<string>(NO_DESIGN);
  const [projectName, setProjectName] = useState("");
  const [total, setTotal] = useState("");
  const [downpayment, setDownpayment] = useState("50");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Cleared on open rather than on close, so a dialog dismissed by accident
  // and reopened does not quietly resend what was typed for someone else.
  useEffect(() => {
    if (!open) return;
    setTemplateId(NO_DESIGN);
    setProjectName("");
    setTotal("");
    setDownpayment("50");
    setNotes("");
    setError(null);
    setLink(null);
    setCopied(false);
  }, [open]);

  const template = useMemo(
    () => templates.find((entry) => entry.id === templateId) ?? null,
    [templateId, templates]
  );

  // Naming the piece after the chosen design is right nearly every time, so
  // it is filled in rather than demanded -- and left alone once the shop has
  // typed its own, which is what the untouched check is for.
  const [nameTouched, setNameTouched] = useState(false);
  useEffect(() => {
    if (nameTouched) return;
    setProjectName(template?.title ?? "");
  }, [template, nameTouched]);

  const totalValue = Number(total);
  const downpaymentValue = Number(downpayment);
  const downpaymentAmount =
    Number.isFinite(totalValue) && Number.isFinite(downpaymentValue) && totalValue > 0
      ? Math.round((totalValue * downpaymentValue) / 100)
      : null;

  const problem =
    !projectName.trim()
      ? uiText("Give this order a name so the customer knows what it is.")
      : !total.trim() || !Number.isFinite(totalValue) || totalValue <= 0
        ? uiText("Enter the total you are charging.")
        : !Number.isFinite(downpaymentValue) ||
            downpaymentValue < MIN_DOWNPAYMENT ||
            downpaymentValue > MAX_DOWNPAYMENT
          ? uiText("The downpayment has to be between {0}% and {1}%.", { 0: MIN_DOWNPAYMENT, 1: MAX_DOWNPAYMENT })
          : null;

  /**
   * The same order, written as an offer nobody owns yet.
   *
   * The link is the only thing standing between this and whoever opens it, so
   * the token is random and the row carries no customer at all: it becomes a
   * real order in claim_order_offer, from these figures rather than from
   * anything the browser says later.
   */
  const handleLink = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("order_offers")
        .insert({
          shop_id: shopId,
          created_by: shopOwnerUserId,
          project_name: projectName.trim(),
          furniture_type: template?.tag ?? null,
          cad_state: template?.cad_state ?? null,
          preview_url: template?.preview_url ?? null,
          model_path: template?.model_path ?? null,
          quoted_total: totalValue,
          downpayment_percent: downpaymentValue,
          notes: notes.trim() || null,
        })
        .select("token")
        .single();

      if (insertError) {
        console.error("Failed to create the offer:", insertError);
        setError(
          insertError.code === "42501"
            ? uiText("This link could not be made. The shop has to be open to orders.")
            : uiText("The link could not be made (error {0}). Please try again.", { 0: insertError.code ?? "unknown" })
        );
        return;
      }

      const url = `${window.location.origin}/o/${String(data.token)}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } catch {
        // Clipboard access is refused in plenty of ordinary situations --
        // an insecure origin, a browser that wants a fresher gesture. The
        // link is shown either way, so it can still be copied by hand.
        setCopied(false);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = async () => {
    if (problem || !customerUserId) {
      setError(problem ?? uiText("Open this from a conversation to send it in chat."));
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("design_orders")
        .insert({
          shop_id: shopId,
          customer_user_id: customerUserId,
          project_name: projectName.trim(),
          furniture_type: template?.tag ?? null,
          status: "quoted",
          quoted_total: totalValue,
          downpayment_percent: downpaymentValue,
          quoted_by: shopOwnerUserId,
          quoted_at: new Date().toISOString(),
          cad_state: template?.cad_state ?? null,
          preview_url: template?.preview_url ?? null,
          notes: notes.trim() || null,
          reference_images: [],
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Failed to send the order:", insertError);
        setError(
          insertError.code === "42501"
            ? uiText("This order was refused. A shop can only send an order to a customer who has messaged it, and only while the shop is open to orders.")
            : uiText("The order could not be sent (error {0}). Please try again.", { 0: insertError.code ?? "unknown" })
        );
        return;
      }

      onSent(data.id);
      onClose();
      notifySuccess("Order sent");
    } finally {
      setIsSending(false);
    }
  };

  const field =
    "w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none placeholder:text-[var(--fc-muted)] focus:border-[#8b5a2b]";
  const label = "block text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={customerUserId ? uiText("Send an order to {0}", { 0: customerName }) : uiText("Write an order")}
      eyebrow={uiText("New order")}
      title={customerUserId ? uiText("Send an order to {0}", { 0: customerName }) : uiText("Write an order")}
      className="sm:max-w-md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.97]"
          >
            {uiText("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleLink()}
            disabled={isSending || Boolean(problem)}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {link ? uiText("New link") : uiText("Copy link")}
          </button>
          {customerUserId ? (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isSending || Boolean(problem)}
              className="inline-flex min-h-11 items-center rounded-full bg-[var(--fc-btn)] px-5 text-sm font-semibold text-[var(--fc-bg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? uiText("Sending…") : uiText("Send in chat")}
            </button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--fc-muted)]">
          {customerUserId
            ? uiText("{0} gets this as a quote to accept or decline.", { 0: customerName })
            : uiText("Whoever opens the link sees the piece in 3D and this price, and takes it as a quote to accept or decline.")}{" "}
          {uiText("Nothing is charged here — once they accept, they pay the downpayment the usual way.")}
        </p>

        {link ? (
          <div className="rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--fc-text)]">
              {copied ? uiText("Link copied. Send it to them.") : uiText("Here is the link — copy it and send it to them.")}
            </p>
            {/* Selectable, because the clipboard is refused often enough that
                a link nobody can copy by hand is a link that does not work. */}
            <p className="mt-1 break-all font-mono text-[11px] leading-snug text-[var(--fc-muted)]">{link}</p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
              {uiText("It works once. They do not need an account to look, only to take the order.")}
            </p>
          </div>
        ) : null}

        <label className="block">
          <span className={label}>{uiText("Design")}</span>
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className={`${field} mt-1.5`}
          >
            <option value={NO_DESIGN}>{uiText("No design — agreed in chat")}</option>
            {templates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-snug text-[var(--fc-muted)]">
            {uiText("One of your templates, which the customer can open and look at. Leave it as agreed in chat for a piece you have only talked about.")}
          </span>
        </label>

        <label className="block">
          <span className={label}>{uiText("What to call it")}</span>
          <input
            value={projectName}
            onChange={(event) => {
              setNameTouched(true);
              setProjectName(event.target.value);
            }}
            placeholder={uiText("Narra dining table, six seats")}
            className={`${field} mt-1.5`}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>{uiText("Total (₱)")}</span>
            <input
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              placeholder="18500"
              className={`${field} mt-1.5 tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={label}>{uiText("Downpayment (%)")}</span>
            <input
              inputMode="numeric"
              value={downpayment}
              onChange={(event) => setDownpayment(event.target.value)}
              className={`${field} mt-1.5 tabular-nums`}
            />
          </label>
        </div>

        {downpaymentAmount !== null ? (
          <p className="rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] px-3 py-2 text-xs text-[var(--fc-text)]">
            {uiText("They pay {0} up front, and {1} on pick up.", { 0: `₱${downpaymentAmount.toLocaleString("en-US")}`, 1: `₱${(Math.round(totalValue) - downpaymentAmount).toLocaleString("en-US")}` })}
          </p>
        ) : null}

        <label className="block">
          <span className={label}>{uiText("Note (optional)")}</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={uiText("What you agreed — timber, finish, measurements, when it will be ready.")}
            className={`${field} mt-1.5 resize-y`}
          />
        </label>

        {error ? <p className="text-xs text-fc-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
