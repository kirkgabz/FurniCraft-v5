"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HumanCheck, type HumanCheckHandle } from "./human-check";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { OtpCodeInput, OTP_LENGTH } from "@/components/auth/otp-code-input";
import { OtpExpiryNotice, clearOtpSent, otpRequestTime, useOtpExpiry } from "@/components/auth/otp-expiry";

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * The code half of sign-up confirmation, replacing the old "click the link
 * in your email, then come back" screen with one you can finish without
 * leaving the tab. The email still carries the {{ .ConfirmationURL }} link
 * too (see the Supabase email template), so a link click still works --
 * this is just the faster path most people will actually use.
 */
export function VerifyEmailForm({ email }: { email: string }) {
  const { t: uiText } = useUiLanguage();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const router = useRouter();
  // Resending a sign-up code is captcha-protected in Supabase too.
  const resendCheck = useRef<HumanCheckHandle>(null);
  const expiry = useOtpExpiry("signup", email);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Check your email")}</CardTitle>
          <CardDescription className="text-[var(--fc-muted)]">{uiText("Your FurniCraft account has been created. Confirm it from the link we emailed you, then sign in.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/auth/login"
            className="inline-flex items-center justify-center rounded bg-[var(--fc-btn)] px-6 py-3 text-sm font-bold text-[var(--fc-btn-fg)] transition-[transform,background-color] duration-150 active:scale-[0.97] hover:bg-[var(--fc-btn-hover)]"
          >{uiText("Go to sign in")}</Link>
        </CardContent>
      </Card>
    );
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < OTP_LENGTH || expiry.expired) return;
    setIsVerifying(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });

    if (error) {
      setError(error.message || "That code didn't work. Check it and try again.");
      setIsVerifying(false);
      return;
    }

    clearOtpSent("signup", email);
    // Replace, so Back does not return to a code form that has already been used.
    router.replace("/protected");
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    setNotice(null);

    try {
      const captchaToken = await resendCheck.current?.token();
      const supabase = createClient();
      const sentAt = otpRequestTime();
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { captchaToken } });
      resendCheck.current?.reset();
      if (error) throw error;
      expiry.restart(sentAt);
      setCode("");
      setNotice("A new code is on its way.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error: unknown) {
      setError(error instanceof Error && error.message ? error.message : "Could not resend the code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
      <CardHeader>
        <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Confirm your email")}</CardTitle>
        <CardDescription className="text-[var(--fc-muted)]">{uiText("Enter the code we sent to ")}<span className="font-semibold text-[var(--fc-text)]">{email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleVerify}>
          <div className="flex flex-col items-center gap-5">
            <OtpCodeInput value={code} onChange={setCode} disabled={isVerifying || expiry.expired} />
            <OtpExpiryNotice secondsLeft={expiry.secondsLeft} />
            {error && <p className="text-center text-sm text-[var(--fc-danger)]">{uiText(error)}</p>}
            {notice && !error && <p className="text-center text-sm text-[var(--fc-muted)]">{uiText(notice)}</p>}
            <Button
              type="submit"
              className="w-full rounded bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
              disabled={isVerifying || expiry.expired || code.length < OTP_LENGTH}
            >
              {isVerifying ? uiText("Verifying...") : uiText("Verify & continue")}
            </Button>
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || cooldown > 0}
              className="text-sm font-semibold text-[var(--fc-ink-accent)] transition hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {cooldown > 0 ? uiText("Resend code ({0}s)", { 0: cooldown }) : isResending ? uiText("Sending…") : uiText("Resend code")}
            </button>
            <HumanCheck ref={resendCheck} invisible />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
