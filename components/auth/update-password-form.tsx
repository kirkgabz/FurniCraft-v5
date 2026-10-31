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
import { PasswordRequirements } from "./password-requirements";
import { passwordProblem } from "@/lib/password-policy";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UpdatePasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { t: uiText } = useUiLanguage();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    // The same policy as signing up, replacing the bare length check that used
    // to be the only rule here.
    //
    // This is the one place the rule can reach somebody who signed up before
    // it existed, and it is deliberate. A reset is not being asked to change
    // a working password -- it is choosing a new one, which is the moment the
    // requirement costs nothing. Leaving it out would also make the whole
    // policy decorative: anyone could create an account with a strong
    // password and immediately reset it to something weaker. And once the
    // project's Auth settings enforce this server-side, they enforce it here
    // too, so a form that did not say so would fail with an error from
    // Supabase instead of a checklist.
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      setIsLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setIsLoading(false);
      return;
    }

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error(
          "Your password reset link is invalid or expired. Please request a new email.",
        );
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      notifySuccess("Password updated");
      // Replace, so Back does not return to a password form already used.
      router.replace("/protected");
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "An error occurred while updating your password.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="ledger-card rounded border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-none">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Reset your password")}</CardTitle>
          <CardDescription className="text-[var(--fc-muted)]">{uiText("Please enter your new password below.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-5">
              <div className="grid gap-2">
                <Label htmlFor="password" className="ledger-label">{uiText("New password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={uiText("New password")}
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
                <Label htmlFor="confirm-password" className="ledger-label">{uiText("Confirm new password")}</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={uiText("Confirm new password")}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="ledger-input border-[var(--fc-border)] bg-[var(--fc-bg)] pr-16 text-[var(--fc-text)] shadow-none focus-visible:ring-0"
                  />
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? uiText("Hide confirmed password") : uiText("Show confirmed password")}
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-xs font-semibold text-[var(--fc-ink-accent)] transition hover:opacity-75"
                  >
                    {showConfirmPassword ? uiText("Hide") : uiText("Show")}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-[var(--fc-danger)]">{uiText(error)}</p>}
              <Button
                type="submit"
                className="w-full rounded bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
                disabled={isLoading}
              >
                {isLoading ? uiText("Saving...") : uiText("Save new password")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
