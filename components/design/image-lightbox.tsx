"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useModalA11y } from "@/components/ui/modal";

type Props = {
  src: string;
  alt?: string;
  onClose: () => void;
};

/**
 * A full-bleed image on a dim backdrop, deliberately not a card: the picture
 * is the content, so a panel around it would only make it smaller.
 *
 * It does owe what every dialog owes, though, and had none of it -- no
 * Escape, no scroll lock behind it, and a 36px close button. dvh rather than
 * vh so the image is not cut off behind a phone browser's toolbars.
 */
export default function ImageLightbox({ src, alt, onClose }: Props) {
  const { t: uiText } = useUiLanguage();
  const panelRef = useModalA11y(true, onClose);
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={alt || uiText("Preview")}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 outline-none"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={uiText("Close")}
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition-[background-color,transform] duration-150 hover:bg-white/20 active:scale-[0.94]"
      >
        <span aria-hidden className="text-lg leading-none">&#10005;</span>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt || uiText("Preview")}
        className="max-h-[90dvh] max-w-[90vw] rounded-2xl object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
