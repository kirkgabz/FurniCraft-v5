"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_SHOP_POLICIES } from "./shop-policies";
import PhoneInput from "@/components/ui/phone-input";
import { ShopLogo } from "@/components/shops/shop-logo";
import { ImageCropper } from "@/components/ui/image-cropper";
import { ShopMapFrame, useShopLocation } from "@/components/shops/shop-map";
import AddressPicker from "@/components/shops/address-picker";
import SocialLinksEditor from "@/components/shops/social-links-editor";
import { notifySaved } from "@/lib/saved-notice";
import ShopLocationEditor from "@/components/shops/shop-location-editor";
import { GOOGLE_MAPS_API_KEY } from "@/lib/google-maps-loader";
import { signedUrlFor, uploadQr, QR_BUCKET } from "@/components/orders/payment-proof";
import {
  COVER_IMAGE_OPTIONS,
  GALLERY_IMAGE_OPTIONS,
  LOGO_IMAGE_OPTIONS,
  dataUrlBytes,
  dataUrlToFile,
  fileToDownscaledDataUrl,
  formatBytes,
} from "@/lib/image-utils";
import {
  MAX_GALLERY_PHOTOS,
  parseGallery,
  SHOP_PLACEHOLDER_IMAGE,
  type ShopPhoto,
} from "./shop-types";
import { QUICK_ANSWER_MAX_CHARS, QUICK_QUESTIONS, parseQuickAnswers, type QuickAnswers } from "@/lib/shop-assistant";
import ShopMaterialStockPicker from "@/components/shops/shop-material-stock-picker";
import { materialStockIssues } from "@/lib/shops/material-stock";

/**
 * Storefront editor for an approved shop owner: the details and photos that
 * customers see on the shop card.
 *
 * Photos are downscaled in the browser before they are stored, because they are
 * persisted inline on the shop row rather than in object storage -- so the size
 * of what gets saved is shown to the owner as they add pictures.
 */

/**
 * The editor's sections, one tab each, so an owner changing their hours does
 * not scroll past the cover photo, the gallery and the payment QR to get there.
 */
const TABS = [
  { id: "profile", label: "Profile" },
  { id: "location", label: "Location" },
  { id: "materials", label: "Materials & colors" },
  { id: "photos", label: "Photos" },
  { id: "policies", label: "Policies" },
  { id: "answers", label: "Quick answers" },
  { id: "payment", label: "Payment" },
  { id: "links", label: "Links" },
] as const;
export type StorefrontTab = (typeof TABS)[number]["id"];

type Props = {
  shopId: string;
  open: boolean;
  onClose: () => void;
  /** Receives the saved storefront so the dashboard can update without refetching. */
  onSaved?: (result: FormState) => void;
  /**
   * Which tab to land on, re-read every time the dialog opens.
   *
   * The dashboard opens this one dialog from five different places, and a
   * button that says "Edit payment details" landing on Profile asks the shop
   * to go and find the thing it just named. Each caller says where it meant.
   */
  initialTab?: StorefrontTab;
};

export type FormState = {
  shopName: string;
  tagline: string;
  description: string;
  address: string;
  phone: string;
  hours: string;
  mapUrl: string;
  policies: string;
  coverImageUrl: string;
  /** Downscaled data URL (LOGO_IMAGE_OPTIONS); empty shows the initials. */
  logoUrl: string;
  gallery: ShopPhoto[];
  /** Storage path of the QR image, not a URL: the bucket is private. */
  paymentQrUrl: string;
  paymentInstructions: string;
  paymentAccountName: string;
  paymentAccountNumber: string;
  quickAnswers: QuickAnswers;
  allowedMaterials: string[];
  /** Whole pesos as typed; both empty means no range (20261101100000). */
  priceRangeMin: string;
  priceRangeMax: string;
};

/** What is wrong with a price range as typed, or null when it can be saved. */
export function priceRangeProblem(min: string, max: string): string | null {
  if (!min.trim() && !max.trim()) return null;
  if (!min.trim() || !max.trim()) return "Give both a lowest and a highest price, or leave both empty.";
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || low <= 0) return "The lowest price must be more than ₱0.";
  if (!Number.isFinite(high) || high < low) return "The highest price can't be lower than the lowest.";
  return null;
}

const EMPTY_FORM: FormState = {
  priceRangeMin: "",
  priceRangeMax: "",
  allowedMaterials: [],
  shopName: "",
  tagline: "",
  description: "",
  address: "",
  phone: "",
  hours: "",
  mapUrl: "",
  policies: "",
  coverImageUrl: "",
  logoUrl: "",
  gallery: [],
  paymentQrUrl: "",
  paymentInstructions: "",
  paymentAccountName: "",
  paymentAccountNumber: "",
  quickAnswers: {},
};

/** Postgres reports an unknown column with this code; it means the migration is pending. */
const UNDEFINED_COLUMN = "42703";

type RequiredField = { tab: StorefrontTab; label: string; key?: string };

