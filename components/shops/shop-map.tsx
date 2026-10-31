"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { ClockIcon, ExternalIcon, MapPinIcon } from "@/components/shops/shop-icons";
import {
  googleMapsDirectionsUrl,
  googleMapsEmbedUrl,
  googleMapsSearchUrl,
  isShortMapsLink,
  parseGoogleMapsUrl,
  type MapTarget,
} from "@/lib/google-maps";
import { parsePhAddress, phAddressMapQuery } from "@/lib/ph-address";

export type MapLookup =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "found"; target: MapTarget }
  | { status: "unreadable" };

/**
 * Where a shop's map link points. A full Google Maps URL is read on the spot;
 * a short share link is followed by /api/map-embed first, because only the
 * full URL carries the coordinates.
 */
export function useMapTarget(mapUrl: string | null | undefined): MapLookup {
  const link = (mapUrl ?? "").trim();
  const direct = link ? parseGoogleMapsUrl(link) : null;
  const needsLookup = Boolean(link) && !direct && isShortMapsLink(link);

  const [resolved, setResolved] = useState<{ link: string; target: MapTarget | null } | null>(null);

  useEffect(() => {
    if (!needsLookup) return;
    const controller = new AbortController();
    fetch(`/api/map-embed?url=${encodeURIComponent(link)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { target?: MapTarget } | null;
        setResolved({ link, target: response.ok && body?.target ? body.target : null });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setResolved({ link, target: null });
      });
    return () => controller.abort();
  }, [link, needsLookup]);

  if (!link) return { status: "empty" };
  if (direct) return { status: "found", target: direct };
  if (!needsLookup) return { status: "unreadable" };
  // A result for a link the owner has since edited is not this link's answer.
  if (!resolved || resolved.link !== link) return { status: "loading" };
  return resolved.target ? { status: "found", target: resolved.target } : { status: "unreadable" };
}

export type ShopLocation = {
  /** What to put on the map: the exact pin when there is one, else the address. */
  lookup: MapLookup;
  /** "pin" from the owner's Google Maps link, "address" from the picked address. */
  source: "pin" | "address" | null;
  /** The map link on its own, so the editor can say when it is unusable. */
  link: MapLookup;
};

/**
 * Where the shop is, from the two things the owner can give: the address they
 * picked (province, city, barangay, street, ZIP), which Google Maps looks up,
 * and optionally a Google Maps link to their own place, whose pin is exact and
 * so wins when it is readable.
 *
 * An address typed before the picker existed is not structured, and is not
 * looked up -- a map of "Puerto" is a guess.
 */
export function useShopLocation(address: string | null | undefined, mapUrl: string | null | undefined): ShopLocation {
  const link = useMapTarget(mapUrl);
  if (link.status === "found" || link.status === "loading") {
    return { lookup: link, source: link.status === "found" ? "pin" : null, link };
  }
  const parsed = parsePhAddress(address);
  if (parsed) {
    return { lookup: { status: "found", target: { kind: "query", query: phAddressMapQuery(parsed) } }, source: "address", link };
  }
  return { lookup: link.status === "unreadable" ? link : { status: "empty" }, source: null, link };
}

/** The embedded Google map with a pin on the shop. */
export function ShopMapFrame({
  target,
  title,
  className = "",
}: {
  target: MapTarget;
  title: string;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] ${className}`}
    >
      <iframe
        title={uiText(title)}
        src={googleMapsEmbedUrl(target)}
        className="block h-full w-full border-0"
        loading="lazy"
        allowFullScreen
        // Google's own recommendation for the Embed API: a key restricted to
        // this site's referrer needs the origin sent with the request.
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

/**
 * "Visit the shop" on the storefront: the map with the shop's pin, its address
 * and hours, directions, and a way out to Google Maps.
 *
 * Shown to customers only when there is somewhere to pin -- a picked address or
 * a readable map link. The owner always sees it, with a prompt to fix whatever
 * is missing, because they are the only one who can.
 */
/**
 * The shop's map, small enough to sit inside a chat bubble.
 *
 * Renders nothing at all until the location resolves. A storefront can
 * afford to say "Loading map…" in a reserved 320px box, because the heading
 * above it has already promised a map; a chat answer cannot -- a grey
 * rectangle that may never fill is worse than the sentence on its own, and
 * the sentence already carries the address.
 */
export function ShopMapPreview({
  shopName,
  address,
  mapUrl,
}: {
  shopName: string;
  address: string | null | undefined;
  mapUrl: string | null | undefined;
}) {
  const { t: uiText } = useUiLanguage();
  const { lookup, source } = useShopLocation(address, mapUrl);
  if (lookup.status !== "found") return null;

  // The owner's own pin when there is one -- it opens the actual place, with
  // its name and reviews -- and a search for the coordinates otherwise.
  const link = (mapUrl ?? "").trim();
  const href = source === "pin" && link ? link : googleMapsSearchUrl(lookup.target);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="relative mt-2 block overflow-hidden rounded-2xl transition-transform duration-150 active:scale-[0.99]"
    >
      {/*
        The embed is a map you can pan, which is the wrong thing inside a
        chat: a drag meant for the thread gets eaten by it, and there is no
        room to pan anywhere useful. Pointer events off makes the whole
        frame one target, and the tap leaves for Maps proper, where the
        panning, the directions and the reviews actually are.
      */}
      <ShopMapFrame
        target={lookup.target}
        title={uiText("Map showing {0}", { 0: shopName })}
        className="pointer-events-none h-36 w-full"
      />
      <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fc-text)] shadow-sm">
        {uiText("Open in Maps")}
        <ExternalIcon aria-hidden className="h-3 w-3" />
      </span>
    </a>
  );
}

