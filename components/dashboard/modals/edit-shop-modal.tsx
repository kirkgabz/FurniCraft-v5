"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { type Dispatch, type SetStateAction } from "react";
import { Modal } from "@/components/ui/modal";

export type EditShopModalProps = {
  setIsEditShopModalOpen: Dispatch<SetStateAction<boolean>>;
  setShopOwnerAddress: Dispatch<SetStateAction<string>>;
  setShopOwnerName: Dispatch<SetStateAction<string>>;
  shopOwnerAddress: string;
  shopOwnerName: string;
};

/**
 * Update your shop details.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function EditShopModal({
  setIsEditShopModalOpen,
  setShopOwnerAddress,
  setShopOwnerName,
  shopOwnerAddress,
  shopOwnerName,
}: EditShopModalProps) {
  const { t: uiText } = useUiLanguage();
  return (
    <Modal
      open
      onClose={() => setIsEditShopModalOpen(false)}
      ariaLabel={uiText("Update your shop details")}
      eyebrow={uiText("Edit shop")}
      title={uiText("Update your shop details")}
      className="sm:max-w-md"
    >
      <div className="space-y-3 text-sm text-[var(--fc-text)]">
        <input
          className="min-h-11 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 text-[16px] text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] sm:text-sm"
          placeholder={uiText("Shop name")}
          value={shopOwnerName || ""}
          onChange={(event) => setShopOwnerName(event.target.value)}
        />
        <input
          className="min-h-11 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 text-[16px] text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] sm:text-sm"
          placeholder={uiText("Shop address")}
          value={shopOwnerAddress || ""}
          onChange={(event) => setShopOwnerAddress(event.target.value)}
        />
        <button
          onClick={() => {
            // Handle save here
            setIsEditShopModalOpen(false);
          }}
          className="btn btn-primary btn-block"
        >{uiText("Save Shop Details")}</button>
      </div>
    </Modal>
  );
}
