import { ProBadge } from "./pro-badge";
import type { Shop } from "./shop-types";

/** Compact shop identity, safe inside a card link or a shop-selection button. */
export function ShopName({ shop }: { shop: Pick<Shop, "name" | "isPro"> }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
      <span className="min-w-0 truncate">{shop.name}</span>
      {shop.isPro === true ? <ProBadge interactive={false} /> : null}
    </span>
  );
}
