"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { type Dispatch, type SetStateAction } from "react";
import { type Shop as ShopRecord } from "@/components/shops/shop-types";
import { SocialLinkRow } from "@/components/shops/social-links-editor";
import { IconPresence } from "@/components/solihiya/icons";
import { Modal } from "@/components/ui/modal";

export type ShopProfileModalProps = {
  isShopOnline: (shop: { ownerUserId?: string | null; } | null) => boolean;
  selectedShop: ShopRecord;
  setIsShopProfileModalOpen: Dispatch<SetStateAction<boolean>>;
};

/**
 * A shop's details, opened from the dashboard.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function ShopProfileModal({
  isShopOnline,
  selectedShop,
  setIsShopProfileModalOpen,
}: ShopProfileModalProps) {
  const { t: uiText } = useUiLanguage();
  return (
    <Modal
      open
      onClose={() => setIsShopProfileModalOpen(false)}
      ariaLabel={uiText("{0} profile", { 0: selectedShop.name })}
      eyebrow={uiText("Shop profile")}
      title={selectedShop.name}
      className="sm:max-w-md"
    >
        <div className="space-y-3 text-sm text-[var(--fc-text)]">
          <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Specialty")}</div>
            <p className="mt-1 text-[var(--fc-text)]">{selectedShop.specialty}</p>
          </div>
          <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Location")}</div>
            <p className="mt-1 text-[var(--fc-text)]">{selectedShop.location}</p>
          </div>
          <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Status")}</div>
            <p className={`mt-1 font-semibold ${isShopOnline(selectedShop) ? "text-fc-online" : "text-[var(--fc-muted)]"}`}>
              <span className="inline-flex items-center gap-1.5"><IconPresence online={isShopOnline(selectedShop)} /> {isShopOnline(selectedShop) ? uiText("Online now") : uiText("Away")}</span>
            </p>
          </div>
          {selectedShop.socialLinks?.length ? (
            <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Find them elsewhere")}</div>
              <div className="mt-2">
                <SocialLinkRow links={selectedShop.socialLinks} />
              </div>
            </div>
          ) : null}
          {selectedShop.policies ? (
            <div className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Shop policies")}</div>
              <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap text-[var(--fc-text)]">
                {selectedShop.policies}
              </p>
            </div>
          ) : null}
        </div>
    </Modal>
  );
}
