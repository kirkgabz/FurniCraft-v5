import assert from "node:assert/strict";
import { test } from "node:test";
import { ENGLISH_INTERFACE } from "./language-context";
import { translate } from "./translations";
import { timeAgo } from "../../lib/time-ago";
import { buildSystemPrompt, quickQuestionsFor, quickAnswerNote } from "../../lib/shop-assistant";

test("the shared interface is English with Philippine formatting and no language setter", () => {
  assert.equal(ENGLISH_INTERFACE.language, "en");
  assert.equal(ENGLISH_INTERFACE.locale, "en-PH");
  assert.equal("setLanguage" in ENGLISH_INTERFACE, false);
  assert.equal(ENGLISH_INTERFACE.t("Settings"), "Settings");
});

test("English interpolation preserves submitted names, prices, punctuation and missing placeholders", () => {
  const name = '<Settings> $& {1} "Mabuhay"';
  assert.equal(translate("en", "Call {0}", { 0: name }), `Call ${name}`);
  assert.equal(translate("en", "{0} orders · ₱{1}", { 0: 2, 1: "1,500" }), "2 orders · ₱1,500");
  assert.equal(translate("en", "Call {0}"), "Call {0}");
  assert.equal(translate("en", "  Settings  "), "  Settings  ");
  assert.equal(translate("en", "Could not delete Test $&: offline"), "Could not delete Test $&: offline");
});

test("relative dates retain the English timing boundaries", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  assert.equal(timeAgo("2026-10-24T11:59:40Z", now), "Just now");
  assert.equal(timeAgo("2026-10-24T11:58:00Z", now), "2m ago");
  assert.equal(timeAgo("2026-10-24T10:00:00Z", now), "2h ago");
  assert.equal(timeAgo("2026-10-22T12:00:00Z", now), "2d ago");
  assert.equal(timeAgo("invalid", now), "");
});

test("shop quick questions and automated answer instructions use English", () => {
  assert.match(buildSystemPrompt({ name: "Sample shop" }), /always answer in English/);
  assert.equal(quickQuestionsFor("en")[0].text, "Where is your shop?");
  assert.equal(quickAnswerNote("Sample shop"), "Written by Sample shop. Send a message below if you need anything else.");
});
