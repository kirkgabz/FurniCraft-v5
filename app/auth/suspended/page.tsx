import { SuspendedNotice } from "@/components/auth/suspended-notice";

/**
 * Where a suspended account is sent (lib/supabase/proxy.ts). Under /auth so it
 * stays reachable while every other signed-in page redirects here.
 */
export default function Page() {
  return (
    <div className="ledger-grid relative flex min-h-svh items-center justify-center bg-[var(--fc-bg)] p-6">
      <div className="w-full max-w-md">
        <SuspendedNotice />
      </div>
    </div>
  );
}