export function ShopVisitSection({
  shopName,
  address,
  hours,
  mapUrl,
  isOwnShop,
  onEdit,
}: {
  shopName: string;
  address: string | null;
  hours: string | null;
  mapUrl: string | null | undefined;
  isOwnShop: boolean;
  onEdit?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { lookup, source } = useShopLocation(address, mapUrl);
  if (lookup.status !== "found" && lookup.status !== "loading" && !isOwnShop) return null;

  const link = (mapUrl ?? "").trim();
  const openHref =
    source === "pin" ? link : lookup.status === "found" ? googleMapsSearchUrl(lookup.target) : link || null;
  const ownerPrompt =
    lookup.status === "found" || lookup.status === "loading"
      ? null
      : "Choose your province, city and barangay in your shop details so customers can see where you are and get directions.";

  return (
    <section aria-labelledby="shop-visit-title">
      <h2 id="shop-visit-title" className="mb-3 font-display text-xl font-bold">{uiText("Visit the shop")}</h2>

      {lookup.status === "found" ? (
        <ShopMapFrame target={lookup.target} title={uiText("Map showing {0}", { 0: shopName })} className="h-64 sm:h-80" />
      ) : lookup.status === "loading" ? (
        <div className="grid h-64 place-items-center rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] text-sm text-[var(--fc-muted)] sm:h-80">{uiText("Loading map…")}</div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1 text-sm">
          {address ? (
            <p className="flex items-start gap-1.5 font-semibold text-[var(--fc-text)] [overflow-wrap:anywhere]">
              <MapPinIcon size={14} className="mt-0.5 shrink-0" />
              {address}
            </p>
          ) : null}
          {hours ? (
            <p className="flex items-start gap-1.5 text-[var(--fc-muted)]">
              <ClockIcon size={14} className="mt-0.5 shrink-0" />
              {hours}
            </p>
          ) : null}
        </div>

        {openHref ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            {lookup.status === "found" ? (
              <a
                href={googleMapsDirectionsUrl(lookup.target)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary inline-flex items-center justify-center gap-2"
              >{uiText("Get directions")}</a>
            ) : null}
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`btn btn-secondary inline-flex items-center justify-center gap-2${
                lookup.status === "found" ? "" : " col-span-2"
              }`}
            >{uiText("Open in Google Maps")}<ExternalIcon size={13} className="opacity-70" />
            </a>
          </div>
        ) : null}
      </div>

      {isOwnShop && ownerPrompt ? (
        <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">
          {uiText(ownerPrompt)}{" "}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="font-semibold text-[var(--fc-ink-accent)] hover:underline"
            >{uiText("Set your address")}</button>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
