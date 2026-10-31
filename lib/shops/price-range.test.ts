import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetMissesRange, formatRange, rangeMessage, rangesFrom } from "./price-range";

const shop = { min: 10000, max: 50000 };

test("a budget that reaches into the shop's range is accepted", () => {
  assert.equal(budgetMissesRange(10000, 12000, shop), false); // inside
  assert.equal(budgetMissesRange(8000, 12000, shop), false); // overlaps the bottom
  assert.equal(budgetMissesRange(45000, 70000, shop), false); // overlaps the top
  assert.equal(budgetMissesRange(5000, 90000, shop), false); // covers it
  assert.equal(budgetMissesRange(5000, 10000, shop), false); // touches the lowest
  assert.equal(budgetMissesRange(50000, 60000, shop), false); // touches the highest
});

test("a budget entirely outside the range is sent back", () => {
  assert.equal(budgetMissesRange(2000, 9999, shop), true); // all below
  assert.equal(budgetMissesRange(50001, 80000, shop), true); // all above
});

test("only complete, valid ranges are read; a shop with none is not checked", () => {
  const ranges = rangesFrom([
    { id: "a", price_range_min: "10000.00", price_range_max: "50000.00" },
    { id: "b", price_range_min: null, price_range_max: null },
    { id: "c", price_range_min: 5000, price_range_max: null },
    { id: "d", price_range_min: 9000, price_range_max: 1000 },
  ]);
  assert.deepEqual(Object.keys(ranges), ["a"]);
  assert.deepEqual(ranges.a, shop);
});

test("the notice names the shop and its range", () => {
  assert.equal(formatRange(shop), "₱10,000 to ₱50,000");
  assert.match(rangeMessage("Izumi Furniture Shop", shop), /Izumi Furniture Shop's price range of ₱10,000 to ₱50,000/);
});
