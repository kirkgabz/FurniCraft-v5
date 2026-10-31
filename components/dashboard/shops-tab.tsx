"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import Link from "next/link";
import { SHOP_PLACEHOLDER_IMAGE, shopCoverImage, type Shop } from "@/components/shops/shop-types";
import { MaterialTagChips, MaterialTagFilter } from "@/components/design/material-tag-chips";
import type { MaterialTagId } from "@/components/design/studio/material-tags";
import { CopyLinkButton } from "@/components/shops/share-template-button";
import {
  IconArrowUpRight,
  IconEdit,
  IconFurniture,
  IconLocation,
  IconStar,
} from "@/components/solihiya/icons";

/** A shop's score, averaged over its published reviews. Null when it has none. */
export type ShopRating = { average: number; count: number };

/**
 * One furniture shop, as a card.
 *
 * Built from the design file's Shops screen: the cover photograph, then the
 * name against its rating, where it is, what it makes, and one button into the
 * shop's own page.
 *
 * Three things on that card are deliberately absent here, because FurniCraft
 * has no data for them and a card is not the place to start inventing it. The
 * design shows "2.4 kilometres away", which needs a location for the customer
 * and coordinates for the shop, and we hold neither; it shows an "Accepting
 * projects" chip, which is a capacity flag no shop has ever been asked to set;
 * and it shows "4-6 weeks", a lead time with the same problem. Each would be a
 * plausible-looking number that nobody entered, on the page where a customer
 * decides who builds their furniture.
 *
 * What is here instead and is real: whether the shop is online now, which the
 * design does not show and we do know.
 */
function ShopCard({
  shop,
  isOwn,
  isSelected,
  isOnline,
  rating,
  onOpen,
}: {
  shop: Shop;
  isOwn: boolean;
  isSelected: boolean;
  isOnline: boolean;
  rating: ShopRating | null;
  onOpen: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <Link
      href={`/shops/${shop.id}`}
      onClick={onOpen}
      /* Sideways on a phone, upright from sm up. As a full card with its own
         16:10 photograph each, five furniture shops were 4.6 screens of scrolling
         and the photo alone was 245px of every one. Turned on its side the
         same card carries the same facts in about a quarter of the height. */
      className={`group flex h-full flex-row items-stretch overflow-hidden rounded-2xl border bg-[var(--fc-panel)] transition-[border-color,transform,box-shadow] duration-150 ease-fc hover:shadow-[0_8px_24px_rgba(26,19,9,0.08)] active:scale-[0.99] sm:flex-col ${
        isOwn || isSelected ? "border-[var(--fc-ink-accent)]" : "border-[var(--fc-border)]"
      }`}
    >
      <span className="relative block w-28 shrink-0 self-stretch overflow-hidden bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] sm:aspect-[16/10] sm:w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shopCoverImage(shop)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 ease-fc motion-safe:group-hover:scale-[1.03]"
          onError={(event) => {
            event.currentTarget.src = SHOP_PLACEHOLDER_IMAGE;
          }}
        />
        {isOwn || isSelected ? (
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-sm sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px] ${
              isOwn ? "bg-[var(--fc-verify)] text-white" : "bg-[var(--fc-ink-accent)] text-white"
            }`}
          >
            {isOwn ? uiText("Yours") : uiText("Your shop")}
          </span>
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:gap-2 sm:p-4">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className="min-w-0 truncate text-[15px] font-bold tracking-[-0.02em] text-[var(--fc-text)] sm:text-lg"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <ShopName shop={shop} />
          </span>
          {rating ? (
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--fc-ink-accent)]">
              <IconStar aria-hidden className="h-3.5 w-3.5" />
              <span className="tabular-nums">{rating.average.toFixed(1)}</span>
              <span className="font-normal text-[var(--fc-muted)]">({rating.count})</span>
            </span>
          ) : (
            <span className="shrink-0 text-xs text-[var(--fc-muted)]">{uiText("No reviews yet")}</span>
          )}
        </span>

        {shop.location ? (
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--fc-muted)]">
            <IconLocation aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{shop.location}</span>
          </span>
        ) : null}

        {shop.specialty ? (
          <span className="line-clamp-2 text-[13px] text-[var(--fc-text)] sm:text-sm">{shop.specialty}</span>
        ) : null}

        <span className="mt-auto flex items-center justify-between gap-3 sm:pt-1">
          <span className="flex items-center gap-1.5 text-xs text-[var(--fc-muted)]">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${isOnline ? "bg-fc-online" : "bg-[var(--fc-muted)]"}`}
            />
            {isOnline ? uiText("Online") : uiText("Away")}
          </span>
        </span>

        <span className="hidden min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border sm:inline-flex border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color] duration-150 group-hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]">{uiText("View furniture shop")}<IconArrowUpRight aria-hidden className="h-3.5 w-3.5" />
        </span>
      </span>
    </Link>
  );
}

