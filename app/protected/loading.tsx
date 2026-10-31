
import { UiText } from "@/components/language/ui-text";
/**
 * The signed-in chrome, before any of it has data.
 *
 * Deliberately mode-neutral. A loading file applies to its segment and to
 * everything nested under it, so this one is the first thing drawn for the
 * customer dashboard, the shop dashboard, the generator and an order page
 * alike. An earlier version of it was the customer overview's own two-column
 * shape, which meant switching to the shop drew the customer side for a beat
 * before the shop's own skeleton replaced it -- on a product that keeps the
 * two modes apart, a loading screen showing the wrong mode is worse than
 * none.
 *
 * So this holds only what every one of those routes really shares: the header
 * band, the sidebar's run of nav items from lg up, and a column of content
 * blocks. The routes whose shape differs enough to be worth saying override
 * it (app/protected/shop/loading.tsx, app/protected/orders/[id]/loading.tsx).
 *
 * `motion-safe:animate-pulse` on accent-tinted blocks is the idiom the
 * dashboard's own in-page skeletons already use (see CustomerHome's
 * !ordersLoaded branch), so this hands over to those without a visible change
 * of material.
 */
const BLOCK = "rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] motion-safe:animate-pulse";
const LINE = "rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] motion-safe:animate-pulse";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="min-h-[100dvh] bg-[var(--fc-bg)]">
      <span className="sr-only"><UiText text="Loading" /></span>

      {/* The header band, at the height the real one holds. */}
      <div className="flex items-center justify-between border-b border-[var(--fc-border)] px-5 py-[18px] sm:px-7">
        <div className={`${LINE} h-6 w-32`} />
        <div className="flex items-center gap-2">
          <div className={`${LINE} h-9 w-9 rounded-full`} />
          <div className={`${LINE} h-9 w-9 rounded-full`} />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-5 py-7 sm:px-7">
        {/* The sidebar is a drawer below lg and pinned open above it, so the
            skeleton only claims that column where the real one would be. */}
        <aside aria-hidden className="hidden w-56 shrink-0 flex-col gap-2 lg:flex">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className={`${LINE} h-10 w-full`} />
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <div className={`${LINE} h-8 w-56`} />
          <div className={`${LINE} mt-2 h-4 w-72`} />

          <div className="mt-7 space-y-4">
            <div className={`${BLOCK} h-36`} />
            <div className={`${BLOCK} h-24`} />
            <div className={`${BLOCK} h-24`} />
          </div>
        </div>
      </div>
    </div>
  );
}
