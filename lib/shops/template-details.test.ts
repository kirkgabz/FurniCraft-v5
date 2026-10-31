import assert from "node:assert/strict";
import { test } from "node:test";
import { validateTemplateDetails } from "./template-details";

const details = { title: "Patio chair", tag: "", description: "" };

test("existing templates with missing metadata can save material updates", () => {
  for (const existing of [{ tag: null, description: null }, { tag: "", description: "  " }, {}]) {
    assert.deepEqual(validateTemplateDetails(details, existing), {
      required: { tag: false, description: false }, missing: [],
    });
  }
});

test("new templates still require tag and description", () => {
  assert.deepEqual(validateTemplateDetails(details).missing, ["Tag", "Description"]);
  assert.deepEqual(validateTemplateDetails({ ...details, title: " " }, null).missing, ["Title", "Tag", "Description"]);
  assert.deepEqual(validateTemplateDetails({ title: "Patio chair", tag: "Outdoor", description: "Synthetic rattan chair" }).missing, []);
});

test("editing cannot erase metadata that is already filled in", () => {
  assert.deepEqual(validateTemplateDetails(details, { tag: "Outdoor", description: "Woven chair" }).missing, ["Tag", "Description"]);
  assert.deepEqual(validateTemplateDetails(details, { tag: "Outdoor", description: null }).missing, ["Tag"]);
  assert.deepEqual(validateTemplateDetails(details, { tag: null, description: "Woven chair" }).missing, ["Description"]);
});

test("all template updates still require a nonblank title", () => {
  assert.deepEqual(validateTemplateDetails({ ...details, title: "\n\t " }, {}).missing, ["Title"]);
});
