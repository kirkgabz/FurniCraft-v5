
import { UiText } from "@/components/language/ui-text";
/**
 * The fallback shown while any route without its own loading file is still
 * being fetched.
 *
 * Not a spinner. A spinner says "something is happening" and nothing else; it
 * belongs to no product and reads the same on a bank, a bus timetable and a
 * furniture studio. This is the wordmark over a strand of the solihiya weave
 * drawing itself across, which is the same lattice the icon set is cut from
 * and the one thing on screen that could only be this app.
 *
 * Routes that know their own shape override this with a skeleton of that shape
 * (see app/protected/loading.tsx and app/customize-furniture/loading.tsx): a
 * skeleton tells you what is coming, which this cannot.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[100dvh] place-items-center bg-[var(--fc-bg)] px-6"
    >
      <div className="flex flex-col items-center gap-5">
        <span
          className="text-2xl font-bold tracking-[-0.03em] text-[var(--fc-text)]"
          style={{ fontFamily: "var(--font-display), ui-sans-serif, system-ui, sans-serif" }}
        ><UiText text="FurniCraft" /></span>

        {/* The weave: a track the width of the wordmark with one strand
            travelling along it. Under prefers-reduced-motion the strand stops
            and simply rests at a third of the way across, so the shape still
            reads as a loading bar without anything moving. */}
        <span
          aria-hidden
          className="relative block h-[3px] w-40 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_18%,transparent)]"
        >
          <span className="fc-loading-strand absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--fc-ink-accent)]" />
        </span>

        <span className="sr-only"><UiText text="Loading" /></span>
      </div>
    </div>
  );
}
