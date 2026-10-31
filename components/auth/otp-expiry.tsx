"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";

// How long an emailed code stays valid. Must match Supabase Dashboard ->
// Authentication -> Sign In / Providers -> Email -> "Email OTP Expiration"
// (and otp_expiry in supabase/config.toml); Supabase is what actually expires
// the code, this only shows the countdown.
export const OTP_EXPIRY_SECONDS = 180;

export type OtpKind = "signup" | "recovery";

const storageKey = (kind: OtpKind, email: string) => `fc-otp-sent:${kind}:${email.trim().toLowerCase()}`;

// Taken just before the send request goes out, so the countdown can only run
// slightly ahead of Supabase's own clock, never behind it.
export function otpRequestTime() {
  return Date.now();
}

export function recordOtpSent(kind: OtpKind, email: string, sentAt: number) {
  try {
    window.sessionStorage.setItem(storageKey(kind, email), String(sentAt));
  } catch {}
}

export function clearOtpSent(kind: OtpKind, email: string) {
  try {
    window.sessionStorage.removeItem(storageKey(kind, email));
  } catch {}
}

function readOtpSent(kind: OtpKind, email: string): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(storageKey(kind, email)));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

// Seconds left on the code, counted against a fixed deadline rather than
// decremented, so a throttled background tab or a slow tick never drifts.
// null when the send time is unknown (e.g. the page was opened in a new tab).
export function useOtpExpiry(kind: OtpKind, email: string) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!email) {
      setDeadline(null);
      return;
    }
    const sentAt = readOtpSent(kind, email);
    setDeadline(sentAt === null ? null : sentAt + OTP_EXPIRY_SECONDS * 1000);
  }, [kind, email]);

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    let timer: number | undefined;
    const tick = () => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setSecondsLeft(Math.ceil(remainingMs / 1000));
      if (remainingMs > 0) timer = window.setTimeout(tick, remainingMs % 1000 || 1000);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [deadline]);

  const restart = useCallback(
    (sentAt: number) => {
      recordOtpSent(kind, email, sentAt);
      setDeadline(sentAt + OTP_EXPIRY_SECONDS * 1000);
    },
    [kind, email],
  );

  return { secondsLeft, expired: secondsLeft === 0, restart };
}

function formatRemaining(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function OtpExpiryNotice({ secondsLeft }: { secondsLeft: number | null }) {
  const { t: uiText } = useUiLanguage();
  if (secondsLeft === null) {
    return (
      <p className="text-center text-sm text-[var(--fc-muted)]">{uiText("Codes are valid for ")}{Math.round(OTP_EXPIRY_SECONDS / 60)}{uiText(" minutes.")}</p>
    );
  }

  if (secondsLeft === 0) {
    return (
      <p className="text-center text-sm text-[var(--fc-danger)]" role="alert">{uiText("This code has expired. Resend a new one.")}</p>
    );
  }

  return (
    <p className="text-center text-sm text-[var(--fc-muted)]">{uiText("Code expires in")}{" "}
      <span
        role="timer"
        className={`font-mono font-semibold tabular-nums ${secondsLeft <= 60 ? "text-[var(--fc-danger)]" : "text-[var(--fc-text)]"}`}
      >
        {formatRemaining(secondsLeft)}
      </span>
    </p>
  );
}
