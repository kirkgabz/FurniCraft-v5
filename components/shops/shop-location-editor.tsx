"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import AddressPicker, { type AddressField } from "@/components/shops/address-picker";
import PinMap from "@/components/shops/pin-map";
import { ShopMapFrame } from "@/components/shops/shop-map";
import { useMapTarget } from "@/components/shops/shop-map";
import { geocodeAddress, reverseGeocode, type LatLng } from "@/lib/google-geocode";
import { googleMapsPinUrl } from "@/lib/google-maps";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { parsePhAddress, phAddressMapQuery, type GeoParts } from "@/lib/ph-address";

/**
 * Where the shop is, set two ways that keep each other in step -- the way
 * checkout address forms in the Philippines work:
 *
 *  - Pick Province / City / Barangay (and ZIP, street) from the lists, and the
 *    pin moves to that address.
 *  - Drag the pin, or tap the map, and the lists change to the address at that
 *    spot (read by Google's geocoder and matched to the official names).
 *
 * The pin is the exact location customers are sent to; it is saved as a Google
 * Maps link in the existing map_url column (googleMapsPinUrl), which the shop
 * page reads straight back. The address line is saved in `address` as before.
 *
 * Once the owner has placed the pin by hand, changing only the barangay, ZIP
 * or street does not move it -- they are correcting the text, not the place.
 * Choosing a different province or city does, because the old pin is then in
 * the wrong town.
 */
export default function ShopLocationEditor({
  savedAddress,
  savedMapUrl,
  shopName,
  onChange,
  fieldClassName,
  labelClassName,
}: {
  savedAddress: string;
  savedMapUrl: string;
  shopName: string;
  onChange: (next: { address: string; incomplete: boolean; mapUrl: string }) => void;
  fieldClassName: string;
  labelClassName: string;
}) {
  const { t: uiText } = useUiLanguage();
  const [line, setLine] = useState("");
  const [incomplete, setIncomplete] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(null);
  /** Where the pin came from: the saved link, the picked address, or the owner's hand. */
  const pinSource = useRef<"saved" | "address" | "manual" | null>(null);
  const [fromPin, setFromPin] = useState<{ parts: GeoParts; seq: number } | null>(null);
  const [wantsGeocode, setWantsGeocode] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  // The saved pin, once. A short share link pasted before this editor existed
  // is followed by /api/map-embed the same way the shop page does.
  const savedTarget = useMapTarget(savedMapUrl);
  const seededPin = useRef(false);
  useEffect(() => {
    if (seededPin.current || savedTarget.status === "loading") return;
    seededPin.current = true;
    if (savedTarget.status === "found" && savedTarget.target.kind === "coords") {
      pinSource.current = "saved";
      setPin({ lat: savedTarget.target.lat, lng: savedTarget.target.lng });
    } else if (parsePhAddress(savedAddress)) {
      // An address with no pin yet: put the pin on it.
      setWantsGeocode(true);
    }
  }, [savedTarget, savedAddress]);

  // The address was picked from the lists: move the pin to it. Only a newer
  // lookup (or the owner moving the pin) supersedes one in flight -- typing in
  // the street meanwhile must not throw its answer away.
  const lookupId = useRef(0);
  useEffect(() => {
    if (!wantsGeocode || mapFailed) return;
    const parsed = parsePhAddress(line);
    if (!parsed) return;
    setWantsGeocode(false);
    const id = ++lookupId.current;
    const isStale = () => id !== lookupId.current;
    loadGoogleMaps()
      .then(() => geocodeAddress(phAddressMapQuery(parsed)))
      .then((point) => {
        if (isStale()) return;
        if (point) {
          pinSource.current = "address";
          setPin(point);
          setStatus(null);
        } else {
          setStatus("Google couldn't find this address on the map. Drag the pin to your shop.");
        }
      })
      .catch(() => {
        if (!isStale()) setMapFailed(true);
      });
  }, [wantsGeocode, line, mapFailed]);

  // Leaving the form abandons any lookup still in flight.
  useEffect(() => () => void ++lookupId.current, []);

  const handleUserChange = useCallback((field: AddressField) => {
    if (field === "province" || field === "city" || (field === "barangay" && pinSource.current !== "manual")) {
      setWantsGeocode(true);
    }
  }, []);

  const pinMoveId = useRef(0);
  const handlePinMove = useCallback(async (point: LatLng) => {
    // The owner's hand beats any address lookup still on its way.
    lookupId.current++;
    pinSource.current = "manual";
    setPin(point);
    setStatus("Reading the address at the pin…");
    // Two quick drags: only the last one's address may land.
    const id = ++pinMoveId.current;
    const parts = await reverseGeocode(point);
    if (id !== pinMoveId.current) return;
    if (!parts) {
      setStatus("Google couldn't read an address at this spot. Choose your address from the lists; the pin stays where you put it.");
      return;
    }
    setStatus(null);
    setFromPin((current) => ({ parts, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const handleAddressChange = useCallback((address: string, isIncomplete: boolean) => {
    setLine(address);
    setIncomplete(isIncomplete);
  }, []);

  const mapUrl = pin ? googleMapsPinUrl(pin.lat, pin.lng) : savedMapUrl;
  useEffect(() => {
    onChange({ address: line, incomplete, mapUrl });
    // onChange is the parent's setter; see AddressPicker for why it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, incomplete, mapUrl]);

  const parsedLine = parsePhAddress(line);

  return (
    <>
      <AddressPicker
        initial={savedAddress}
        onChange={handleAddressChange}
        fromPin={fromPin}
        onUserChange={handleUserChange}
        fieldClassName={fieldClassName}
        labelClassName={labelClassName}
      />

      <div className="space-y-2 sm:col-span-2">
        {mapFailed ? (
          <>
            <p className="rounded-2xl border border-[#c0392b]/30 bg-[#c0392b]/10 px-3 py-2 text-xs text-[#a8452c]">{uiText("The Google map could not load, so the pin can't be moved right now. Check the Google Maps API key, or save your address from the lists and set the pin later.")}</p>
            {pin || parsedLine ? (
              <ShopMapFrame
                target={pin ? { kind: "coords", ...pin } : { kind: "query", query: phAddressMapQuery(parsedLine!) }}
                title={uiText("Map preview for {0}", { 0: shopName || uiText("your shop") })}
                className="h-56"
              />
            ) : null}
          </>
        ) : (
          <>
            <PinMap pin={pin} onPinMove={handlePinMove} onLoadError={() => setMapFailed(true)} className="h-72" />
            <p className="text-xs text-[var(--fc-muted)]">
              {pin ? uiText("Drag the pin, or tap the map, to put it exactly on your shop. The address above updates to match. Customers are sent to this pin.") : uiText("Choose your address above and the pin will move there, or tap the map to drop the pin on your shop.")}
            </p>
          </>
        )}
        {status ? (
          <p role="status" className="text-xs font-semibold text-[var(--fc-ink-accent)]">
            {uiText(status)}
          </p>
        ) : null}
      </div>
    </>
  );
}
