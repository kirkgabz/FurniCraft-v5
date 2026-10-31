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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HumanCheck, type HumanCheckHandle } from "./human-check";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Where to go after signing in, when the page that sent here asked
 * (`?next=/t/...` from a shared template). Only a path on this site: an
 * absolute or protocol-relative address would make the sign-in form a way to
 * bounce someone off to another site.
 */
function safeNextPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const { t: uiText } = useUiLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const humanCheck = useRef<HumanCheckHandle>(null);
  // An expired or already-used link is sent here with its reason, rather
  // than dropping someone on a blank login form wondering what happened.
  //
  // Read from window rather than useSearchParams: that hook opts the route
  // out of static prerendering unless it is wrapped in Suspense, and this is
  // only ever needed after mount anyway.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setError(reason);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const captchaToken = await humanCheck.current?.token();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken },
      });
      // Spent either way, so a retry after a wrong password asks again.
      humanCheck.current?.reset();
      if (error) throw error;
      // Replace, not push: a signed-in history must not keep the sign-in form one
      // Back press behind the dashboard, where it looks like being logged out.
      router.replace(safeNextPath() ?? "/protected");
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
          <CardTitle className="font-display text-2xl text-[var(--fc-text)]">{uiText("Welcome back")}</CardTitle>
          <CardDescription className="text-[var(--fc-muted)]">{uiText("Sign in to reopen your design.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
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
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password" className="ledger-label">{uiText("Password")}</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ledger-link ml-auto inline-block text-xs font-semibold hover:underline"
                  >{uiText("Forgot your password?")}</Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
              </div>
              <HumanCheck ref={humanCheck} />
              {error && <p className="text-sm text-[var(--fc-danger)]">{uiText(error)}</p>}
              <Button
                type="submit"
                className="w-full rounded bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
                disabled={isLoading}
              >
                {isLoading ? uiText("Signing in...") : uiText("Sign in")}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm text-[var(--fc-muted)]">{uiText("New here?")}{" "}
              <Link href="/auth/sign-up" className="ledger-link font-semibold hover:underline">{uiText("Create an account")}</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
