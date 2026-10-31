"use client";

import { shopInitials } from "@/components/shops/shop-types";

/**
 * Four tints from the palette, so shops without a logo are still told apart
 * at a glance instead of all being the same brown square. Picked from the
 * name, so a shop keeps its colour everywhere it appears. Tinted rather than
 * filled, which keeps the initials readable in light and dark themes.
 */
const PLACEHOLDER_TONES = ["var(--fc-ink-accent)", "var(--fc-verify)", "var(--fc-online)", "var(--fc-accent-2)"];

function toneFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PLACEHOLDER_TONES[hash % PLACEHOLDER_TONES.length];
}

/**
 * A shop's logo, or its initials in its place.
 *
 * One component for every surface a shop appears on: its own page, the Shops
 * list, the chat list and header, the cart's furniture shop picker. Before logos
 * existed those surfaces each improvised one from the cover photo, which
 * crops to an arbitrary square at 40px. `size` is in px; the corner radius
 * scales with it so a large logo and a small one read as the same shape.
 */
export function ShopLogo({
  name,
  logoUrl,
  size = 44,
  className = "",
  ring = false,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
  /** A panel-coloured ring, for a logo set over a photo. */
  ring?: boolean;
}) {
  const style = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.26),
    ...(ring ? { boxShadow: "0 0 0 3px var(--fc-panel)" } : null),
  } as const;

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        loading="lazy"
        style={style}
        className={`shrink-0 border border-[var(--fc-border)] bg-white object-cover ${className}`}
      />
    );
  }

  const tone = toneFor(name || "?");
  return (
    <span
      aria-hidden
      style={{
        ...style,
        color: tone,
        background: `color-mix(in srgb, ${tone} 16%, var(--fc-panel))`,
        border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
        fontSize: Math.max(11, Math.round(size * 0.36)),
        fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif",
      }}
      className={`grid shrink-0 place-items-center font-bold leading-none tracking-[-0.02em] ${className}`}
    >
      {shopInitials(name)}
    </span>
  );
}
