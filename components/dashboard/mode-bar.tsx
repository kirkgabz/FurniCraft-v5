"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import Link from "next/link";
import { IconSeller, IconOrders } from "@/components/solihiya/icons";

/**
 * Which side of FurniCraft you are on, said at the top of every dashboard
 * screen.
 *
 * An account that owns a shop has two dashboards: /protected, where it orders
 * furniture as a customer, and /protected/shop, where it runs the shop. They
 * looked alike (same header, same tab bar, a "Shop" chip on one and a "Shop
 * Owner" badge, confusingly, on the other) and an owner could not tell at a
 * glance which one they were in. This bar is the answer in two colours: dark
 * walnut for the shop, light amber for the customer side, sticky so it is on
 * every screen of the scroll.
 *
 * The two dashboards stay separate surfaces, as PRODUCT.md requires; the link
 * here goes from one to the other the way the Account menu's rows already do.
 * Plain customers (no shop) never see it on the customer side: there is only
 * one mode for them to be in.
 */
export function ModeBar({
  mode,
  shopName,
  shopIsPro = false,
  className = "",
}: {
  mode: "customer" | "shop";
  /** Shown in shop mode, so the owner also sees which shop. */
  shopName?: string | null;
  shopIsPro?: boolean;
  /** E.g. the customer dashboard's sidebar offset (lg:ml-64). */
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const isShop = mode === "shop";
  return (
    <div className={`fc-modebar ${className}`} data-mode={mode} role="note" aria-label={isShop ? uiText("Shop mode") : uiText("Customer mode")}>
      <span className="flex min-w-0 items-center gap-2">
        {isShop ? (
          <IconSeller aria-hidden className="h-4 w-4 shrink-0" />
        ) : (
          <IconOrders aria-hidden className="h-4 w-4 shrink-0" />
        )}
        <span className="shrink-0 font-bold">{isShop ? uiText("Shop mode") : uiText("Customer mode")}</span>
        {/* The shop's name is worth its space on a phone; "ordering for
            yourself" is not, and it was cut to "Ordering for y..." there. */}
        <span className={`min-w-0 truncate opacity-80${isShop ? "" : " max-sm:hidden"}`}>
          {isShop ? <ShopName shop={{ name: shopName || uiText("Your shop"), isPro: shopIsPro }} /> : uiText("Ordering for yourself")}
        </span>
      </span>
      <Link href={isShop ? "/protected" : "/protected/shop"} className="fc-modebar-switch">
        {isShop ? uiText("Switch to customer") : uiText("Switch to shop")}
      </Link>
    </div>
  );
}
