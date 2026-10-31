/** Local Supabase integration check. Requires SELLER_TEST_URL, _PUBLIC_KEY and _SERVICE_KEY. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { submitSellerApplication } from "../lib/shops/submit-application.ts";

const url = process.env.SELLER_TEST_URL;
const publicKey = process.env.SELLER_TEST_PUBLIC_KEY;
const serviceKey = process.env.SELLER_TEST_SERVICE_KEY;
assert.ok(url && publicKey && serviceKey, "Set local seller test connection variables.");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "This test only creates synthetic data on a local Supabase instance.");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const users: string[] = [];
const documents: string[] = [];
let applicationId: string | null = null;
const password = `Local-test-${randomUUID()}!`;

async function account(role: "applicant" | "admin" | "other") {
  const email = `${role}-${randomUUID()}@example.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(error);
  assert.ok(data.user);
  users.push(data.user.id);
  const profile = await service.from("user_profiles").upsert({ id: data.user.id, full_name: `Synthetic ${role}`, is_admin: role === "admin" });
  assert.ifError(profile.error);
  const client = createClient(url!, publicKey!, { auth: { persistSession: false } });
  assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
  return client;
}

try {
  const applicant = await account("applicant");
  const admin = await account("admin");
  const other = await account("other");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII=", "base64");
  const application = {
    shopName: `Synthetic Seller ${randomUUID()}`, description: "Synthetic integration fixture", address: "Test address",
    phone: "+63 9171234567", socialLinks: [], birRegisteredName: "Synthetic Maker",
    birDocument: new File([png], "synthetic-bir.png", { type: "image/png" }),
    validId: new File([png], "synthetic-id.png", { type: "image/png" }),
  };
  applicationId = await submitSellerApplication(applicant, application);
  const queue = await admin.from("shops").select("*").eq("id", applicationId).eq("status", "pending").single();
  assert.ifError(queue.error);
  assert.equal(queue.data.shop_name, application.shopName);
  assert.equal(queue.data.bir_registered_name, application.birRegisteredName);
  documents.push(queue.data.bir_document_url, queue.data.valid_id_url);
  console.log("PASS: customer application appears in the admin pending queue with both document paths.");

  for (const path of documents) {
    assert.ifError((await admin.storage.from("seller-documents").download(path)).error);
    assert.ok((await other.storage.from("seller-documents").createSignedUrl(path, 60)).error);
  }
  const hidden = await other.from("shops").select("id").eq("id", applicationId);
  assert.ifError(hidden.error);
  assert.deepEqual(hidden.data, []);
  const anonymous = createClient(url, publicKey, { auth: { persistSession: false } });
  const anonymousRead = await anonymous.from("shops").select("id").eq("id", applicationId);
  assert.ok(anonymousRead.error || anonymousRead.data?.length === 0);
  console.log("PASS: admin can read documents; another customer and anonymous visitors cannot read the application.");

  const approval = await applicant.from("shops").update({ status: "approved" }).eq("id", applicationId);
  assert.ok(approval.error, "Applicant must not self-approve.");
  await assert.rejects(submitSellerApplication(applicant, application), /already with the admin/);
  const after = await admin.from("shops").select("status").eq("id", applicationId).single();
  assert.equal(after.data?.status, "pending");
  console.log("PASS: duplicate submissions and customer self-approval are blocked.");
} finally {
  if (applicationId) await service.from("shops").delete().eq("id", applicationId);
  if (documents.length) await service.storage.from("seller-documents").remove(documents);
  for (const id of users) await service.auth.admin.deleteUser(id);
}
