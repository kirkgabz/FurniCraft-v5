"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useRef } from "react";
import { useModalA11y } from "@/components/ui/modal";
import { IconClose } from "@/components/solihiya/icons";

/**
 * The phone dashboard's Design and Account menus: a sheet that rises from the
 * bottom of the screen, and a centred dialog from sm up (see globals.css).
 *
 * It comes up from the bar the thumb just touched and leaves the same way:
 * translateY(100%) to 0 over 320ms on an iOS-drawer curve, and back down in
 * 200ms, because a dismissal should feel faster than an arrival. Always
 * mounted and hidden with visibility, so both directions are plain CSS
 * transitions (interruptible -- reopening mid-exit reverses from where it is)
 * and nothing waits on a timer to unmount it.
 *
 * Dragging the handle down closes it, and so does a quick flick that never
 * travels far: velocity counts, not only distance. Dragging up meets friction
 * instead of a wall.
 *
 * Focus, Escape and the body scroll lock come from useModalA11y, the same as
 * every other modal in the app.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const panelRef = useModalA11y(open, onClose);
  const drag = useRef<{ startY: number; startTime: number; dy: number; pointerId: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // One finger only, and never from the close button.
    if (drag.current || (event.target as HTMLElement).closest("button")) return;
    // From sm up this is a centred dialog, not a sheet: there is no bottom
    // edge to throw it at, and dragging would only shift it off centre.
    if (window.matchMedia("(min-width: 640px)").matches) return;
    drag.current = { startY: event.clientY, startTime: performance.now(), dy: 0, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (panelRef.current) panelRef.current.style.transition = "none";
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId || !panelRef.current) return;
    state.dy = event.clientY - state.startY;
    // Down follows the finger; up gets a fraction of it.
    const offset = state.dy > 0 ? state.dy : state.dy * 0.15;
    panelRef.current.style.transform = `translateY(${offset}px)`;
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    drag.current = null;
    const panel = panelRef.current;
    if (panel) {
      panel.style.transition = "";
      panel.style.transform = "";
    }
    const velocity = Math.abs(state.dy) / Math.max(1, performance.now() - state.startTime);
    if (state.dy > 96 || (state.dy > 8 && velocity > 0.11)) onClose();
  };

  return (
    <div className="fc-sheet-root" data-open={open ? "" : undefined} aria-hidden={open ? undefined : true}>
      <div className="fc-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={uiText(title)}
        tabIndex={-1}
        className="fc-sheet-panel"
      >
        <div
          className="fc-sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="fc-sheet-handle" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="fc-sheet-title">{uiText(title)}</h2>
            <button type="button" onClick={onClose} aria-label={uiText("Close")} className="fc-sheet-close">
              <IconClose aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="fc-sheet-body">{children}</div>
      </div>
    </div>
  );
}
