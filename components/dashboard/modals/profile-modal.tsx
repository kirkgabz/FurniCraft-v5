"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { type Dispatch, type SetStateAction } from "react";
import { IconEdit, IconProfile } from "@/components/solihiya/icons";
import { Modal } from "@/components/ui/modal";
import PhoneInput from "@/components/ui/phone-input";

export type ProfileModalProps = {
  avatarError: string | null;
  avatarUrl: string | null;
  fullName: string;
  handleAvatarFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleProfileSave: () => Promise<void>;
  isSavingProfile: boolean;
  phone: string;
  profileAddress: string;
  setFullName: Dispatch<SetStateAction<string>>;
  setIsProfileModalOpen: Dispatch<SetStateAction<boolean>>;
  setPhone: Dispatch<SetStateAction<string>>;
  setProfileAddress: Dispatch<SetStateAction<string>>;
  userEmail: string | null | undefined;
};

/**
 * Edit your profile: photo, name, phone and address.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function ProfileModal({
  avatarError,
  avatarUrl,
  fullName,
  handleAvatarFileChange,
  handleProfileSave,
  isSavingProfile,
  phone,
  profileAddress,
  setFullName,
  setIsProfileModalOpen,
  setPhone,
  setProfileAddress,
  userEmail,
}: ProfileModalProps) {
  const { t: uiText } = useUiLanguage();
  return (
    <Modal
      open
      onClose={() => setIsProfileModalOpen(false)}
      ariaLabel={uiText("Edit your profile")}
      title={uiText("Edit profile")}
      className="sm:max-w-md"
      bodyClassName="p-0 sm:p-0"
      footer={
        <>
          <button
            type="button"
            onClick={() => setIsProfileModalOpen(false)}
            className="ml-auto inline-grid min-h-11 place-items-center rounded-xl px-5 text-sm font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.08)] hover:text-[var(--fc-text)] active:scale-[0.98]"
          >{uiText("Cancel")}</button>
          <button
            onClick={handleProfileSave}
            disabled={isSavingProfile}
            className="inline-grid min-h-11 place-items-center rounded-xl bg-[var(--fc-ink-accent)] px-6 text-sm font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {isSavingProfile ? uiText("Saving…") : uiText("Save Changes")}
          </button>
        </>
      }
    >
        {/* Header with avatar */}
        <div className="flex flex-col items-center gap-3 px-6 pt-7 pb-5">
          <label
            className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[var(--fc-avatar-bg,#3a3530)] text-[var(--fc-avatar-fg,#7a6e66)] transition hover:brightness-110"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <IconProfile aria-hidden className="h-14 w-14 translate-y-2" />
            )}
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
              <IconEdit aria-hidden className="h-5 w-5" />
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => void handleAvatarFileChange(event)}
              className="sr-only"
            />
          </label>
          {avatarError ? <p className="text-xs text-fc-danger">{uiText(avatarError)}</p> : null}
          <div className="text-center">
            <h3 className="text-lg font-bold text-[var(--fc-text)]">{fullName || uiText("Your Profile")}</h3>
            {userEmail ? <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{userEmail}</p> : null}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6 border-t border-[var(--fc-border)]" />

        {/* Form fields */}
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Full name")}</label>
            <input
              className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-2.5 text-sm text-[var(--fc-text)] outline-none transition placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-ink-accent)] focus:ring-1 focus:ring-[var(--fc-ink-accent)]"
              placeholder={uiText("Enter your full name")}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Phone")}</label>
            <PhoneInput value={phone} onChange={setPhone} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Address")}</label>
            <input
              className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-2.5 text-sm text-[var(--fc-text)] outline-none transition placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-ink-accent)] focus:ring-1 focus:ring-[var(--fc-ink-accent)]"
              placeholder={uiText("Enter your address")}
              value={profileAddress}
              onChange={(event) => setProfileAddress(event.target.value)}
            />
          </div>
        </div>

      </Modal>
  );
}
