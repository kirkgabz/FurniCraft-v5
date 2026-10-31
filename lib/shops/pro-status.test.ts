import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadShopProIds } from "./pro-status";

function clientWith(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const client = {
    from(table: string) {
      calls.push(["from", table]);
      return { select(columns: string) {
        calls.push(["select", columns]);
        return { in(column: string, ids: string[]) {
          calls.push(["in", column, ids]);
          return Promise.resolve(result);
        } };
      } };
    },
  } as unknown as Pick<SupabaseClient, "from">;
  return { client, calls };
}

test("only the public active-Pro flag grants a badge, in a single batch", async () => {
  const { client, calls } = clientWith({ data: [
    { id: "pro", is_pro: true }, { id: "expired", is_pro: false },
    { id: "free", is_pro: null }, { id: "unknown" }, { id: "invalid", is_pro: "true" },
  ], error: null });
  assert.deepEqual([...await loadShopProIds(client, ["pro", "expired", "free", "unknown", "invalid"])], ["pro"]);
  assert.deepEqual(calls, [
    ["from", "shops_public"], ["select", "id, is_pro"],
    ["in", "id", ["pro", "expired", "free", "unknown", "invalid"]],
  ]);
});

test("a missing flag column or failed request grants no badges and keeps browsing available", async () => {
  const { client } = clientWith({ data: [{ id: "pro", is_pro: true }], error: { code: "42703" } });
  assert.equal((await loadShopProIds(client, ["pro"])).size, 0);
  const failed = { from() { throw new Error("offline"); } } as unknown as Pick<SupabaseClient, "from">;
  assert.equal((await loadShopProIds(failed, ["pro"])).size, 0);
});

test("empty directories do not issue a subscription query", async () => {
  const { client, calls } = clientWith({ data: null, error: null });
  assert.equal((await loadShopProIds(client, [])).size, 0);
  assert.deepEqual(calls, []);
});
