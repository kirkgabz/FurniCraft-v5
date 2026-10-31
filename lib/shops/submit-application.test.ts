import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applicationErrorMessage, documentFormat, submitSellerApplication, type SellerApplication } from "./submit-application";

const application: SellerApplication = {
  shopName: " Test Furniture ", description: "Custom pieces", address: " Test address ", phone: "",
  socialLinks: [], birRegisteredName: " Test Maker ",
  birDocument: new File(["synthetic document"], "bir.pdf", { type: "application/pdf" }),
  validId: new File(["synthetic ID"], "id.png", { type: "image/png" }),
};

function fixture(options: { failSecondUpload?: boolean; insertError?: { code: string; message: string }; duplicate?: boolean } = {}) {
  const uploaded: string[] = [];
  const uploadedTypes: string[] = [];
  const removed: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "test-user", email: "applicant@example.test" } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: options.duplicate ? [{ status: "pending" }] : [], error: null }) }) }),
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: options.insertError ? null : { id: "application-id" }, error: options.insertError ?? null }) }) };
      },
    }),
    storage: { from: () => ({
      upload: async (path: string, body: Blob) => {
        if (options.failSecondUpload && uploaded.length === 1) return { error: { message: "Storage unavailable" } };
        uploaded.push(path);
        uploadedTypes.push(body.type);
        return { error: null };
      },
      remove: async (paths: string[]) => { removed.push(...paths); return { error: null }; },
    }) },
  } as unknown as SupabaseClient;
  return { client, uploaded, uploadedTypes, removed, inserts };
}

test("submission saves both private documents and a pending application", async () => {
  const state = fixture();
  assert.equal(await submitSellerApplication(state.client, application), "application-id");
  assert.equal(state.uploaded.length, 2);
  assert.equal(state.removed.length, 0);
  assert.equal(state.inserts[0].status, "pending");
  assert.equal(state.inserts[0].shop_name, "Test Furniture");
  assert.equal(state.inserts[0].bir_document_url, state.uploaded[0]);
  assert.equal(state.inserts[0].valid_id_url, state.uploaded[1]);
});

test("a second upload failure removes the first document and creates no application", async () => {
  const state = fixture({ failSecondUpload: true });
  await assert.rejects(submitSellerApplication(state.client, application), /Failed to upload valid ID: Storage unavailable/);
  assert.deepEqual(state.removed, state.uploaded);
  assert.equal(state.inserts.length, 0);
});

test("a rejected database insert cleans up documents and preserves its plain-object error", async () => {
  const error = { code: "42501", message: "Application permission denied" };
  const state = fixture({ insertError: error });
  await assert.rejects(submitSellerApplication(state.client, application), (caught) => applicationErrorMessage(caught) === error.message);
  assert.deepEqual(state.removed, state.uploaded);
});

test("an uncertain insert response retains documents for a possibly committed application", async () => {
  for (const code of ["", "PGRST116"]) {
    const state = fixture({ insertError: { code, message: "Insert response unavailable" } });
    await assert.rejects(submitSellerApplication(state.client, application));
    assert.equal(state.removed.length, 0);
  }
});

test("duplicate applications are stopped before any documents are uploaded", async () => {
  const state = fixture({ duplicate: true });
  await assert.rejects(submitSellerApplication(state.client, application), /already with the admin/);
  assert.equal(state.uploaded.length, 0);
  assert.equal(state.inserts.length, 0);
});

test("phone files upload under the exact type the bucket accepts", async () => {
  // What Android pickers and galleries hand over: no extension, a non-standard
  // JPEG type, an upper-case extension with no type at all.
  const state = fixture();
  await submitSellerApplication(state.client, {
    ...application,
    birDocument: new File(["synthetic photo"], "1000012345", { type: "image/jpg" }),
    validId: new File(["synthetic photo"], "IMG_0001.JPG", { type: "" }),
  });
  assert.match(state.uploaded[0], /\.jpg$/);
  assert.match(state.uploaded[1], /\.jpg$/);
  assert.deepEqual(state.uploadedTypes, ["image/jpeg", "image/jpeg"]);
});

test("documents are recognised by name or type, and anything else is refused before upload", async () => {
  assert.deepEqual(documentFormat(new File([""], "bir.PDF")), { extension: "pdf", contentType: "application/pdf" });
  assert.deepEqual(documentFormat(new File([""], "scan", { type: "application/pdf" })), { extension: "pdf", contentType: "application/pdf" });
  assert.equal(documentFormat(new File([""], "IMG_0001.HEIC", { type: "image/heic" })), null);
  const state = fixture();
  await assert.rejects(
    submitSellerApplication(state.client, { ...application, validId: new File(["x"], "IMG_0001.HEIC", { type: "image/heic" }) }),
    /PDF, JPEG, PNG, or WebP/
  );
  assert.equal(state.uploaded.length, 0);
});
