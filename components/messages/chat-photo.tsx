"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";

import { asChatPhoto, chatPhotoUrl } from "@/lib/chat-photos";
import { useModalA11y } from "@/components/ui/modal";
import { IconClose } from "@/components/solihiya/icons";

/**
 * A photo message in a thread.
 *
 * The bucket is private, so the URL has to be minted per view and expires
 * within the hour. That is why this is a component with an effect rather than
 * a plain `<img src>`: the thread cannot hold a URL that is still valid by the
 * time somebody scrolls back to it.
 *
 * Tapping opens the full photo in a lightbox rather than a new tab. A new tab
 * would be a signed URL in the address bar, which is a link that works for
 * anyone it is pasted to until it expires.
 */
export default function ChatPhotoBubble({
  payload,
  isMine,
  time,
}: {
  payload: unknown;
  isMine: boolean;
  time: string;
}) {
  const { t: uiText } = useUiLanguage();
  const photo = asChatPhoto(payload);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // Escape, the body scroll lock and focus handling, the same as every dialog.
  const lightboxRef = useModalA11y(zoomed, () => setZoomed(false));

  useEffect(() => {
    if (!photo?.path) return;
    let cancelled = false;

    void (async () => {
      const signed = await chatPhotoUrl(photo.path);
      if (cancelled) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [photo?.path]);

  if (!photo) {
    return (
      <div className="msgr-bubble msgr-bubble-recv is-tail">{uiText("This photo could not be loaded.")}</div>
    );
  }

  // Reserved from the stored pixel size so the thread does not jump as photos
  // arrive. Falls back to a square when the size was never recorded.
  const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;

  return (
    <>
      <button
        type="button"
        onClick={() => url && setZoomed(true)}
        aria-label={uiText("Photo sent at {0}. Open it larger.", { 0: time })}
        className="block overflow-hidden rounded-2xl border active:scale-[0.99]"
        style={{
          borderColor: "var(--msgr-hairline)",
          background: isMine ? "var(--msgr-sent-bg, rgba(0,0,0,0.05))" : "var(--msgr-recv-bg, rgba(0,0,0,0.05))",
          width: "min(15rem, 60vw)",
          aspectRatio: String(ratio),
        }}
      >
        {url ? (
          /* A signed URL from a private bucket, minted per view. next/image
             would need the storage host allow-listed and would proxy a link
             that expires within the hour. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={uiText("Photo")} className="h-full w-full object-cover" />
        ) : (
          <span
            className="grid h-full w-full place-items-center text-[11px]"
            style={{ color: "var(--msgr-muted)" }}
          >
            {failed ? uiText("Photo unavailable") : uiText("Loading photo…")}
          </span>
        )}
      </button>

      {zoomed && url ? (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={uiText("Photo")}
          onClick={() => setZoomed(false)}
        >
          {/* Tapping the backdrop still closes it, but that is not something a
              reader can see. The button is, and it clears the status bar. */}
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label={uiText("Close photo")}
            className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white transition-transform duration-150 active:scale-[0.94]"
          >
            <IconClose aria-hidden className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={uiText("Photo")} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      ) : null}
    </>
  );
}
