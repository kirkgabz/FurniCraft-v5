"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmModal from "@/components/ui/confirm-modal";
import { notifySuccess } from "@/lib/saved-notice";

/**
 * There is no in-app countdown to show: the confirmed action signs the
 * account out immediately, so no session is ever left around to render one
 * in. Signing back in within the 30 days is the entire "cancel" flow (see
 * lib/account-deletion.ts) -- this component's only job is collecting the
 * one confirmed click that starts the countdown.
 */
export function DeleteAccountSection({ userId }: { userId: string }) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ deletion_requested_at: new Date().toISOString() })
      .eq("id", userId);

    if (updateError) {
      setBusy(false);
      setError("Something went wrong. Please try again.");
      return;
    }

    await supabase.auth.signOut();
    notifySuccess("Account deletion scheduled. You've been signed out.");
    router.push("/auth/login?deletion_scheduled=1");
  };

  return (
    <>
      <div className="mt-3 rounded-2xl border border-[rgba(231,76,60,0.35)] bg-[rgba(231,76,60,0.05)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[12rem] flex-1">
            <h4 className="font-semibold text-fc-danger">{uiText("Delete account")}</h4>
            <p className="muted-small">{uiText("Schedules permanent deletion in 30 days and signs you out now. Signing back in before then cancels it.")}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn btn-danger shrink-0 px-4 py-2 text-sm transition-transform active:scale-[0.97]"
          >{uiText("Delete account")}</button>
        </div>
        {error ? <p className="mt-2 text-xs font-semibold text-fc-danger">{uiText(error)}</p> : null}
      </div>

      <ConfirmModal
        open={open}
        title={uiText("Delete your account?")}
        body="Your account will be permanently deleted in 30 days. You'll be signed out right away — signing back in any time before then cancels the deletion and restores full access."
        confirmLabel={uiText("Delete account")}
        tone="danger"
        busy={busy}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
