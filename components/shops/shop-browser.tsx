"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconLocation,
  IconCheck,
  IconTemplates,
  IconMessages,
  IconSeller,
  IconPhone,
  IconClock,
  IconPresence,
} from "@/components/solihiya/icons";
import { createClient } from "@/lib/supabase/client";
import { pushStep } from "@/lib/commission-path";
import ImageLightbox from "@/components/design/image-lightbox";
import {
  parseGallery,
  shopCoverImage,
  shopInitials,
  SHOP_PLACEHOLDER_IMAGE,
  SHOPS_PUBLIC_TABLE,
  type Shop,
  type ShopPhoto,
} from "./shop-types";
import { SocialLinkRow } from "./social-links-editor";

/**
 * Map-style shop browser: a scrollable list of storefronts beside a detail panel
 * that opens in place, the way a place card works on a map. Selecting a shop is
 * kept deliberately separate from viewing one -- a customer can read through
 * several shops before committing, and only the explicit button changes which
 * shop their orders go to.
 *
 * Galleries are fetched per shop when its detail opens rather than with the
 * list, because the photos are stored inline on the row and pulling every shop's
 * gallery up front would download megabytes nobody has asked to see yet.
 */

type Props = {
  shops: Shop[];
  selectedShopId: string | null;
  /** The signed-in user, so an owned shop can be told apart from a chosen one. */
  viewerUserId?: string | null;
  /**
   * Owner ids currently online, from Realtime presence. Passed in rather than
   * subscribed to here so the whole dashboard shares one presence channel and
   * one answer, and presence is not something a stored row can know.
   */
  onlineOwnerIds?: Set<string>;
  onSelectShop: (shopId: string) => void;
  onMessageShop?: (shopId: string) => void;
  onViewTemplates?: (shopId: string) => void;
};

