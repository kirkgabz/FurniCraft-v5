
import { UiText } from "@/components/language/ui-text";
/**
 * The shop owner's dashboard, before its data arrives.
 *
 * Its own file rather than inheriting app/protected/loading.tsx, which is the
 * customer dashboard's skeleton. Nesting means every route under /protected
 * picks that one up unless it says otherwise, so switching to the shop drew
 * the customer side's two-column overview for a second and then replaced it
 * with something else entirely. On a product that deliberately keeps the two
 * modes apart, a loading screen that shows you the wrong mode is worse than
 * none: it says you are going somewhere you are not.
 *
 * The shop's overview opens on a wide callout and then its incoming queue, so
 * that is what this holds.
 */
const BLOCK = "rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] motion-safe:animate-pulse";
const LINE = "rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] motion-safe:animate-pulse";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="min-h-[100dvh] bg-[var(--fc-bg)]">
      <span className="sr-only"><UiText text="Loading your shop" /></span>

      <div className="flex items-center justify-between border-b border-[var(--fc-border)] px-5 py-[18px] sm:px-7">
        <div className={`${LINE} h-6 w-32`} />
        <div className="flex items-center gap-2">
          <div className={`${LINE} h-9 w-9 rounded-full`} />
          <div className={`${LINE} h-9 w-9 rounded-full`} />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-5 py-7 sm:px-7">
        <aside aria-hidden className="hidden w-56 shrink-0 flex-col gap-2 lg:flex">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className={`${LINE} h-10 w-full`} />
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <div className={`${LINE} h-8 w-48`} />
          <div className={`${LINE} mt-2 h-4 w-64`} />

          {/* The callout the overview opens on, then the filter chips and the
              queue of incoming orders under it. */}
          <div className={`${BLOCK} mt-7 h-32`} />

          <div className="mt-6 flex flex-wrap gap-2">
            {[72, 88, 64, 80].map((width, index) => (
              <div key={index} className={`${LINE} h-8 rounded-full`} style={{ width }} />
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className={`${BLOCK} h-16`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
