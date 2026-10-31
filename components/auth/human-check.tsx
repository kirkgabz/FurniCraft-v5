"use client";

import HCaptcha from "@hcaptcha/react-hcaptcha";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTheme } from "@/components/theme/theme-context";

/**
 * The public hCaptcha site key. Unset means captcha is not switched on yet:
 * the check renders nothing and hands back no token, so every auth form keeps
 * working exactly as before while the keys are being set up.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY ?? "";

export type HumanCheckHandle = {
  /**
   * A fresh token to pass to Supabase as `captchaToken`, or undefined while
   * captcha is not configured. Throws an Error with a readable message when
   * the visitor has not ticked the box yet.
   */
  token(): Promise<string | undefined>;
  /** Tokens are single-use: call after every auth attempt that sent one. */
  reset(): void;
};

/**
 * "I am human", for the forms that create or open an account.
 *
 * hCaptcha rather than Google reCAPTCHA because Supabase verifies it itself.
 * The forms call Supabase straight from the browser with the public key, so a
 * check that only this page looked at would stop nobody: a bot skips the page
 * and calls Supabase directly. With captcha enabled in Supabase (Auth > Bot
 * and Abuse Protection), a sign-up, sign-in, password reset or code resend
 * without a solved token is refused by the auth server itself.
 *
 * `invisible` is for a button rather than a form -- "Resend code" -- where a
 * checkbox would be clutter: it asks hCaptcha for a token on press, and only
 * shows a challenge if hCaptcha is not already satisfied.
 */
export function HumanCheck({ ref, invisible = false }: { ref?: Ref<HumanCheckHandle>; invisible?: boolean }) {
  const { theme } = useTheme();
  const captchaRef = useRef<HCaptcha>(null);
  const [solved, setSolved] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      async token() {
        if (!SITE_KEY) return undefined;
        if (invisible) {
          const result = await captchaRef.current?.execute({ async: true });
          if (!result?.response) throw new Error("Could not confirm you are human. Please try again.");
          return result.response;
        }
        if (!solved) throw new Error("Please tick “I am human” first.");
        return solved;
      },
      reset() {
        setSolved(null);
        captchaRef.current?.resetCaptcha();
      },
    }),
    [invisible, solved]
  );

  if (!SITE_KEY) return null;

  return (
    <div className={invisible ? undefined : "flex min-h-[78px] justify-center"}>
      <HCaptcha
        ref={captchaRef}
        sitekey={SITE_KEY}
        size={invisible ? "invisible" : "normal"}
        theme={theme === "dark" ? "dark" : "light"}
        onVerify={(token) => setSolved(token)}
        onExpire={() => setSolved(null)}
        onError={() => setSolved(null)}
      />
    </div>
  );
}
