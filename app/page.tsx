
import { UiText } from "@/components/language/ui-text";
import Link from "next/link";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import LedgerHero from "@/components/landing/ledger-hero";
import SessionAware from "@/components/landing/session-aware";
import FaqWidget from "@/components/faq/faq-widget";
import SolihiyaMesh, { SolihiyaCell } from "@/components/solihiya/mesh";

/**
 * The commission, end to end. These are the real states of `design_orders`
 * (see the seven-state lifecycle in the README and the database trigger that
 * enforces it), not a marketing simplification of them -- including the part
 * where the money never touches FurniCraft.
 */
const COMMISSION = [
  {
    step: "Design it",
    body: "Open a piece in the studio and resize any part of it. Every change is measured in centimetres as you make it.",
  },
  {
    step: "Send it to a shop",
    body: "Pick a furniture shop and send the design itself — not a screenshot. They reopen the exact file you built.",
  },
  {
    step: "Get it quoted",
    body: "The shop prices your design and sends the quote back into the same conversation. You accept or you don't.",
  },
  {
    step: "Pay the shop directly",
    body: "You pay the furniture shop by GCash or QR Ph and upload the receipt. FurniCraft never touches the money.",
  },
  {
    step: "It gets built",
    body: "The shop confirms your downpayment, starts work, and marks it complete when your piece is ready.",
  },
] as const;

export default function Page() {
  return (
    <>
      <nav className="landing-nav">
        <Link className="landing-logo" href="/"><UiText text="FurniCraft" /></Link>
        <div className="landing-nav-links">
          <SessionAware
            // Nothing here for a signed-out visitor: the hero's own "Sign in"
            // sits a few hundred pixels below and is the larger target of the
            // two. A signed-in one still gets the way back to their dashboard,
            // which the hero does not duplicate.
            signedOut={null}
            signedIn={
              <Link className="landing-nav-link cta" href="/protected"><UiText text="Go to dashboard" /></Link>
            }
          />
        </div>
      </nav>

      <main>
        <LedgerHero />

        <section aria-labelledby="device-access-heading" className="border-b border-[var(--fc-border)] bg-[var(--fc-panel)]">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-2 md:items-center md:gap-14">
            <div>
              <h2 id="device-access-heading" className="font-display text-2xl font-bold tracking-[-0.025em] text-[var(--fc-text)]"><UiText text="Your designs, on your device." /></h2>
              <p className="mt-3 max-w-[54ch] leading-relaxed text-[var(--fc-muted)]"><UiText text="Access FurniCraft on desktops, laptops, tablets, and smartphones through a browser that supports WebGL for the 3D studio. No app installation needed." /></p>
            </div>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-5 text-[var(--fc-text)]">
              {[
                { label: "Desktops", icon: Monitor },
                { label: "Laptops", icon: Laptop },
                { label: "Tablets", icon: Tablet },
                { label: "Smartphones", icon: Smartphone },
              ].map(({ label, icon: Icon }) => (
                <li key={label} className="flex items-center gap-3">
                  <Icon aria-hidden="true" size={24} strokeWidth={1.5} className="shrink-0 text-[var(--fc-accent)]" />
                  <span className="font-medium"><UiText text={label} /></span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Quiet after the dense hero: one claim, room around it. */}
        <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <h2 className="font-display max-w-[20ch] text-[clamp(1.9rem,3.6vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.035em] text-[var(--fc-text)]"><UiText text="Custom furniture usually fails in the describing." /></h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2 md:gap-14">
            <p className="max-w-[62ch] text-lg leading-relaxed text-[var(--fc-muted)]"><UiText text="You send a photo and a paragraph. The shop reads it, pictures something slightly different, and builds that. Nobody finds out until the piece is finished and standing in the room." /></p>
            <p className="max-w-[62ch] text-lg leading-relaxed text-[var(--fc-text)]"><UiText text="So FurniCraft sends the design instead of a description. The shop receives the file you built, opens it, and reads the measurements off the piece itself — every part, in centimetres, with a dimensioned drawing traced from the shape you actually posed." /></p>
          </div>
        </section>

        {/* Dense passage: the commission, woven. The sequence is load-bearing --
            a customer needs to know payment comes before production and that the
            shop, not the platform, is paid -- so the weave encodes order. */}
        <section className="relative isolate overflow-hidden border-y border-[var(--fc-border)] bg-[var(--fc-panel)]">
          <div className="pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden="true">
            <SolihiyaMesh id="commission" pitch={34} strand={1} opacity={0.5} className="h-full w-full" />
          </div>

          {/* The extra bottom padding on phones is room for the FAQ bubble:
              it is fixed bottom-left, over the same gutter this text starts
              in, so without it the last step sits under the bubble. */}
          <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-28 sm:py-24">
            <h2 className="font-display max-w-[22ch] text-[clamp(1.7rem,3vw,2.5rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-[var(--fc-text)]"><UiText text="What happens after you press send." /></h2>

            <ol className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {COMMISSION.map((item) => (
                <li key={item.step} className="flex gap-4">
                  <SolihiyaCell id={`commission-${item.step}`} state="woven" size={30} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-bold tracking-[-0.02em] text-[var(--fc-text)]">
                      <UiText text={item.step} />
                    </h3>
                    <p className="mt-1.5 max-w-[46ch] text-[var(--fc-muted)]"><UiText text={item.body} /></p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

      </main>

      {/* The same FAQ helper as the dashboard's Overview, answering from the
          same curated list in faq-data.ts. A first-time visitor is browsing
          here too, and "how do payments work?" is exactly the question they
          have before deciding to sign up. */}
      <FaqWidget />
    </>
  );
}
