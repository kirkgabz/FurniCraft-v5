import BackButton from "@/components/ui/back-button";
import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";

/**
 * Reading `searchParams` blocks the whole route from prerendering under Cache
 * Components unless it is isolated behind Suspense -- same fix as
 * app/auth/login/page.tsx's DeletionNotice, for the same reason: the back
 * link doesn't depend on the query string and shouldn't wait on it either.
 */
async function VerifyEmailSection({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <VerifyEmailForm email={email ?? ""} />;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  return (
    <div className="ledger-grid relative flex min-h-svh items-center justify-center bg-[var(--fc-bg)] p-6">
      {/* Same "← Back" pill every other auth screen uses (sign-in, sign-up,
          forgot-password, update-password). It returns to whatever preceded
          this screen; the sign-up form is only the fallback, for a tab that
          opened here with no history -- which is the usual way back anyway,
          e.g. to fix a mistyped email address. */}
      <BackButton
        fallback="/auth/sign-up"
        className={`absolute left-6 top-6 ${BACK_BUTTON_CLASS}`}
      />
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <VerifyEmailSection searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
