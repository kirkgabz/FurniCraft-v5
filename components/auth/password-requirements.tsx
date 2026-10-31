"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { checkPassword } from "@/lib/password-policy";

/**
 * The password rules, ticked off as they are met.
 *
 * Shown while typing rather than reported after submitting, because the
 * alternative is the form people actually hate: press the button, be told one
 * thing is wrong, fix it, press again, be told the next thing. Every rule is
 * on screen from the first keystroke, so the target is visible before anyone
 * aims at it.
 *
 * It stays hidden until the field has something in it. An empty password
 * failing five requirements is not news, and five red marks under a field
 * nobody has typed in yet reads as an error rather than as instructions.
 */
export function PasswordRequirements({ password, id }: { password: string; id: string }) {
  const { t: uiText } = useUiLanguage();
  const { rules, ok } = checkPassword(password);
  if (password.length === 0) return null;

  return (
    <div
      id={id}
      // Polite rather than assertive: this updates on every keystroke, and an
      // assertive region would interrupt the screen reader mid-word each time.
      aria-live="polite"
      className="rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-3"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">
        {ok ? uiText("Password meets every requirement") : uiText("Your password needs")}
      </p>
      <ul className="mt-1.5 grid gap-1">
        {rules.map(({ rule, met }) => (
          <li key={rule.id} className="flex items-start gap-2 text-xs leading-snug">
            {/* The mark is decorative: the text after it already says whether
                the rule is met, via the sentence the list is headed with and
                the strikethrough-free wording below. Reading "check" or
                "cross" aloud before every line would treble the noise. */}
            <span
              aria-hidden
              className={met ? "font-bold text-[#1e7a4b]" : "font-bold text-[var(--fc-muted)]"}
            >
              {met ? "✓" : "•"}
            </span>
            <span className={met ? "text-[var(--fc-muted)]" : "text-[var(--fc-text)]"}>
              {uiText(rule.label)}
              {/* Said in words as well as in colour, so the list still works
                  for anyone who cannot tell the green tick from the grey dot. */}
              <span className="sr-only">{met ? uiText(" — met") : uiText(" — still needed")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
