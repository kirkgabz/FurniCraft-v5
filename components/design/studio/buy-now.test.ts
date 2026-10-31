import assert from "node:assert/strict";
import { test } from "node:test";
import { addToCart, clearCart, readCart, removeFromCart, setCartScope, stageBuyNow } from "./design-cart";
import { DEFAULT_PART_COLORS, DEFAULT_RIG_PARAMS } from "./studio-config";
import type { StudioDesignItem } from "./studio-design-state";

/** localStorage, as the studio and checkout see it. */
function withStorage(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        setItem: (key: string, value: string) => data.set(key, value),
        getItem: (key: string) => data.get(key) ?? null,
        removeItem: (key: string) => data.delete(key),
      },
    },
  });
  try {
    run();
  } finally {
    setCartScope("cart");
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function piece(name: string) {
  const item: StudioDesignItem = {
    kind: "victorian-chair-studio", type: "table", name, dims: { Top: { w: 1, h: 1, d: 1 } },
    materialNames: {}, score: null, globalScale: { x: 1, y: 1, z: 1 },
    studio: { measurement: { overall: { w: 1, h: 1, d: 1 }, seatHeight: 1, parts: [] }, modelId: "table", params: { ...DEFAULT_RIG_PARAMS }, colors: { ...DEFAULT_PART_COLORS } },
  };
  return { item, modelName: "Table", previewUrl: "", unitPrice: 0, shopId: null, shopName: "", shopLocked: false, allowedMaterials: null };
}

test("buy now holds one piece apart; the cart is never added to", () => {
  withStorage(() => {
    addToCart(piece("Chair in the cart"));
    assert.equal(stageBuyNow(piece("Table bought now")).ok, true);
    // The cart, as the studio's badge and the cart page read it.
    assert.deepEqual(readCart().map((line) => line.item.name), ["Chair in the cart"]);
    // The checkout opened with ?buy=now.
    setCartScope("buy-now");
    assert.deepEqual(readCart().map((line) => line.item.name), ["Table bought now"]);
  });
});

test("staging again replaces the buy-now piece rather than piling up", () => {
  withStorage(() => {
    stageBuyNow(piece("First"));
    stageBuyNow(piece("Second"));
    setCartScope("buy-now");
    assert.deepEqual(readCart().map((line) => line.item.name), ["Second"]);
  });
});

test("sending or cancelling a buy-now piece empties only that, not the cart", () => {
  withStorage(() => {
    addToCart(piece("Chair in the cart"));
    stageBuyNow(piece("Table bought now"));
    setCartScope("buy-now");
    const [line] = readCart();
    removeFromCart(line.id);
    clearCart();
    assert.equal(readCart().length, 0);
    setCartScope("cart");
    assert.deepEqual(readCart().map((entry) => entry.item.name), ["Chair in the cart"]);
  });
});

test("a template's piece stays with its shop even if the stored line says otherwise", () => {
  withStorage(() => {
    const template = piece("Shop A's chair");
    // Added unlocked and pointed elsewhere, as an old or hand-edited line could be.
    addToCart({
      ...template,
      item: { ...template.item, originShopId: "shop-a", originShopName: "Shop A" },
      shopId: "shop-b",
      shopName: "Shop B",
    });
    const [line] = readCart();
    assert.equal(line.shopId, "shop-a");
    assert.equal(line.shopName, "Shop A");
    assert.equal(line.shopLocked, true);
  });
});
