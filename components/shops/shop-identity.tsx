"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopLogo } from "@/components/shops/shop-logo";
import type { Shop } from "@/components/shops/shop-types";

const SHOP_IDENTITY_SIZES = {
  sm: { px: 32, dot: "h-2 w-2" },
  md: { px: 44, dot: "h-2.5 w-2.5" },
  lg: { px: 56, dot: "h-3 w-3" },
} as const;

/**
 * A shop's face, for the Shops list, the conversation list, the chat header
 * and the message gutter beside what it said: its logo, or its initials as a
 * placeholder when it has not uploaded one (ShopLogo).
 *
 * It used to be the cover photo, which at these sizes crops to an arbitrary
 * corner of a room; a logo is made to be read small.
 *
 * `online` is optional because presence is worth showing in a list, where
 * nothing else says it, and redundant in the chat header, which already spells
 * it out in a pill beside the name.
 */
export function ShopIdentity({
  shop,
  size,
  online,
}: {
  shop: Pick<Shop, "name" | "logoUrl">;
  size: keyof typeof SHOP_IDENTITY_SIZES;
  online?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const scale = SHOP_IDENTITY_SIZES[size];
  return (
    <span className="relative shrink-0">
      <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={scale.px} />
      {online !== undefined ? (
        <>
          <span
            aria-hidden
            className={`absolute -bottom-0.5 -right-0.5 ${scale.dot} rounded-full border-2 border-[var(--fc-panel)] ${
              online ? "bg-fc-online" : "bg-[var(--fc-muted)]"
            }`}
          />
          <span className="sr-only">{online ? uiText("Online") : uiText("Away")}</span>
        </>
      ) : null}
    </span>
  );
}
