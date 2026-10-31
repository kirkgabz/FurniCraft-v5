
import { UiText } from "@/components/language/ui-text";
/**
 * One order, before it loads.
 *
 * Also its own file, for the same reason the shop's is: without it this route
 * inherited the customer dashboard's skeleton and spent a moment pretending to
 * be a dashboard before resolving into a single order. The page is a back
 * link, a heading, the progress stepper, and then eight columns of detail
 * beside a four-column sidebar, so that is the shape held here.
 */
const BLOCK = "rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] motion-safe:animate-pulse";
const LINE = "rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] motion-safe:animate-pulse";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="min-h-[100dvh] bg-[var(--fc-bg)]">
      <span className="sr-only"><UiText text="Loading this order" /></span>

      <div className="mx-auto w-full max-w-5xl px-5 py-8">
        <div className={`${LINE} h-6 w-28 rounded-full`} />
        <div className={`${LINE} mt-5 h-8 w-64`} />
        <div className={`${LINE} mt-2 h-4 w-48`} />

        {/* The stepper across the top of an order. */}
        <div className={`${BLOCK} mt-6 h-14`} />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-8">
            <div className={`${BLOCK} h-56`} />
            <div className={`${BLOCK} h-32`} />
          </div>
          <div className="space-y-4 lg:col-span-4">
            <div className={`${BLOCK} h-40`} />
            <div className={`${BLOCK} h-24`} />
          </div>
        </div>
      </div>
    </div>
  );
}
