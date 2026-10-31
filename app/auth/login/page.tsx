
import { UiText } from "@/components/language/ui-text";
import BackButton from "@/components/ui/back-button";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";

/**
 * Reading `searchParams` blocks the whole route from prerendering under Cache
 * Components unless it is isolated behind Suspense -- the rest of the page
 * (the back link, the form) does not depend on the query string and should
 * not wait on it either.
 */
async function DeletionNotice({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; deletion_scheduled?: string }>;
}) {
  const { deleted, deletion_scheduled: deletionScheduled } = await searchParams;

  if (deleted) {
    return (
      <p className="mb-4 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] px-4 py-3 text-sm text-[var(--fc-text)]"><UiText text="This account has been deleted and can no longer sign in." /></p>
    );
  }

  if (deletionScheduled) {
    return (
      <p className="mb-4 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] px-4 py-3 text-sm text-[var(--fc-text)]"><UiText text="Your account is scheduled for permanent deletion in 30 days. Sign back in any time before then to cancel it." /></p>
    );
  }

  return null;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; deletion_scheduled?: string }>;
}) {
  return (
    <div className="ledger-grid relative flex min-h-svh w-full items-center justify-center bg-[var(--fc-bg)] px-6 pb-6 pt-24 md:px-10 md:pb-10">
      <BackButton
        fallback="/"
        className={`absolute left-6 top-6 ${BACK_BUTTON_CLASS}`}
      />
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <DeletionNotice searchParams={searchParams} />
        </Suspense>
        <LoginForm />
      </div>
    </div>
  );
}
