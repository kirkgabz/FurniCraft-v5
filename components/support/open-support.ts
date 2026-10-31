/**
 * Taking someone straight to the Support chat -- from a "FurniCraft support
 * replied" notification.
 *
 * The notification's stored link predates the Help centre / Support split and
 * points at Settings, where a customer's chat no longer is. Rather than
 * rewriting stored rows, the click is redirected here: to the Support section
 * of whichever dashboard the person is in, with the Support panel already
 * open.
 *
 * The open request is a module flag plus an event, not a query parameter: the
 * dashboards strip `?section=` from the address as soon as they apply it, so a
 * panel that mounts a moment later would never see one.
 */

export const OPEN_SUPPORT_EVENT = "furnicraft:open-support";

let pending = false;

/** Asks the help page to open on Support -- now if it is showing, or when it next mounts. */
export function requestSupportChat(): void {
  pending = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_SUPPORT_EVENT));
}

/** True once per request: the help page reads it as it mounts. */
export function takeSupportChatRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** The Support section of the dashboard this person is in now. */
export function supportSectionHref(): string {
  const inShop = typeof window !== "undefined" && window.location.pathname.startsWith("/protected/shop");
  return inShop ? "/protected/shop?section=support" : "/protected?section=support";
}

/**
 * Where a notification should go when clicked. Support replies go to the chat;
 * everything else keeps its own link.
 */
export function notificationHref(item: { type: string; link: string | null }): string | null {
  if (item.type === "support_reply") {
    requestSupportChat();
    return supportSectionHref();
  }
  return item.link;
}
