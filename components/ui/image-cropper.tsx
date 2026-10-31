"use client";

import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  cropToSquareDataUrl,
  isImageFile,
  loadImage,
  readAsDataUrl,
  type CropOutput,
} from "@/lib/image-utils";

/**
 * Choose which square of a photo to keep.
 *
 * Every square image in FurniCraft used to be cropped from its centre and
 * nothing else: an avatar through resizeImageToSquareDataUrl, a shop logo
 * through fileToDownscaledDataUrl. That is right about as often as the
 * subject happens to be centred, which for a phone photo is rarely, and it
 * was worse for a payment QR -- a screenshot of GCash is mostly app chrome,
 * so the code itself ended up a stamp in the middle of a lot of nothing,
 * too small to scan from a customer's screen.
 *
 * The frame here does not move. The photo moves behind it, which is the
 * difference between adjusting a picture and fighting a box: at any moment
 * what is inside the window is exactly what will be saved, so there is
 * nothing to predict and nothing to undo.
 *
 * Three ways in, because one is never enough across a phone and a laptop:
 * drag, the zoom slider, and the keyboard (arrows nudge, shift for a bigger
 * step, + and - to zoom). The slider earns its place over pinch-to-zoom --
 * it is the only one of the three a keyboard or a screen reader can reach,
 * and a second finger is awkward on the small frame a phone has room for.
 */

type Shape = "circle" | "square";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const NUDGE_PX = 8;
const NUDGE_PX_FAST = 32;

