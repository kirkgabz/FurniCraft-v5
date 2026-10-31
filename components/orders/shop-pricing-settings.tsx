"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useState } from "react";
import { DEFAULT_FORMULA, describeFormula, type BreakdownView, type PricingFormula } from "@/components/orders/pricing";
import { BreakdownViewPicker, PricingFormulaEditor } from "@/components/orders/pricing-formula-editor";
import { useShopPricing } from "@/components/orders/use-shop-pricing";

/**
 * Settings → Pricing: the shop's formula, set once and used on every order's
 * cost sheet, and what its customers see when a quote is filled from it.
 * Private -- shop_pricing has owner-only policies.
 */
export default function ShopPricingSettings({ shopId }: { shopId: string }) {
  const { t: uiText } = useUiLanguage();
  const pricing = useShopPricing(shopId);
  // Local copies, so a half-made change is not saved until Save.
  const [formula, setFormula] = useState<PricingFormula | null>(null);
  const [view, setView] = useState<BreakdownView | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const shownFormula = formula ?? pricing.formula ?? DEFAULT_FORMULA;
  const shownView = view ?? pricing.view;
  const dirty = formula !== null || view !== null || (!pricing.formula && pricing.loaded);

  return (
    <div className="mt-3 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-4">
      <h4 className="font-semibold text-[var(--fc-text)]">{uiText("Pricing")}</h4>
      <p className="muted-small">{uiText("How your cost sheet turns what a piece costs you into a price. Only you can see this.")}{pricing.formula ? uiText(" Now: {0}.", { 0: describeFormula(pricing.formula) }) : ""}
      </p>

      {!pricing.loaded ? (
        <div aria-hidden className="mt-3 h-24 animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]" />
      ) : (
        <>
          <div className="mt-3">
            <PricingFormulaEditor
              name="shop-pricing-formula"
              value={shownFormula}
              onChange={(next) => {
                setFormula(next);
                setSavedNote(null);
              }}
            />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What customers see")}</p>
          <div className="mt-2">
            <BreakdownViewPicker
              name="shop-pricing-view"
              value={shownView}
              onChange={(next) => {
                setView(next);
                setSavedNote(null);
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {savedNote ? <p role="status" className="mr-auto text-xs text-fc-online">{uiText(savedNote)}</p> : null}
            {pricing.error ? <p className="mr-auto text-xs text-fc-danger">{uiText(pricing.error)}</p> : null}
            <button
              type="button"
              disabled={!dirty}
              onClick={async () => {
                const ok = await pricing.save(shownFormula, shownView);
                if (ok) {
                  setFormula(null);
                  setView(null);
                  setSavedNote("Saved. New cost sheets will use this.");
                }
              }}
              className="btn btn-primary btn-sm active:scale-[0.97] disabled:opacity-40"
            >{uiText("Save pricing")}</button>
          </div>
        </>
      )}
    </div>
  );
}
