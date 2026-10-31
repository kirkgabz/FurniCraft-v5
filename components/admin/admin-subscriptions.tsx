"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import {
  SUBSCRIPTION_DATE_OPTIONS,
  PAYMENT_COLUMNS,
  PESO,
  PLATFORM_ASSET_BUCKET,
  SUBSCRIPTION_RECEIPT_BUCKET,
  fetchPlatformSettings,
  isGrant,
  signedLink,
  toPayment,
  uploadPlatformQr,
  type SubscriptionPayment,
} from "@/lib/shops/subscription";

/**
 * The admin side of Pro: checking what shops say they paid, granting Pro
 * outright, and setting the price and the QR shops pay through.
 *
 * Every verdict goes through the database functions (approve_/reject_
 * subscription_payment, grant_pro), which check the admin flag themselves
 * and notify the shop. This screen only decides which one to call.
 */

type ShopRow = { id: string; shop_name: string | null; status: string };
type SubRow = { shop_id: string; tier: string; period_end: string | null; generations_used: number; generations_limit: number };

const CARD = "rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm";
const PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-fc-btn px-4 py-2 text-sm font-bold text-fc-btn-fg transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-fc-btn-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
const QUIET =
  "inline-flex items-center justify-center rounded-full border border-[var(--fc-border)] px-4 py-2 text-sm font-semibold text-[var(--fc-ink-accent)] transition-[background-color,border-color,transform,opacity] duration-150 ease-out hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
const FIELD =
  "mt-1 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)] focus:outline-none";
const LABEL = "text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]";

function activeUntil(sub: SubRow | undefined, uiLocale: string): string | null {
  if (!sub || sub.tier !== "pro" || !sub.period_end || new Date(sub.period_end).getTime() <= Date.now()) return null;
  return new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(sub.period_end));
}

