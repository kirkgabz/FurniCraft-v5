"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A shop drawing you can actually read on a phone.
 *
 * The blueprint is generated at a fixed page size -- around 960 x 1410 for a
 * chair -- and both places that showed it dropped that straight into a
 * scrolling box. Measured on a 375px screen that is 2.8x wider than the pane:
 * about a sixth of the drawing visible at once, read by dragging on two axes,
 * with no way to zoom and no way to see the whole sheet. A dimensioned
 * drawing whose dimensions cannot be found is decoration.
 *
 * So it opens fit to the pane -- the whole sheet, every time -- and magnifies
 * on the gestures people already use on a map: pinch, double-tap, or the
 * buttons for anyone not using a touch screen. Zooming sets the SVG's own
 * width rather than transforming it, so the rules and the dimension text stay
 * sharp at every step instead of turning into a bitmap enlargement.
 */
const MAX_SCALE = 6;
/** Below this the text stops being text, so "fit" never goes under it. */
const MIN_SCALE = 0.15;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** The page size the generator wrote onto the root <svg>. */
function naturalSize(markup: string): { w: number; h: number } | null {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(markup);
  if (box) return { w: Number(box[1]), h: Number(box[2]) };
  const w = /\bwidth="([\d.]+)"/.exec(markup);
  const h = /\bheight="([\d.]+)"/.exec(markup);
  return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
}

export function BlueprintViewer({ svg, label }: { svg: string; label?: string }) {
  const { t: uiText } = useUiLanguage();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const natural = useRef(naturalSize(svg));
  const [fit, setFit] = useState(1);
  /** null means "follow the fit scale", so a rotation re-fits rather than stranding an old zoom. */
  const [zoom, setZoom] = useState<number | null>(null);
  const scale = zoom ?? fit;

  useEffect(() => {
    natural.current = naturalSize(svg);
    setZoom(null);
  }, [svg]);

  // Fit is the pane's width over the page's, re-measured whenever the pane
  // changes size -- a rotation, or the dialog growing at sm.
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const measure = () => {
      const page = natural.current;
      if (!page || page.w <= 0) return;
      const available = node.clientWidth - 16;
      if (available > 0) setFit(clamp(available / page.w, MIN_SCALE, 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Applied to the SVG itself: it carries a viewBox, so setting width re-renders
  // the geometry at the new size instead of scaling a finished image.
  useLayoutEffect(() => {
    const page = natural.current;
    const element = holderRef.current?.querySelector("svg");
    if (!element || !page) return;
    element.setAttribute("width", String(page.w * scale));
    element.setAttribute("height", String(page.h * scale));
    element.style.display = "block";
    element.style.maxWidth = "none";
  }, [scale, svg]);

  /** Zooms about a point, keeping whatever is under the fingers under the fingers. */
  const zoomAbout = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const node = scrollRef.current;
      if (!node) return;
      const bounded = clamp(next, MIN_SCALE, MAX_SCALE);
      setZoom((current) => {
        const from = current ?? fit;
        if (bounded === from) return current;
        const box = node.getBoundingClientRect();
        const x = clientX - box.left;
        const y = clientY - box.top;
        const ratio = bounded / from;
        requestAnimationFrame(() => {
          node.scrollLeft = (node.scrollLeft + x) * ratio - x;
          node.scrollTop = (node.scrollTop + y) * ratio - y;
        });
        return bounded;
      });
    },
    [fit]
  );

  // Trackpad pinch arrives as a wheel event with ctrlKey; without this it
  // would zoom the whole page instead of the drawing.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoomAbout((zoom ?? fit) * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAbout, zoom, fit]);

  // Two-finger pinch. Tracked by hand rather than left to the browser, because
  // a scroll container does not pinch-zoom its own contents.
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    pinch.current = {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      scale: zoom ?? fit,
    };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !pinch.current) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinch.current.distance <= 0) return;
    event.preventDefault();
    zoomAbout(
      pinch.current.scale * (distance / pinch.current.distance),
      (a.clientX + b.clientX) / 2,
      (a.clientY + b.clientY) / 2
    );
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    if (event.touches.length < 2) pinch.current = null;
  };

  /** Double-tap: in to read a dimension, out to see the sheet again. */
  const lastTap = useRef(0);
  const onPointerUp = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if ((zoom ?? fit) > fit * 1.2) setZoom(null);
      else zoomAbout(fit * 2.5, event.clientX, event.clientY);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  };

  const atFit = zoom === null || Math.abs(scale - fit) < 0.01;
  const percent = Math.round(scale * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="fc-bp-scroll"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onPointerUp={onPointerUp}
        role="img"
        aria-label={label ? uiText("Blueprint for {0}", { 0: label }) : uiText("Blueprint")}
      >
        <div ref={holderRef} className="fc-bp-holder" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <div className="fc-bp-bar">
        <button
          type="button"
          onClick={() => setZoom(null)}
          aria-pressed={atFit}
          className={`fc-bp-btn${atFit ? " is-on" : ""}`}
        >{uiText("Fit")}</button>
        <button type="button" onClick={() => setZoom(1)} aria-pressed={!atFit && Math.abs(scale - 1) < 0.01} className="fc-bp-btn">
          1:1
        </button>
        <span className="fc-bp-zoom" aria-live="polite">
          {percent}%
        </span>
        <button
          type="button"
          aria-label={uiText("Zoom out")}
          onClick={() => {
            const node = scrollRef.current;
            const box = node?.getBoundingClientRect();
            zoomAbout(scale / 1.4, (box?.left ?? 0) + (node?.clientWidth ?? 0) / 2, (box?.top ?? 0) + (node?.clientHeight ?? 0) / 2);
          }}
          className="fc-bp-btn fc-bp-btn-icon"
        >{"−"}</button>
        <button
          type="button"
          aria-label={uiText("Zoom in")}
          onClick={() => {
            const node = scrollRef.current;
            const box = node?.getBoundingClientRect();
            zoomAbout(scale * 1.4, (box?.left ?? 0) + (node?.clientWidth ?? 0) / 2, (box?.top ?? 0) + (node?.clientHeight ?? 0) / 2);
          }}
          className="fc-bp-btn fc-bp-btn-icon"
        >
          +
        </button>
      </div>
    </div>
  );
}
