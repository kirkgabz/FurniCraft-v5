import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getActiveMessageConversation,
  messageConversationFromLink,
  registerActiveMessageConversation,
  sameMessageConversation,
  subscribeActiveMessageConversation,
} from "./message-notifications";

const message = { type: "message_received", link: "/protected?section=messages&shop=shop-a" };
const personal = { audience: "personal", shopId: "shop-a" } as const;
const shop = { audience: "shop", customerUserId: "customer-a" } as const;

test("customer notifications identify the shop, including encoded IDs", () => {
  assert.deepEqual(messageConversationFromLink(message), personal);
  assert.deepEqual(messageConversationFromLink({ ...message, link: "/protected?shop=shop%20b&section=messages" }), {
    audience: "personal", shopId: "shop b",
  });
});

test("shop notifications identify the customer", () => {
  assert.deepEqual(messageConversationFromLink({
    ...message, audience: "shop", link: "/protected/shop?section=messages&customer=customer-a",
  }), shop);
});

test("same shop/customer matches, other conversations and account roles do not", () => {
  assert(sameMessageConversation(personal, { ...personal }));
  assert(sameMessageConversation(shop, { ...shop }));
  assert(!sameMessageConversation(personal, { ...personal, shopId: "shop-b" }));
  assert(!sameMessageConversation(shop, { ...shop, customerUserId: "customer-b" }));
  assert(!sameMessageConversation(personal, shop));
  assert(!sameMessageConversation(personal, null));
});

test("orders and unrelated notifications remain visible even with a chat link", () => {
  assert.equal(messageConversationFromLink({ ...message, type: "order_received" }), null);
  assert.equal(messageConversationFromLink({ ...message, type: undefined! }), null);
});

test("missing, unrelated, external or contradictory links fail open", () => {
  for (const link of [null, "", "/protected", "/protected?shop=shop-a", "/protected?section=orders&shop=shop-a",
    "/protected?section=messages&shop=", "https://other.test/protected?section=messages&shop=shop-a", "http://["]) {
    assert.equal(messageConversationFromLink({ ...message, link }), null);
  }
  assert.equal(messageConversationFromLink({ ...message, audience: "shop" }), null);
  assert.equal(messageConversationFromLink({ ...message, audience: "personal", link: "/protected/shop?section=messages&customer=c" }), null);
});

test("active registration follows switching, cleanup, and effect resumption", () => {
  let changes = 0;
  const unsubscribe = subscribeActiveMessageConversation(() => changes++);
  const releaseA = registerActiveMessageConversation(personal);
  assert.deepEqual(getActiveMessageConversation(), personal);
  const releaseB = registerActiveMessageConversation(shop);
  releaseA();
  assert.deepEqual(getActiveMessageConversation(), shop, "old route cleanup cannot clear new conversation");
  releaseB();
  assert.equal(getActiveMessageConversation(), null);
  const resumed = registerActiveMessageConversation(personal);
  resumed();
  assert.equal(getActiveMessageConversation(), null);
  assert.equal(changes, 5);
  unsubscribe();
  const stopped = registerActiveMessageConversation(shop);
  stopped();
  assert.equal(changes, 5);
});
