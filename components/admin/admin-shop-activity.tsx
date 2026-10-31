"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SHOP_INACTIVE_DEACTIVATE_DAYS } from "@/lib/shop-activity";

type ShopActivityRow = {
  id: string;
  shop_name: string | null;
  is_active: boolean;
  suspended_at: string | null;
  last_active_at: string | null;
  inactive_deactivated_at: string | null;
};

type Stage = "active" | "warned30" | "warned60" | "deactivated" | "hidden" | "suspended";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where a shop stands under the inactivity rule (20261028090000_shop_inactivity.sql). */
function stageOf(shop: ShopActivityRow, idleDays: number | null): Stage {
  if (shop.suspended_at) return "suspended";
  if (shop.inactive_deactivated_at) return "deactivated";
  if (!shop.is_active) return "hidden";
  if (idleDays !== null && idleDays >= 60) return "warned60";
  if (idleDays !== null && idleDays >= 30) return "warned30";
  return "active";
}

const STAGE_LABEL: Record<Stage, string> = {
  active: "Active",
  warned30: "Warned at 30 days",
  warned60: "Warned at 60 days",
  deactivated: "Deactivated for inactivity",
  hidden: "Hidden by owner or admin",
  suspended: "Suspended",
};

const STAGE_TONE: Record<Stage, string> = {
  active: "bg-[rgba(46,125,80,0.12)] text-[#2e7d50]",
  warned30: "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]",
  warned60: "bg-[rgba(192,57,43,0.12)] text-[var(--fc-danger)]",
  deactivated: "bg-[rgba(192,57,43,0.12)] text-[var(--fc-danger)]",
  hidden: "bg-[rgba(0,0,0,0.06)] text-[var(--fc-muted)]",
  suspended: "bg-[rgba(0,0,0,0.06)] text-[var(--fc-muted)]",
};

/**
 * Deactivated shops, and how active every approved shop has been.
 *
 * Read only. A shop deactivated for inactivity comes back when its owner opens
 * the shop dashboard again, so there is nothing here for an admin to press;
 * what an admin needs is to see which shops have gone quiet, and which the
 * rule has already switched off.
 */
export default function AdminShopActivity() {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const [shops, setShops] = useState<ShopActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingMigration, setMissingMigration] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shops")
      .select("id, shop_name, is_active, suspended_at, last_active_at, inactive_deactivated_at")
      .eq("status", "approved");
    // The columns arrive with the migration; until then, say what is missing
    // rather than show an empty list that reads as "no shops".
    setMissingMigration(Boolean(error));
    setShops(error ? [] : ((data ?? []) as ShopActivityRow[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const now = Date.now();
    return shops
      .map((shop) => {
        const idleDays = shop.last_active_at ? Math.floor((now - Date.parse(shop.last_active_at)) / DAY_MS) : null;
        return { shop, idleDays, stage: stageOf(shop, idleDays) };
      })
      .sort((a, b) => (b.idleDays ?? -1) - (a.idleDays ?? -1));
  }, [shops]);

  const deactivated = rows.filter((row) => row.stage === "deactivated");
  const warned = rows.filter((row) => row.stage === "warned30" || row.stage === "warned60");
  const date = (value: string | null) => (value ? new Date(value).toLocaleDateString(uiLocale) : "—");

  if (loading) return <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>;

  if (missingMigration) {
    return (
      <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">
        {uiText("Shop activity tracking is not switched on yet. Apply migration 20261028090000_shop_inactivity.sql in Supabase.")}
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Deactivated", value: deactivated.length, alarm: deactivated.length > 0 },
          { label: "Warned", value: warned.length, alarm: false },
          { label: "Approved shops", value: rows.length, alarm: false },
        ].map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border p-4 ${
              card.alarm ? "border-[var(--fc-danger)] bg-[rgba(192,57,43,0.06)]" : "border-[var(--fc-border)] bg-[var(--fc-panel)]"
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-[var(--fc-muted)]">{uiText(card.label)}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--fc-text)]">{card.value}</p>
          </div>
        ))}
      </div>

      <p className="text-sm text-[var(--fc-muted)]">
        {uiText("A shop with no activity for {0} days is deactivated: hidden from customers and closed to new orders. Its owner is warned at 30 and 60 days, and the shop comes back by itself when the owner opens the shop dashboard again.", { 0: SHOP_INACTIVE_DEACTIVATE_DAYS })}
      </p>

      <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5">
        <h2 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Deactivated shops")}</h2>
        {deactivated.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("No shops have been deactivated for inactivity.")}</p>
        ) : (
          <ul className="m-0 mt-3 list-none space-y-2 p-0">
            {deactivated.map(({ shop, idleDays }) => (
              <li key={shop.id} className="rounded-2xl border border-[var(--fc-border)] p-3 text-sm">
                <p className="font-semibold text-[var(--fc-text)]">{shop.shop_name || uiText("Unnamed shop")}</p>
                <p className="mt-1 text-[var(--fc-muted)]">
                  {uiText("Deactivated {0} · last active {1} ({2} days ago)", {
                    0: date(shop.inactive_deactivated_at),
                    1: date(shop.last_active_at),
                    2: idleDays ?? "—",
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5">
        <h2 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Shop activity")}</h2>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Every approved shop, longest without activity first.")}</p>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("No approved shop owners yet.")}</p>
        ) : (
          <ul className="m-0 mt-3 list-none divide-y divide-[var(--fc-border)] p-0">
            {rows.map(({ shop, idleDays, stage }) => (
              <li key={shop.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--fc-text)]">{shop.shop_name || uiText("Unnamed shop")}</p>
                  <p className="text-xs text-[var(--fc-muted)]">
                    {uiText("Last active {0}", { 0: date(shop.last_active_at) })}
                    {idleDays !== null ? ` · ${uiText("{0} days without activity", { 0: idleDays })}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STAGE_TONE[stage]}`}>
                  {uiText(STAGE_LABEL[stage])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
