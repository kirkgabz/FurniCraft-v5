import assert from "node:assert/strict";
import { test } from "node:test";
import { canGoBackInApp, previousPathInApp, trackHistoryDepth } from "../components/ui/history-depth";
import { pushStep } from "./commission-path";

function withBrowser(run: (browser: ReturnType<typeof browserFixture>) => void) {
  const browser = browserFixture();
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { referrer: "" } });
  const cleanup = trackHistoryDepth();
  try { run(browser); } finally {
    cleanup();
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

function browserFixture() {
  const storage = new Map<string, string>();
  const entries = [{ url: "http://example.test/", state: { __NA: true, tree: "next-tree" } as Record<string, unknown> }];
  let index = 0;
  const events = new EventTarget();
  const window = Object.assign(events, {
    location: new URL(entries[0].url),
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    history: {
      get state() { return entries[index].state; },
      pushState(data: Record<string, unknown>, _: string, url?: string | URL | null) {
        entries.splice(index + 1);
        entries.push({ state: data, url: new URL(url || window.location.href, window.location.href).href });
        index++;
        window.location = new URL(entries[index].url);
      },
      replaceState(data: Record<string, unknown>, _: string, url?: string | URL | null) {
        entries[index] = { state: data, url: new URL(url || window.location.href, window.location.href).href };
        window.location = new URL(entries[index].url);
      },
    },
  });
  const go = (offset: number) => {
    index += offset;
    window.location = new URL(entries[index].url);
    events.dispatchEvent(new Event("popstate"));
    events.dispatchEvent(new Event("hashchange"));
  };
  return { window, go, storage };
}

test("Back tracks hash sections, query changes and replacements without losing Next state", () => withBrowser(({ window, go }) => {
  assert.equal(canGoBackInApp(), false);
  window.history.pushState({ __NA: true, tree: "dashboard-tree" }, "", "/protected");
  window.history.pushState(null!, "", "#orders");
  window.history.pushState(null!, "", "#messages");
  assert.equal(previousPathInApp(), "/protected");
  window.history.replaceState(null!, "", "?section=messages#messages");
  assert.equal(window.history.state.fcDepth, 3);
  assert.equal(previousPathInApp(), "/protected");
  go(-1);
  assert.equal(window.location.hash, "#orders");
  assert.equal(previousPathInApp(), "/protected");
  go(1);
  assert.equal(previousPathInApp(), "/protected");
  go(-1);
  window.history.pushState({ __NA: true, tree: "settings-tree" }, "", "#settings");
  assert.equal(window.history.state.tree, "settings-tree");
  assert.equal(previousPathInApp(), "/protected");
}));

test("auth screens can return within sign-in flow, while signed-in screens avoid sign-in", () => withBrowser(({ window }) => {
  window.history.pushState(null!, "", "/auth/login");
  window.history.pushState(null!, "", "/auth/sign-up");
  assert.equal(canGoBackInApp(), true);
  window.history.replaceState(null!, "", "/protected");
  assert.equal(canGoBackInApp(), false);
}));

test("cold entries use fallback even with old tab storage; unknown history is not trusted", () => withBrowser(({ window, storage }) => {
  storage.set("furnicraft_nav_depth", "90");
  assert.equal(canGoBackInApp(), false);
  window.history.pushState(null!, "", "/admin");
  storage.delete("furnicraft_nav_paths");
  assert.equal(canGoBackInApp(), false);
}));

test("commission Back preserves picker, studio, review and protected order predecessors", () => withBrowser(({ storage }) => {
  const steps = [
    { href: "/protected#shops", label: "Shops" },
    { href: "/shops/local", label: "Local shop" },
    { href: "/customize-furniture", label: "Pick a piece" },
    { href: "/customize-furniture#shape", label: "Shape it" },
    { href: "/order-summary", label: "Review" },
    { href: "/protected/orders/order-1", label: "Order" },
  ];
  steps.forEach(pushStep);
  assert.deepEqual(JSON.parse(storage.get("furnicraft_commission_path")!), steps);
  pushStep(steps[3]);
  assert.deepEqual(JSON.parse(storage.get("furnicraft_commission_path")!), steps.slice(0, 4));
}));

test("query-addressed steps remain distinct, dashboard roots begin a new journey", () => withBrowser(({ storage }) => {
  pushStep({ href: "/customize-furniture?type=table", label: "Table" });
  pushStep({ href: "/customize-furniture?type=bed", label: "Bed" });
  assert.equal(JSON.parse(storage.get("furnicraft_commission_path")!).length, 2);
  pushStep({ href: "/protected/shop#orders", label: "Shop orders" });
  assert.deepEqual(JSON.parse(storage.get("furnicraft_commission_path")!), [{ href: "/protected/shop#orders", label: "Shop orders" }]);
}));


test("missing path records never shift auth entries into a different history position", () => withBrowser(({ window, storage }) => {
  window.history.pushState(null!, "", "/auth/login");
  storage.set("furnicraft_nav_paths", JSON.stringify([null, "/auth/login"]));
  window.history.pushState(null!, "", "/admin");
  assert.equal(previousPathInApp(), "/auth/login");
  assert.equal(canGoBackInApp(), false);
}));