export default function AdminSubscriptions({ onPendingCountChange }: { onPendingCountChange?: (count: number) => void }) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [subs, setSubs] = useState<Record<string, SubRow>>({});
  const [pending, setPending] = useState<SubscriptionPayment[]>([]);
  const [history, setHistory] = useState<SubscriptionPayment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Grant form
  const [grantShopId, setGrantShopId] = useState("");
  const [grantDays, setGrantDays] = useState(30);
  const [grantNote, setGrantNote] = useState("");

  // Settings form
  const [price, setPrice] = useState("599");
  const [accountName, setAccountName] = useState("");
  const [note, setNote] = useState("");
  const [qrPath, setQrPath] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [shopResult, subResult, pendingResult, historyResult, settings] = await Promise.all([
      supabase.from("shops").select("id, shop_name, status").order("shop_name"),
      supabase.from("shop_subscriptions").select("shop_id, tier, period_end, generations_used, generations_limit"),
      supabase.from("subscription_payments").select(PAYMENT_COLUMNS).eq("status", "pending").order("submitted_at"),
      supabase
        .from("subscription_payments")
        .select(PAYMENT_COLUMNS)
        .neq("status", "pending")
        .order("verified_at", { ascending: false })
        .limit(20),
      fetchPlatformSettings(),
    ]);
    setShops((shopResult.data ?? []) as ShopRow[]);
    setSubs(Object.fromEntries(((subResult.data ?? []) as SubRow[]).map((row) => [row.shop_id, row])));
    const waiting = (pendingResult.data ?? []).map(toPayment);
    setPending(waiting);
    onPendingCountChange?.(waiting.length);
    setHistory((historyResult.data ?? []).map(toPayment));
    if (settings) {
      setPrice(String(settings.proPricePhp));
      setAccountName(settings.paymentAccountName ?? "");
      setNote(settings.paymentNote ?? "");
      setQrPath(settings.paymentQrPath);
      setQrUrl(await signedLink(PLATFORM_ASSET_BUCKET, settings.paymentQrPath));
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const shopName = (id: string) => shops.find((shop) => shop.id === id)?.shop_name || "Unnamed shop";
  const approvedShops = shops.filter((shop) => shop.status === "approved");

  const run = async (id: string, action: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setBusyId(id);
    setMessage(null);
    const { error } = await action();
    setBusyId(null);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    setMessage({ tone: "ok", text: success });
    notifySuccess(success);
    await load();
  };

  const approve = (payment: SubscriptionPayment) =>
    run(
      payment.id,
      () => createClient().rpc("approve_subscription_payment", { p_payment_id: payment.id }),
      `Approved. ${shopName(payment.shopId)} is on Pro and has been notified.`
    );

  const reject = (paymentId: string, shopId: string, reason: string) =>
    run(
      paymentId,
      () => createClient().rpc("reject_subscription_payment", { p_payment_id: paymentId, p_reason: reason.trim() }),
      `Rejected. ${shopName(shopId)} has been told why.`
    ).then(() => setRejecting(null));

  const grant = () =>
    run(
      "grant",
      () => createClient().rpc("grant_pro", { p_shop_id: grantShopId, p_days: grantDays, p_note: grantNote.trim() || null }),
      `Granted ${grantDays} days of Pro to ${shopName(grantShopId)}. They've been notified.`
    ).then(() => setGrantNote(""));

  const viewReceipt = async (path: string | null) => {
    const url = await signedLink(SUBSCRIPTION_RECEIPT_BUCKET, path);
    if (url) window.open(url, "_blank", "noopener");
    else setMessage({ tone: "error", text: "That receipt couldn't be opened." });
  };

  const saveSettings = async (nextQrPath: string | null = qrPath) => {
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ tone: "error", text: "Enter a price above zero." });
      return;
    }
    setSavingSettings(true);
    setMessage(null);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("platform_settings")
      .update({
        pro_price_php: amount,
        payment_account_name: accountName.trim() || null,
        payment_note: note.trim() || null,
        payment_qr_path: nextQrPath,
        updated_at: new Date().toISOString(),
        updated_by: userData.user?.id ?? null,
      })
      .eq("id", true);
    setSavingSettings(false);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    setMessage({ tone: "ok", text: "Payment settings saved. Shops see them straight away." });
    notifySaved("Settings saved");
    await load();
  };

  const replaceQr = async (file: File | null) => {
    if (!file) return;
    setSavingSettings(true);
    const uploaded = await uploadPlatformQr(file);
    setSavingSettings(false);
    if ("error" in uploaded) {
      setMessage({ tone: "error", text: uploaded.error });
      return;
    }
    await saveSettings(uploaded.path);
  };

  return (
    <div className="space-y-6">
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-2xl border px-4 py-3 text-sm ${
            message.tone === "error"
              ? "border-[color-mix(in_srgb,var(--fc-danger)_40%,transparent)] text-[var(--fc-danger)]"
              : "border-[var(--fc-border)] text-[var(--fc-text)]"
          }`}
        >
          {uiText(message.text)}
        </p>
      ) : null}

      {/* ------------------------------------------------ waiting for review */}
      <section className={CARD} aria-labelledby="pending-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="pending-heading" className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Waiting for review")}</h3>
          <span className="font-mono text-sm tabular-nums text-[var(--fc-muted)]">{pending.length}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Check each one against FurniCraft’s own GCash or bank account before approving.")}</p>
        {pending.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-[var(--fc-border)] p-6 text-center text-sm text-[var(--fc-muted)]">{uiText("Nothing to review. New payments appear here as shops send them.")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {pending.map((payment) => (
              <li key={payment.id} className="rounded-2xl border border-[var(--fc-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--fc-text)]">{shopName(payment.shopId)}</p>
                    <p className="mt-0.5 text-xs text-[var(--fc-muted)]">
                      {new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(payment.submittedAt))} ·{" "}
                      <span className="font-mono tabular-nums text-[var(--fc-text)]">
                        {payment.amount !== null ? PESO.format(payment.amount) : "—"}
                      </span>
                      {payment.reference ? (
                        <>
                          {" "}{uiText("· ref ")}<span className="font-mono">{payment.reference}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={QUIET} onClick={() => void viewReceipt(payment.receiptPath)}>{uiText("View receipt")}</button>
                    <button
                      type="button"
                      className={QUIET}
                      disabled={busyId === payment.id}
                      onClick={() => setRejecting({ id: payment.id, reason: "" })}
                    >{uiText("Reject")}</button>
                    <button type="button" className={PRIMARY} disabled={busyId === payment.id} onClick={() => void approve(payment)}>
                      {busyId === payment.id ? uiText("Working…") : uiText("Approve")}
                    </button>
                  </div>
                </div>
                {rejecting?.id === payment.id ? (
                  <div className="mt-3 border-t border-[var(--fc-border)] pt-3">
                    <label className={LABEL} htmlFor={`reason-${payment.id}`}>{uiText("Why it can’t be verified")}</label>
                    <textarea
                      id={`reason-${payment.id}`}
                      rows={2}
                      className={FIELD}
                      placeholder={uiText("e.g. No payment with this reference reached our account.")}
                      value={rejecting.reason}
                      onChange={(event) => setRejecting({ id: payment.id, reason: event.target.value })}
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className={PRIMARY}
                        disabled={!rejecting.reason.trim() || busyId === payment.id}
                        onClick={() => void reject(payment.id, payment.shopId, rejecting.reason)}
                      >{uiText("Send rejection")}</button>
                      <button type="button" className={QUIET} onClick={() => setRejecting(null)}>{uiText("Cancel")}</button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------- grant Pro */}
        <section className={CARD} aria-labelledby="grant-heading">
          <h3 id="grant-heading" className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Grant Pro")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("For demos, promotions or goodwill, without a payment. Recorded as a ₱0 grant and the shop is notified. A shop already on Pro has the days added to the end.")}</p>
          <label className={`${LABEL} mt-4 block`} htmlFor="grant-shop">{uiText("Shop")}</label>
          <select id="grant-shop" className={FIELD} value={grantShopId} onChange={(event) => setGrantShopId(event.target.value)}>
            <option value="">{uiText("Choose an approved shop…")}</option>
            {approvedShops.map((shop) => {
              const until = activeUntil(subs[shop.id], uiLocale);
              return (
                <option key={shop.id} value={shop.id}>
                  {shop.shop_name || uiText("Unnamed shop")} — {until ? uiText("Pro until {0}", { 0: until }) : uiText("Free")}
                </option>
              );
            })}
          </select>
          <div className="mt-3 grid grid-cols-[7rem_1fr] gap-3">
            <label className="block">
              <span className={LABEL}>{uiText("Days")}</span>
              <input
                type="number"
                min={1}
                max={366}
                className={`${FIELD} font-mono tabular-nums`}
                value={Number.isFinite(grantDays) ? grantDays : ""}
                onChange={(event) => setGrantDays(event.target.valueAsNumber)}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{uiText("Note")}</span>
              <input
                className={FIELD}
                placeholder={uiText("Thesis demo")}
                value={grantNote}
                onChange={(event) => setGrantNote(event.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className={`${PRIMARY} mt-4`}
            disabled={!grantShopId || !Number.isFinite(grantDays) || grantDays < 1 || grantDays > 366 || busyId === "grant"}
            onClick={() => void grant()}
          >
            {busyId === "grant" ? uiText("Granting…") : uiText("Grant Pro")}
          </button>
        </section>

        {/* ------------------------------------------------ payment settings */}
        <section className={CARD} aria-labelledby="settings-heading">
          <h3 id="settings-heading" className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Payment settings")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("What shops see when they upgrade.")}</p>
          <div className="mt-4 grid grid-cols-[8rem_1fr] gap-3">
            <label className="block">
              <span className={LABEL}>{uiText("Price (₱)")}</span>
              <input
                type="number"
                min={1}
                className={`${FIELD} font-mono tabular-nums`}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{uiText("Account name")}</span>
              <input
                className={FIELD}
                placeholder={uiText("FurniCraft")}
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
              />
            </label>
          </div>
          <label className="mt-3 block">
            <span className={LABEL}>{uiText("Note for shops")}</span>
            <input
              className={FIELD}
              placeholder={uiText("e.g. Put your shop name in the message.")}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt={uiText("Current payment QR")} className="h-28 w-28 rounded-2xl border border-[var(--fc-border)] bg-white object-contain p-1.5" />
            ) : (
              <span className="grid h-28 w-28 place-items-center rounded-2xl border border-dashed border-[var(--fc-border)] text-center text-[11px] text-[var(--fc-muted)]">{uiText("No QR yet")}</span>
            )}
            <label className={`${QUIET} cursor-pointer`}>
              {qrUrl ? uiText("Replace QR") : uiText("Upload QR")}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  void replaceQr(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <button type="button" className={`${PRIMARY} mt-4`} disabled={savingSettings} onClick={() => void saveSettings()}>
            {savingSettings ? uiText("Saving…") : uiText("Save settings")}
          </button>
        </section>
      </div>

      {/* ------------------------------------------------------- history */}
      <section className={CARD} aria-labelledby="history-heading">
        <h3 id="history-heading" className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Recent decisions")}</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("No payments or grants yet.")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--fc-border)]">
            {history.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="min-w-0 font-semibold text-[var(--fc-text)]">{shopName(payment.shopId)}</span>
                <span className="text-xs text-[var(--fc-muted)]">
                  {payment.verifiedAt ? new Intl.DateTimeFormat(uiLocale, SUBSCRIPTION_DATE_OPTIONS).format(new Date(payment.verifiedAt)) : "—"}
                  {payment.reference ? <> · {payment.reference}</> : null}
                </span>
                <span className="font-mono tabular-nums text-[var(--fc-text)]">
                  {isGrant(payment) ? uiText("Granted") : payment.amount !== null ? PESO.format(payment.amount) : "—"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    payment.status === "approved"
                      ? "bg-[color-mix(in_srgb,var(--fc-online)_14%,transparent)] text-[var(--fc-online)]"
                      : "bg-[color-mix(in_srgb,var(--fc-danger)_12%,transparent)] text-[var(--fc-danger)]"
                  }`}
                >
                  {payment.status === "approved" ? uiText("Approved") : uiText("Rejected")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
