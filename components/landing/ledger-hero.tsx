
import { UiText } from "@/components/language/ui-text";
import Link from "next/link";
import SessionAware from "@/components/landing/session-aware";

const PRIMARY_CTA =
  "inline-flex items-center justify-center rounded px-6 py-3.5 text-base font-bold text-[var(--fc-btn-fg)] transition-[transform,background-color] duration-150 active:scale-[0.97] hover:bg-[var(--fc-btn-hover)]";
const SECONDARY_CTA =
  "inline-flex items-center justify-center rounded border px-6 py-3.5 text-base font-bold text-[var(--fc-text)] transition-[transform,border-color,background-color] duration-150 active:scale-[0.97] hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]";

/**
 * The first viewport, Furniture Shop Ledger world.
 *
 * The dark vitrine hero this replaces argued its case with a working control;
 * this one argues it with a drawing. Every commission on FurniCraft ends in a
 * dimensioned shop drawing traced from the piece the customer actually posed
 * (see components/design/blueprint-svg.ts) -- so a schematic, dimensioned line
 * drawing is the honest hero asset for this product, not a lifestyle photo of
 * a chair in a room. This one is illustrative rather than data-driven (a real
 * blueprint needs a saved design to trace), drawn once by hand to match the
 * shape of a real drawing: outline, extension lines, a dimension, a number.
 *
 * No client state: the draw-in is pure CSS (.ledger-outline/.ledger-dim/
 * .ledger-dim-label/.ledger-stamp in globals.css), so this stays a Server
 * Component.
 */
export default function LedgerHero() {
  return (
    <section className="ledger-grid relative isolate overflow-hidden bg-[var(--fc-bg)]">
      <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-12 lg:py-24">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(2.2rem,4.6vw,3.4rem)] font-extrabold leading-[1.04] tracking-[-0.035em] text-[var(--fc-text)]"><UiText text={"Every part, dimensioned before it's built."} /></h1>

          <p className="mt-6 max-w-[50ch] text-lg leading-relaxed text-[var(--fc-muted)]"><UiText text={"Resize any part of a real piece in the studio and the furniture shop receives the exact drawing, not a description of one."} /></p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <SessionAware
              signedOut={
                <>
                  <Link href="/auth/sign-up" className={PRIMARY_CTA} style={{ background: "var(--fc-btn)" }}><UiText text={"Sign up"} /></Link>
                  <Link href="/auth/login" className={SECONDARY_CTA} style={{ borderColor: "var(--fc-border)" }}><UiText text={"Sign in"} /></Link>
                </>
              }
              signedIn={
                <>
                  <Link href="/customize-furniture" className={PRIMARY_CTA} style={{ background: "var(--fc-btn)" }}><UiText text={"Design a piece"} /></Link>
                  <Link href="/protected" className={SECONDARY_CTA} style={{ borderColor: "var(--fc-border)" }}><UiText text={"Your dashboard"} /></Link>
                </>
              }
            />
          </div>
        </div>

        {/* The drawing. */}
        <div className="relative">
          <span className="ledger-stamp"><UiText text={"Measured · FurniCraft"} /></span>
          <div className="ledger-diagram rounded border p-4" style={{ borderColor: "var(--fc-border)" }}>
            <svg viewBox="0 0 320 240" fill="none" className="block h-auto w-full" aria-hidden="true">
              <g
                className="ledger-outline"
                stroke="var(--fc-text)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M92 60 L92 140 Q92 156 108 156 L188 156" />
                <path d="M92 60 Q92 46 106 46 L150 46 Q166 46 166 60 L166 96" />
                <line x1="92" y1="140" x2="92" y2="196" />
                <line x1="188" y1="156" x2="188" y2="196" />
                <line x1="82" y1="196" x2="102" y2="196" />
                <line x1="178" y1="196" x2="198" y2="196" />
              </g>
              <g className="ledger-dim ledger-dim-1" stroke="var(--fc-ink-accent)" strokeWidth="1" opacity="0.85">
                <line x1="222" y1="46" x2="222" y2="196" />
                <line x1="216" y1="46" x2="228" y2="46" />
                <line x1="216" y1="196" x2="228" y2="196" />
              </g>
              <text
                className="ledger-dim-label ledger-dim-label-1 font-mono"
                x="232"
                y="124"
                fill="var(--fc-ink-accent)"
                fontSize="10"
                letterSpacing="0.5"
              ><UiText text={"78 cm"} /></text>
              <g className="ledger-dim ledger-dim-2" stroke="var(--fc-ink-accent)" strokeWidth="1" opacity="0.85">
                <line x1="92" y1="212" x2="188" y2="212" />
                <line x1="92" y1="206" x2="92" y2="218" />
                <line x1="188" y1="206" x2="188" y2="218" />
              </g>
              <text
                className="ledger-dim-label ledger-dim-label-2 font-mono"
                x="112"
                y="230"
                fill="var(--fc-ink-accent)"
                fontSize="10"
                letterSpacing="0.5"
              ><UiText text={"54 cm"} /></text>
            </svg>
          </div>
          <p className="mt-3 text-center font-mono text-[11px] text-[var(--fc-muted)]"><UiText text={"Illustrative. Every real order ships a drawing traced from the piece you actually built."} /></p>
        </div>
      </div>
    </section>
  );
}
