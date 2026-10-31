"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useRef } from "react";

/**
 * How many digits an emailed verification code has.
 *
 * THIS NUMBER IS NOT OURS TO CHOOSE ALONE. It has to match what Supabase
 * actually sends, which is the hosted project's own setting -- Dashboard ->
 * Authentication -> Emails -> Email OTP Length. The `otp_length = 6` in
 * supabase/config.toml governs the local stack only and has never had any
 * effect on production; that mismatch is exactly how this was 8 before, and a
 * previous change here was made only after checking a real code that arrived
 * in an inbox.
 *
 * So if verification suddenly rejects every correct-looking code, the first
 * thing to check is whether this and the Dashboard still agree.
 *
 * Exported because the forms gate their submit button on a complete code, and
 * three copies of the same literal in three files is how they drift apart.
 */
export const OTP_LENGTH = 6;

/**
 * Six boxes, one digit each.
 *
 * Autofocus moves forward as you type, backspace on an empty box steps back,
 * and pasting the whole code (from a password manager, or copied out of the
 * email) fills every box at once instead of only the one it landed in.
 */
export function OtpCodeInput({
  value,
  onChange,
  disabled = false,
  id,
}: {
  /** Digits only, up to OTP_LENGTH characters. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? "");

  return (
    <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label={uiText("Verification code")}>
      {digits.map((digit, index) => (
        <input
          key={index}
          id={index === 0 ? id : undefined}
          ref={(el) => {
            inputsRef.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value.replace(/\D/g, "");
            if (!raw) {
              const next = digits.slice();
              next[index] = "";
              onChange(next.join(""));
              return;
            }
            const chars = raw.split("");
            const next = digits.slice();
            for (let i = 0; i < chars.length && index + i < OTP_LENGTH; i++) {
              next[index + i] = chars[i];
            }
            onChange(next.join("").slice(0, OTP_LENGTH));
            inputsRef.current[Math.min(index + chars.length, OTP_LENGTH - 1)]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) {
              inputsRef.current[index - 1]?.focus();
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
            if (!pasted) return;
            event.preventDefault();
            onChange(pasted);
            inputsRef.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
          }}
          className="h-12 w-10 rounded-md border border-[var(--fc-border)] bg-[var(--fc-bg)] text-center font-mono text-lg text-[var(--fc-text)] shadow-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[var(--fc-accent)] disabled:opacity-50"
        />
      ))}
    </div>
  );
}
