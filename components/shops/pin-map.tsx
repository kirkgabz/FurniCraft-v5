"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, useState } from "react";
import { GOOGLE_MAPS_MAP_ID, loadGoogleMaps } from "@/lib/google-maps-loader";
import type { LatLng } from "@/lib/google-geocode";

/** The middle of the Philippines, at a zoom that shows all of it. */
const PH_CENTRE: LatLng = { lat: 12.8797, lng: 121.774 };
const PIN_ZOOM = 17;

function toLiteral(position: google.maps.marker.AdvancedMarkerElement["position"]): LatLng | null {
  if (!position) return null;
  return typeof position.lat === "function"
    ? { lat: (position as google.maps.LatLng).lat(), lng: (position as google.maps.LatLng).lng() }
    : { lat: position.lat as number, lng: position.lng as number };
}

/**
 * A Google map with one draggable pin. The owner drags the pin, or taps the
 * map to drop it there; either reports the new point through onPinMove. A pin
 * moved from outside (the address was picked from the lists) is shown without
 * reporting back, so the two cannot chase each other.
 */
export default function PinMap({
  pin,
  onPinMove,
  onLoadError,
  className = "",
}: {
  pin: LatLng | null;
  onPinMove: (point: LatLng) => void;
  onLoadError?: () => void;
  className?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const onPinMoveRef = useRef(onPinMove);
  const onLoadErrorRef = useRef(onLoadError);
  const initialPin = useRef(pin);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    onPinMoveRef.current = onPinMove;
    onLoadErrorRef.current = onLoadError;
  });

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];

    loadGoogleMaps()
      .then(async () => {
        const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([
          google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
          google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
        ]);
        if (cancelled || !containerRef.current) return;

        const start = initialPin.current;
        const map = new Map(containerRef.current, {
          center: start ?? PH_CENTRE,
          zoom: start ? PIN_ZOOM : 5,
          mapId: GOOGLE_MAPS_MAP_ID,
          // Inside a scrolling form: one finger scrolls the page, two move the map.
          gestureHandling: "cooperative",
          streetViewControl: false,
          mapTypeControl: false,
          clickableIcons: false,
        });
        const marker = new AdvancedMarkerElement({
          map,
          position: start,
          gmpDraggable: true,
          title: "Drag to your shop",
        });

        listeners.push(
          marker.addListener("dragend", () => {
            const point = toLiteral(marker.position);
            if (point) onPinMoveRef.current(point);
          }),
          map.addListener("click", (event: google.maps.MapMouseEvent) => {
            if (!event.latLng) return;
            const point = { lat: event.latLng.lat(), lng: event.latLng.lng() };
            marker.position = point;
            onPinMoveRef.current(point);
          })
        );
        mapRef.current = map;
        markerRef.current = marker;
        setIsReady(true);
      })
      .catch(() => {
        if (!cancelled) onLoadErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      if (markerRef.current) markerRef.current.map = null;
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  // A pin set from outside: move the marker there and bring it into view.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!isReady || !map || !marker || !pin) return;
    const current = toLiteral(marker.position);
    if (current && Math.abs(current.lat - pin.lat) < 1e-7 && Math.abs(current.lng - pin.lng) < 1e-7) return;
    marker.position = pin;
    map.panTo(pin);
    if ((map.getZoom() ?? 0) < 15) map.setZoom(PIN_ZOOM);
  }, [pin, isReady]);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] ${className}`}
    >
      <div ref={containerRef} className="h-full w-full" />
      {isReady ? null : (
        <div className="absolute inset-0 grid place-items-center text-sm text-[var(--fc-muted)]">{uiText("Loading map…")}</div>
      )}
    </div>
  );
}
