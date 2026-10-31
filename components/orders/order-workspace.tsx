"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { AdaptiveText } from "@/components/language/adaptive-text";


import { useMemo, useState } from "react";
import ImageLightbox from "@/components/design/image-lightbox";
import OrderDesignPreview from "@/components/design/order-design-preview";
import { Stars } from "@/components/reviews/stars";
import { formatPeso } from "@/components/orders/order-status";
import { QuoteBreakdownList } from "@/components/orders/quote-breakdown";
import type { QuoteLine } from "@/components/orders/quote-lines";
import { ShopLogo } from "@/components/shops/shop-logo";
import { shopInitials } from "@/components/shops/shop-types";
import { canOpenInDesigner, resolveDesignItems } from "@/components/design/design-state-utils";
import { generateStudioBlueprintSvg } from "@/components/design/studio/studio-blueprint-svg";
import { BlueprintViewer } from "@/components/design/blueprint-viewer";
import { Modal } from "@/components/ui/modal";
import type { StudioDesignItem } from "@/components/design/studio/studio-design-state";
import LengthUnitPicker, { usePreferredLengthUnit } from "@/components/design/length-unit-picker";
import { IconCheck, IconCopy } from "@/components/solihiya/icons";

/**
 * The parts of an order's detail view that are the same wherever it is opened.
 *
 * An order is reachable from three places -- its own page, the customer's
 * dashboard modal and the shop's -- and each one owns its own mutations,
 * because each already has its own client, its own refresh and its own idea of
 * what happens after a write. What they must *not* each own is the reading half:
 * three hand-maintained copies of a spec table and a notes gallery is how the
 * three drift into disagreeing about the same order.
 *
 * So the seam is drawn at presentation. Everything here takes data and
 * callbacks and performs no writes; the actions stay with the surface that
 * knows how to apply them.
 */

export type ReferenceImage = { name?: string; dataUrl?: string; url?: string };

/** Reference images are stored loosely -- a url, a data url, or neither. */
function imageSrc(image: ReferenceImage): string | null {
  return image.dataUrl || image.url || null;
}

/**
 * The left column: what was designed, what it measures, and whatever the
 * customer said about it.
 */
