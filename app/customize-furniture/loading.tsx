
import { UiText } from "@/components/language/ui-text";
/**
 * The studio, before its model is on screen.
 *
 * This is the slowest route in the app and the one most worth shaping: it
 * loads Three.js and then a GLTF, which is seconds rather than milliseconds,
 * and until now the whole wait was a blank page. The three bands below are
 * where the piece list, the canvas and the part panel actually land, so the
 * layout is already settled when the studio takes over.
 */
const TINT = "bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] motion-safe:animate-pulse";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="min-h-[100dvh] bg-[var(--fc-bg)]">
      <span className="sr-only"><UiText text="Opening the studio" /></span>

      {/* The toolbar across the top. */}
      <div className="flex items-center gap-3 border-b border-[var(--fc-border)] px-4 py-3">
        <div className={`${TINT} h-9 w-28 rounded-full`} />
        <div className={`${TINT} h-9 w-24 rounded-full`} />
        <div className={`${TINT} ml-auto h-9 w-32 rounded-full`} />
      </div>

      <div className="flex min-h-[calc(100dvh-61px)]">
        {/* The piece rail, which only exists from md up. */}
        <aside
          aria-hidden
          className="hidden w-24 shrink-0 flex-col gap-2 border-r border-[var(--fc-border)] p-2 md:flex"
        >
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className={`${TINT} h-20 w-full rounded-xl`} />
          ))}
        </aside>

        {/* The canvas. Left plain rather than pulsing: it is the one area that
            will be filled by something drawn rather than laid out, and a
            breathing rectangle the size of the viewport is a lot of motion to
            put in front of someone who is waiting. */}
        <div className="grid flex-1 place-items-center p-6">
          <div className="h-full w-full rounded-2xl border border-dashed border-[var(--fc-border)]" />
        </div>

        {/* The part panel, from lg up. */}
        <aside
          aria-hidden
          className="hidden w-80 shrink-0 flex-col gap-3 border-l border-[var(--fc-border)] p-4 lg:flex"
        >
          <div className={`${TINT} h-4 w-16 rounded-md`} />
          <div className={`${TINT} h-11 w-full rounded-xl`} />
          <div className={`${TINT} mt-2 h-4 w-24 rounded-md`} />
          <div className="grid grid-cols-2 gap-2">
            <div className={`${TINT} h-16 rounded-xl`} />
            <div className={`${TINT} h-16 rounded-xl`} />
          </div>
          <div className={`${TINT} mt-2 h-4 w-14 rounded-md`} />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className={`${TINT} h-11 w-full rounded-xl`} />
          ))}
        </aside>
      </div>
    </div>
  );
}
