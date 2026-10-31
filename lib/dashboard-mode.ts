/**
 * Which dashboard this browser tab is working in: the customer's or the shop's.
 *
 * One account can be both a customer and a shop owner, and the 3D studio is
 * the same page for both. Owning a shop is therefore not enough to show shop
 * tools there -- "Publish as Template" has to appear only when the person came
 * in as the shop, not while they are shopping as a customer.
 *
 * Each dashboard records itself here when it opens, and the studio reads it.
 * Per tab (sessionStorage), so a shop tab and a customer tab open side by side
 * do not overwrite each other. Anything unknown -- a fresh tab, storage
 * blocked -- reads as "customer", so shop tools are never shown by default.
 */

export type DashboardMode = "customer" | "shop";

const KEY = "fc-dashboard-mode";

export function setDashboardMode(mode: DashboardMode): void {
  try {
    window.sessionStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked: the studio then treats the tab as customer mode.
  }
}

export function getDashboardMode(): DashboardMode {
  try {
    return window.sessionStorage.getItem(KEY) === "shop" ? "shop" : "customer";
  } catch {
    return "customer";
  }
}
