"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySaved } from "@/lib/saved-notice";
import {
  parseBreakdownView,
  parseFormula,
  type BreakdownView,
  type PricingFormula,
} from "@/components/orders/pricing";

/**
 * The shop's own pricing formula (shop_pricing), read and saved.
 *
 * `formula` is null until the shop has set one: the cost sheet then offers to
 * set it rather than assuming a markup nobody chose.
 */
export function useShopPricing(shopId: string | null | undefined) {
  const [formula, setFormula] = useState<PricingFormula | null>(null);
  const [view, setView] = useState<BreakdownView>("groups");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("shop_pricing")
        .select("formula, breakdown_view")
        .eq("shop_id", shopId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        console.error("Failed to load the shop's pricing:", loadError);
        setError("Could not load your pricing.");
      } else {
        const row = data as { formula: unknown; breakdown_view: unknown } | null;
        setFormula(parseFormula(row?.formula));
        setView(parseBreakdownView(row?.breakdown_view));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const save = useCallback(
    async (nextFormula: PricingFormula, nextView: BreakdownView): Promise<boolean> => {
      if (!shopId) return false;
      setError(null);
      const supabase = createClient();
      const { error: saveError } = await supabase.from("shop_pricing").upsert(
        { shop_id: shopId, formula: nextFormula, breakdown_view: nextView, updated_at: new Date().toISOString() },
        { onConflict: "shop_id" }
      );
      if (saveError) {
        console.error("Failed to save the shop's pricing:", saveError);
        setError("Could not save your pricing. Try again.");
        return false;
      }
      setFormula(nextFormula);
      setView(nextView);
      notifySaved("Pricing saved");
      return true;
    },
    [shopId]
  );

  return { formula, view, loaded, error, save };
}
