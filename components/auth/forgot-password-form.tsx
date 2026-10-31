"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OtpCodeInput, OTP_LENGTH } from "@/components/auth/otp-code-input";
import { OtpExpiryNotice, clearOtpSent, otpRequestTime, useOtpExpiry } from "@/components/auth/otp-expiry";
import { HumanCheck, type HumanCheckHandle } from "./human-check";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const RESEND_COOLDOWN_SECONDS = 30;

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { t: uiText } = useUiLanguage();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "request" asks for the email; "verify" asks for the code that email
  // arrived with. Recovery proves control of the inbox, not knowledge of the
  // password, so verifying the code here only unlocks the next screen --
  // update-password-form.tsx still asks for the new password itself.
  const [step, setStep] = useState<"request" | "verify">("request");
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const router = useRouter();
  // Sending a reset code is captcha-protected in Supabase, so both the first
  // send (a visible check on the email step) and every resend (an invisible
  // one, on the code step) need a fresh token.
  const requestCheck = useRef<HumanCheckHandle>(null);
  const resendCheck = useRef<HumanCheckHandle>(null);
  const expiry = useOtpExpiry("recovery", email);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const sendCode = async (check: HumanCheckHandle | null) => {
    const supabase = createClient();
    const captchaToken = await check?.token();
    const sentAt = otpRequestTime();
    // The url which will be included in the email. This URL needs to be configured in your redirect URLs in the Supabase dashboard at https://supabase.com/dashboard/project/_/auth/url-configuration
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
      captchaToken,
    });
    check?.reset();
    if (!error) expiry.restart(sentAt);
    return { error };
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await sendCode(requestCheck.current);
      if (error) throw error;
      notifySuccess("Code sent. Check your email.");
      setStep("verify");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < OTP_LENGTH || expiry.expired) return;
    setIsVerifying(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });

    if (error) {
      setError(error.message || "That code didn't work. Check it and try again.");
      setIsVerifying(false);
      return;
    }

    clearOtpSent("recovery", email);
    router.push("/auth/update-password");
  };

  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setError(null);
    setNotice(null);

    try {
      const { error } = await sendCode(resendCheck.current);
      if (error) throw error;
      setCode("");
      setNotice("A new code is on its way.");
      notifySuccess("New code sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error: unknown) {
      setError(error instanceof Error && error.message ? error.message : "Could not resend the code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {step === "verify" ? (
        <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Enter the code")}</CardTitle>
            <CardDescription className="text-[var(--fc-muted)]">{uiText("We sent a code to ")}<span className="font-semibold text-[var(--fc-text)]">{email}</span>.
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
                  {isVerifying ? uiText("Verifying...") : uiText("Verify code")}
                </Button>
                <div className="flex items-center gap-4 text-sm">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isResending || cooldown > 0}
                    className="font-semibold text-[var(--fc-ink-accent)] transition hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                  >
                    {cooldown > 0 ? uiText("Resend code ({0}s)", { 0: cooldown }) : isResending ? uiText("Sending…") : uiText("Resend code")}
                  </button>
                  <HumanCheck ref={resendCheck} invisible />
                  <button
                    type="button"
                    onClick={() => {
                      setStep("request");
                      setCode("");
                      setError(null);
                      setNotice(null);
                    }}
                    className="font-semibold text-[var(--fc-muted)] transition hover:text-[var(--fc-text)] hover:underline"
                  >{uiText("Use a different email")}</button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Reset your password")}</CardTitle>
            <CardDescription className="text-[var(--fc-muted)]">{uiText("Type in your email and we'll send you a code to reset your password.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="email" className="ledger-label">{uiText("Email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={uiText("m@example.com")}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                  />
                </div>
                <HumanCheck ref={requestCheck} />
                {error && <p className="text-sm text-[var(--fc-danger)]">{uiText(error)}</p>}
                <Button
                  type="submit"
                  className="w-full rounded bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
                  disabled={isLoading}
                >
                  {isLoading ? uiText("Sending...") : uiText("Send code")}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm text-[var(--fc-muted)]">{uiText("Already have an account?")}{" "}
                <Link href="/auth/login" className="ledger-link font-semibold hover:underline">{uiText("Sign in")}</Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