export function ImageCropper({
  file,
  shape = "circle",
  title,
  hint,
  confirmLabel = "Use photo",
  output,
  onCancel,
  onCropped,
}: {
  /** The picked file. Null closes the dialog. */
  file: File | null;
  /** How the window is masked. Square for a QR, circle for a face or a logo. */
  shape?: Shape;
  title: string;
  /** One line under the frame saying what the crop is for. */
  hint?: string;
  confirmLabel?: string;
  output: CropOutput;
  onCancel: () => void;
  onCropped: (dataUrl: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frameSide, setFrameSide] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const open = file !== null;

  // Read and decode on open. Both are async, and a dialog that renders its
  // frame before it knows the image's shape would jump the moment it landed,
  // so nothing is drawn in the frame until `natural` is set.
  useEffect(() => {
    if (!file) {
      setSource(null);
      setNatural(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setError(null);
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });

    void (async () => {
      try {
        if (!isImageFile(file)) throw new Error("Choose an image file.");
        const dataUrl = await readAsDataUrl(file);
        const image = await loadImage(dataUrl);
        if (cancelled) return;
        setSource(dataUrl);
        setNatural({ width: image.naturalWidth, height: image.naturalHeight });
      } catch (readError) {
        if (cancelled) return;
        setError(readError instanceof Error ? readError.message : "That image could not be read.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  // The frame is a CSS square that sizes itself to the dialog, so its pixel
  // width is only knowable after layout -- and it changes when a phone is
  // turned. Every number below is derived from it.
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !open) return;
    const measure = () => setFrameSide(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, natural]);

  /** Scale at which the image exactly covers the frame; zoom multiplies it. */
  const coverScale = natural && frameSide ? frameSide / Math.min(natural.width, natural.height) : 0;
  const scale = coverScale * zoom;
  const displayWidth = natural ? natural.width * scale : 0;
  const displayHeight = natural ? natural.height * scale : 0;

  /** Keeps the frame full: the image may not be dragged off any edge. */
  const clamp = useCallback(
    (next: { x: number; y: number }, atZoom = zoom) => {
      if (!natural || !frameSide) return next;
      const s = coverScale * atZoom;
      const width = natural.width * s;
      const height = natural.height * s;
      return {
        x: Math.min(0, Math.max(frameSide - width, next.x)),
        y: Math.min(0, Math.max(frameSide - height, next.y)),
      };
    },
    [coverScale, frameSide, natural, zoom]
  );

  // Centre the image the first time it and the frame are both measured. This
  // is the centre crop the app did before -- it is a sensible starting point,
  // it just is not the only one on offer any more.
  useEffect(() => {
    if (!natural || !frameSide) return;
    setOffset({ x: (frameSide - displayWidth) / 2, y: (frameSide - displayHeight) / 2 });
    // Only when the image or the frame changes size, never on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, frameSide]);

  /** Zooms about the centre of the frame, so the subject stays put. */
  const applyZoom = useCallback(
    (nextZoom: number) => {
      const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      setOffset((current) => {
        if (!natural || !frameSide) return current;
        const ratio = bounded / zoom;
        const centre = frameSide / 2;
        return clamp(
          { x: centre - (centre - current.x) * ratio, y: centre - (centre - current.y) * ratio },
          bounded
        );
      });
      setZoom(bounded);
    },
    [clamp, frameSide, natural, zoom]
  );

  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!natural) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(
      clamp({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      })
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  // Wheel is attached by hand rather than with onWheel: React's wheel
  // listener is passive, so preventDefault there is ignored and zooming the
  // crop would scroll the dialog behind it at the same time.
  useEffect(() => {
    const node = frameRef.current;
    if (!node || !natural) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyZoom(zoom * (event.deltaY > 0 ? 0.92 : 1.08));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [applyZoom, natural, zoom]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE_PX_FAST : NUDGE_PX;
    const moves: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setOffset((current) => clamp({ x: current.x + move.x, y: current.y + move.y }));
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      applyZoom(zoom + 0.2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      applyZoom(zoom - 0.2);
    }
  };

  const handleConfirm = async () => {
    if (!source || !natural || !frameSide) return;
    setIsWorking(true);
    setError(null);
    try {
      // The frame in source pixels: where its top-left lands on the image,
      // and how much of the image one frame-width covers.
      const dataUrl = await cropToSquareDataUrl(
        source,
        { x: -offset.x / scale, y: -offset.y / scale, side: frameSide / scale },
        output
      );
      onCropped(dataUrl);
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "That image could not be cropped.");
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabel={uiText(title)}
      title={uiText(title)}
      className="sm:max-w-sm"
      dismissOnBackdrop={false}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--fc-border)] px-4 text-sm font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.97]"
          >
            {uiText("Cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!natural || isWorking}
            className="inline-flex min-h-11 items-center rounded-full bg-[var(--fc-btn)] px-5 text-sm font-semibold text-[var(--fc-bg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWorking ? uiText("Saving…") : uiText(confirmLabel)}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          ref={frameRef}
          role="application"
          aria-label={uiText("Drag to move the photo, or use the arrow keys")}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          /*
           * Capped against the viewport's height, not just the dialog's
           * width. A square that takes the full width of a 500px dialog is
           * 500px tall, which on a laptop in landscape pushed the zoom
           * slider and both buttons below the fold -- a crop window you have
           * to scroll to finish using. 52vh leaves room for the header, the
           * slider, the hint and the footer at every height worth having.
           */
          className="relative mx-auto aspect-square w-full max-w-[min(100%,52vh)] touch-none select-none overflow-hidden rounded bg-[var(--fc-bg)] outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--fc-accent)]"
          style={{ cursor: natural ? "grab" : "default" }}
        >
          {source && natural ? (
            // A data URL sized in pixels by the crop maths, so next/image
            // can optimise neither the source nor the layout.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={source}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
                // No transition: a dragged image has to track the finger
                // exactly, and easing a direct manipulation reads as lag.
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-[var(--fc-muted)]">
              {error ? "" : uiText("Opening…")}
            </div>
          )}

          {/* The mask: a ring with an enormous shadow spread, which dims
              everything outside the window without covering it. */}
          {natural ? (
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 ${shape === "circle" ? "rounded-full" : "rounded"}`}
              style={{ boxShadow: "0 0 0 9999px rgba(18, 15, 13, 0.55)" }}
            />
          ) : null}
        </div>

        <label className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--fc-muted)]">{uiText("Zoom")}</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!natural}
            onChange={(event) => applyZoom(Number(event.target.value))}
            className="h-11 flex-1 accent-[var(--fc-accent)]"
          />
        </label>

        {hint ? <p className="text-xs text-[var(--fc-muted)]">{hint}</p> : null}
        {error ? <p className="text-xs text-fc-danger">{uiText(error)}</p> : null}
      </div>
    </Modal>
  );
}
