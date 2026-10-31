"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { Modal } from "@/components/ui/modal";
import { resolveShopPolicies } from "./shop-policies";

/**
 * The terms a customer sees when they pick a shop to work with.
 *
 * Shown on first selection rather than at checkout: deposits and lead times
 * change whether you want this shop at all, and a customer who reads them after
 * paying has read them too late. It appears once per shop and can be reopened
 * from the shop's page, so it informs without nagging.
 *
 * When the shop has published nothing, this shows FurniCraft's standard terms
 * under a heading that says so. That labelling is not decoration -- presenting
 * a platform default as a named furniture shop's own commitment would invent terms
 * that furniture shop never agreed to, for a customer who may act on them.
 */
export function ShopPoliciesDialog({
  open,
  onClose,
  shopName,
  policies,
}: {
  open: boolean;
  onClose: () => void;
  shopName: string;
  policies: string | null | undefined;
}) {
  const { t: uiText } = useUiLanguage();
  const { text, isShopAuthored } = resolveShopPolicies(policies);

  return (
    <Modal open={open} onClose={onClose} ariaLabel={uiText("Ordering terms for {0}", { 0: shopName })} className="sm:max-w-lg" bodyClassName="p-0 sm:p-0">
      <div className="flex min-h-0 flex-col">
        <header className="border-b border-[var(--fc-border)] p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">{uiText("Before you order")}</p>
          <h2 className="mt-1 text-xl font-bold text-[var(--fc-text)]">{shopName}</h2>
          <p className="mt-2 text-sm leading-snug text-[var(--fc-muted)]">
            {isShopAuthored ? uiText("These are this shop's own terms. Worth reading before you send a design.") : uiText("This shop hasn't published its own terms yet. These are FurniCraft's standard terms — treat them as a guide, and confirm the details with the shop before you pay.")}
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--fc-text)]">{text}</p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--fc-border)] p-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-fc-btn px-4 py-2 text-sm font-semibold text-fc-btn-fg transition hover:opacity-90"
          >{uiText("Got it")}</button>
        </footer>
      </div>
    </Modal>
  );
}
