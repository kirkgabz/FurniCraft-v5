"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import ConfirmModal from "@/components/ui/confirm-modal";
import { useRouter } from "next/navigation";

/**
 * `pill` is the header button. `row` is a drawer row, for the phone layout,
 * where the header no longer has room for it and the drawer is where account
 * things live.
 */
export function LogoutButton({ variant = "pill", label = "Sign out" }: { variant?: "pill" | "row"; label?: string }) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  /**
   * Logout sits in the header of every signed-in screen, a few pixels from the
   * notification bell and the user pill, and used to fire on the first click.
   * On a half-finished design or an unsent order that is an expensive misclick,
   * so it asks first.
   */
  const logout = async () => {
    setIsSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth/login");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <>
      {variant === "row" ? (
        <button
          type="button"
          onClick={() => setIsConfirmOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold text-fc-danger transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] active:scale-[0.98] [@media(pointer:coarse)]:min-h-11"
        >
          {uiText(label)}
        </button>
      ) : (
        <Button
          onClick={() => setIsConfirmOpen(true)}
          className="rounded-full bg-[var(--fc-btn)] text-[var(--fc-btn-fg)] shadow-none hover:bg-[var(--fc-btn-hover)]"
        >{uiText(label)}</Button>
      )}
      <ConfirmModal
        open={isConfirmOpen}
        title={uiText("Sign out of FurniCraft?")}
        body="Saved designs and orders stay where they are. Anything you have not saved in the studio will be lost."
        confirmLabel={uiText("Sign out")}
        busy={isSigningOut}
        onConfirm={() => void logout()}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}
