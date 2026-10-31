"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PhoneInput from "@/components/ui/phone-input";
import { TermsDialog } from "./terms-dialog";
import { PasswordRequirements } from "./password-requirements";
import { passwordProblem } from "@/lib/password-policy";
import { LEGAL_DECK, PRIVACY_START_INDEX } from "./legal-content";
import { HumanCheck, type HumanCheckHandle } from "./human-check";
import { otpRequestTime, recordOtpSent } from "./otp-expiry";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { t: uiText } = useUiLanguage();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsStart, setTermsStart] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const humanCheck = useRef<HumanCheckHandle>(null);

  const openTerms = (start: number) => {
    setTermsStart(start);
    setTermsOpen(true);
  };

  /**
   * Reaching the end of the deck and accepting is the same act as ticking the
   * box, so it ticks it -- asking someone to read every section and then go
   * find a checkbox is asking twice.
   *
   * Focus then moves to Create account. The modal returns focus to whatever
   * opened it, which would be the Terms link the reader is now finished with;
   * the next step is the button below it, so that is where the cursor should
   * land. The timeout lets the modal's own focus restore run first.
   */
  const handleAcceptTerms = () => {
    setAcceptedTerms(true);
    setError((current) => (current?.startsWith("Please accept") ? null : current));
    setTermsOpen(false);
    window.setTimeout(() => submitRef.current?.focus(), 0);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    // Checked before the match, so someone who typed the same weak password
    // twice is told what is actually wrong with it rather than that it
    // matches. This form had no password check at all until now -- not even a
    // length -- so the only floor was Supabase's own.
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      setIsLoading(false);
      return;
    }

    if (password !== repeatPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (!acceptedTerms) {
      setError("Please accept the Terms and Conditions to create an account.");
      setIsLoading(false);
      return;
    }

    try {
      const captchaToken = await humanCheck.current?.token();
      const sentAt = otpRequestTime();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          captchaToken,
          data: {
            full_name: fullName,
            phone,
            address,
            // Recorded onto the profile by the on_auth_user_created trigger --
            // see supabase/migrations/20260825000500_terms_acceptance.sql.
            terms_accepted_at: new Date().toISOString(),
          },
          emailRedirectTo: `${window.location.origin}/protected`,
        },
      });
      // Spent either way, so a retry after an error asks again.
      humanCheck.current?.reset();

      if (error) throw error;

      if (!data.session) recordOtpSent("signup", email, sentAt);

      // The profile row is created by the on_auth_user_created trigger, from
      // the metadata passed above -- see
      // supabase/migrations/20260825000100_profile_on_signup.sql.
      //
      // This used to be written from here, which stopped working once anon lost
      // write access to user_profiles: with email confirmation enabled signUp
      // returns a user but no session, so the browser is still `anon` and the
      // insert fails with "permission denied for table user_profiles". The
      // account existed, but the customer only ever saw an error.
      //
      // The upsert is kept as a best-effort top-up for the case where a session
      // does exist (email confirmation off), and deliberately cannot fail the
      // sign-up: the trigger is the source of truth either way.
      if (data.user && data.session) {
        const { error: profileError } = await supabase.from("user_profiles").upsert(
          {
            id: data.user.id,
            full_name: fullName || email,
            phone: phone || null,
            address: address || null,
            role: "customer",
            shop_owner: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );

        if (profileError) {
          console.warn("Profile top-up after sign-up failed; the trigger owns this row.", profileError);
        }
      }

      router.push(`/auth/sign-up-success?email=${encodeURIComponent(email)}`);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Create an account")}</CardTitle>
          <CardDescription className="text-[var(--fc-muted)]">{uiText("Open the studio and design your first piece.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="full-name" className="ledger-label">{uiText("Full name")}</Label>
                <Input
                  id="full-name"
                  type="text"
                  placeholder={uiText("Maria Santos")}
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone" className="ledger-label">{uiText("Phone number")}</Label>
                <PhoneInput
                  id="phone"
                  value={phone}
                  onChange={setPhone}
                  inputClassName="ledger-input flex h-9 w-full min-w-0 border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-1 text-base text-[var(--fc-text)] shadow-none outline-none md:text-sm"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="address" className="ledger-label">{uiText("Address")}</Label>
                <Input
                  id="address"
                  type="text"
                  placeholder={uiText("Your city or home address")}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                />
              </div>
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
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password" className="ledger-label">{uiText("Password")}</Label>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-requirements"
                    className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] pr-16 text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? uiText("Hide password") : uiText("Show password")}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-[var(--fc-ink-accent)] transition hover:opacity-75"
                  >
                    {showPassword ? uiText("Hide") : uiText("Show")}
                  </button>
                </div>
                <PasswordRequirements id="password-requirements" password={password} />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password" className="ledger-label">{uiText("Repeat password")}</Label>
                </div>
                <div className="relative">
                  <Input
                    id="repeat-password"
                    type={showRepeatPassword ? "text" : "password"}
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                    className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] pr-16 text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    aria-label={showRepeatPassword ? uiText("Hide repeated password") : uiText("Show repeated password")}
                    onClick={() => setShowRepeatPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-[var(--fc-ink-accent)] transition hover:opacity-75"
                  >
                    {showRepeatPassword ? uiText("Hide") : uiText("Show")}
                  </button>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                  aria-label={uiText("I have read and accept the Terms and Conditions and the Privacy Policy")}
                  className="mt-0.5 rounded-sm border-[var(--fc-border)] data-[state=checked]:border-[var(--fc-btn)] data-[state=checked]:bg-[var(--fc-btn)] data-[state=checked]:text-[var(--fc-btn-fg)]"
                />
                {/* The two document names are buttons that open the reader, not
                    text styled to look like links. They sit inside the label,
                    which is safe: a label does not forward activation to its
                    control for clicks on an interactive descendant. The
                    stopPropagation is belt and braces so opening the terms can
                    never tick the box you have not read them for. */}
                <Label htmlFor="terms" className="text-sm font-normal leading-snug text-[var(--fc-muted)]">{uiText("I have read and accept the")}{" "}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTerms(0);
                    }}
                    className="ledger-link font-semibold underline decoration-dotted underline-offset-4 transition-[opacity] duration-150 hover:opacity-75"
                  >{uiText("Terms and Conditions")}</button>{" "}{uiText("and the")}{" "}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTerms(PRIVACY_START_INDEX);
                    }}
                    className="ledger-link font-semibold underline decoration-dotted underline-offset-4 transition-[opacity] duration-150 hover:opacity-75"
                  >{uiText("Privacy Policy")}</button>
                  .
                </Label>
              </div>
              {!acceptedTerms && (
                <p className="-mt-2 text-xs leading-snug text-[var(--fc-muted)]">{uiText("Haven't read them yet?")}{" "}
                  <button
                    type="button"
                    onClick={() => openTerms(0)}
                    className="ledger-link font-semibold underline decoration-dotted underline-offset-4"
                  >{uiText("Read them here")}</button>{" "}
                  — {LEGAL_DECK.length}{uiText(" short sections, then accept at the end.")}</p>
              )}
              <HumanCheck ref={humanCheck} />
              {error && <p className="text-sm text-[var(--fc-danger)]">{uiText(error)}</p>}
              <Button
                ref={submitRef}
                type="submit"
                className="w-full rounded bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
                disabled={isLoading || !acceptedTerms}
              >
                {isLoading ? uiText("Creating account...") : uiText("Create account")}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm text-[var(--fc-muted)]">{uiText("Already have an account?")}{" "}
              <Link href="/auth/login" className="ledger-link font-semibold hover:underline">{uiText("Sign in")}</Link>
            </div>
          </form>
        </CardContent>
      </Card>
      <TermsDialog
        open={termsOpen}
        startIndex={termsStart}
        onClose={() => setTermsOpen(false)}
        onAccept={handleAcceptTerms}
      />
    </div>
  );
}
