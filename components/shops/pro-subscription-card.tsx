"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { SUBSCRIPTION_COLUMNS, toAllowance, type Allowance } from "@/lib/shops/allowance";
import {
  SUBSCRIPTION_DATE_OPTIONS,
  PAYMENT_COLUMNS,
  PESO,
  PLATFORM_ASSET_BUCKET,
  SUBSCRIPTION_RECEIPT_BUCKET,
  fetchPlatformSettings,
  isGrant,
  signedLink,
  submitSubscriptionPayment,
  toPayment,
  type PlatformSettings,
  type SubscriptionPayment,
} from "@/lib/shops/subscription";

/**
 * A shop's Pro subscription: what it has, and how to pay for more.
 *
 * Payment is the flow the platform already runs for orders, pointed the
 * other way: the shop pays FurniCraft by scanning its QR, files the reference
 * number and a receipt, and an admin checks it against the platform's own
 * account before switching the shop to Pro. Nothing here moves money or
 * decides anything -- it files a claim, and shows where that claim stands.
 */

const PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-fc-btn px-5 py-2.5 [@media(pointer:coarse)]:min-h-11 text-sm font-bold text-fc-btn-fg transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-fc-btn-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
const FIELD =
  "mt-1 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)] focus:outline-none";
const EYEBROW = "text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]";

