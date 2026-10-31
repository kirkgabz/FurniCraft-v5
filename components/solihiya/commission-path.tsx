"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useRouter } from "next/navigation";
import Link from "next/link";
import { SolihiyaCell } from "@/components/solihiya/mesh";
import { IconArrowLeft } from "@/components/solihiya/icons";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";
import {
  COMMISSION_STEPS,
  useCommissionPath,
  type CommissionStepLabel,
  type PathStep,
} from "@/lib/commission-path";

/**
 * The commission path: where you are in a commission, and every way back.
 *
 * A caned panel shows its own making -- you can see which rows are woven and
 * which are still bare warp -- and that is exactly the wayfinding this journey
 * was missing. Completed steps render woven and are clickable; the step you are
 * on is the only one carrying the lacquer accent; steps still ahead are strung
 * warp with nothing crossing them yet.
 *
 * "Back" here points at the step you actually arrived from, not at a hardcoded
 * dashboard. `fallback` covers the honest case where there is no trail at all:
 * a customer who opened this URL directly, or came back to it in a new tab.
 */
export default function CommissionPath({
  current,
  fallback,
  upcoming = [],
  onBack,
  className = "",
  showSteps = true,
}: {
  /** The surface rendering this. Announced to the trail on mount. */
  current: PathStep;
  /** Where "Back" goes when there is no trail behind this step. */
  fallback: PathStep;
  /** Steps that come after this one, shown as bare warp. */
  upcoming?: string[];
  /**
   * Run instead of navigating, for a surface whose "back" is a state change.
   *
   * The studio opened from the picker is the case: both live at
   * /customize-furniture and the picker simply stops rendering the studio, so
   * pushing the URL would remount the picker and lose the kind being browsed.
   * Without this the studio had to choose between a trail and a working back
   * button, and it chose the button -- which is why the steps disappeared
   * there.
   */
  onBack?: () => void;
  className?: string;
  /**
   * False when the surface shows the steps in its own CommissionProgress band,
   * leaving this as the Back button alone.
   */
  showSteps?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const { trail, previous } = useCommissionPath(current);
  const back = onBack ? fallback : previous ?? fallback;
  // The back button already labels the most-recent prior step; exclude it from
  // the woven trail so it does not appear twice side-by-side.
  const completed = trail.slice(0, -1).filter((step) => step.href !== back.href);

  return (
    <nav
      aria-label={uiText("Commission path")}
      className={`flex min-w-0 items-center gap-3 ${className}`}
    >
      <button
        type="button"
        onClick={() => (onBack ? onBack() : router.push(back.href))}
        className={BACK_BUTTON_CLASS}
      >
        <IconArrowLeft aria-hidden className="h-4 w-4 motion-safe:transition-transform motion-safe:group-hover:-translate-x-0.5" />
        <span className="max-w-[12rem] truncate" title={uiText(back.label)}>{uiText(back.label)}</span>
      </button>

      {/* The woven record. Hidden on narrow screens, where the labelled Back
          above already answers "how do I get out of here" and a row of cells
          would only compete with the surface's own content. */}
      <ol className={showSteps ? "hidden min-w-0 items-center gap-1.5 md:flex" : "hidden"}>
        {completed.map((step) => (
          <li key={step.href} className="min-w-0">
            <Link
              href={step.href}
              title={uiText("Back to {0}", { 0: step.label })}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-[var(--fc-muted)] transition-colors hover:text-[var(--fc-text)]"
            >
              <SolihiyaCell id={`done-${step.href}`} state="woven" size={22} />
              <span className="max-w-[7rem] truncate">{uiText(step.label)}</span>
            </Link>
          </li>
        ))}

        <li className="flex min-w-0 items-center gap-1.5 px-1">
          <SolihiyaCell id="current" state="active" size={22} />
          <span
            aria-current="step"
            className="max-w-[16rem] truncate text-xs font-bold text-[var(--fc-text)]"
            title={uiText(current.label)}
          >
            {uiText(current.label)}
          </span>
        </li>

        {upcoming.map((label) => (
          <li key={label} className="flex items-center gap-1.5 px-1">
            <SolihiyaCell id={`warp-${label}`} state="warp" size={22} />
            <span className="max-w-[7rem] truncate text-xs text-[var(--fc-muted)] opacity-70">
              {uiText(label)}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The commission's four steps as a band of their own, above a surface's
 * toolbar rather than inside it.
 *
 * In the studio the trail shared one row with nine tools, and at 1366px the
 * step you were on was squeezed to nothing: the row read "Pick a piece,
 * Review, Send to shop" with "Shape it" missing between them. Here the steps
 * are the fixed list (COMMISSION_STEPS), not the browsing trail, so a
 * dashboard section you passed through is never drawn as a step of the order.
 * Steps already done can be returned to when the surface says how (`onStep`).
 */
export function CommissionProgress({
  current,
  onStep,
  className = "",
}: {
  current: CommissionStepLabel;
  onStep?: Partial<Record<CommissionStepLabel, () => void>>;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const index = COMMISSION_STEPS.indexOf(current);

  return (
    <nav
      aria-label={uiText("Progress: step {0} of {1}, {2}", { 0: index + 1, 1: COMMISSION_STEPS.length, 2: current })}
      className={`border-b border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_5%,var(--fc-bg))] px-3 py-1.5 sm:px-5 [@media(pointer:coarse)]:py-0 ${className}`}
    >
      <ol className="mx-auto flex max-w-3xl items-center justify-center gap-1.5 sm:gap-2.5">
        {COMMISSION_STEPS.map((label, i) => {
          const state = i < index ? "woven" : i === index ? "active" : "warp";
          const go = i < index ? onStep?.[label] : undefined;
          const content = (
            <>
              <SolihiyaCell id={`progress-${i}`} state={state} size={20} />
              {/* On a phone only the current step keeps its words; the others
                  are the cells alone, and still read out. */}
              <span
                className={
                  i === index
                    ? "whitespace-nowrap text-xs font-bold text-[var(--fc-text)]"
                    : `whitespace-nowrap text-xs text-[var(--fc-muted)] max-sm:sr-only ${i > index ? "opacity-70" : ""}`
                }
              >
                {uiText(label)}
              </span>
            </>
          );
          return (
            <li key={label} className="flex items-center gap-1.5 sm:gap-2.5">
              {i > 0 ? (
                <span
                  aria-hidden
                  className={`h-px w-4 shrink-0 sm:w-8 ${i <= index ? "bg-[var(--fc-cane)]" : "bg-[var(--fc-border)]"}`}
                />
              ) : null}
              {go ? (
                <button
                  type="button"
                  onClick={go}
                  title={uiText("Back to {0}", { 0: label })}
                  className="flex items-center justify-center gap-1.5 rounded-md px-1 py-1 transition-[background-color,transform] duration-150 hover:bg-[var(--fc-cane-soft)] active:scale-[0.97] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                >
                  {content}
                </button>
              ) : (
                <span aria-current={i === index ? "step" : undefined} className="flex items-center gap-1.5 px-1 py-1">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
