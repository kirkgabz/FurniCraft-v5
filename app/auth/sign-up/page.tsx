import BackButton from "@/components/ui/back-button";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";

export default function Page() {
  return (
    <div className="ledger-grid relative flex min-h-svh w-full items-center justify-center bg-[var(--fc-bg)] px-6 pb-6 pt-24 md:px-10 md:pb-10">
      <BackButton
        fallback="/"
        className={`absolute left-6 top-6 ${BACK_BUTTON_CLASS}`}
      />
      <div className="w-full max-w-md">
        <SignUpForm />
      </div>
    </div>
  );
}
