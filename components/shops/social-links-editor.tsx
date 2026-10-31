"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_SOCIAL_LINKS,
  MAX_LINK_LABEL,
  normaliseLinkInput,
  parseSocialLinks,
  suggestLabel,
  type SocialLink,
} from "@/components/shops/social-links";
import SocialIcon from "@/components/shops/social-icons";
import { notifySaved } from "@/lib/saved-notice";

/**
 * Where a shop owner manages the places customers can find them off FurniCraft.
 *
 * Kept apart from the storefront editor, which is a modal: links are a list you
 * add to over time and reorder, and that is awkward work to do inside a dialog
 * stacked on the dashboard. This lives as its own section with room to breathe,
 * and shows the row exactly as the customer will see it.
 *
 * Saving writes the whole array. guard_shop_social_links validates every entry
 * server-side and will reject a scheme other than http/https regardless of what
 * this component permits -- the checks here exist to give a useful message, not
 * to be the rule.
 */
export default function SocialLinksEditor({ shopId }: { shopId: string }) {
  const { t: uiText } = useUiLanguage();
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [labelDraft, setLabelDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("shops")
        .select("social_links")
        .eq("id", shopId)
        .maybeSingle();

      if (cancelled) return;
      if (loadError) {
        setError("Could not load your links.");
        setIsLoading(false);
        return;
      }
      setLinks(parseSocialLinks((data as { social_links?: unknown } | null)?.social_links));
      setIsLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  /** Every change writes immediately: a list with a separate Save button is a
   *  list people edit and then navigate away from. */
  const persist = useCallback(
    async (next: SocialLink[]) => {
      setBusy(true);
      setError(null);
      setSaved(false);

      const supabase = createClient();
      const { error: saveError } = await supabase
        .from("shops")
        .update({ social_links: next })
        .eq("id", shopId);

      setBusy(false);

      if (saveError) {
        // The trigger's message is written for a person, so it is worth showing.
        setError(saveError.message);
        return false;
      }

      setLinks(next);
      setSaved(true);
      notifySaved("Links saved");
      window.setTimeout(() => setSaved(false), 2500);
      return true;
    },
    [shopId]
  );

  const add = async () => {
    if (links.length >= MAX_SOCIAL_LINKS) {
      setError(`You can list up to ${MAX_SOCIAL_LINKS} links.`);
      return;
    }

    const result = normaliseLinkInput(urlDraft, labelDraft);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    if (links.some((link) => link.url === result.link.url)) {
      setError("That link is already on the list.");
      return;
    }

    if (await persist([...links, result.link])) {
      setUrlDraft("");
      setLabelDraft("");
    }
  };

  const remove = (index: number) => persist(links.filter((_, i) => i !== index));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    [next[index], next[target]] = [next[target], next[index]];
    return persist(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Add a link")}</h3>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Your Facebook page, Instagram, TikTok, Shopee listing, or your own website. Customers see these on your storefront and open them in a new tab.")}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Address")}</span>
            <input
              value={urlDraft}
              onChange={(event) => {
                setUrlDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
              placeholder={uiText("facebook.com/your-shop")}
              className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Name (optional)")}</span>
            <input
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value.slice(0, MAX_LINK_LABEL))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void add();
                }
              }}
              placeholder={urlDraft.trim() ? suggestLabel(urlDraft.trim()) : uiText("Facebook")}
              className="mt-1 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={add}
            disabled={busy || !urlDraft.trim()}
            className="btn btn-primary self-end"
          >
            {busy ? uiText("Saving…") : uiText("Add link")}
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-xl border border-[#c0392b] bg-[rgba(192,57,43,0.08)] px-3 py-2 text-sm text-[#c0392b]">
            {error}
          </p>
        ) : null}
        {saved && !error ? (
          <p className="mt-3 text-sm font-semibold text-emerald-700">{uiText("Saved.")}</p>
        ) : null}
      </div>

      <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Your links")}</h3>
          <span className="text-xs text-[var(--fc-muted)]">
            {links.length}{uiText(" of ")}{MAX_SOCIAL_LINKS}
          </span>
        </div>

        {isLoading ? (
          <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>
        ) : links.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">{uiText("No links yet. If your shop already has a Facebook page with your back catalogue, that is usually the first one worth adding.")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {links.map((link, index) => (
              <li
                key={link.url}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.04)] p-3"
              >
                <SocialIcon url={link.url} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[var(--fc-text)]">{link.label}</span>
                  <span className="block truncate text-xs text-[var(--fc-muted)]">{link.url}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={busy || index === 0}
                    aria-label={uiText("Move {0} up", { 0: link.label })}
                    className="grid h-8 w-8 place-items-center rounded-full border border-[var(--fc-border)] text-sm transition hover:bg-[rgba(178,106,56,0.1)] disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={busy || index === links.length - 1}
                    aria-label={uiText("Move {0} down", { 0: link.label })}
                    className="grid h-8 w-8 place-items-center rounded-full border border-[var(--fc-border)] text-sm transition hover:bg-[rgba(178,106,56,0.1)] disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={busy}
                    className="ml-1 text-xs font-semibold text-[#c0392b] hover:underline disabled:opacity-40"
                  >{uiText("Remove")}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {links.length > 0 ? (
        <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
          <span className="section-eyebrow">{uiText("👤 Customer preview")}</span>
          <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("This is the row on your storefront.")}</p>
          <div className="mt-3">
            <SocialLinkRow links={links} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The customer-facing row, exported so the storefront renders exactly what the
 * owner was shown in the preview above.
 *
 * rel="noopener noreferrer" is not optional here: without noopener the opened
 * page gets a handle on this one through window.opener, and these are addresses
 * a shop owner typed.
 */
export function SocialLinkRow({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] px-3 py-1.5 [@media(pointer:coarse)]:min-h-11 text-sm font-semibold text-[var(--fc-text)] transition hover:border-[#8b5a2b] hover:bg-[rgba(178,106,56,0.12)]"
          >
            <SocialIcon url={link.url} />
            {link.label}
            <span aria-hidden className="text-[var(--fc-muted)]">
              ↗
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
