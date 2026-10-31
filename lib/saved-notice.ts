/**
 * The success confirmation shown at the top of the screen after a person saves
 * or completes something anywhere in the app -- their profile, the storefront,
 * a quote, an order, a payment.
 *
 * A window event rather than a context, so any screen (or a plain hook with no
 * React tree of its own) can confirm a save with one call and no provider to
 * thread through. components/notifications/saved-toast.tsx, mounted once in the
 * root layout, is what listens.
 *
 * Call it only after the write has actually succeeded: a confirmation for a
 * save that failed is worse than none.
 */

export const SAVED_EVENT = "furnicraft:saved";

export type SavedNoticeDetail = { message: string };

export function notifySaved(message = "Saved"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SavedNoticeDetail>(SAVED_EVENT, { detail: { message } }));
}

/**
 * The same confirmation for anything that is not a save: a quote sent, an
 * order confirmed, a receipt uploaded, a report filed. One pill for every
 * success, so the app answers each finished action the same way.
 */
export const notifySuccess = notifySaved;
