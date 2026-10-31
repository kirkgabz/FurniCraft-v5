"use client";

import { useState } from "react";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { createClient } from "@/lib/supabase/client";
import { notifySaved } from "@/lib/saved-notice";
import {
  isMissingSuspensionsTable,
  isSuspensionActive,
  SUSPENSION_LENGTHS,
  suspensionEnd,
  SUSPENSIONS_TABLE,
  type Suspension,
} from "@/lib/account-suspension";

/**
 * Suspend or reinstate one account, for the admin Users list and for a ticket
 * about that account. The same control in both places, so a suspension made
 * from a ticket is the one the Users list shows, and the other way round.
 */
export function AccountSuspensionControl({
  userId,
  name,
  suspension,
  reportId = null,
  onChange,
}: {
  userId: string;
  name: string;
  suspension: Suspension | null;
  /** The ticket this is being done from, recorded with the suspension. */
  reportId?: string | null;
  onChange: (next: Suspension | null) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [length, setLength] = useState(SUSPENSION_LENGTHS[0].id);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = isSuspensionActive(suspension);
  const until = suspension?.suspended_until
    ? new Date(suspension.suspended_until).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  const explain = (failure: { code?: string; message?: string }) =>
    isMissingSuspensionsTable(failure)
      ? "Suspensions need migration 20261027120000_account_suspensions applied in Supabase."
      : failure.message ?? "Something went wrong. Please try again.";

  const suspend = async () => {
    const text = reason.trim();
    if (!text || busy) return;
    const chosen = SUSPENSION_LENGTHS.find((option) => option.id === length) ?? SUSPENSION_LENGTHS[0];
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: writeError } = await supabase
      .from(SUSPENSIONS_TABLE)
      .upsert({
        user_id: userId,
        suspended_until: suspensionEnd(chosen.days),
        reason: text,
        report_id: reportId,
        suspended_by: auth.user?.id ?? null,
        created_at: new Date().toISOString(),
      })
      .select("user_id, suspended_until, reason, report_id, created_at")
      .single();
    setBusy(false);
    if (writeError) {
      setError(explain(writeError));
      return;
    }
    onChange(data as Suspension);
    setOpen(false);
    setReason("");
    notifySaved("Account suspended");
  };

  const lift = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: deleteError } = await createClient().from(SUSPENSIONS_TABLE).delete().eq("user_id", userId);
    setBusy(false);
    if (deleteError) {
      setError(explain(deleteError));
      return;
    }
    onChange(null);
    notifySaved("Suspension lifted");
  };

  return (
    <div className="min-w-0">
      {active ? (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--fc-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--fc-danger)]">
              {until ? uiText("Suspended until {0}", { 0: until }) : uiText("Permanently suspended")}
            </span>
            <button
              type="button"
              onClick={() => void lift()}
              disabled={busy}
              className="rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-1 text-xs font-semibold text-[var(--fc-text)] disabled:opacity-60"
            >
              {busy ? uiText("Working…") : uiText("Lift suspension")}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--fc-text)]">
            <span className="text-[var(--fc-muted)]">{uiText("Reason: ")}</span>
            {suspension?.reason}
          </p>
        </div>
      ) : open ? (
        <div className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3">
          <p className="text-xs font-semibold text-[var(--fc-text)]">{uiText("Suspend {0}", { 0: uiText(name) })}</p>
          <div role="radiogroup" aria-label={uiText("Suspension length")} className="mt-2 flex flex-wrap gap-1.5">
            {SUSPENSION_LENGTHS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={length === option.id}
                onClick={() => setLength(option.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  length === option.id
                    ? option.days === null
                      ? "border-[var(--fc-danger)] bg-[var(--fc-danger)] text-white"
                      : "border-[var(--fc-btn)] bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]"
                    : "border-[var(--fc-border)] text-[var(--fc-muted)]"
                }`}
              >
                {uiText(option.label)}
              </button>
            ))}
          </div>
          <label className="mt-2 block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Reason (shown to them) *")}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={uiText("Say what they did, so they know why.")}
              className="mt-1 w-full rounded-lg border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none focus:border-[var(--fc-ink-accent)]"
            />
          </label>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)]"
            >
              {uiText("Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void suspend()}
              disabled={busy || !reason.trim()}
              className="rounded-full bg-[var(--fc-danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy
                ? uiText("Working…")
                : length === "permanent"
                  ? uiText("Suspend permanently")
                  : uiText("Suspend for {0}", { 0: uiText(SUSPENSION_LENGTHS.find((option) => option.id === length)?.label ?? "") })}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-[color-mix(in_srgb,var(--fc-danger)_40%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)]"
        >
          {uiText("Suspend account…")}
        </button>
      )}
      {error ? <p role="alert" className="mt-1.5 text-xs text-[var(--fc-danger)]">{uiText(error)}</p> : null}
    </div>
  );
}
