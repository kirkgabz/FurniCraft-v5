"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { IconClock } from "@/components/solihiya/icons";

/** The promise made to every customer: finished 2 weeks to 30 days after production starts. */
export const PRODUCTION_MIN_DAYS = 14;
export const PRODUCTION_MAX_DAYS = 30;

type Schedule = {
  production_started_at: string | null;
  estimated_completion_date: string | null;
  completed_at: string | null;
};

/** A calendar day as YYYY-MM-DD in local time, the format a date input uses. */
function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD read as a local day, not as midnight UTC (which can be the day before). */
function fromDayKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * When the piece will be ready.
 *
 * The 2-week-to-30-day window is worked out from production_started_at; the
 * shop may also give its own exact day (20261031090000_estimated_completion_date.sql).
 * Shown in the Quote tab of every order view, the same for both sides; only
 * the shop gets the date field, and only while the order is in production.
 *
 * Reads its own three columns rather than taking them from the order, so the
 * order views keep loading even before that migration is applied -- the window
 * still shows, and the date field says it is not available yet.
 */
export default function ProductionSchedule({
  orderId,
  status,
  viewerIsShop,
  className = "",
}: {
  orderId: string;
  status: string;
  viewerIsShop: boolean;
  className?: string;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [dateColumnMissing, setDateColumnMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = ["quoted", "confirmed", "payment_submitted", "in_production", "completed"].includes(status);

  const load = useCallback(async () => {
    const supabase = createClient();
    const full = await supabase
      .from("design_orders")
      .select("production_started_at, estimated_completion_date, completed_at")
      .eq("id", orderId)
      .maybeSingle();
    if (!full.error) {
      const row = (full.data ?? null) as Schedule | null;
      setSchedule(row);
      setDraft(row?.estimated_completion_date ?? "");
      setDateColumnMissing(false);
      return;
    }
    const partial = await supabase
      .from("design_orders")
      .select("production_started_at, completed_at")
      .eq("id", orderId)
      .maybeSingle();
    const row = (partial.data ?? null) as Omit<Schedule, "estimated_completion_date"> | null;
    setSchedule(row ? { ...row, estimated_completion_date: null } : null);
    setDateColumnMissing(true);
  }, [orderId]);

  // Again whenever the order moves: approving the payment is what sets
  // production_started_at.
  useEffect(() => {
    if (shown) void load();
  }, [load, shown, status]);

  if (!shown) return null;

  const format = (date: Date) => date.toLocaleDateString(uiLocale, { month: "long", day: "numeric", year: "numeric" });
  const started = schedule?.production_started_at ? new Date(schedule.production_started_at) : null;
  const earliest = started ? addDays(started, PRODUCTION_MIN_DAYS) : null;
  const latest = started ? addDays(started, PRODUCTION_MAX_DAYS) : null;
  const setDate = schedule?.estimated_completion_date ? fromDayKey(schedule.estimated_completion_date) : null;
  const canEdit = viewerIsShop && status === "in_production" && !dateColumnMissing;
  const today = dayKey(new Date());

  const save = async (value: string | null) => {
    setSaving(true);
    setError(null);
    const { error: writeError } = await createClient()
      .from("design_orders")
      .update({ estimated_completion_date: value })
      .eq("id", orderId);
    setSaving(false);
    if (writeError) {
      setError(writeError.message);
      return;
    }
    notifySuccess(value ? "Finish date saved. The customer has been told." : "Finish date removed");
    await load();
  };

  return (
    <div className={`rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-4 ${className}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">
        <IconClock aria-hidden className="h-4 w-4" />
        {uiText("Production time frame")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-[var(--fc-text)]">
        {uiText("Orders are finished within 2 weeks to 30 days after production starts.")}
      </p>

      {status === "in_production" || status === "completed" ? (
        started && earliest && latest ? (
          <p className="mt-1 text-sm text-[var(--fc-muted)]">
            {uiText("Production started {0}, so this order is due between {1} and {2}.", {
              0: format(started),
              1: format(earliest),
              2: format(latest),
            })}
          </p>
        ) : null
      ) : (
        <p className="mt-1 text-sm text-[var(--fc-muted)]">
          {uiText("The clock starts when the shop approves the downpayment and begins production.")}
        </p>
      )}

      {status === "completed" && schedule?.completed_at ? (
        <p className="mt-3 rounded-xl bg-[rgba(46,125,80,0.1)] px-3 py-2 text-sm font-semibold text-[#2e7d50]">
          {uiText("Finished on {0}", { 0: format(new Date(schedule.completed_at)) })}
        </p>
      ) : setDate && !canEdit ? (
        <p className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm">
          <span className="text-[var(--fc-muted)]">{uiText("The shop expects to finish on")} </span>
          <strong className="text-[var(--fc-ink-accent)]">{format(setDate)}</strong>
        </p>
      ) : !viewerIsShop && status === "in_production" ? (
        <p className="mt-3 text-xs text-[var(--fc-muted)]">{uiText("The shop hasn't given an exact finish date. It may add one while your order is being made.")}</p>
      ) : null}

      {canEdit && latest ? (
        <div className="mt-3 border-t border-[var(--fc-border)] pt-3">
          <label className="block text-sm" htmlFor={`finish-date-${orderId}`}>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">
              {uiText("Exact finish date")} <span className="normal-case tracking-normal">{uiText("(optional)")}</span>
            </span>
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              id={`finish-date-${orderId}`}
              type="date"
              value={draft}
              min={today}
              max={dayKey(latest)}
              onChange={(event) => setDraft(event.target.value)}
              className="rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none"
            />
            <button
              type="button"
              disabled={saving || !draft || draft === (schedule?.estimated_completion_date ?? "")}
              onClick={() => void save(draft)}
              className="btn btn-primary btn-sm"
            >
              {saving ? uiText("Saving…") : uiText("Save date")}
            </button>
            {schedule?.estimated_completion_date ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(null)}
                className="btn btn-secondary btn-sm"
              >
                {uiText("Remove")}
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-[var(--fc-muted)]">
            {uiText("Any day up to {0}. The customer is notified when you save it.", { 0: format(latest) })}
          </p>
        </div>
      ) : null}

      {viewerIsShop && status === "in_production" && dateColumnMissing ? (
        <p className="mt-3 text-xs text-[var(--fc-muted)]">
          {uiText("Setting an exact finish date needs migration 20261031090000_estimated_completion_date.sql applied in Supabase.")}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-fc-danger-soft">{uiText(error)}</p> : null}
    </div>
  );
}
