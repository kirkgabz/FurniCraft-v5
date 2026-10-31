"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PH_ADDRESS_BASE,
  ZIP_PATTERN,
  formatPhAddress,
  matchBarangay,
  matchCity,
  matchProvince,
  parsePhAddress,
  type GeoParts,
  type PhCity,
  type PhProvince,
} from "@/lib/ph-address";

/**
 * The shop's address, picked the way checkout forms in the Philippines ask for
 * one: Province, then City/Municipality, then Barangay, then the street and
 * ZIP. Picking from the PSGC lists (rather than typing) is what lets Google
 * Maps find the place reliably -- "Brgy. San Pedro, PPC" is ambiguous to a
 * geocoder, "San Pedro, City of Puerto Princesa, Palawan" is not.
 *
 * Reports the finished one-line address through onChange, or "" with
 * `incomplete` set while a part the owner has started is still missing, so
 * the editor can refuse to save half an address.
 *
 * `fromPin` is the other way in: address parts read from where the owner
 * dropped the map pin. They are matched to the same lists, so the picker only
 * ever holds official names; a part that does not match is left to choose.
 * `onUserChange` says which field the owner changed by hand, so the map can
 * follow a new city without undoing a pin they placed on purpose.
 */

export type AddressField = "province" | "city" | "barangay" | "detail";
export default function AddressPicker({
  initial,
  onChange,
  fromPin,
  onUserChange,
  fieldClassName,
  labelClassName,
}: {
  /** The saved address line; prefills the picker when it was made by it. */
  initial: string;
  onChange: (address: string, incomplete: boolean) => void;
  /** Parts read from the map pin; applied each time `seq` changes. */
  fromPin?: { parts: GeoParts; seq: number } | null;
  onUserChange?: (field: AddressField) => void;
  fieldClassName: string;
  labelClassName: string;
}) {
  const { t: uiText } = useUiLanguage();
  const saved = useMemo(() => parsePhAddress(initial), [initial]);

  const [provinces, setProvinces] = useState<PhProvince[] | null>(null);
  const [cities, setCities] = useState<PhCity[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provinceCode, setProvinceCode] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [barangay, setBarangay] = useState(saved?.barangay ?? "");
  const [street, setStreet] = useState(saved?.street ?? "");
  const [zip, setZip] = useState(saved?.zip ?? "");
  /** What the last pin drop could not fill in, for the owner to finish. */
  const [pinNote, setPinNote] = useState<string | null>(null);
  /** Pin parts waiting for their province's city list to load. */
  const pendingPin = useRef<GeoParts | null>(null);

  const applyPinCity = useCallback((list: PhCity[], parts: GeoParts) => {
    const city = matchCity(list, parts);
    if (!city) {
      setCityCode("");
      setBarangay("");
      setPinNote("We couldn't tell which city or municipality the pin is in. Choose it from the list.");
      return;
    }
    setCityCode(city.code);
    const barangayName = matchBarangay(city, parts);
    setBarangay(barangayName ?? "");
    if (parts.zip) setZip(parts.zip);
    if (parts.street) setStreet(parts.street);
    setPinNote(
      barangayName
        ? parts.zip
          ? null
          : "Enter your ZIP code. Google didn't give one for this spot."
        : "Choose your barangay. Google didn't name one we could match for this spot."
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${PH_ADDRESS_BASE}/provinces.json`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((list: PhProvince[]) => {
        if (cancelled) return;
        setProvinces(list);
        // Prefill from the saved line by name; the codes are not stored.
        const match = saved && list.find((p) => p.name === saved.province);
        if (match) setProvinceCode(match.code);
      })
      .catch(() => !cancelled && setLoadError("Could not load the list of provinces. Check your connection and reopen this form."));
    return () => {
      cancelled = true;
    };
  }, [saved]);

  useEffect(() => {
    if (!provinceCode) return;
    let cancelled = false;
    fetch(`${PH_ADDRESS_BASE}/${provinceCode}.json`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((list: PhCity[]) => {
        if (cancelled) return;
        setCities(list);
        if (pendingPin.current) {
          applyPinCity(list, pendingPin.current);
          pendingPin.current = null;
          return;
        }
        setCityCode((current) => {
          if (current && list.some((c) => c.code === current)) return current;
          const match = saved && list.find((c) => c.name === saved.city);
          if (!match || !saved) return "";
          // About a hundred barangay names have a comma in them ("Osmeña,
          // Sr."), which the saved line's comma split cannot see. With the
          // city's list in hand, the barangay is the longest name the line
          // ends with, and the street is what comes before it.
          const rest = [saved.street, saved.barangay].filter(Boolean).join(", ");
          const found = match.barangays
            .filter((name) => rest === name || rest.endsWith(`, ${name}`))
            .sort((a, b) => b.length - a.length)[0];
          if (found) {
            setBarangay(found);
            setStreet(rest === found ? "" : rest.slice(0, rest.length - found.length - 2));
          }
          return match.code;
        });
      })
      .catch(() => !cancelled && setLoadError("Could not load the cities for that province. Try again."));
    return () => {
      cancelled = true;
    };
  }, [provinceCode, saved, applyPinCity]);

  // A pin drop: match its province, then (once that province's cities are
  // loaded) its city and barangay.
  const pinSeq = fromPin?.seq;
  useEffect(() => {
    if (!fromPin || !provinces) return;
    const province = matchProvince(provinces, fromPin.parts);
    if (!province) {
      setPinNote("We couldn't match the pin to a province. Choose your address from the lists.");
      return;
    }
    if (province.code === provinceCode && cities) {
      applyPinCity(cities, fromPin.parts);
      return;
    }
    pendingPin.current = fromPin.parts;
    setProvinceCode(province.code);
    setCities(null);
    setCityCode("");
    setBarangay("");
    // Only a new pin drop re-runs this; the lists it reads are current when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinSeq, provinces]);

  const province = provinces?.find((p) => p.code === provinceCode) ?? null;
  const city = cities?.find((c) => c.code === cityCode) ?? null;
  const barangayValid = Boolean(city && city.barangays.includes(barangay));
  const zipValid = ZIP_PATTERN.test(zip.trim());

  const line =
    province && city && barangayValid && zipValid
      ? formatPhAddress({ street, barangay, city: city.name, province: province.name, zip })
      : "";

  const incomplete = !line && Boolean(provinceCode || zip || street.trim());

  useEffect(() => {
    onChange(line, incomplete);
    // onChange is the parent's setter; reporting on every render it changes
    // would loop through the parent's re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, incomplete]);

  const select = `${fieldClassName} mt-1 disabled:opacity-60`;

  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      {initial && !saved ? (
        <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-3 text-xs text-[var(--fc-muted)] sm:col-span-2">{uiText("Your current address is ")}<span className="font-semibold text-[var(--fc-text)]">{initial}</span>{uiText(". Choose your province, city and barangay below so customers can find you on the map.")}</p>
      ) : null}
      {pinNote ? (
        <p role="status" className="rounded-2xl border border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--fc-text)] sm:col-span-2">
          {pinNote}
        </p>
      ) : null}
      {loadError ? (
        <p className="text-xs font-semibold text-[#a8452c] sm:col-span-2">{uiText(loadError)}</p>
      ) : null}

      <label className="block">
        <span className={labelClassName}>{uiText("Province")}</span>
        <select
          className={select}
          value={provinceCode}
          disabled={!provinces}
          onChange={(event) => {
            setProvinceCode(event.target.value);
            setCities(null);
            setCityCode("");
            setBarangay("");
            setPinNote(null);
            onUserChange?.("province");
          }}
        >
          <option value="">{provinces ? uiText("Select province") : uiText("Loading…")}</option>
          {provinces?.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClassName}>{uiText("City / Municipality")}</span>
        <select
          className={select}
          value={cityCode}
          disabled={!provinceCode || !cities}
          onChange={(event) => {
            setCityCode(event.target.value);
            setBarangay("");
            setPinNote(null);
            onUserChange?.("city");
          }}
        >
          <option value="">{provinceCode && !cities ? uiText("Loading…") : uiText("Select city / municipality")}</option>
          {cities?.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClassName}>{uiText("Barangay")}</span>
        <select
          className={select}
          value={barangayValid ? barangay : ""}
          disabled={!city}
          onChange={(event) => {
            setBarangay(event.target.value);
            setPinNote(null);
            onUserChange?.("barangay");
          }}
        >
          <option value="">{uiText("Select barangay")}</option>
          {city?.barangays.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className={labelClassName}>{uiText("ZIP code")}</span>
        <input
          className={`${fieldClassName} mt-1`}
          value={zip}
          onChange={(event) => {
            setZip(event.target.value.replace(/\D/g, "").slice(0, 4));
            onUserChange?.("detail");
          }}
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="e.g. 5300"
        />
        {zip && !zipValid ? (
          <span className="mt-1 block text-xs text-[#a8452c]">{uiText("A Philippine ZIP code has 4 digits.")}</span>
        ) : null}
      </label>

      <label className="block sm:col-span-2">
        <span className={labelClassName}>{uiText("Street, building, house no.")}</span>
        <input
          className={`${fieldClassName} mt-1`}
          value={street}
          // Commas are kept: the stored line is split from its end, so the
          // street is whatever is left at the front.
          onChange={(event) => {
            setStreet(event.target.value);
            onUserChange?.("detail");
          }}
          autoComplete="street-address"
          placeholder={uiText("e.g. 123 Rizal Avenue")}
        />
      </label>
    </div>
  );
}
