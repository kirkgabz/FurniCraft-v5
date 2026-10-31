import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseOrderEvents, orderEntryId } from "./order-event-cards";
import type { ThreadEntry } from "./messenger-thread";

const card = (id: string, orderId: string, event: string): ThreadEntry => ({
  id,
  text: "",
  time: "",
  kind: "order_event",
  payload: { order_id: orderId, event },
});
const text = (id: string): ThreadEntry => ({ id, text: id, time: "" });

const thread = [
  card("a1", "A", "order_placed"),
  text("hello"),
  card("b1", "B", "order_placed"),
  card("a2", "A", "order_quoted"),
  text("thanks"),
  card("a3", "A", "order_confirmed"),
];

test("keeps only the newest card per order, where it was posted", () => {
  const ids = collapseOrderEvents(thread).map((entry) => entry.id);
  assert.deepEqual(ids, ["hello", "b1", "thanks", "a3"]);
});

test("the kept card says how many cards it replaced", () => {
  const byId = new Map(collapseOrderEvents(thread).map((entry) => [entry.id, entry]));
  assert.equal(byId.get("a3")?.replacedCards, 2);
  assert.equal(byId.get("b1")?.replacedCards, 0);
  assert.equal(byId.get("hello")?.replacedCards, undefined);
});

test("Show in chat jumps to the card that is still on screen", () => {
  assert.equal(orderEntryId(thread, "A"), "a3");
  assert.equal(orderEntryId(thread, "missing"), null);
});
