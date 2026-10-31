/**
 * What a password has to contain, in one place.
 *
 * ---------------------------------------------------------------------------
 * Where this applies, and where it deliberately does not
 *
 * It gates SETTING a password -- creating an account, or choosing a new one
 * after a reset. It is not consulted when signing in, and that is the whole
 * point rather than an oversight: every account created before this existed
 * has a password that predates the rule, and checking it at the door would
 * lock those people out of their own accounts for a policy they were never
 * offered. Nobody is ever asked to change a password that already works.
 *
 * The practical consequence is that the rule reaches an existing customer
 * only if they choose a new password themselves, which is the one moment
 * where meeting it costs them nothing.
 *
 * ---------------------------------------------------------------------------
 * Why the rules are exactly these
 *
 * They mirror Supabase's own "Lowercase, uppercase letters, digits and
 * symbols" password requirement, character set included, because that is the
 * setting that actually enforces any of this. What runs in this file runs in
 * the customer's browser, where it is advice: it tells them what is wanted
 * before they submit, and it can be stepped around by anyone who cares to.
 * The enforcement is the project's Auth settings, and the two are written to
 * agree so that a password this file accepts is never rejected by the server
 * with a message the customer cannot act on.
 *
 * See the README for the dashboard setting that has to be turned on for this
 * to be more than a suggestion.
 */

/** Supabase's own floor is 6; 8 is the shortest worth asking for. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * The characters that count as special, verbatim from Supabase's symbol set.
 *
 * Copied rather than approximated with something like `/[^a-zA-Z0-9]/`,
 * because a looser test accepts characters the server does not: a password
 * whose only "symbol" is an accented letter or a non-breaking space passes a
 * negated-alphanumeric check here and is then refused at the server, which
 * leaves the customer staring at a form that says every requirement is met.
 */
export const SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export type PasswordRule = {
  id: string;
  /** Written as the thing the password must have, so it reads as a checklist. */
  label: string;
  isMet: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    isMet: (password) => password.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: "lowercase",
    label: "A lowercase letter",
    isMet: (password) => /[a-z]/.test(password),
  },
  {
    id: "uppercase",
    label: "An uppercase letter",
    isMet: (password) => /[A-Z]/.test(password),
  },
  {
    id: "digit",
    label: "A number",
    isMet: (password) => /[0-9]/.test(password),
  },
  {
    id: "special",
    // Spelled out rather than left as "a special character", because that
    // phrase sends people to whichever symbol their keyboard puts first and
    // some of those are not on the list.
    label: "A special character, such as ! ? @ # or $",
    isMet: (password) => password.split("").some((char) => SPECIAL_CHARACTERS.includes(char)),
  },
];

export type PasswordCheck = {
  /** Every rule with whether this password satisfies it, in checklist order. */
  rules: Array<{ rule: PasswordRule; met: boolean }>;
  /** True when the password may be submitted. */
  ok: boolean;
};

export function checkPassword(password: string): PasswordCheck {
  const rules = PASSWORD_RULES.map((rule) => ({ rule, met: rule.isMet(password) }));
  return { rules, ok: rules.every((entry) => entry.met) };
}

/**
 * One sentence naming what is still missing, or null when nothing is.
 *
 * For the error banner, which is what a screen reader announces on submit and
 * what someone who tabbed past the checklist will actually read. It names
 * every unmet rule rather than only the first: fixing them one submit at a
 * time is the worst version of this interaction.
 */
export function passwordProblem(password: string): string | null {
  const missing = checkPassword(password).rules.filter((entry) => !entry.met);
  if (missing.length === 0) return null;

  const labels = missing.map((entry) => entry.rule.label.toLowerCase());
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Your password still needs: ${list}.`;
}