/** The fields the feed reads from a shop's published design template. */
export type FeedTemplate = {
  id: string;
  shop_id: string;
  title: string;
  tag: string | null;
  preview_url: string | null;
};

/**
 * The customer's Shops section: every shop as one row, then the pieces shops
 * publish.
 *
 * It replaced a block on the dashboard home made of a search field, a large
 * "Your selected shop" card with four buttons, and a sideways rail where every
 * shop card carried four more (view collection, select, message, visit). Each
 * of those now lives on the shop's own page, which a row opens: its
 * collection, the Message button, its terms, and "Choose this shop", which
 * decides where the customer's next order goes. One tap per shop, and the
 * page that explains the shop is the page where you commit to it.
 *
 * The feed below is unchanged in what it does: filter by material, filter by
 * a shop from a piece's "by ..." line, open a piece in the studio.
 */
export default function ShopsTab<T extends FeedTemplate>({
  shops,
  visibleShops,
  query,
  onQueryChange,
  selectedShopId,
  currentUserId,
  isShopOnline,
  ratings,
  onOpenShop,
  feedShopFilter,
  onClearShopFilter,
  onFilterByShop,
  feedFilterTags,
  feedTagFilter,
  onTagFilterChange,
  isLoadingFeed,
  feedTemplateCount,
  visibleFeed,
  tagsFor,
  shopNameFor,
  customizeFor,
}: {
  shops: Shop[];
  /** `shops` narrowed by the search query. */
  visibleShops: Shop[];
  query: string;
  onQueryChange: (value: string) => void;
  /** Where the customer's next order goes (user_profiles.selected_shop_id). */
  selectedShopId: string | null;
  currentUserId: string | null;
  isShopOnline: (shop: Shop) => boolean;
  /** Average score and review count per shop id, for shops that have reviews. */
  ratings?: Record<string, ShopRating>;
  /** Called as a row is followed, e.g. to record the breadcrumb back here. */
  onOpenShop: (shop: Shop) => void;
  feedShopFilter: string | null;
  onClearShopFilter: () => void;
  onFilterByShop: (shopId: string) => void;
  feedFilterTags: MaterialTagId[];
  feedTagFilter: MaterialTagId | null;
  onTagFilterChange: (tag: MaterialTagId | null) => void;
  isLoadingFeed: boolean;
  /** Before the material filter; tells "nothing published" from "nothing matches". */
  feedTemplateCount: number;
  visibleFeed: T[];
  tagsFor: (template: T) => MaterialTagId[];
  shopNameFor: (shopId: string) => string;
  /** Null for a piece with no reopenable design. */
  customizeFor: (template: T) => (() => void) | null;
}) {
  const { t: uiText } = useUiLanguage();
  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;
  const filteredShopName = feedShopFilter ? shops.find((shop) => shop.id === feedShopFilter)?.name ?? "This shop" : null;

  return (
    <div className="space-y-10">
      <section aria-labelledby="shops-list-title" className="space-y-3 sm:space-y-4">
        {/* The design file's own opening for this page. The eyebrow and the
            heading carry the voice; the line under them says what the page is
            for. The dashboard's generic page title is suppressed for this
            section so the two do not stack. */}
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)] sm:text-[11px]"
            style={{ fontFamily: "var(--font-mono)" }}
          >{uiText("Local hands. Exceptional craft.")}</p>
          <h1
            id="shops-list-title"
            className="mt-1 text-[1.35rem] font-bold leading-tight tracking-[-0.03em] text-[var(--fc-text)] sm:mt-2 sm:text-[1.6rem] lg:text-[2.1rem]"
            style={{ fontFamily: "var(--font-display)" }}
          >{uiText("Find your kind of maker.")}</h1>
          <p className="mt-1 text-sm text-[var(--fc-muted)] sm:mt-1.5 sm:text-base">{uiText("Independent furniture shops ready to bring your design to life.")}</p>
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={uiText("Search furniture shops, materials or specialties…")}
          aria-label={uiText("Search shops")}
          className="min-h-11 w-full rounded-full border sm:min-h-12 border-[var(--fc-border)] bg-[var(--fc-panel)] px-5 text-[16px] text-[var(--fc-text)] outline-none transition-[border-color] duration-150 placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)] sm:text-sm"
        />

        {/* The design shows "6 of 8 furniture shops within 10 miles". The count is
            real and the distance is not, so the count stays and the distance
            goes: FurniCraft holds no coordinates for a shop and no location
            for the customer. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm tabular-nums text-[var(--fc-muted)]">
            {visibleShops.length === shops.length ? `${shops.length} ${shops.length === 1 ? "furniture shop" : "furniture shops"}` : uiText("{0} of {1} furniture shops", { 0: visibleShops.length, 1: shops.length })}
          </p>
          {/* Phones get the count alone. This line wrapped to a second row at
              375 and cost about 20px above the fold, and on a phone the same
              fact is already on the card itself: the chosen furniture shop wears a
              "Your shop" badge over its photograph. */}
          <p className="hidden text-sm text-[var(--fc-muted)] sm:block">
            {selectedShop ? (
              <>{uiText("Your next order goes to")}{" "}
                <span className="font-semibold text-[var(--fc-text)]"><ShopName shop={selectedShop} /></span>.
              </>
            ) : (
              "Open a furniture shop to see their work or choose them for your next order."
            )}
          </p>
        </div>

        {shops.length === 0 ? (
          <EmptyNote>{uiText("No shops are open on FurniCraft yet. Approved shops will appear here.")}</EmptyNote>
        ) : visibleShops.length === 0 ? (
          <EmptyNote>{uiText("No shops match “")}{query}”.{" "}
            <button type="button" onClick={() => onQueryChange("")} className="font-semibold text-[var(--fc-ink-accent)] hover:underline">{uiText("Clear search")}</button>
          </EmptyNote>
        ) : (
          /* One card per furniture shop, one up on a phone and three abreast on a
             desktop. This replaced a divided list whose rows measured 1598 by
             68 on a 1920 monitor: a monogram and a name at the far left, then
             most of a metre of nothing. */
          /* grid-cols-1 is load-bearing, not decoration.
             Without it this grid had no column definition below sm, so it fell
             back to one implicit `auto` column. An auto track is sized to its
             max-content and will not shrink below it, so the column grew to
             whatever the longest shop name wanted -- "Nanahoshi Futuristic
             Furniture Shop" -- and the cards rendered 447px wide inside a
             319px grid, hanging 128px off the right of the screen. Tailwind's
             grid-cols-1 is repeat(1, minmax(0, 1fr)), and it is the minmax(0)
             that lets the track be narrower than its content so the truncate
             and line-clamp inside the card can finally do their job. */
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleShops.map((shop) => {
              const isSelected = shop.id === selectedShopId;
              const isOwn = Boolean(currentUserId && shop.ownerUserId === currentUserId);
              return (
                <li key={shop.id}>
                  <ShopCard
                    shop={shop}
                    isOwn={isOwn}
                    isSelected={isSelected}
                    isOnline={isShopOnline(shop)}
                    rating={ratings?.[shop.id] ?? null}
                    onOpen={() => onOpenShop(shop)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="shops-feed-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="shops-feed-title" className="text-base font-bold text-[var(--fc-text)]">
            {filteredShopName ? uiText("{0}’s pieces", { 0: filteredShopName }) : uiText("Pieces from shops")}
          </h2>
          {feedShopFilter ? (
            <button
              type="button"
              onClick={onClearShopFilter}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline"
            >{uiText("Show every shop")}</button>
          ) : null}
        </div>
        <p className="text-sm text-[var(--fc-muted)]">{uiText("Open one in the 3D studio and change it to fit your room.")}</p>

        {!isLoadingFeed ? (
          <MaterialTagFilter tags={feedFilterTags} value={feedTagFilter} onChange={onTagFilterChange} label={uiText("Filter pieces by material")} />
        ) : null}

        {isLoadingFeed ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" aria-busy="true" aria-label={uiText("Loading pieces")}>
            {[0, 1, 2].map((index) => (
              <div key={index} className="aspect-[4/3] rounded-2xl bg-[rgba(178,106,56,0.08)] motion-safe:animate-pulse" />
            ))}
          </div>
        ) : feedTemplateCount === 0 ? (
          <EmptyNote>
            {feedShopFilter ? uiText("This shop hasn't published any pieces yet.") : uiText("No shop has published a piece yet. Check back soon.")}
          </EmptyNote>
        ) : visibleFeed.length === 0 ? (
          <EmptyNote>{uiText("None of these pieces are made that way.")}{" "}
            <button type="button" onClick={() => onTagFilterChange(null)} className="font-semibold text-[var(--fc-ink-accent)] hover:underline">{uiText("Show every piece")}</button>
          </EmptyNote>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {visibleFeed.map((template) => (
              <FeedProductCard
                key={template.id}
                template={template}
                tags={tagsFor(template)}
                shopName={shopNameFor(template.shop_id)}
                shopIsPro={shops.find((shop) => shop.id === template.shop_id)?.isPro === true}
                onViewShop={() => onFilterByShop(template.shop_id)}
                onCustomize={customizeFor(template)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">{children}</p>
  );
}

/**
 * One shop-published design template. `onCustomize` is null for a legacy row
 * with no reopenable cad_state, matching the read-only fallback the rest of
 * the app already gives those (see openItemInDesigner's docstring).
 */
function FeedProductCard({
  template,
  shopName,
  shopIsPro,
  onViewShop,
  onCustomize,
  tags,
}: {
  template: FeedTemplate;
  shopName: string;
  shopIsPro: boolean;
  /** What it is made of; see material-tags.ts. */
  tags: MaterialTagId[];
  onViewShop: () => void;
  onCustomize: (() => void) | null;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)]">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[rgba(178,106,56,0.06)]">
        {template.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={template.preview_url}
            alt={template.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:[@media(hover:hover)]:group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <IconFurniture aria-hidden className="h-10 w-10 text-[var(--fc-muted)]" />
          </div>
        )}
        {template.tag ? (
          <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
            {template.tag}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <h3 className="text-sm font-semibold leading-snug text-[var(--fc-text)] sm:text-base">{template.title}</h3>
        <MaterialTagChips tags={tags} />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onViewShop}
            className="tap-target w-fit min-w-0 truncate text-left text-xs font-semibold text-[var(--fc-muted)] transition-colors duration-150 hover:text-fc-ink-accent"
          >{uiText("by ")}<ShopName shop={{ name: shopName, isPro: shopIsPro }} />
          </button>
          <CopyLinkButton templateId={template.id} title={template.title} className="shop-template-action-btn shrink-0" compact />
        </div>
        {onCustomize ? (
          <button
            type="button"
            onClick={onCustomize}
            className="mt-auto inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-dashed border-fc-ink-accent px-2 py-2 text-xs font-semibold text-fc-ink-accent transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] hover:bg-[rgba(178,106,56,0.08)]"
          >
            <IconEdit aria-hidden className="h-4 w-4 shrink-0" />{uiText(" Customize")}</button>
        ) : (
          <p className="mt-auto text-xs text-[var(--fc-muted)]">{uiText("Ask this shop about this piece")}</p>
        )}
      </div>
    </div>
  );
}
