/**
 * The links a shop points customers at: Facebook, Instagram, TikTok, a website.
 *
 * Stored as an array of {label, url} on shops rather than a
 * column per network, because a fixed set of columns is a guess about which
 * platforms matter and it goes stale -- Viber and Shopee are as likely here as
 * Instagram. The label carries the name; the icon is worked out from the host.
 *
 * Everything in this file is a convenience. The rule that actually holds is
 * guard_shop_social_links in supabase/migrations/20260826001100, which rejects
 * any scheme other than http/https before the row is written -- these become
 * anchors on a page other people load, so `javascript:` in an href would be
 * script execution on the viewer's session.
 */

import { brandLabel } from "@/components/shops/social-icons";

export type SocialLink = {
  label: string;
  url: string;
};

export const MAX_SOCIAL_LINKS = 8;
export const MAX_LINK_LABEL = 60;
export const MAX_LINK_URL = 500;

/** Host of a URL, or null when it will not parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * A name for a link the owner did not name: the platform if recognised, the
 * bare host otherwise. Better than showing a raw URL in a button.
 *
 * The platform table lives with the icons, so adding a network is one edit
 * rather than two that have to agree.
 */
export function suggestLabel(url: string): string {
  const known = brandLabel(url);
  if (known) return known;
  const host = hostOf(url);
  if (!host) return "Link";
  return host.replace(/^www./i, "");
}

/**
 * Accepts what the database will accept, and nothing else.
 *
 * Anchored and case-insensitive so neither "JavaScript:" nor a leading space
 * gets through, which is the same expression the trigger uses.
 */
export function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_LINK_URL) return false;
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return false;
  const host = hostOf(trimmed);
  // A URL with no host ("http://") parses in some engines and is not a link.
  return Boolean(host);
}

/**
 * Normalises the jsonb column, which is written by the editor but read straight
 * from the database, so it has to tolerate anything -- including rows written
 * before the guard trigger existed.
 */
export function parseSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  const links: SocialLink[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const url = (entry as { url?: unknown }).url;
    if (typeof url !== "string" || !isSafeLinkUrl(url)) continue;
    const rawLabel = (entry as { label?: unknown }).label;
    const label =
      typeof rawLabel === "string" && rawLabel.trim()
        ? rawLabel.trim().slice(0, MAX_LINK_LABEL)
        : suggestLabel(url);
    links.push({ label, url: url.trim() });
    if (links.length >= MAX_SOCIAL_LINKS) break;
  }
  return links;
}

/**
 * Turns what someone typed into something storable, or explains why it is not.
 * "facebook.com/shop" gets an https:// rather than a rejection -- nobody types
 * the scheme, and refusing over it is pedantry the customer pays for.
 */
export function normaliseLinkInput(rawUrl: string, rawLabel: string): { link: SocialLink } | { error: string } {
  let url = rawUrl.trim();
  if (!url) return { error: "Paste the address of your page." };

  // Only add a scheme when none was given; a bad one must still be rejected
  // rather than quietly prefixed into something that looks safe.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;

  if (!isSafeLinkUrl(url)) {
    return { error: "That needs to be a web address starting with http:// or https://" };
  }

  const label = rawLabel.trim().slice(0, MAX_LINK_LABEL) || suggestLabel(url);
  return { link: { label, url } };
}