export function OrderDesignColumn({
  previewUrl,
  cadState,
  notes,
  referenceImages,
  onOpenStudio,
}: {
  previewUrl?: string | null;
  cadState?: unknown;
  notes?: string | null;
  referenceImages?: ReferenceImage[] | null;
  onOpenStudio?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  // The reader's unit, shared with the preview above it; display only.
  const [unit, setUnit] = usePreferredLengthUnit();
  const images = (referenceImages ?? []).filter((image) => imageSrc(image));

  // Derived from the same cadState the preview reads, through the same pure
  // functions, so the enlarged drawing is the one shown in the panel.
  // One drawing per piece, not one drawing for the order. A furniture shop asked to
  // build a chair and a stool needs both sheets; printing only the chair's is
  // the failure this whole change exists to prevent.
  const items = useMemo(() => resolveDesignItems(cadState), [cadState]);
  const blueprints = useMemo(
    () =>
      items
        .map((entry, index) => ({
          index,
          name: entry.name ?? `Piece ${index + 1}`,
          svg: canOpenInDesigner(entry)
            ? generateStudioBlueprintSvg(entry as unknown as StudioDesignItem, { unit })
            : "",
        }))
        // Legacy parametric designs have no measured boxes and produce nothing
        // drawable; they are skipped rather than shown as an empty sheet.
        .filter((entry) => entry.svg),
    [items, unit]
  );
  const hasBlueprint = blueprints.length > 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">{uiText("Design snapshot")}</h2>
          <div className="flex flex-wrap gap-2">
            {onOpenStudio ? (
              <button type="button" onClick={onOpenStudio} className="btn btn-secondary btn-sm">{uiText("Inspect in 3D")}</button>
            ) : null}
            {hasBlueprint ? (
              <button
                type="button"
                onClick={() => setBlueprintOpen(true)}
                className="btn btn-secondary btn-sm"
              >
                {blueprints.length > 1 ? uiText("View blueprints ({0})", { 0: blueprints.length }) : uiText("View blueprint")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="mt-4">
          <OrderDesignPreview previewUrl={previewUrl} cadState={cadState} />
        </div>
      </section>

      {notes || images.length ? (
        <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 sm:p-5">
          <h2 className="font-display text-lg font-bold">{uiText("Notes from the customer")}</h2>
          {notes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--fc-text)]"><AdaptiveText text={notes} /></p>
          ) : (
            <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("No notes were written for this order.")}</p>
          )}

          {images.length ? (
            <>
              <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Reference images · ")}{images.length}
              </p>
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((image, index) => {
                  const src = imageSrc(image) as string;
                  return (
                    <li key={src.slice(0, 48) + index}>
                      <button
                        type="button"
                        onClick={() => setLightbox({ src, alt: image.name || uiText("Reference image") })}
                        className="group block aspect-square w-full overflow-hidden rounded-xl border border-[var(--fc-border)] bg-[rgba(0,0,0,0.04)]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={image.name || ""}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {lightbox ? (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}

      {/* One viewer per drawing, each fitting the pane on open and zooming on
          its own: at 375px the sheet is nearly three times the width of the
          screen, so "fits the width" and "readable" are not the same thing. */}
      <Modal
        open={blueprintOpen}
        onClose={() => setBlueprintOpen(false)}
        ariaLabel={uiText("Dimensioned drawing")}
        eyebrow={blueprints.length > 1 ? uiText("{0} drawings", { 0: blueprints.length }) : uiText("Dimensioned drawing")}
        title={blueprints.length > 1 ? uiText("Shop drawings") : uiText("Shop drawing")}
        className="sm:max-w-4xl"
        bodyClassName="flex min-h-0 flex-col p-0 sm:p-0"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-[var(--fc-border)] px-3 py-2">
          <LengthUnitPicker value={unit} onChange={setUnit} tone="sheet" />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-grid min-h-11 place-items-center rounded-full border border-[var(--fc-border)] px-4 text-xs font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[var(--fc-cane-soft)] active:scale-[0.97]"
          >{uiText("Print")}</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {blueprints.map((entry) => (
            <figure key={entry.index} className="m-0 flex min-h-0 flex-1 flex-col">
              {blueprints.length > 1 ? (
                <figcaption className="px-3 pt-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
                  {entry.name}
                </figcaption>
              ) : null}
              <BlueprintViewer svg={entry.svg} label={entry.name} />
            </figure>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** The money, wherever a quote exists. Figures only -- the actions sit under it. */
export function QuoteFigures({
  total,
  percent,
  due,
  lines = [],
}: {
  total: number | null;
  percent: number | null;
  due: number | null;
  /** The shop's breakdown, when it sent one (design_orders.quote_lines). */
  lines?: QuoteLine[];
}) {
  const { t: uiText } = useUiLanguage();
  if (total == null) {
    return (
      <p className="text-sm text-[var(--fc-muted)]">{uiText("No price yet. The shop sends a quote once they have looked at the design.")}</p>
    );
  }

  return (
    <>
    <QuoteBreakdownList lines={lines} className="mb-3 border-b border-[var(--fc-border)] pb-3" />
    <dl className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-[var(--fc-muted)]">{uiText("Total price")}</dt>
        <dd className="font-display text-xl font-bold">{formatPeso(total)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-[var(--fc-muted)]">{uiText("Downpayment")}</dt>
        <dd className="text-sm font-bold">{percent ?? 0}%</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-[var(--fc-border)] pt-2.5">
        <dt className="text-sm font-semibold">{uiText("Due now")}</dt>
        <dd className="font-display text-xl font-bold text-[var(--fc-ink-accent)]">{formatPeso(due)}</dd>
      </div>
    </dl>
    </>
  );
}

/** A panel in the right rail. Titled, so the column reads as a list of answers. */
export function SideCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <section className={`rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 ${className}`}>
      <h2 className="font-display text-base font-bold">{uiText(title)}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Who is on the other side of the order, and the way to reach them.
 *
 * Used for the shop on a customer's screen and for the customer on a shop's,
 * which is why the label is a prop rather than the word "Shop".
 */
export function OrderPartyCard({
  name,
  subtitle,
  averageRating,
  reviewCount,
  onMessage,
  messageLabel = "Message shop",
  logoUrl,
}: {
  name: string;
  /**
   * Set (even to null) when the party is a shop: its logo, or ShopLogo's
   * initials badge. Left out for a customer, who keeps the plain initials.
   */
  logoUrl?: string | null;
  subtitle?: string | null;
  averageRating?: number | null;
  reviewCount?: number;
  onMessage?: () => void;
  messageLabel?: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div>
      <div className="flex items-center gap-3">
        {logoUrl !== undefined ? (
          <ShopLogo name={name} logoUrl={logoUrl} size={44} />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.1)] text-sm font-bold text-[var(--fc-ink-accent)]">
            {shopInitials(name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--fc-text)]">{name}</p>
          {reviewCount ? (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--fc-muted)]">
              <Stars value={averageRating ?? 0} />
              {(averageRating ?? 0).toFixed(1)} · {reviewCount}{uiText(reviewCount === 1 ? " review" : " reviews")}
            </span>
          ) : subtitle ? (
            <p className="truncate text-xs text-[var(--fc-muted)]">{uiText(subtitle)}</p>
          ) : null}
        </div>
      </div>
      {onMessage ? (
        <button type="button" onClick={onMessage} className="btn btn-secondary btn-block mt-3">
          {uiText(messageLabel)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One labelled value with its Copy button on the right: an account number, an
 * account name, a payment reference. The value wraps instead of being cut off
 * -- a truncated number is worse than none, because it gets copied by hand.
 */
export function CopyField({
  label,
  value,
  mono = false,
  accent = false,
  className = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 ${className}`}>
      <div className="min-w-0 flex-1">
        <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText(label)}</span>
        <span
          className={`block break-all text-sm ${mono ? "font-mono font-bold tracking-wider" : "font-semibold"} ${
            accent ? "text-[var(--fc-ink-accent)]" : "text-[var(--fc-text)]"
          }`}
        >
          {value}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={uiText("Copy {0}", { 0: uiText(label) })}
        className="inline-flex shrink-0 items-center gap-1.5 self-center rounded-lg border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.1)] active:scale-95 [@media(pointer:coarse)]:min-h-11"
      >
        {copied ? (
          <>
            <IconCheck size={12} className="text-emerald-500" />
            <span className="font-bold text-emerald-600">{uiText("Copied")}</span>
          </>
        ) : (
          <>
            <IconCopy size={12} />
            <span>{uiText("Copy")}</span>
          </>
        )}
      </button>
    </div>
  );
}

export type ShopPaymentInfo = {
  payment_instructions?: string | null;
  payment_account_name?: string | null;
  payment_account_number?: string | null;
  payment_qr_url?: string | null;
};

/**
 * Displays the shop owner's exact payment methods (GCash / QR / Account details)
 * with 1-click clipboard copying and click-to-zoom for the QR code.
 */
export function ShopPaymentDetailsCard({
  payment,
  qrUrl,
  title = "Shop Payment Options",
  subtitle = "Pay directly via GCash, Bank Transfer, or QR Ph",
  className = "",
}: {
  payment: ShopPaymentInfo | null;
  qrUrl?: string | null;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const hasDetails = Boolean(
    qrUrl ||
      payment?.payment_account_name ||
      payment?.payment_account_number ||
      payment?.payment_instructions
  );

  return (
    <div
      className={`rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fc-border)] pb-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">
            {uiText(title)}
          </span>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText(subtitle)}</p>
          ) : null}
        </div>
      </div>

      {!hasDetails ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--fc-border)] p-4 text-center">
          <p className="text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("This shop has not added payment details yet. Message them to arrange payment.")}</p>
        </div>
      ) : (
        <div className="mt-3.5 space-y-3.5">
          <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start">
            {qrUrl ? (
              <div className="group relative shrink-0">
                <div
                  onClick={() => setLightbox(qrUrl)}
                  className="relative mx-auto h-36 w-36 cursor-pointer overflow-hidden rounded-xl border border-[var(--fc-border)] bg-white p-1.5 shadow-sm transition duration-200 hover:border-[var(--fc-ink-accent)] hover:shadow-md sm:mx-0"
                  title={uiText("Click to zoom QR Code")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrUrl}
                    alt={uiText("Shop payment QR code")}
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-[11px] font-semibold text-white opacity-0 backdrop-blur-[1px] transition-opacity duration-150 group-hover:opacity-100">
                    <span>{uiText("🔍 Tap to zoom")}</span>
                  </div>
                </div>
                <p className="mt-1 text-center text-[10px] font-medium text-[var(--fc-muted)]">{uiText("Scan QR Ph / GCash")}</p>
              </div>
            ) : null}

            <div className="min-w-0 flex-1 space-y-2.5">
              {payment?.payment_account_name ? (
                <CopyField label="Account Name" value={payment.payment_account_name} />
              ) : null}

              {payment?.payment_account_number ? (
                <CopyField label="Account / GCash Number" value={payment.payment_account_number} mono accent />
              ) : null}
            </div>
          </div>

          {payment?.payment_instructions ? (
            <div className="rounded-xl border border-[rgba(178,106,56,0.2)] bg-[rgba(178,106,56,0.06)] p-3">
              <span className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--fc-ink-accent)]">{uiText("Payment Instructions")}</span>
              <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--fc-text)]">
                {payment.payment_instructions}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {lightbox ? (
        <ImageLightbox
          src={lightbox}
          alt={uiText("Shop payment QR code")}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}
