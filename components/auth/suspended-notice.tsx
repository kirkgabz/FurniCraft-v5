"use client";

import { useEffect, useState } from "react";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useRouter } from "next/navigation";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { createClient } from "@/lib/supabase/client";
import { isSuspensionActive, SUSPENSIONS_TABLE, type Suspension } from "@/lib/account-suspension";

/**
 * What a suspended account sees instead of the app: for how long, why, and a
 * way to sign out. Once the suspension has ended (or been lifted) it says so
 * and lets them back in.
 */
export function SuspendedNotice() {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [state, setState] = useState<{ loading: boolean; suspension: Suspension | null }>({ loading: true, suspension: null });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/auth/login");
        return;
      }
      const { data } = await supabase
        .from(SUSPENSIONS_TABLE)
        .select("user_id, suspended_until, reason, report_id, created_at")
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (!cancelled) setState({ loading: false, suspension: (data as Suspension | null) ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const signOut = async () => {
    await createClient().auth.signOut();
    router.replace("/auth/login");
  };

  const active = isSuspensionActive(state.suspension);
  const until = state.suspension?.suspended_until
    ? new Date(state.suspension.suspended_until).toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
      {state.loading ? (
        <p className="text-sm text-[var(--fc-muted)]">{uiText("Checking your account…")}</p>
      ) : active ? (
        <>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--fc-danger)]">{uiText("Account suspended")}</p>
          <h1 className="mt-2 text-xl font-semibold text-[var(--fc-text)]">
            {until
              ? uiText("Your account is suspended until {0}.", { 0: until })
              : uiText("Your account has been permanently suspended.")}
          </h1>
          <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("While it is suspended you cannot place or manage orders, message shops or customers, post reviews, or run a shop. A shop you own is hidden from customers until the suspension ends.")}</p>
          <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fc-muted)]">{uiText("Reason")}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--fc-text)]"><AdaptiveText text={state.suspension?.reason ?? ""} /></p>
          </div>
          <button type="button" onClick={() => void signOut()} className="btn btn-primary mt-5 w-full">{uiText("Sign out")}</button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-[var(--fc-text)]">{uiText("Your account is not suspended.")}</h1>
          <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Any suspension on it has ended. You can use FurniCraft as usual.")}</p>
          <button type="button" onClick={() => router.replace("/protected")} className="btn btn-primary mt-5 w-full">{uiText("Continue")}</button>
        </>
      )}
    </div>
  );
}
