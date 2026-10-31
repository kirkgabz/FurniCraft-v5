"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { BAND_LABEL, type DesignAnalysis, type ScoreBlock } from "./design-analysis";

/**
 * The design analysis, beside the piece it is about.
 *
 * Two gradings and nothing else. The engine behind this runs a dozen checks --
 * slenderness ratios, deflections in millimetres, bending stresses, tipping
 * angles -- and every one of them still runs, because that is what the two
 * percentages are made of. None of it is printed here: this is a gauge, not a
 * report, and a gauge that has to be scrolled has stopped being one.
 *
 * The working is all still on the object, in `analysis.concerns`,
 * `analysis.notes` and each block's `checks`, so putting any of it back on
 * screen is a rendering change rather than a rebuild.
 */

const BAND_TONE: Record<string, { bar: string; text: string }> = {
  robust: { bar: "var(--fc-online)", text: "var(--fc-online)" },
  sound: { bar: "var(--fc-online)", text: "var(--fc-online)" },
  marginal: { bar: "var(--fc-star)", text: "var(--fc-star)" },
  rework: { bar: "var(--fc-danger)", text: "var(--fc-danger)" },
};

function Meter({ title, block }: { title: string; block: ScoreBlock }) {
  const { t: uiText } = useUiLanguage();
  const tone = BAND_TONE[block.band];
  if (!block.analysable) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--fc-border)] px-3 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fc-muted)]">
          {uiText(title)}
        </span>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--fc-muted)]">{uiText("Nothing here to measure on this piece.")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--fc-border)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        {/* Two lines are reserved whether or not this title needs them.
            "Durability" fits on one and "Material quality" does not, so
            without the floor the two meters' bars sit at different heights and
            the pair stops reading as one instrument. */}
        <span className="min-h-[2.2em] text-[10px] font-semibold uppercase leading-tight tracking-wider text-[var(--fc-muted)]">
          {uiText(title)}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums" style={{ color: tone.text }}>
          {block.score}%
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fc-border)]"
        role="meter"
        aria-valuenow={block.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={uiText("{0}: {1} per cent, {2}", { 0: title, 1: block.score, 2: uiText(BAND_LABEL[block.band]) })}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300 ease-out"
          style={{ width: `${block.score}%`, background: tone.bar }}
        />
      </div>
      <p className="mt-1.5 text-[11px] font-semibold" style={{ color: tone.text }}>
        {uiText(BAND_LABEL[block.band])}
      </p>
    </div>
  );
}

/**
 * Where the panel is standing.
 *
 * `floating` is the desktop placement: a card over the top-right corner of the
 * viewport, hard against the sidebar rather than inside it. The gradings belong
 * beside the piece they are gradings of -- a customer dragging a leg thinner
 * watches the model and the meter in one glance, which they cannot do while the
 * meter is one scroll down a column of controls.
 *
 * `section` is the narrow-screen placement, where the viewport is under half
 * the height and a card over it would cover the furniture. There it goes back
 * into the sidebar flow.
 */
export type AnalysisPlacement = "floating" | "section";

export function DesignAnalysisPanel({
  analysis,
  placement = "section",
  collapsed = false,
  onToggle,
}: {
  analysis: DesignAnalysis | null;
  placement?: AnalysisPlacement;
  /** Folded to its title and the two scores, so it covers less of the piece. */
  collapsed?: boolean;
  /** Shows the arrow that folds and unfolds it; without it the card cannot fold. */
  onToggle?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!analysis) return null;

  const floating = placement === "floating";
  const score = (block: ScoreBlock) => (block.analysable ? `${block.score}%` : "—");

  return (
    <section
      className={
        floating
          ? // The background is written as a color-mix rather than as
            // `bg-[var(--fc-panel)]/95`, and that is load-bearing: Tailwind
            // cannot apply an opacity modifier to an arbitrary CSS-variable
            // colour, so that class emits no rule at all and the card comes out
            // fully transparent -- invisible over the viewport, and
            // light-on-light text in dark mode.
            "pointer-events-auto w-full rounded-xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-panel)_94%,transparent)] p-3.5 shadow-fc-lg backdrop-blur-md"
          : "border-b border-[var(--fc-border)] p-4"
      }
      /* Nothing on screen says these are estimates any more, and they are:
         published typical timber properties run through textbook beam and
         column formulas. The caveat costs no space as a tooltip and stays one
         hover away, which is the least this can carry without turning back
         into a report. */
      title={uiText("Engineering estimate from this design's spans, sections and stock. The furniture shop that builds it confirms what it can actually be made in.")}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Design analysis")}</h2>
        {collapsed ? (
          // Folded: the two numbers stay readable, the rest is one tap away.
          <span className="ml-auto flex items-center gap-2 font-mono text-xs font-bold tabular-nums">
            <span title={uiText("Durability")} style={{ color: BAND_TONE[analysis.durability.band].text }}>{score(analysis.durability)}</span>
            <span aria-hidden className="text-[var(--fc-border)]">·</span>
            <span title={uiText("Material quality")} style={{ color: BAND_TONE[analysis.quality.band].text }}>{score(analysis.quality)}</span>
          </span>
        ) : null}
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? uiText("Show design analysis") : uiText("Minimize design analysis")}
            title={collapsed ? uiText("Show design analysis") : uiText("Minimize design analysis")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--fc-border)] text-[var(--fc-muted)] transition-colors hover:text-[var(--fc-text)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          >
            <svg viewBox="0 0 16 16" aria-hidden className={`h-3.5 w-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4-4 4 4" />
            </svg>
          </button>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Meter title={uiText("Durability")} block={analysis.durability} />
          <Meter title={uiText("Material quality")} block={analysis.quality} />
        </div>
      )}
    </section>
  );
}
