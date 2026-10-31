// Read on every request, the same convention /t and /shops use: an offer
// that has just been claimed or revoked must stop opening at once.
export const instant = false;

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSharedOffer } from "@/lib/shops/shared-offer";
import SharedOfferView from "@/components/shops/shared-offer-view";
import { UiText } from "@/components/language/ui-text";

/**
 * An order a shop wrote, opened from the link it shared.
 *
 * Public: the proxy lets /o/ through without a session, so the link works
 * pasted into a message, written on a receipt, or sent to somebody who has
 * never heard of FurniCraft. Seeing the piece and its price needs no account;
 * taking the order does, and the page asks only at that point.
 *
 * The offer is read on the server with the secret key (see loadSharedOffer
 * for the rules it applies), so order_offers stays closed to the browser.
 */

const load = cache(loadSharedOffer);

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const result = await load(token);
  if (result.kind !== "found") return { title: "Order | FurniCraft" };
  const { offer } = result;
  const title = `${offer.projectName} from ${offer.shop.name} | FurniCraft`;
  const description = `₱${offer.quotedTotal.toLocaleString("en-US")} — open it in 3D and order it from ${offer.shop.name}.`;
  // A link preview needs an address it can fetch; a stored data: URL is not one.
  const image = offer.previewUrl?.startsWith("http") ? offer.previewUrl : null;
  return {
    title,
    description,
    openGraph: { title, description, ...(image ? { images: [image] } : {}) },
    // An offer is for one person, and the link is the only thing protecting
    // it. Keeping it out of search results is the least this can do.
    robots: { index: false, follow: false },
  };
}

export default async function SharedOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await load(token);

  if (result.kind === "unconfigured") {
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--fc-bg)] px-4 text-center text-[var(--fc-text)]">
        <p className="max-w-sm text-sm text-[var(--fc-muted)]">
          <UiText text="This link can't be opened right now. Please try again shortly." />
        </p>
      </main>
    );
  }

  // Missing, already taken, expired, or a shop customers can no longer see --
  // all one answer, so a link cannot be used to find out which.
  if (result.kind !== "found") notFound();

  return <SharedOfferView offer={result.offer} />;
}