function missingRequired(form: FormState, addressIncomplete: boolean, requireAnswers: boolean): RequiredField[] {
  const blank = (value: string) => !value.trim();
  const checks: Array<[boolean, RequiredField]> = [
    [blank(form.logoUrl), { tab: "profile", label: "Logo" }],
    [blank(form.coverImageUrl), { tab: "profile", label: "Cover photo" }],
    [blank(form.shopName), { tab: "profile", label: "Shop name" }],
    [blank(form.tagline), { tab: "profile", label: "Tagline" }],
    [blank(form.description), { tab: "profile", label: "About your shop" }],
    [blank(form.phone), { tab: "location", label: "Phone" }],
    [blank(form.hours), { tab: "location", label: "Opening hours" }],
    [blank(form.address) || addressIncomplete, { tab: "location", label: "Shop address" }],
    [blank(form.policies), { tab: "policies", label: "Shop policies" }],
    [materialStockIssues(form.allowedMaterials).length > 0, { tab: "materials", label: "Available materials and colors" }],
    [blank(form.paymentQrUrl), { tab: "payment", label: "Payment QR" }],
    [blank(form.paymentAccountName), { tab: "payment", label: "Account name" }],
    [blank(form.paymentAccountNumber), { tab: "payment", label: "Account number" }],
    [blank(form.paymentInstructions), { tab: "payment", label: "Payment instructions" }],
  ];
  const missing = checks.filter(([isMissing]) => isMissing).map(([, field]) => field);
  if (requireAnswers) {
    for (const question of QUICK_QUESTIONS) {
      if (blank(form.quickAnswers[question.id] ?? "")) {
        missing.push({ tab: "answers", label: "Quick answers", key: `answer:${question.id}` });
      }
    }
  }
  return missing;
}

/**
 * Four of the quick questions are already answered elsewhere in this form.
 *
 * A shop that has typed its address on the Location tab should not have to
 * type it again under "Where is your shop?", and the two drifting apart is
 * worse than either: the chat answers from quick_answers while the
 * storefront shows the address column, so a shop that moves and updates
 * only one of them tells customers two different things.
 *
 * Phrased as a sentence rather than pasted raw, because the field is shown
 * to a customer exactly as written and "123 Rizal St, Puerto Princesa" is
 * not an answer to a question. Returns null where there is nothing honest
 * to build from -- the lead time, the downpayment and what the shop makes
 * are judgements no other field holds.
 */
function suggestedAnswer(questionId: string, form: FormState): string | null {
  const text = (value: string) => value.trim();
  switch (questionId) {
    case "location": {
      const address = text(form.address);
      const map = text(form.mapUrl);
      if (!address && !map) return null;
      // Deliberately the address alone, with no link in it. The chat draws
      // the shop's map under this answer from the shop's own columns (see
      // ShopMapPreview), so a pasted URL would be noise in the bubble and
      // would eat the character budget the address needs.
      return address ? `We're at ${address}.` : null;
    }
    case "hours": {
      const hours = text(form.hours);
      return hours ? `We're open ${hours}.` : null;
    }
    case "contact": {
      const phone = text(form.phone);
      return phone ? `You can reach us on ${phone}, or message us here.` : null;
    }
    case "ordering": {
      const name = text(form.paymentAccountName);
      const number = text(form.paymentAccountNumber);
      if (!name || !number) return null;
      const extra = text(form.paymentInstructions);
      const base = `Send your downpayment to ${name}, ${number}, then upload the receipt here.`;
      return extra ? `${base} ${extra}` : base;
    }
    default:
      return null;
  }
}

