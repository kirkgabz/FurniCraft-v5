"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useRouter } from "next/navigation";
import { canGoBackInApp } from "@/components/ui/history-depth";
import { IconArrowLeft } from "@/components/solihiya/icons";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";

/**
 * A Back control that returns to the page you actually came from.
 *
 * Most of this app's "Back" buttons used to be a fixed destination: the auth
 * screens all pointed at the landing page, the admin console pointed at the
 * dashboard. That is right whenever the guess happens to match and wrong
 * whenever it does not -- signing in from a shop's page returned you to the
 * marketing site rather than to the shop, and the admin console sent you to a
 * dashboard you may never have been on.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the commission path
 *
 * The customer journey -- pick a piece, design it, review the order, open the
 * order -- already has a better answer in `CommissionPath`, which records a
 * labelled trail in sessionStorage and can therefore name where Back goes and
 * survive a reload. That mechanism is worth its weight on a multi-step journey
 * and is not worth it here: signing in is not a step in a commission, and a
 * trail that recorded the sign-in screen would start offering to return
 * customers to it.
 *
 * So this uses the browser's own history, which is exactly "the previous page"
 * and nothing more.
 *
 * ---------------------------------------------------------------------------
 * The fallback, and why it is not optional
 *
 * `history.back()` on the first entry of a tab does nothing at all -- no
 * error, no movement, just a button that appears broken. That is the ordinary
 * case here rather than an edge case: a password-reset link opens in a new
 * tab, a notification opens the console directly, someone bookmarks the shop
 * dashboard. So every caller names where Back should go when there is no
 * behind to go to.
 *
 * "Is there a behind" is answered by `canGoBackInApp`, not by
 * `history.length`. The length test was the first version and it shipped a
 * Back button that navigated to a blank page: a tab that opens a link already
 * holds an entry of its own, so length reads 2 on what is really the first
 * page of the app. See history-depth.tsx.
 */
export default function BackButton({
  fallback,
  label = "Back",
  className = "",
  compactOnMobile = false,
  ariaLabel,
  intercept,
}: {
  /** Where to go when this tab has no previous page. */
  fallback: string;
  label?: string;
  className?: string;
  ariaLabel?: string;
  /**
   * A chance to handle Back without navigating. Return true if it was handled.
   *
   * This exists for the dashboards, where "the previous page" is often not a
   * page at all: settings, orders and messages are sections of one route, so
   * leaving the route entirely is a bigger move than the customer asked for.
   * Back steps out to the overview first, and only leaves once there is
   * nothing left to step back through.
   */
  intercept?: () => boolean;
  /**
   * Below `sm`, show the arrow alone. For a crowded header on a phone -- the
   * dashboards' bar has a menu button, Back, the brand, notifications and
   * Sign out to fit into 375px, and it was the brand that lost. The label stays
   * in the accessibility tree, so the control is still named.
   */
  compactOnMobile?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      onClick={() => {
        if (intercept?.()) return;
        if (canGoBackInApp()) {
          router.back();
          return;
        }
        router.push(fallback);
      }}
      // 44px on touch whatever styling a page passes in -- every screen that
      // uses this hands over its own class, so the default alone reached none.
      className={`${className || BACK_BUTTON_CLASS} [@media(pointer:coarse)]:min-h-11${compactOnMobile ? " max-sm:min-w-11 max-sm:justify-center" : ""}`}
    >
      <IconArrowLeft aria-hidden className="h-4 w-4" />
      <span className={compactOnMobile ? "max-sm:sr-only" : undefined}>{uiText(label)}</span>
    </button>
  );
}

/**
 * The pill the auth screens have always used, kept as the default so those
 * pages look exactly as they did -- only their destination has changed.
 *
 * The transition names its two properties rather than using `all`, per the
 * project's design contract: `all` animates layout properties as well, which
 * on a positioned element means the browser transitions its position on every
 * reflow.
 */