export default function ShopBrowser({
  shops,
  selectedShopId,
  viewerUserId,
  onlineOwnerIds,
  onSelectShop,
  onMessageShop,
  onViewTemplates,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [activeShopId, setActiveShopId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [galleries, setGalleries] = useState<Record<string, ShopPhoto[]>>({});
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Collapsed by default: the panel is about the shop, not its photo album.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const activeShop = shops.find((shop) => shop.id === activeShopId) ?? null;

  const loadGallery = useCallback(
    async (shopId: string) => {
      if (galleries[shopId]) return;
      setLoadingGallery(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from(SHOPS_PUBLIC_TABLE)
          .select("gallery")
          .eq("id", shopId)
          .maybeSingle();
        setGalleries((current) => ({ ...current, [shopId]: parseGallery(data?.gallery) }));
      } catch {
        // A missing gallery column or a network hiccup should not break the card.
        setGalleries((current) => ({ ...current, [shopId]: [] }));
      } finally {
        setLoadingGallery(false);
      }
    },
    [galleries]
  );

  const openShop = useCallback(
    (shopId: string) => {
      setActiveShopId(shopId);
      setGalleryOpen(false);
      void loadGallery(shopId);
      // On narrow screens the detail renders below the list, so bring it into view.
      requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 1023px)").matches) {
          detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    [loadGallery]
  );

  /**
   * Open the customer's own shop, and nothing else.
   *
   * This used to fall back to `shops[0]` when they had not chosen one, which
   * put an arbitrary furniture shop on screen as though it had been picked for them --
   * whichever happened to sort first became the default recommendation of a
   * marketplace that is not supposed to have one. Their own selected shop is a
   * real answer to "which shop"; the first row of a list is not, so with no
   * selection the panel now invites a choice instead of pre-empting it.
   */
  useEffect(() => {
    if (activeShopId || shops.length === 0 || !selectedShopId) return;
    const own = shops.find((shop) => shop.id === selectedShopId);
    if (!own) return;
    setActiveShopId(own.id);
    void loadGallery(own.id);
  }, [shops, selectedShopId, activeShopId, loadGallery]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  const needle = query.trim().toLowerCase();
  const visibleShops = needle
    ? shops.filter((shop) =>
        [shop.name, shop.specialty, shop.location].some((field) => field?.toLowerCase().includes(needle))
      )
    : shops;

  const activeGallery = activeShop ? galleries[activeShop.id] ?? [] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      {/* ---- list ---- */}
      <div className="flex min-h-0 flex-col rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)]">
        <div className="border-b border-[var(--fc-border)] p-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={uiText("Search shops, specialties, places…")}
            aria-label={uiText("Search shops")}
            className="w-full rounded-full border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-2 text-sm text-[var(--fc-text)] outline-none placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)]"
          />
        </div>

        <div className="max-h-[520px] overflow-y-auto p-2">
          {visibleShops.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--fc-muted)]">
              {shops.length === 0 ? uiText("No approved shops yet.") : uiText("No shops match “{0}”.", { 0: query })}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {visibleShops.map((shop) => {
                const isActive = shop.id === activeShopId;
                const isSelected = shop.id === selectedShopId;
                return (
                  <li key={shop.id}>
                    <button
                      type="button"
                      onClick={() => openShop(shop.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={`flex w-full gap-3 rounded-2xl border p-2.5 text-left transition-[transform,background-color,border-color] duration-150 active:scale-[0.99] ${
                        isActive
                          ? "border-[var(--fc-accent)] bg-[rgba(198,125,56,0.10)]"
                          : "border-transparent hover:border-[var(--fc-border)] hover:bg-[rgba(198,125,56,0.05)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shopCoverImage(shop)}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-xl border border-[var(--fc-border)] object-cover"
                        onError={(event) => {
                          event.currentTarget.src = SHOP_PLACEHOLDER_IMAGE;
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate font-semibold text-[var(--fc-text)]"><ShopName shop={shop} /></h4>
                          {isSelected ? (
                            <span className="shrink-0 rounded-full bg-[var(--fc-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{uiText("Yours")}</span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-[var(--fc-muted)]">{shop.specialty}</p>
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--fc-muted)]">
                          <IconLocation aria-hidden className="h-3.5 w-3.5 shrink-0" />
                          {shop.location}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---- detail ---- */}
      <div ref={detailRef} className="overflow-hidden rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-sm">
        {!activeShop ? (
          <div className="grid h-full min-h-[320px] place-items-center p-8 text-center">
            <p className="text-sm text-[var(--fc-muted)]">{uiText("Pick a shop from the list to see its storefront.")}</p>
          </div>
        ) : (
          <article>
            <div className="relative h-48 w-full bg-[rgba(198,125,56,0.08)] sm:h-60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shopCoverImage(activeShop)}
                alt={uiText("{0} storefront", { 0: activeShop.name })}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = SHOP_PLACEHOLDER_IMAGE;
                }}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4">
                <div className="flex items-end gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/95 text-base font-extrabold text-[var(--fc-ink-accent)] shadow-md">
                    {shopInitials(activeShop.name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-bold text-white"><ShopName shop={activeShop} /></h3>
                    <p className="truncate text-xs text-white/85">{activeShop.specialty}</p>
                  </div>
                </div>
              </div>
              {viewerUserId && activeShop.ownerUserId === viewerUserId ? (
                <span className="absolute right-3 top-3 rounded-full bg-[var(--fc-verify)] px-3 py-1 text-xs font-bold text-white shadow-md">{uiText("Your shop")}</span>
              ) : activeShop.id === selectedShopId ? (
                <span className="absolute right-3 top-3 rounded-full bg-[var(--fc-accent)] px-3 py-1 text-xs font-bold text-white shadow-md">
                  <span className="inline-flex items-center gap-1.5"><IconCheck aria-hidden className="h-3.5 w-3.5" />{uiText(" Selected shop")}</span>
                </span>
              ) : null}
            </div>

            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                {activeShop.id === selectedShopId ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--fc-accent)] bg-[rgba(198,125,56,0.12)] px-4 py-2 text-sm font-bold text-[var(--fc-accent-2)]">
                    <IconCheck aria-hidden className="h-4 w-4" />{uiText(" Selected shop")}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectShop(activeShop.id)}
                    className="btn btn-primary"
                  >{uiText("Select this shop")}</button>
                )}
                {onViewTemplates ? (
                  <button
                    type="button"
                    onClick={() => onViewTemplates(activeShop.id)}
                    className="btn btn-secondary"
                  >
                    <span className="inline-flex items-center gap-2"><IconTemplates aria-hidden className="h-4 w-4" />{uiText(" Templates")}</span>
                  </button>
                ) : null}
                {onMessageShop ? (
                  <button
                    type="button"
                    onClick={() => onMessageShop(activeShop.id)}
                    className="btn btn-secondary"
                  >
                    <span className="inline-flex items-center gap-2"><IconMessages aria-hidden className="h-4 w-4" />{uiText(" Message")}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    pushStep({ href: "/protected#overview", label: "Browse shops" });
                    router.push(`/shops/${activeShop.id}`);
                  }}
                  className="btn btn-secondary"
                >
                  <span className="inline-flex items-center gap-2"><IconSeller aria-hidden className="h-4 w-4" />{uiText(" Visit")}</span>
                </button>
              </div>

              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--fc-muted)]" aria-label={uiText("Address")}><IconLocation aria-hidden className="h-4 w-4" /></dt>
                  <dd className="text-[var(--fc-text)]">{activeShop.location}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-[var(--fc-muted)]" aria-label={uiText("Status")}>
                    <IconPresence online={Boolean(activeShop.ownerUserId && onlineOwnerIds?.has(activeShop.ownerUserId))} size={14} />
                  </dt>
                  <dd className="text-[var(--fc-text)]">
                    {activeShop.ownerUserId && onlineOwnerIds?.has(activeShop.ownerUserId) ? uiText("Online now") : uiText("Away — messages still reach them")}
                  </dd>
                </div>
                {activeShop.phone ? (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-[var(--fc-muted)]" aria-label={uiText("Phone")}><IconPhone aria-hidden className="h-4 w-4" /></dt>
                    <dd className="text-[var(--fc-text)]">{activeShop.phone}</dd>
                  </div>
                ) : null}
                {activeShop.hours ? (
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-[var(--fc-muted)]" aria-label={uiText("Opening hours")}><IconClock aria-hidden className="h-4 w-4" /></dt>
                    <dd className="text-[var(--fc-text)]">{activeShop.hours}</dd>
                  </div>
                ) : null}
              </dl>

              {activeShop.socialLinks?.length ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-muted)]">{uiText("Find them elsewhere")}</div>
                  <div className="mt-2">
                    <SocialLinkRow links={activeShop.socialLinks} />
                  </div>
                </div>
              ) : null}

              {activeShop.description ? (
                <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[var(--fc-muted)]">
                  <AdaptiveText text={activeShop.description} automatic />
                </p>
              ) : null}

              <section className="mt-5">
                <button
                  type="button"
                  onClick={() => setGalleryOpen((open) => !open)}
                  aria-expanded={galleryOpen}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--fc-border)] px-3 py-2 text-left transition hover:bg-[rgba(178,106,56,0.07)]"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("View gallery")}{activeGallery.length > 0 ? ` (${activeGallery.length})` : ""}
                  </span>
                  <span aria-hidden className={`text-[var(--fc-muted)] transition-transform ${galleryOpen ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>

                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${galleryOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                {loadingGallery && activeGallery.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Loading photos…")}</p>
                ) : activeGallery.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("This shop hasn't added photos yet.")}</p>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {activeGallery.map((photo, index) => (
                      <button
                        key={`${photo.url.slice(-24)}-${index}`}
                        type="button"
                        onClick={() => setLightbox(photo.url)}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-[var(--fc-border)]"
                        aria-label={photo.caption || `Photo ${index + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={photo.caption || ""}
                          loading="lazy"
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                        {photo.caption ? (
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                            <AdaptiveText text={photo.caption} plain />
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}
                  </div>
                </div>
              </section>
            </div>
          </article>
        )}
      </div>

      {lightbox ? <ImageLightbox src={lightbox} alt={uiText("Shop photo")} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}
