"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef } from "react";
import { ORDER_STATUSES, type OrderStatus } from "@/components/orders/order-status";

/**
 * Where an order has got to, as six steps.
 *
 * The status badge says what an order *is*; this says how far along it is and
 * what is still to come, which is the question someone actually opens an order
 * to answer. The sequence is the live half of ORDER_STATUSES -- the same
 * vocabulary the database enforces in guard_design_order_columns -- so a stage
 * cannot exist here that the order cannot actually reach.
 *
 * `declined` is deliberately not a seventh step. It is not further along the
 * road, it is off it, so it reads as a banner with the road greyed out behind
 * rather than as a destination the order arrived at.
 */

const STEPS: Array<{ status: OrderStatus; label: string }> = [
  { status: "pending_quote", label: "Pending quote" },
  { status: "quoted", label: "Quoted" },
  { status: "confirmed", label: "Confirmed" },
  { status: "payment_submitted", label: "Payment" },
  { status: "in_production", label: "In production" },
  { status: "completed", label: "Completed" },
];

/** Drawn rather than a ✓ character, so it keeps the stroke weight of the rest of the UI at any size. */
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function OrderStepper({ status, className = "" }: { status: string; className?: string }) {
  const { t: uiText } = useUiLanguage();
  const railRef = useRef<HTMLOListElement | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const declined = status === "declined";
  // An unknown status behaves like the start rather than throwing the whole
  // stepper away; -1 would silently mark every step complete.
  const activeIndex = declined ? -1 : Math.max(0, STEPS.findIndex((step) => step.status === status));

  useEffect(() => {
    const rail = railRef.current;
    const active = activeRef.current;
    if (!rail || !active) return;
    if (rail.scrollWidth <= rail.clientWidth) return;

    rail.scrollLeft = Math.max(
      0,
      active.offsetLeft - (rail.clientWidth - active.clientWidth) / 2
    );
  }, [status]);

  return (
    <div className={className}>
      {declined ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-2xl border border-[#c0392b]/35 bg-[rgba(192,57,43,0.08)] px-4 py-3"
        >
          <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#c0392b] text-[11px] font-bold text-white">
            !
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#a8452c]">{uiText("Order declined")}</p>
            <p className="mt-0.5 text-sm text-[var(--fc-muted)]">{uiText("This order was stopped and will not go into production. Start a new design, or message the shop if you think this was a mistake.")}</p>
          </div>
        </div>
      ) : null}

      {/* Phones get the same fact without the sideways scroll. Six labelled
          circles need about 570px; on a 375px screen the rail scrolled itself
          to the live step and left the earlier ones hanging half-off the left
          edge, which reads as broken rather than as scrollable. A bar and a
          count say how far along the order is in the space there actually is.

          Not rendered for a declined order: the banner above already says what
          happened, and a progress bar under it would be claiming the order is
          somewhere on a road it has left. */}
      {declined ? null : (
        <div className="sm:hidden">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold text-[var(--fc-text)]">{uiText(STEPS[activeIndex].label)}</p>
            <p className="shrink-0 text-xs tabular-nums text-[var(--fc-muted)]">{uiText("Step ")}{activeIndex + 1}{uiText(" of ")}{STEPS.length}
            </p>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--fc-border)]"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={activeIndex + 1}
            aria-valuetext={`${STEPS[activeIndex].label}, step ${activeIndex + 1} of ${STEPS.length}`}
          >
            <div
              className="h-full rounded-full bg-[#b26a38] transition-[width] duration-300 ease-out"
              style={{ width: `${((activeIndex + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          {activeIndex < STEPS.length - 1 ? (
            <p className="mt-1.5 text-xs text-[var(--fc-muted)]">{uiText("Next: ")}{uiText(STEPS[activeIndex + 1].label)}</p>
          ) : null}
        </div>
      )}

      {/* The list scrolls rather than wrapping: six labels wrapping to two rows
          breaks the line that carries the whole meaning of the component. */}
      <ol
        ref={railRef}
        className={`hidden min-w-full items-start gap-0 overflow-x-auto pb-1 sm:flex ${declined ? "opacity-45 grayscale" : ""}`}
        aria-label={uiText("Order progress")}
      >
        {STEPS.map((step, index) => {
          const isPast = !declined && index < activeIndex;
          const isCurrent = !declined && index === activeIndex;
          const isLast = index === STEPS.length - 1;

          return (
            <li
              key={step.status}
              ref={isCurrent ? activeRef : undefined}
              className="flex min-w-[92px] flex-1 flex-col items-center"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="flex w-full items-center">
                {/* Half-width rails either side keep every circle centred over
                    its own label, which a single rail between them does not. */}
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 rounded-full ${index === 0 ? "opacity-0" : isPast || isCurrent ? "bg-[#b26a38]" : "bg-[var(--fc-border)]"}`}
                />
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                    isPast
                      ? "bg-[#b26a38] text-white"
                      : isCurrent
                        ? "bg-[#b26a38] text-white ring-4 ring-[rgba(178,106,56,0.25)]"
                        : "border border-[var(--fc-border)] bg-[var(--fc-panel)] text-[var(--fc-muted)]"
                  }`}
                >
                  {isPast ? <CheckMark /> : index + 1}
                </span>
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 rounded-full ${isLast ? "opacity-0" : isPast ? "bg-[#b26a38]" : "bg-[var(--fc-border)]"}`}
                />
              </div>
              <span
                className={`mt-2 px-1 text-center text-[11px] leading-tight ${
                  isCurrent
                    ? "font-bold text-[var(--fc-text)]"
                    : isPast
                      ? "font-semibold text-[var(--fc-text)]"
                      : "text-[var(--fc-muted)]"
                }`}
              >
                {uiText(step.label)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Exported so callers can label a step without duplicating the sequence. */
export { STEPS as ORDER_STEPS };

// A guard against the sequence drifting from the vocabulary it claims to
// mirror: every step must be a real status, and the only live status missing
// must be `declined`, which is off the road by design.
if (process.env.NODE_ENV !== "production") {
  const missing = ORDER_STATUSES.filter(
    (s) => s !== "declined" && !STEPS.some((step) => step.status === s)
  );
  if (missing.length) {
    console.warn(`OrderStepper is missing a status the order can reach: ${missing.join(", ")}`);
  }
}
