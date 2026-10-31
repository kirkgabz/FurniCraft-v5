import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageProvider } from "./language-provider";
import { ThemeContext } from "../theme/theme-context";
import SettingsSection from "../dashboard/sections/settings-section";
import SupportSection from "../dashboard/sections/support-section";
import { ShopName } from "../shops/shop-name";
import { QuoteBreakdownList } from "../orders/quote-breakdown";
import AdminSupportInbox from "../admin/admin-support-inbox";
import OrderStepper from "../orders/order-stepper";
import { AdaptiveText } from "./adaptive-text";
import AuthLayout from "../../app/auth/layout";

function render(element: React.ReactNode) {
  return renderToStaticMarkup(React.createElement(ThemeContext.Provider, {
    value: { theme: "light", setTheme: () => {}, toggleTheme: () => {} },
  }, React.createElement(LanguageProvider, null, element)));
}

test("customer settings retain appearance and email preferences without a language setting", () => {
  const settings = render(React.createElement(SettingsSection, {
    currentUserId: null, emailNotifyOrderReady: true, handleToggleEmailNotifyOrderReady: async () => {},
  }));
  assert.match(settings, /Appearance/);
  assert.match(settings, /Order ready emails/);
  assert.doesNotMatch(settings, /Language|Filipino|Choose the language/);
});

test("support, order steps and admin tools use English", () => {
  const support = render(React.createElement(SupportSection, { currentUserId: null }));
  assert.match(support, /How can we help/);
  assert.match(render(React.createElement(OrderStepper, { status: "quoted" })), /Quoted/);
  assert.match(render(React.createElement(AdminSupportInbox)), /No support messages yet/);
});

test("authentication has no language selection", () => {
  const html = render(React.createElement(AuthLayout, null, React.createElement("h1", null, "Sign in")));
  assert.match(html, /Sign in/);
  assert.doesNotMatch(html, /select|Language|Filipino/);
});

test("submitted names, quote labels and prose remain as written", () => {
  assert.match(render(React.createElement(ShopName, { shop: { name: "Settings", isPro: true } })), />Settings</);
  const quote = render(React.createElement(QuoteBreakdownList, { lines: [{ label: "Settings", amount: 500 }] }));
  assert.match(quote, />Settings</);
  const text = "Salamat po — custom message ₱500";
  assert.match(render(React.createElement(AdaptiveText, { text })), /Salamat po — custom message ₱500/);
  assert.equal(render(React.createElement(AdaptiveText, { text, translationOnly: true })), "");
});
