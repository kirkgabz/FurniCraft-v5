"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconClose } from "@/components/solihiya/icons";

/**
 * The shared shell every dashboard/editor modal in the app should render
 * through, instead of hand-rolling its own backdrop + panel.
 *
 * Before this, one modal (order detail) had role="dialog", aria-modal, and
 * an Escape handler; the other eight -- profile, seller registration,
 * shop-profile, add/edit template, edit shop, storefront editor, template
 * editors -- had none of that, so keyboard and screen-reader users could
 * tab straight past an open modal into the page behind it. This centralizes
 * that behavior once: role/aria-modal, Escape-to-close, focus landing on
 * the panel on open and returning to whatever triggered it on close, and a
 * body scroll lock while open.
 *
 * Deliberately not a full focus trap (Tab still escapes the panel) -- the
 * app's modals are short forms and detail views, not the kind of
 * long-lived, high-stakes dialog a trap earns its complexity for.
 */
/**
 * The Escape-to-close / focus-on-open / body-scroll-lock behavior a modal
 * needs, factored out so it can be attached to a panel that already exists
 * in a page's own JSX (see the dashboards' modals, which keep their own
 * backdrop/panel markup rather than routing through <Modal> below -- their
 * surrounding files are thousands of lines each, and restructuring their
 * JSX to nest under a wrapper component is a needless place to introduce a
 * mismatched edit versus attaching this hook and the three aria attributes
 * to the div that is already there).
 *
 * Returns a ref to put on the panel element (not the backdrop): it receives
 * focus on open, and needs tabIndex={-1} to be focusable programmatically.
 */
/**
 * Open dialogs, oldest first. Escape closes only the last one: a confirm
 * opened over an order used to close the order with it, because every open
 * dialog's document listener heard the same key.
 */
const openDialogs: object[] = [];

export function useModalA11y(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * `onClose` is held in a ref rather than listed as a dependency, and that is
   * the whole fix for a bug that made every modal in the app unusable to type
   * in.
   *
   * Callers pass an inline arrow (`() => setIsSellerModalOpen(false)`), so its
   * identity changes on every render. With it in the dependency array, typing a
   * single character re-rendered the parent, which re-ran this effect: the
   * cleanup returned focus to whatever had it before the modal opened, and the
   * new run called `panelRef.current?.focus()` again. Focus left the input on
   * every keystroke, so a field could not hold more than one character.
   *
   * The ref keeps the Escape handler pointing at the current callback without
   * making the effect depend on its identity.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    // Runs only on the closed -> open transition now, which is the only time
    // moving focus into the dialog is correct.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const token = {};
    openDialogs.push(token);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openDialogs[openDialogs.length - 1] !== token) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return panelRef;
}

export function Modal({
  open,
  onClose,
  children,
  ariaLabel,
  title,
  eyebrow,
  footer,
  className = "sm:max-w-md",
  bodyClassName,
  dismissOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel: string;
  /**
   * Rendered in a header that stays put while the body scrolls, with the
   * close button beside it.
   *
   * Optional only so the dialogs that still draw their own heading inside
   * `children` keep working. Pass it: a dialog whose only close control is
   * the first thing to scroll away is one a phone cannot leave, which is what
   * the order detail did for 3011px of content.
   */
  title?: React.ReactNode;
  /** Small label above the title, e.g. "Order detail". */
  eyebrow?: React.ReactNode;
  /** Actions pinned below the body, clear of the home indicator. */
  footer?: React.ReactNode;
  /**
   * Width, as a Tailwind class. The default caps the panel at `md` from sm up;
   * below sm the panel is the screen, so a width here does nothing there.
   */
  className?: string;
  /** Extra classes for the scrolling body, e.g. to remove its padding. */
  bodyClassName?: string;
  /**
   * Whether clicking the scrim closes the dialog. True for every ordinary
   * modal, and the reason it is a switch at all is the terms-and-conditions
   * dialog: a click just outside a panel is the easiest accidental gesture
   * there is, and there it would skip a document the customer is about to say
   * they have read. Escape is deliberately NOT covered by this -- see the
   * keydown handler above, which stays live whatever this is set to, because a
   * dialog a keyboard user cannot leave is a trap rather than a policy.
   */
  dismissOnBackdrop?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const panelRef = useModalA11y(open, onClose);

  /**
   * Rendered into <body> rather than where it was written.
   *
   * `position: fixed` is only relative to the viewport while no ancestor has
   * established a containing block, and `filter`, `backdrop-filter`, `transform`,
   * `perspective`, `contain` and `will-change` all establish one. The dashboard
   * header carries `backdrop-filter: blur(8px)`, so a modal opened from the
   * sign-out button in that header had its `inset-0` resolve against the header's
   * own box: the dialog rendered clipped to a strip across the top of the page.
   *
   * Portalling to <body> puts every modal outside whichever ancestor its trigger
   * happened to live in, so this cannot come back the next time someone adds a
   * blur or a transform somewhere above a button.
   *
   * Mounted state gates it because document does not exist during the server
   * render; the modal is client-only anyway, since it opens on interaction.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fc-modal-scrim"
      onClick={(event) => {
        // Only a click on the backdrop itself closes it, and only where the
        // caller allows the backdrop to dismiss at all.
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn("fc-modal-panel", className)}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? (
          <header className="fc-modal-head">
            <div className="min-w-0">
              {eyebrow ? <p className="fc-modal-eyebrow">{eyebrow}</p> : null}
              <h2 className="fc-modal-title">{title}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={uiText("Close")} className="fc-modal-close">
              <IconClose aria-hidden className="h-4 w-4" />
            </button>
          </header>
        ) : null}
        {/* The padding is utilities rather than CSS so twMerge can drop it when a
            caller passes its own -- several dialogs pad their children themselves. */}
        <div className={cn("fc-modal-body", "p-4 sm:p-6", bodyClassName)}>{children}</div>
        {footer ? <div className="fc-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