export default function ProSubscriptionCard({ shopId }: { shopId: string }) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [reference, setReference] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [platform, subscription, history] = await Promise.all([
      fetchPlatformSettings(),
      supabase.from("shop_subscriptions").select(SUBSCRIPTION_COLUMNS).eq("shop_id", shopId).maybeSingle(),
      supabase
        .from("subscription_payments")
        .select(PAYMENT_COLUMNS)
        .eq("shop_id", shopId)
        .order("submitted_at", { ascending: false })
        .limit(6),
    ]);
    setSettings(platform);
    setQrUrl(await signedLink(PLATFORM_ASSET_BUCKET, platform?.paymentQrPath ?? null));
    setAllowance(subscription.data ? toAllowance(subscription.data, Date.now()) : null);
    setPayments((history.data ?? []).map(toPayment));
    setLoading(false);
  }, [shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = payments.find((payment) => payment.status === "pending") ?? null;
  const latest = payments[0] ?? null;
  const rejected = !pending && latest?.status === "rejected" ? latest : null;
  const price = settings ? PESO.format(settings.proPricePhp) : "—";
  const onPro = allowance?.onPro === true;

  const submit = async () => {
    if (!receipt) return;
    setSubmitting(true);
    setError(null);
    const result = await submitSubscriptionPayment(shopId, reference, receipt);
    setSubmitting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setReference("");
    setReceipt(null);
    setNotice("Sent. FurniCraft will check it against its account and switch your shop to Pro -- you'll get a notification.");
    notifySuccess("Payment proof sent");
    await load();
  };

  const viewReceipt = async (path: string | null) => {
    const url = await signedLink(SUBSCRIPTION_RECEIPT_BUCKET, path);
    if (url) window.open(url, "_blank", "noopener");
  };

  if (loading) {
    return (
      <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm" aria-busy="true">
        <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading your subscription…")}</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------- where it stands */}
      <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
        <p className={EYEBROW}>{uiText("Your plan")}</p>
        {onPro && allowance ? (
          <>
            <h3 className="mt-1 font-display text-2xl font-bold text-[var(--fc-text)]">{uiText("Pro")}</h3>
            <p className="mt-1 text-sm text-[var(--fc-muted)]">
              <span className="font-mono tabular-nums text-[var(--fc-text)]">
                {Math.max(0, allowance.limit - allowance.used)}{uiText(" of ")}{allowance.limit}
              </span>{" "}{uiText("photo generations left, until")}{" "}
              <span className="font-semibold text-[var(--fc-text)]">
                {allowance.periodEnd ? new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(allowance.periodEnd)) : "—"}
              </span>
              .
            </p>
          </>
        ) : (
          <>
            <h3 className="mt-1 font-display text-2xl font-bold text-[var(--fc-text)]">{uiText("Free")}</h3>
            <p className="mt-1 text-sm text-[var(--fc-muted)]">
              {allowance?.trialUsed ? uiText("Your one free photo generation has been used.") : uiText("You have one free photo generation to try it out.")}{" "}{uiText("Pro adds ")}<span className="font-semibold text-[var(--fc-text)]">{uiText("15 photo generations every 30 days")}</span>{uiText(" for")}{" "}
              <span className="font-semibold text-[var(--fc-text)]">{price}</span>.
            </p>
          </>
        )}

        {pending ? (
          <div className="mt-4 rounded-2xl border border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] p-4" role="status">
            <p className="text-sm font-semibold text-[var(--fc-text)]">{uiText("Payment under review")}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("Sent ")}{new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(pending.submittedAt))}
              {pending.reference ? <>{uiText(" · reference ")}<span className="font-mono">{pending.reference}</span></> : null}
              {pending.amount !== null ? <> · {PESO.format(pending.amount)}</> : null}{uiText(". FurniCraft checks payments by hand; you’ll be notified as soon as it’s done.")}</p>
          </div>
        ) : null}

        {rejected ? (
          <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-4" role="alert">
            <p className="text-sm font-semibold text-[var(--fc-text)]">{uiText("Your last payment couldn’t be verified")}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{rejected.rejectedReason}</p>
            <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("You can send it again below.")}</p>
          </div>
        ) : null}

        {notice ? (
          <p className="mt-4 text-sm text-[var(--fc-text)]" role="status">
            {uiText(notice)}
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------ paying */}
      {!pending ? (
        <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm" aria-labelledby="pay-heading">
          <p className={EYEBROW}>{onPro ? uiText("Renew early") : uiText("Upgrade to Pro")}</p>
          <h3 id="pay-heading" className="mt-1 text-lg font-semibold text-[var(--fc-text)]">
            {price}{uiText(" for 30 days")}</h3>
          {onPro ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("The new 30 days start when your current ones end, and any generations you haven’t used carry over.")}</p>
          ) : null}

          <ol className="mt-5 space-y-5">
            <li>
              <p className="text-sm font-semibold text-[var(--fc-text)]">{uiText("1. Scan and pay ")}{price}</p>
              {qrUrl ? (
                <div className="mt-2 flex flex-wrap items-start gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrUrl}
                    alt={uiText("FurniCraft payment QR code")}
                    className="h-44 w-44 rounded-2xl border border-[var(--fc-border)] bg-white object-contain p-2"
                  />
                  <div className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--fc-muted)]">
                    {settings?.paymentAccountName ? (
                      <p>{uiText("Pay to ")}<span className="font-semibold text-[var(--fc-text)]">{settings.paymentAccountName}</span>
                      </p>
                    ) : null}
                    <p className="mt-1">{uiText("Scan with GCash, Maya or your bank app (QR Ph).")}</p>
                    {settings?.paymentNote ? <p className="mt-1">{settings.paymentNote}</p> : null}
                  </div>
                </div>
              ) : (
                <p className="mt-2 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-xs text-[var(--fc-muted)]">{uiText("FurniCraft hasn’t added its payment QR yet. Please check back soon.")}</p>
              )}
            </li>

            <li>
              <label htmlFor="pro-reference" className="text-sm font-semibold text-[var(--fc-text)]">{uiText("2. Enter the reference number")}</label>
              <input
                id="pro-reference"
                className={FIELD}
                inputMode="text"
                autoComplete="off"
                placeholder={uiText("From your GCash or bank receipt")}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </li>

            <li>
              <span className="text-sm font-semibold text-[var(--fc-text)]">{uiText("3. Upload the receipt")}</span>
              <label
                htmlFor="pro-receipt"
                className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--fc-border)] p-4 transition-[border-color,background-color] duration-150 ease-out hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)]"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7 shrink-0 text-[var(--fc-ink-accent)]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h9l3 3v15H6z" />
                  <path d="M9 12h6M9 16h6M9 8h3" />
                </svg>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold text-[var(--fc-text)]">{receipt ? receipt.name : uiText("Choose a screenshot or PDF")}</span>
                  <span className="block text-xs text-[var(--fc-muted)]">{uiText("Showing the amount, date and reference. Up to 5 MB.")}</span>
                </span>
              </label>
              <input
                id="pro-receipt"
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  setReceipt(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </li>
          </ol>

          {error ? (
            <p className="mt-4 text-sm text-[var(--fc-danger)]" role="alert">
              {uiText(error)}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--fc-border)] pt-5">
            <button type="button" className={PRIMARY} disabled={!receipt || !qrUrl || submitting} onClick={() => void submit()}>
              {submitting ? uiText("Sending…") : uiText("Send for review")}
            </button>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("FurniCraft checks each payment against its own account, usually within a day.")}</p>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ history */}
      {payments.length ? (
        <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
          <p className={EYEBROW}>{uiText("History")}</p>
          <ul className="mt-3 divide-y divide-[var(--fc-border)]">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="text-[var(--fc-muted)]">{new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(payment.submittedAt))}</span>
                <span className="font-mono tabular-nums text-[var(--fc-text)]">
                  {isGrant(payment) ? uiText("Granted") : payment.amount !== null ? PESO.format(payment.amount) : "—"}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      payment.status === "approved"
                        ? "bg-[color-mix(in_srgb,var(--fc-online)_14%,transparent)] text-[var(--fc-online)]"
                        : payment.status === "rejected"
                          ? "bg-[color-mix(in_srgb,var(--fc-danger)_12%,transparent)] text-[var(--fc-danger)]"
                          : "bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-[var(--fc-ink-accent)]"
                    }`}
                  >
                    {payment.status === "approved" ? uiText("Approved") : payment.status === "rejected" ? uiText("Not verified") : uiText("Under review")}
                  </span>
                  {payment.receiptPath ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--fc-ink-accent)] underline-offset-2 transition-[color] duration-150 hover:underline"
                      onClick={() => void viewReceipt(payment.receiptPath)}
                    >{uiText("Receipt")}</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
