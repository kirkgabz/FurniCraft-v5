/**
 * Brand marks for the places a shop links out to.
 *
 * These replace the emoji that stood in for them. An emoji is a category —
 * 📘 is "a blue book", not Facebook — and on Windows several of them rendered
 * as something else entirely. A recognisable mark in the platform's own colour
 * is the whole point of the row: it is scanned, not read.
 *
 * Every glyph here is drawn from primitives (circles, rounded rectangles,
 * strokes) or a single well-known outline, on a 24x24 grid, so they stay sharp
 * at any size and carry no external asset. Platforms without a faithful mark
 * fall back to a lettermark in the brand colour rather than a wrong shape:
 * a bad approximation of a logo is worse than an honest initial.
 *
 * Using a platform's mark to link to that platform is ordinary nominative use;
 * they are not FurniCraft's marks and are not presented as such.
 */

type Brand = {
  /** Matches the URL's host. */
  match: RegExp;
  label: string;
  color: string;
  /** Inner SVG for the 24x24 viewBox, drawn in white on the brand colour. */
  glyph: React.ReactNode;
};

/** A letter in the middle of the badge, for marks we cannot draw faithfully. */
function Letter({ children }: { children: string }) {
  return (
    <text
      x="12"
      y="12"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="13"
      fontWeight="700"
      fontFamily="system-ui, sans-serif"
      fill="currentColor"
    >
      {children}
    </text>
  );
}

const BRANDS: Brand[] = [
  {
    match: /(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)m\.me$/i,
    label: "Facebook",
    color: "#1877F2",
    // The "f": a stem with a crossbar, which is the recognisable part.
    glyph: (
      <path
        d="M15.4 8.4h-1.9c-.5 0-.8.3-.8.8v1.6h2.6l-.4 2.7h-2.2V20h-2.8v-6.5H8.2v-2.7h1.7V9c0-1.9 1.2-3 3-3h2.5v2.4z"
        fill="currentColor"
      />
    ),
  },
  {
    match: /(^|\.)instagram\.com$/i,
    label: "Instagram",
    color: "#E4405F",
    // Rounded square, lens, flash — constructed, so it is exact.
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="5" width="14" height="14" rx="4.2" />
        <circle cx="12" cy="12" r="3.4" />
        <circle cx="16.2" cy="7.8" r="1" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  {
    match: /(^|\.)tiktok\.com$/i,
    label: "TikTok",
    color: "#010101",
    // A quaver: note head plus a flagged stem.
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="10" cy="16" r="2.8" fill="currentColor" stroke="none" />
        <path d="M12.8 16V6.5c1 1.9 2.5 2.9 4.4 3" />
      </g>
    ),
  },
  {
    match: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i,
    label: "YouTube",
    color: "#FF0000",
    glyph: (
      <g>
        <rect x="4" y="7" width="16" height="10" rx="3" fill="currentColor" />
        <path d="M10.6 9.9v4.2L14.4 12z" fill="#FF0000" />
      </g>
    ),
  },
  {
    match: /(^|\.)x\.com$|(^|\.)twitter\.com$/i,
    label: "X",
    color: "#000000",
    glyph: (
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
      </g>
    ),
  },
  {
    match: /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i,
    label: "WhatsApp",
    color: "#25D366",
    // Speech bubble with a tail, plus a handset suggestion.
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 11.6c0 3.6-3.1 6.5-7 6.5-1.1 0-2.2-.24-3.1-.66L5 18.5l1.1-3.2A6.2 6.2 0 0 1 5 11.6C5 8 8.1 5.1 12 5.1s7 2.9 7 6.5z" />
        <path d="M9.8 9.6c.3 1.9 1.9 3.4 3.8 3.7" />
      </g>
    ),
  },
  { match: /(^|\.)pinterest\.com$/i, label: "Pinterest", color: "#BD081C", glyph: <Letter>P</Letter> },
  { match: /(^|\.)shopee\.ph$|(^|\.)shopee\.com$/i, label: "Shopee", color: "#EE4D2D", glyph: <Letter>S</Letter> },
  { match: /(^|\.)lazada\.com\.ph$|(^|\.)lazada\.com$/i, label: "Lazada", color: "#0F146D", glyph: <Letter>L</Letter> },
  { match: /(^|\.)viber\.com$/i, label: "Viber", color: "#7360F2", glyph: <Letter>V</Letter> },
];

/** The generic mark: a globe, for a shop's own website or anything unknown. */
const GENERIC = {
  label: "Website",
  color: "#8b5a2b",
  glyph: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="7" />
      <ellipse cx="12" cy="12" rx="3" ry="7" />
      <path d="M5.3 9.8h13.4M5.3 14.2h13.4" strokeLinecap="round" />
    </g>
  ),
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function brandFor(url: string) {
  const host = hostOf(url);
  if (!host) return GENERIC;
  return BRANDS.find((brand) => brand.match.test(host)) ?? GENERIC;
}

/** The platform's own name for a link, when we recognise it. */
export function brandLabel(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return BRANDS.find((brand) => brand.match.test(host))?.label ?? null;
}

/**
 * A brand badge for one link.
 *
 * The colour is on the badge and the glyph is drawn in `currentColor` set to
 * white, so a mark stays legible whichever theme the page is in — brand colours
 * are chosen against white, not against a dark panel.
 */
export default function SocialIcon({ url, size = 20 }: { url: string; size?: number }) {
  const brand = brandFor(url);

  return (
    <span
      aria-hidden
      style={{ background: brand.color, width: size, height: size }}
      className="inline-grid shrink-0 place-items-center rounded-[28%] text-white"
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.82}
        height={size * 0.82}
        role="presentation"
        focusable="false"
      >
        {brand.glyph}
      </svg>
    </span>
  );
}