export default function StorefrontEditor({ shopId, open, onClose, onSaved, initialTab = "profile" }: Props) {
  const { t: uiText } = useUiLanguage();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [materialIssues, setMaterialIssues] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<StorefrontTab>("profile");
  const [error, setError] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [isUploadingQr, setIsUploadingQr] = useState(false);
  // A signed URL for the stored QR; the bucket is private so the raw path is not viewable.
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The picked file for whichever square image is being cropped, and which
   * one it is. One pair of state rather than two, because the cropper is a
   * dialog and only one can be open.
   */
  const [cropping, setCropping] = useState<{ kind: "logo" | "qr"; file: File } | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  /** The address as loaded, for the picker to prefill from; form.address follows the picker. */
  const [savedAddress, setSavedAddress] = useState("");
  const [savedMapUrl, setSavedMapUrl] = useState("");
  /** The owner has started picking an address and not finished it. */
  const [isAddressIncomplete, setIsAddressIncomplete] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [quickAnswersReady, setQuickAnswersReady] = useState(true);
  const [priceRangeReady, setPriceRangeReady] = useState(false);
  /**
   * What this form last filled in for each question, so an answer the owner
   * has written is never overwritten. A blank answer, or one still holding
   * the previous suggestion, follows its field; the moment it is edited it
   * stops following and is theirs.
   */
  const appliedSuggestions = useRef<Record<string, string>>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const handleAddressChange = useCallback((line: string, incomplete: boolean) => {
    setIsAddressIncomplete(incomplete);
    if (line) setForm((current) => (current.address === line ? current : { ...current, address: line }));
  }, []);
  const handleLocationChange = useCallback(
    ({ address, incomplete, mapUrl }: { address: string; incomplete: boolean; mapUrl: string }) => {
      handleAddressChange(address, incomplete);
      setForm((current) => (current.mapUrl === mapUrl ? current : { ...current, mapUrl }));
    },
    [handleAddressChange]
  );

  useEffect(() => {
    if (!open || !shopId) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setTab(initialTab);
      appliedSuggestions.current = {};
      setError(null);
      setTriedSave(false);
      try {
        const supabase = createClient();
        let result = await supabase
          .from("shops")
          // The payment columns have to be read as well as written. They were
          // missing from this list while handleSave still sent all four, so
          // every save wrote the empty strings this form had started with --
          // a shop that edited its opening hours lost its GCash number and QR
          // in the same click, and nothing on screen said so.
          .select(
            "shop_name, description, address, tagline, cover_image_url, logo_url, gallery, phone, hours, policies, map_url, " +
              "payment_qr_url, payment_instructions, payment_account_name, payment_account_number, allowed_materials"
          )
          .eq("id", shopId)
          .maybeSingle();

        // Fall back to the pre-migration columns so the editor still opens.
        if (result.error) {
          result = await supabase
            .from("shops")
            .select("shop_name, description, address")
            .eq("id", shopId)
            .maybeSingle();
          if (!result.error && !cancelled) {
            setError(
              "Storefront photo fields aren't set up yet. Run the 2026-08-24-shop-storefront-profile migration in Supabase to enable the cover photo and gallery."
            );
          }
        }
        if (cancelled) return;
        if (result.error) throw result.error;

        const row = (result.data ?? {}) as Record<string, unknown>;
        const asText = (value: unknown) => (typeof value === "string" ? value : "");
        setSavedAddress(asText(row.address));
        setSavedMapUrl(asText(row.map_url));
        setForm({
          shopName: asText(row.shop_name),
          tagline: asText(row.tagline),
          description: asText(row.description),
          address: asText(row.address),
          phone: asText(row.phone),
          hours: asText(row.hours),
          policies: asText(row.policies),
          mapUrl: asText(row.map_url),
          coverImageUrl: asText(row.cover_image_url),
          logoUrl: asText(row.logo_url),
          paymentQrUrl: asText(row.payment_qr_url),
          paymentInstructions: asText(row.payment_instructions),
          paymentAccountName: asText(row.payment_account_name),
          paymentAccountNumber: asText(row.payment_account_number),
          gallery: parseGallery(row.gallery),
          quickAnswers: {},
          allowedMaterials: Array.isArray(row.allowed_materials) ? row.allowed_materials.filter((id): id is string => typeof id === "string") : [],
          priceRangeMin: "",
          priceRangeMax: "",
        });

        // Read on its own so the editor still opens before the price-range
        // migration (20261101100000) is applied; the fields hide until it is.
        const range = await supabase.from("shops").select("price_range_min, price_range_max").eq("id", shopId).maybeSingle();
        if (cancelled) return;
        setPriceRangeReady(!range.error);
        if (!range.error) {
          const value = (n: unknown) => (n == null ? "" : String(Math.round(Number(n))));
          const r = (range.data ?? {}) as { price_range_min?: unknown; price_range_max?: unknown };
          setForm((current) => ({ ...current, priceRangeMin: value(r.price_range_min), priceRangeMax: value(r.price_range_max) }));
        }

        const answers = await supabase.from("shops").select("quick_answers").eq("id", shopId).maybeSingle();
        if (cancelled) return;
        setQuickAnswersReady(!answers.error);
        if (!answers.error) {
          const quickAnswers = parseQuickAnswers((answers.data as { quick_answers?: unknown } | null)?.quick_answers);
          setForm((current) => ({ ...current, quickAnswers }));
        }
      } catch (loadError) {
        if (!cancelled) {
          console.error("Failed to load storefront:", loadError);
          setError("Could not load your storefront details.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, shopId, initialTab]);

  /**
   * Fills the four answerable questions from the fields that already hold
   * the answer, and keeps them in step while the owner is still in here --
   * correcting the address on the Location tab updates "Where is your shop?"
   * with it. An answer the owner has written is never touched: it only
   * follows while it is blank or still exactly what this filled in.
   */
  useEffect(() => {
    if (!open) return;
    setForm((current) => {
      const answers = { ...current.quickAnswers };
      let changed = false;
      for (const question of QUICK_QUESTIONS) {
        const suggestion = suggestedAnswer(question.id, current);
        if (!suggestion) continue;
        const answer = answers[question.id] ?? "";
        if (answer === suggestion) continue;
        // Written by the owner, so it is theirs to keep.
        if (answer.trim() && answer !== appliedSuggestions.current[question.id]) continue;
        answers[question.id] = suggestion;
        appliedSuggestions.current[question.id] = suggestion;
        changed = true;
      }
      return changed ? { ...current, quickAnswers: answers } : current;
    });
  }, [
    open,
    form.quickAnswers,
    form.address,
    form.hours,
    form.phone,
    form.paymentAccountName,
    form.paymentAccountNumber,
    form.paymentInstructions,
  ]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  // Both of the square images here go through the cropper rather than being
  // downscaled on the spot: a logo centre-cropped out of a wider picture
  // loses whichever half of the mark was not in the middle.
  const handleLogoChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setCropping({ kind: "logo", file });
  }, []);

  const handleCoverChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusyMessage("Processing cover photo…");
    setError(null);
    try {
      const dataUrl = await fileToDownscaledDataUrl(file, COVER_IMAGE_OPTIONS);
      setForm((current) => ({ ...current, coverImageUrl: dataUrl }));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "That image could not be used.");
    } finally {
      setBusyMessage(null);
    }
  }, []);

  const handleGalleryChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;

      const room = MAX_GALLERY_PHOTOS - form.gallery.length;
      if (room <= 0) {
        setError(`You can show up to ${MAX_GALLERY_PHOTOS} photos.`);
        return;
      }

      setBusyMessage("Processing photos…");
      setError(null);
      const added: ShopPhoto[] = [];
      try {
        for (const file of files.slice(0, room)) {
          added.push({ url: await fileToDownscaledDataUrl(file, GALLERY_IMAGE_OPTIONS) });
        }
        setForm((current) => ({
          ...current,
          gallery: [...current.gallery, ...added].slice(0, MAX_GALLERY_PHOTOS),
        }));
        if (files.length > room) setError(`Only ${room} more photo${room === 1 ? "" : "s"} could be added.`);
      } catch (imageError) {
        setError(imageError instanceof Error ? imageError.message : "Those images could not be used.");
      } finally {
        setBusyMessage(null);
      }
    },
    [form.gallery.length]
  );

  const movePhoto = useCallback((index: number, delta: number) => {
    setForm((current) => {
      const next = [...current.gallery];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, gallery: next };
    });
  }, []);

  // Resolve the stored path to something viewable whenever it changes.
  useEffect(() => {
    let cancelled = false;
    if (!form.paymentQrUrl) {
      setQrPreview(null);
      return;
    }
    void signedUrlFor(QR_BUCKET, form.paymentQrUrl).then((url) => {
      if (!cancelled) setQrPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [form.paymentQrUrl]);

  const handleQrChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setCropping({ kind: "qr", file });
  }, []);

  /** Uploads the cropped QR. Called by the cropper, not by the file input. */
  const uploadCroppedQr = useCallback(
    async (dataUrl: string) => {
      setIsUploadingQr(true);
      setError(null);
      try {
        const result = await uploadQr(shopId, dataUrlToFile(dataUrl, "payment-qr.png"));
        if ("error" in result) {
          setError(result.error);
          return;
        }
        // Stored as a path; Save writes it to the row.
        setForm((current) => ({ ...current, paymentQrUrl: result.path }));
      } finally {
        setIsUploadingQr(false);
      }
    },
    [shopId]
  );

  const handleSave = useCallback(async () => {
    const missing = missingRequired(form, isAddressIncomplete, quickAnswersReady);
    if (materialIssues.length && !missing.some((field) => field.tab === "materials")) {
      missing.push({ tab: "materials", label: "Available materials and colors" });
    }
    // Only the materials block a save: customers can order nothing from a
    // shop that lists none. Everything else that is still empty is saved as
    // it stands and stays flagged on its tab as a reminder.
    if (form.allowedMaterials.length === 0) {
      setTriedSave(true);
      setError(null);
      setTab("materials");
      overlayRef.current?.scrollTo({ top: 0 });
      return;
    }
    const rangeProblem = priceRangeReady ? priceRangeProblem(form.priceRangeMin, form.priceRangeMax) : null;
    if (rangeProblem) {
      setError(rangeProblem);
      setTab("profile");
      overlayRef.current?.scrollTo({ top: 0 });
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      // Only storefront columns are written here -- approval state is not the
      // owner's to change.
      const payload = {
        shop_name: form.shopName.trim() || null,
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        hours: form.hours.trim() || null,
        policies: form.policies.trim() || null,
        map_url: form.mapUrl.trim() || null,
        allowed_materials: form.allowedMaterials,
        cover_image_url: form.coverImageUrl || null,
        logo_url: form.logoUrl || null,
        gallery: form.gallery,
        payment_qr_url: form.paymentQrUrl || null,
        payment_instructions: form.paymentInstructions.trim() || null,
        payment_account_name: form.paymentAccountName.trim() || null,
        payment_account_number: form.paymentAccountNumber.trim() || null,
        ...(priceRangeReady
          ? {
              price_range_min: form.priceRangeMin.trim() ? Number(form.priceRangeMin) : null,
              price_range_max: form.priceRangeMax.trim() ? Number(form.priceRangeMax) : null,
            }
          : {}),
        ...(quickAnswersReady
          ? {
              quick_answers: Object.fromEntries(
                QUICK_QUESTIONS.map((question) => [question.id, (form.quickAnswers[question.id] ?? "").trim()])
              ),
            }
          : {}),
      };

      let { error: saveError } = await supabase.from("shops").update(payload).eq("id", shopId);

      if (saveError && (saveError as { code?: string }).code === UNDEFINED_COLUMN) {
        // Save what the current schema supports rather than losing the edit.
        const fallback = await supabase
          .from("shops")
          .update({
            shop_name: payload.shop_name,
            description: payload.description,
            address: payload.address,
            allowed_materials: payload.allowed_materials,
          })
          .eq("id", shopId);
        saveError = fallback.error;
        if (!saveError) {
          setError(
            "Saved your name, description, address, materials and colors. Photos need the 2026-08-24-shop-storefront-profile migration."
          );
        }
      }

      if (saveError) throw saveError;

      onSaved?.({ ...form, shopName: form.shopName.trim(), address: form.address.trim() });
      const stillMissing = [...new Set(missing.map((item) => item.label))];
      notifySaved(
        stillMissing.length
          ? uiText("Storefront saved. Still missing: {0}", { 0: stillMissing.map((name) => uiText(name)).join(", ") })
          : "Storefront saved"
      );
      onClose();
    } catch (saveError) {
      console.error("Failed to save storefront:", saveError);
      setError("Could not save your storefront. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [form, shopId, onSaved, onClose, isAddressIncomplete, quickAnswersReady, priceRangeReady, materialIssues, uiText]);

  if (!open) return null;

  const payloadBytes =
    dataUrlBytes(form.coverImageUrl) +
    dataUrlBytes(form.logoUrl) +
    form.gallery.reduce((total, photo) => total + dataUrlBytes(photo.url), 0);

  const field =
    "w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none placeholder:text-[var(--fc-muted)] focus:border-[#8b5a2b]";
  const label = "text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]";
  // Every empty field is flagged on its tab all the time, as a reminder. Only
  // after a blocked save are the fields themselves outlined and listed.
  const reminders = missingRequired(form, isAddressIncomplete, quickAnswersReady);
  if (materialIssues.length && !reminders.some((field) => field.tab === "materials")) {
    reminders.push({ tab: "materials", label: "Available materials and colors" });
  }
  const missing = triedSave ? reminders : [];
  const isMissing = (name: string) => missing.some((item) => (item.key ?? item.label) === name);
  const fieldFor = (name: string) => (isMissing(name) ? field.replace("border-[var(--fc-border)]", "border-[#c0392b]") : field);
  const tabNeedsAttention = (id: StorefrontTab) =>
    reminders.some((item) => item.tab === id) || (id === "location" && isAddressIncomplete);
  const panel = (id: StorefrontTab) => ({
    role: "tabpanel" as const,
    id: `storefront-panel-${id}`,
    "aria-labelledby": `storefront-tab-${id}`,
    hidden: tab !== id,
  });

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto scroll-pt-16 scroll-pb-28 bg-[#2b1b14]/60 p-4">
      <div className="my-8 w-full max-w-4xl rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">{uiText("Storefront")}</div>
            <h3 className="text-xl font-semibold text-[var(--fc-text)]">{uiText("Edit how customers see your shop")}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[var(--fc-ink-accent)]">{uiText("Close")}</button>
        </div>

        {error ? (
          <p className="mt-4 rounded-2xl border border-[#c0392b]/30 bg-[#c0392b]/10 px-3 py-2 text-sm text-[#a8452c]">
            {uiText(error)}
          </p>
        ) : null}

        {triedSave && form.allowedMaterials.length === 0 ? (
          <div role="alert" className="mt-4 rounded-2xl border border-[#c0392b]/30 bg-[#c0392b]/10 px-3 py-2 text-sm text-[#a8452c]">
            <p>{uiText("Choose at least one material and color to save your storefront.")}</p>
            {missing.some((item) => item.tab !== "materials") ? (
              <p className="mt-1">{uiText("Also still empty (you can save without these): {0}.", { 0: [...new Set(missing.filter((item) => item.tab !== "materials").map((item) => uiText(item.label)))].join(", ") })}</p>
            ) : null}
            {isMissing("Shop address") && isAddressIncomplete ? (
              <p className="mt-1">{uiText("Finish your address: choose your province, city and barangay, and enter your 4-digit ZIP code.")}</p>
            ) : null}
          </div>
        ) : null}

        {isLoading ? (
          <p className="mt-6 text-sm text-[var(--fc-muted)]">{uiText("Loading your storefront…")}</p>
        ) : (
          <div className="mt-5">
            {/* Sticky, so the tabs stay in reach however far a panel scrolls. The
                panel is max-w-4xl so all eight fit on one line on a desktop (they
                need ~820px with every attention dot showing); a narrower window
                wraps them rather than hiding Payment and Links off the edge, and
                only a phone, where a swipe works, scrolls them sideways. */}
            <div
              role="tablist"
              aria-label={uiText("Storefront sections")}
              className="sticky top-0 z-10 -mx-6 mb-5 flex gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible border-b border-[var(--fc-border)] bg-[var(--fc-panel)] px-6 [scrollbar-width:none]"
            >
              {TABS.map((item) => {
                const selected = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`storefront-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls={`storefront-panel-${item.id}`}
                    onClick={() => setTab(item.id)}
                    className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold transition-colors ${
                      selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                    }`}
                  >
                    {uiText(item.label)}
                    {tabNeedsAttention(item.id) ? (
                      <span aria-label={uiText("needs attention")} className="h-1.5 w-1.5 rounded-full bg-[#c0392b]" />
                    ) : null}
                    {selected ? (
                      <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Every panel stays mounted and is only hidden, so switching tabs
                never drops an unsaved edit or the map's pin. */}
            <div {...panel("profile")} className="space-y-5">
              {/* ---- logo ----
                  First, because it is what customers see most often: in the
                  Shops list, in their chats, on every piece "by" this shop. */}
              <section>
                <span className={label}>{uiText("Logo ")}<RequiredMark /></span>
                <div className="mt-2 flex items-center gap-4">
                  <ShopLogo name={form.shopName || "Shop"} logoUrl={form.logoUrl || null} size={72} />
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="inline-flex min-h-11 items-center rounded-full border border-[var(--fc-border)] px-4 text-xs font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.97]"
                      >
                        {form.logoUrl ? uiText("Replace logo") : uiText("Upload logo")}
                      </button>
                      {form.logoUrl ? (
                        <button type="button" onClick={() => update("logoUrl", "")} className="btn btn-danger-ghost btn-sm">{uiText("Remove")}</button>
                      ) : null}
                    </div>
                    <p className={`text-xs ${isMissing("Logo") ? "text-[#a8452c]" : "text-[var(--fc-muted)]"}`}>
                      {form.logoUrl ? uiText("Shown square, in the Shops list, your chats and on your shop page.") : uiText("No logo yet, so customers see your initials. A square image works best.")}
                    </p>
                  </div>
                  <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                </div>
              </section>

              {/* ---- cover ---- */}
              <section>
                <span className={label}>{uiText("Cover photo ")}<RequiredMark /></span>
                <div className={`mt-2 overflow-hidden rounded-2xl border ${isMissing("Cover photo") ? "border-[#c0392b]" : "border-[var(--fc-border)]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.coverImageUrl || SHOP_PLACEHOLDER_IMAGE}
                    alt={uiText("Shop cover preview")}
                    className="h-40 w-full bg-[rgba(178,106,56,0.08)] object-cover"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.08)]"
                  >
                    {form.coverImageUrl ? uiText("Replace cover") : uiText("Upload cover")}
                  </button>
                  {form.coverImageUrl ? (
                    <button
                      type="button"
                      onClick={() => update("coverImageUrl", "")}
                      className="btn btn-danger-ghost btn-sm"
                    >{uiText("Remove")}</button>
                  ) : (
                    <span className={`text-xs ${isMissing("Cover photo") ? "text-[#a8452c]" : "text-[var(--fc-muted)]"}`}>{uiText("No cover photo yet.")}</span>
                  )}
                  <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverChange} className="hidden" />
                </div>
              </section>

              {/* ---- details ---- */}
              <section className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>{uiText("Shop name ")}<RequiredMark /></span>
                  <input
                    required
                    className={`${fieldFor("Shop name")} mt-1`}
                    value={form.shopName}
                    onChange={(event) => update("shopName", event.target.value)}
                    placeholder={uiText("e.g. Narra & Oak Woodworks")}
                  />
                </label>
                <label className="block">
                  <span className={label}>{uiText("Tagline ")}<RequiredMark /></span>
                  <input
                    required
                    className={`${fieldFor("Tagline")} mt-1`}
                    value={form.tagline}
                    onChange={(event) => update("tagline", event.target.value)}
                    placeholder={uiText("Handmade hardwood furniture")}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className={label}>{uiText("About your shop ")}<RequiredMark /></span>
                  <textarea
                    required
                    className={`${fieldFor("About your shop")} mt-1 resize-y`}
                    rows={4}
                    value={form.description}
                    onChange={(event) => update("description", event.target.value)}
                    placeholder={uiText("What you make, the timber you work with, how long a build usually takes…")}
                  />
                </label>
                {priceRangeReady ? (
                  <fieldset className="sm:col-span-2">
                    <legend className={label}>{uiText("Price range (optional)")}</legend>
                    <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("The lowest and highest price you build for. Shown on your shop page; a customer whose budget is entirely outside it is asked to adjust it before sending an order.")}</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      {([
                        ["priceRangeMin", "Lowest", "e.g. 5000"],
                        ["priceRangeMax", "Highest", "e.g. 50000"],
                      ] as const).map(([key, title, hint]) => (
                        <label key={key} className="block">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText(title)}</span>
                          <span className="mt-1 flex items-center gap-1.5 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 focus-within:border-[#8b5a2b]">
                            <span className="text-sm text-[var(--fc-muted)]">₱</span>
                            <input
                              inputMode="numeric"
                              className="w-full bg-transparent py-2 text-sm text-[var(--fc-text)] outline-none placeholder:text-[var(--fc-muted)]"
                              value={form[key]}
                              onChange={(event) => update(key, event.target.value.replace(/[^\d]/g, ""))}
                              placeholder={hint}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                    {priceRangeProblem(form.priceRangeMin, form.priceRangeMax) ? (
                      <p className="mt-1.5 text-xs font-semibold text-fc-danger">{uiText(priceRangeProblem(form.priceRangeMin, form.priceRangeMax) ?? "")}</p>
                    ) : null}
                  </fieldset>
                ) : null}
              </section>
            </div>

            <div {...panel("location")}>
              <section className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>{uiText("Phone ")}<RequiredMark /></span>
                  <PhoneInput
                    className="mt-1"
                    value={form.phone}
                    onChange={(next) => update("phone", next)}
                    inputClassName={fieldFor("Phone")}
                  />
                </label>
                <label className="block">
                  <span className={label}>{uiText("Opening hours ")}<RequiredMark /></span>
                  <input
                    required
                    className={`${fieldFor("Opening hours")} mt-1`}
                    value={form.hours}
                    onChange={(event) => update("hours", event.target.value)}
                    placeholder={uiText("Mon–Sat, 9am–6pm")}
                  />
                </label>
                {/* ---- address ----
                    Its own block, ending in the map: the owner picks the
                    parts, and sees straight away where customers will be sent. */}
                <div className="sm:col-span-2">
                  <span className={label}>{uiText("Shop address ")}<RequiredMark /></span>
                  <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Where customers can visit you. Check the map below shows your shop.")}</p>
                </div>
                {GOOGLE_MAPS_API_KEY ? (
                  <ShopLocationEditor
                    savedAddress={savedAddress}
                    savedMapUrl={savedMapUrl}
                    shopName={form.shopName}
                    onChange={handleLocationChange}
                    fieldClassName={field}
                    labelClassName={label}
                  />
                ) : (
                  <>
                    {/* Without a Maps JavaScript API key there is no draggable pin:
                        the keyless embedded map shows where the address lands, and
                        a pasted Google Maps link can correct it. */}
                    <AddressPicker
                      initial={savedAddress}
                      onChange={handleAddressChange}
                      fieldClassName={field}
                      labelClassName={label}
                    />
                    <LocationPreview address={form.address} mapUrl={form.mapUrl} shopName={form.shopName} />
                    <label className="block sm:col-span-2">
                      <span className={label}>{uiText("Exact pin from Google Maps (optional)")}</span>
                      <input
                        className={`${field} mt-1`}
                        value={form.mapUrl}
                        onChange={(event) => update("mapUrl", event.target.value)}
                        placeholder="https://maps.app.goo.gl/…"
                      />
                      <span className="mt-1 block text-xs text-[var(--fc-muted)]">{uiText("If the pin above isn't exactly on your shop, find your shop in Google Maps, tap Share and paste the link here. Its pin is used instead of the address.")}</span>
                    </label>
                  </>
                )}
              </section>

            </div>

            <div {...panel("policies")}>
              {/* ---- shop policies ---- */}
              <section>
                <span className={label}>{uiText("Shop policies ")}<RequiredMark /></span>
                <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Your terms, shown on your storefront before a customer sends you a design. Deposits, lead times, what happens to a custom piece if they change their mind, warranty — whatever you would otherwise have to type into every conversation.")}</p>
                <textarea
                  required
                  className={`${fieldFor("Shop policies")} mt-2`}
                  rows={6}
                  maxLength={4000}
                  value={form.policies}
                  onChange={(event) => update("policies", event.target.value)}
                  placeholder={uiText("50% downpayment before we start.\nLead time 3–4 weeks for a chair.\nCustom pieces cannot be returned once cutting has begun.\n1 year warranty on joinery.")}
                />
                <div className="mt-1 flex items-center justify-between gap-3">
                  {/* Until a shop saves something here, customers are shown
                      FurniCraft's standard terms labelled as the platform's, not
                      as this shop's. This is how an owner adopts them: the text
                      lands in the box, they edit the numbers to match how they
                      actually work, and saving makes the terms theirs. It is
                      never written on their behalf. */}
                  <button
                    type="button"
                    onClick={() => update("policies", DEFAULT_SHOP_POLICIES)}
                    className="text-[11px] font-semibold text-[var(--fc-ink-accent)] underline underline-offset-2 transition hover:opacity-80"
                  >
                    {form.policies.trim() ? uiText("Replace with standard terms") : uiText("Start from standard terms")}
                  </button>
                  <span className="text-[11px] text-[var(--fc-muted)]">{form.policies.length}/4000</span>
                </div>
                {!form.policies.trim() ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("You haven't published terms. Customers currently see FurniCraft's standard terms, marked as ours rather than yours.")}</p>
                ) : null}
              </section>

            </div>

            <div {...panel("materials")}>
              <ShopMaterialStockPicker
                value={form.allowedMaterials}
                onChange={(value) => update("allowedMaterials", value)}
                onValidationChange={setMaterialIssues}
              />
            </div>

            <div {...panel("answers")}>
              <section>
                <span className={label}>{uiText("Quick answers ")}<RequiredMark />
                </span>
                <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Customers tap these questions in their chat with you and see your answer straight away. Write each one in your own words; it is shown exactly as you write it.")}</p>
                {quickAnswersReady ? (
                  <ol className="mt-3 space-y-4">
                    {QUICK_QUESTIONS.map((question, index) => {
                      const value = form.quickAnswers[question.id] ?? "";
                      return (
                        <li key={question.id}>
                          <label className="block">
                            <span className="block text-sm font-semibold text-[var(--fc-text)]">
                              {index + 1}. {question.ask.en} <RequiredMark />
                            </span>
                            <textarea
                              required
                              rows={2}
                              maxLength={QUICK_ANSWER_MAX_CHARS}
                              className={`${fieldFor(`answer:${question.id}`)} mt-1.5 resize-y`}
                              value={value}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  quickAnswers: { ...current.quickAnswers, [question.id]: event.target.value },
                                }))
                              }
                            />
                          </label>
                          <div className="mt-0.5 flex items-start justify-between gap-3">
                            {value && value === suggestedAnswer(question.id, form) ? (
                              <span className="text-[11px] leading-snug text-[var(--fc-muted)]">
                                {uiText("Filled in from what you entered elsewhere in this form. Edit it if you would rather say it in your own words.")}
                              </span>
                            ) : (
                              <span />
                            )}
                            <span className="shrink-0 text-[11px] text-[var(--fc-muted)]">
                              {value.length}/{QUICK_ANSWER_MAX_CHARS}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-3 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-sm text-[var(--fc-muted)]">{uiText("Quick answers can't be saved yet: the 2026-10-20 shop quick answers database update hasn't been applied.")}</p>
                )}
              </section>
            </div>

            <div {...panel("links")}>
              {/* Optional, and saved as each link is added, so it never blocks Save. */}
              <p className="mb-3 text-xs text-[var(--fc-muted)]">{uiText("Optional. Links save as soon as you add, move or remove them.")}</p>
              <SocialLinksEditor shopId={shopId} />
            </div>

            <div {...panel("payment")}>
              {/* ---- how customers pay ---- */}
              <section>
                <span className={label}>{uiText("Payment details ")}<RequiredMark /></span>
                <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Customers pay you directly. FurniCraft does not process or hold the money, and cannot confirm a transfer — you approve each downpayment yourself after checking your own app.")}</p>

                <div className="mt-3 flex flex-wrap items-start gap-4">
                  <div className={`grid h-32 w-32 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-[rgba(178,106,56,0.06)] ${isMissing("Payment QR") ? "border-[#c0392b]" : "border-[var(--fc-border)]"}`}>
                    {qrPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrPreview} alt={uiText("Your payment QR")} className="h-full w-full object-contain" />
                    ) : (
                      <span className="px-2 text-center text-[11px] text-[var(--fc-muted)]">{uiText("No QR uploaded")}</span>
                    )}
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <button
                      type="button"
                      onClick={() => qrInputRef.current?.click()}
                      disabled={isUploadingQr}
                      className="btn btn-secondary btn-sm"
                    >
                      {isUploadingQr ? uiText("Uploading…") : form.paymentQrUrl ? uiText("Replace QR") : uiText("Upload QR Ph / GCash QR")}
                    </button>
                    <input
                      ref={qrInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleQrChange}
                    />
                    <p className="mt-2 text-[11px] text-[var(--fc-muted)]">{uiText("Shown to a customer only once they have an order with you.")}</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>{uiText("Account name ")}<RequiredMark /></span>
                    <input
                      required
                      className={`${fieldFor("Account name")} mt-1`}
                      value={form.paymentAccountName}
                      onChange={(event) => update("paymentAccountName", event.target.value)}
                      placeholder={uiText("Name on the GCash or bank account")}
                    />
                  </label>
                  <label className="block">
                    <span className={label}>{uiText("Account number ")}<RequiredMark /></span>
                    <input
                      required
                      className={`${fieldFor("Account number")} mt-1`}
                      value={form.paymentAccountNumber}
                      onChange={(event) => update("paymentAccountNumber", event.target.value)}
                      placeholder={uiText("09xx xxx xxxx")}
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className={label}>{uiText("Payment instructions ")}<RequiredMark /></span>
                    <textarea
                      required
                      className={`${fieldFor("Payment instructions")} mt-1 min-h-[72px]`}
                      value={form.paymentInstructions}
                      onChange={(event) => update("paymentInstructions", event.target.value)}
                      placeholder={uiText("e.g. Send the downpayment to the number above and upload the receipt.")}
                    />
                  </label>
                </div>
              </section>

            </div>

            <div {...panel("photos")}>
              {/* ---- gallery ---- */}
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={label}>{uiText("Gallery (")}{form.gallery.length}/{MAX_GALLERY_PHOTOS})</span>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={form.gallery.length >= MAX_GALLERY_PHOTOS}
                    className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-text)] transition enabled:hover:bg-[rgba(178,106,56,0.08)] disabled:opacity-40"
                  >{uiText("+ Add photos")}</button>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleGalleryChange}
                    className="hidden"
                  />
                </div>

                {form.gallery.length === 0 ? (
                  <p className="mt-2 rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-center text-sm text-[var(--fc-muted)]">{uiText("Optional. Add photos of finished pieces or your furniture shop whenever you're ready.")}</p>
                ) : (
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {form.gallery.map((photo, index) => (
                      <li key={`${photo.url.slice(-24)}-${index}`} className="rounded-2xl border border-[var(--fc-border)] p-2">
                        <div className="flex gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <input
                              className={field}
                              value={photo.caption ?? ""}
                              onChange={(event) =>
                                setForm((current) => {
                                  const next = [...current.gallery];
                                  next[index] = { ...next[index], caption: event.target.value };
                                  return { ...current, gallery: next };
                                })
                              }
                              placeholder={uiText("Caption (optional)")}
                            />
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => movePhoto(index, -1)}
                                disabled={index === 0}
                                aria-label={uiText("Move photo earlier")}
                                className="rounded-full border border-[var(--fc-border)] px-2 py-0.5 text-xs disabled:opacity-30"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => movePhoto(index, 1)}
                                disabled={index === form.gallery.length - 1}
                                aria-label={uiText("Move photo later")}
                                className="rounded-full border border-[var(--fc-border)] px-2 py-0.5 text-xs disabled:opacity-30"
                              >
                                →
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    gallery: current.gallery.filter((_, i) => i !== index),
                                  }))
                                }
                                className="ml-auto rounded-full border border-[var(--fc-border)] px-2 py-0.5 text-xs font-semibold text-[#a8452c]"
                              >{uiText("Remove")}</button>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {payloadBytes > 0 ? (
                  <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("Photos add ")}{formatBytes(payloadBytes)}{uiText(" to your shop profile.")}{payloadBytes > 3 * 1024 * 1024 ? uiText(" That's quite large — consider removing a few.") : ""}
                  </p>
                ) : null}
              </section>

            </div>

            {/* Sticky at the foot: Save is one tap from any tab. */}
            <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 flex flex-wrap items-center gap-3 rounded-b-3xl border-t border-[var(--fc-border)] bg-[var(--fc-panel)] px-6 py-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || Boolean(busyMessage)}
                className="btn btn-primary"
              >
                {isSaving ? uiText("Saving…") : uiText("Save storefront")}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-full border border-[var(--fc-border)] px-5 py-2 text-sm font-semibold text-[var(--fc-text)]"
              >{uiText("Cancel")}</button>
              {busyMessage ? <span className="text-xs text-[var(--fc-muted)]">{uiText(busyMessage)}</span> : null}
            </div>
          </div>
        )}
      </div>

      <ImageCropper
        file={cropping?.file ?? null}
        shape={cropping?.kind === "qr" ? "square" : "circle"}
        title={cropping?.kind === "qr" ? uiText("Crop your payment QR") : uiText("Position your logo")}
        hint={
          cropping?.kind === "qr"
            ? "Crop in to the code itself. A screenshot of the whole GCash screen leaves the QR too small to scan from a phone."
            : "Drag to move, and use the slider to zoom. The circle is what customers will see."
        }
        confirmLabel={cropping?.kind === "qr" ? uiText("Use this QR") : uiText("Use logo")}
        output={
          cropping?.kind === "qr"
            ? { side: 720, type: "image/png" }
            : { side: LOGO_IMAGE_OPTIONS.maxDimension, type: "image/jpeg", quality: LOGO_IMAGE_OPTIONS.quality }
        }
        onCancel={() => setCropping(null)}
        onCropped={(dataUrl) => {
          const kind = cropping?.kind;
          setCropping(null);
          if (kind === "qr") void uploadCroppedQr(dataUrl);
          else setForm((current) => ({ ...current, logoUrl: dataUrl }));
        }}
      />
    </div>
  );
}

/**
 * What a customer will see on the shop page, as the owner fills the address
 * in. This is where a wrong pin gets caught: before it is on the shop page,
 * not after a customer has driven to it.
 */
function LocationPreview({ address, mapUrl, shopName }: { address: string; mapUrl: string; shopName: string }) {
  const { t: uiText } = useUiLanguage();
  const { lookup, source, link } = useShopLocation(address, mapUrl);
  const linkUnusable = link.status === "unreadable";

  return (
    <div className="space-y-2 sm:col-span-2">
      {lookup.status === "found" ? (
        <>
          <ShopMapFrame target={lookup.target} title={uiText("Map preview for {0}", { 0: shopName || uiText("your shop") })} className="h-56" />
          <p className="text-xs text-[var(--fc-muted)]">
            {source === "pin" ? uiText("Using the exact pin from your Google Maps link. This is what customers will see.") : uiText("This is what customers will see. If the pin isn't on your shop, add your exact pin below.")}
          </p>
        </>
      ) : lookup.status === "loading" ? (
        <p className="text-xs text-[var(--fc-muted)]">{uiText("Finding your shop on the map…")}</p>
      ) : (
        <div className="grid h-32 place-items-center rounded-2xl border border-dashed border-[var(--fc-border)] px-4 text-center text-xs text-[var(--fc-muted)]">{uiText("Choose your province, city and barangay, and enter your ZIP code, to see your shop on the map.")}</div>
      )}
      {linkUnusable ? (
        <p className="rounded-2xl border border-[#c0392b]/30 bg-[#c0392b]/10 px-3 py-2 text-xs text-[#a8452c]">{uiText("We couldn't find a place in your Google Maps link, so it isn't used. Paste the Share link from your shop's page in Google Maps (it starts with https://maps.app.goo.gl/ or https://www.google.com/maps/), or clear it to use your address.")}</p>
      ) : null}
    </div>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden className="text-[#c0392b]">
      *
    </span>
  );
}
