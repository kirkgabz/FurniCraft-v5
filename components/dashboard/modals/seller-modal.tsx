"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { Modal } from "@/components/ui/modal";
import { IconCheck, IconDocument, IconId, IconWarning } from "@/components/solihiya/icons";
import PhoneInput from "@/components/ui/phone-input";
import { prepareSellerDocument } from "@/lib/shops/prepare-seller-document";

/**
 * Extensions and types together. Extensions alone made some phones offer only
 * a file browser; image/* also opens the camera and the photo library, and
 * HEIC is accepted here because it is converted before upload.
 */
const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*";

export type SellerModalProps = {
  address: string;
  birDocFile: File | null;
  birRegisteredName: string;
  description: string;
  handleSellerSubmit: () => Promise<void>;
  isSubmitting: boolean;
  notice: string | null;
  sellerFormStep: 2 | 1;
  setAddress: Dispatch<SetStateAction<string>>;
  setBirDocFile: Dispatch<SetStateAction<File | null>>;
  setBirRegisteredName: Dispatch<SetStateAction<string>>;
  setDescription: Dispatch<SetStateAction<string>>;
  setIsSellerModalOpen: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setSellerFormStep: Dispatch<SetStateAction<2 | 1>>;
  setShopName: Dispatch<SetStateAction<string>>;
  setShopPhone: Dispatch<SetStateAction<string>>;
  setShopSocialUrl: Dispatch<SetStateAction<string>>;
  setValidIdFile: Dispatch<SetStateAction<File | null>>;
  shopName: string;
  shopPhone: string;
  shopSocialUrl: string;
  validIdFile: File | null;
};

/**
 * Become a seller: the two-step shop application with BIR and ID documents.
 *
 * Moved out of furnicraft-dashboard.tsx unchanged. The dashboard still owns
 * the state and the handlers; this receives exactly the values it reads.
 */
export default function SellerModal({
  address,
  birDocFile,
  birRegisteredName,
  description,
  handleSellerSubmit,
  isSubmitting,
  notice,
  sellerFormStep,
  setAddress,
  setBirDocFile,
  setBirRegisteredName,
  setDescription,
  setIsSellerModalOpen,
  setNotice,
  setSellerFormStep,
  setShopName,
  setShopPhone,
  setShopSocialUrl,
  setValidIdFile,
  shopName,
  shopPhone,
  shopSocialUrl,
  validIdFile,
}: SellerModalProps) {
  const { t: uiText } = useUiLanguage();
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  return (
    <Modal
      open
      onClose={() => { if (!isSubmitting) { setIsSellerModalOpen(false); setSellerFormStep(1); } }}
      ariaLabel={uiText("Become a shop owner")}
      eyebrow={uiText("Seller registration")}
      title={uiText("Become a Shop Owner")}
      className="sm:max-w-lg"
    >
        {/* Progress Steps */}
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${sellerFormStep >= 1 ? "bg-fc-btn text-fc-btn-fg shadow-sm" : "bg-[rgba(198,125,56,0.12)] text-[var(--fc-muted)]"}`}>1</div>
          <div className={`h-0.5 flex-1 rounded-full transition-colors ${sellerFormStep >= 2 ? "bg-fc-btn" : "bg-[var(--fc-border)]"}`} />
          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${sellerFormStep >= 2 ? "bg-fc-btn text-fc-btn-fg shadow-sm" : "bg-[rgba(198,125,56,0.12)] text-[var(--fc-muted)]"}`}>2</div>
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
          <span>{uiText("1. Shop Details")}</span>
          <span>{uiText("2. Documents & Verification")}</span>
        </div>

        {notice ? <div ref={noticeRef} role="alert" tabIndex={-1} className="mt-4 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3 text-sm text-[var(--fc-text)]">{uiText(notice)}</div> : null}
        <fieldset disabled={isSubmitting}>
        {sellerFormStep === 1 ? (
          <div className="mt-5 space-y-3.5 text-sm text-[var(--fc-text)]">
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Shop Name")}</label>
              <input
                className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)] transition-[border-color,box-shadow]"
                placeholder={uiText("e.g. Juan's Furniture Works")}
                value={shopName}
                onChange={(event) => setShopName(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Description")}</label>
              <textarea
                className="min-h-[80px] w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)] transition-[border-color,box-shadow]"
                placeholder={uiText("Describe your shop, specialties, products...")}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Business Address")}</label>
              <input
                className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)] transition-[border-color,box-shadow]"
                placeholder={uiText("Complete business address")}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Contact Number")}</label>
              <PhoneInput
                value={shopPhone}
                onChange={setShopPhone}
                inputClassName="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)]"
              />
              <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("Shown on your storefront so customers can reach you outside the app.")}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Facebook Page or Website")}{" "}
                <span className="font-normal text-[var(--fc-muted)]">{uiText("(optional)")}</span>
              </label>
              <input
                className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)] transition-[border-color,box-shadow]"
                placeholder={uiText("facebook.com/your-shop")}
                value={shopSocialUrl}
                onChange={(event) => setShopSocialUrl(event.target.value)}
              />
              <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("If your shop has a page with past work, adding it helps the reviewer confirm you are a real furniture shop.")}</p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!shopName.trim() || !address.trim()) {
                    setNotice("Please fill in the shop name and business address to continue.");
                    return;
                  }
                  setNotice(null);
                  setSellerFormStep(2);
                }}
                className="btn btn-primary btn-block"
              >{uiText("Continue to Documents →")}</button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-3.5 text-sm text-[var(--fc-text)]">
            {/* BIR Registered Name */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Name as registered in BIR")}</label>
              <input
                className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3.5 py-2.5 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] outline-none focus:border-[var(--fc-accent)] focus:ring-1 focus:ring-[var(--fc-accent)] transition-[border-color,box-shadow]"
                placeholder={uiText("Must match your BIR Certificate exactly")}
                value={birRegisteredName}
                onChange={(event) => setBirRegisteredName(event.target.value)}
              />
              <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("This must match the registered name on your BIR Certificate of Registration (Form 2303).")}</p>
            </div>

            {/* BIR Document Upload */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("BIR Certificate of Registration")}</label>
              <div
                className={`relative flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-[background-color,border-color] duration-150 ${
                  birDocFile
                    ? "border-fc-online bg-[rgba(34,110,74,0.08)]"
                    : "border-[var(--fc-border)] bg-[var(--fc-bg)] hover:border-[var(--fc-accent)]"
                }`}
                onClick={() => document.getElementById("bir-doc-input")?.click()}
              >
                <div className="text-2xl">{birDocFile ? <IconCheck aria-hidden className="h-6 w-6 text-[var(--fc-online)]" /> : <IconDocument aria-hidden className="h-6 w-6 opacity-70" />}</div>
                <div className="min-w-0 flex-1">
                  {birDocFile ? (
                    <>
                      <div className="truncate font-semibold text-fc-online">{birDocFile.name}</div>
                      <div className="text-[11px] text-fc-online">{(birDocFile.size / 1024).toFixed(0)}{uiText(" KB • Ready to upload")}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold text-[var(--fc-text)]">{uiText("Upload BIR Form 2303")}</div>
                      <div className="text-[11px] text-[var(--fc-muted)]">{uiText("PDF, JPEG, PNG, or WebP • Max 10MB")}</div>
                    </>
                  )}
                </div>
                {birDocFile && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setBirDocFile(null); }}
                    className="text-xs font-semibold text-fc-danger hover:text-fc-danger-soft transition-colors"
                  >{uiText("Remove")}</button>
                )}
              </div>
              <input
                id="bir-doc-input"
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const input = e.target;
                  const file = input.files?.[0];
                  input.value = "";
                  if (!file) return;
                  const prepared = await prepareSellerDocument(file);
                  if ("error" in prepared) {
                    setNotice(prepared.error);
                    return;
                  }
                  setNotice(null);
                  setBirDocFile(prepared.file);
                }}
              />
            </div>

            {/* Valid ID Upload */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Valid Government ID")}</label>
              <div
                className={`relative flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition-[background-color,border-color] duration-150 ${
                  validIdFile
                    ? "border-fc-online bg-[rgba(34,110,74,0.08)]"
                    : "border-[var(--fc-border)] bg-[var(--fc-bg)] hover:border-[var(--fc-accent)]"
                }`}
                onClick={() => document.getElementById("valid-id-input")?.click()}
              >
                <div className="text-2xl">{validIdFile ? <IconCheck aria-hidden className="h-6 w-6 text-[var(--fc-online)]" /> : <IconId aria-hidden className="h-6 w-6 opacity-70" />}</div>
                <div className="min-w-0 flex-1">
                  {validIdFile ? (
                    <>
                      <div className="truncate font-semibold text-fc-online">{validIdFile.name}</div>
                      <div className="text-[11px] text-fc-online">{(validIdFile.size / 1024).toFixed(0)}{uiText(" KB • Ready to upload")}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold text-[var(--fc-text)]">{uiText("Upload a valid ID")}</div>
                      <div className="text-[11px] text-[var(--fc-muted)]">{uiText("PhilID, Driver's License, Passport, etc. • Max 10MB")}</div>
                    </>
                  )}
                </div>
                {validIdFile && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setValidIdFile(null); }}
                    className="text-xs font-semibold text-fc-danger hover:text-fc-danger-soft transition-colors"
                  >{uiText("Remove")}</button>
                )}
              </div>
              <input
                id="valid-id-input"
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const input = e.target;
                  const file = input.files?.[0];
                  input.value = "";
                  if (!file) return;
                  const prepared = await prepareSellerDocument(file);
                  if ("error" in prepared) {
                    setNotice(prepared.error);
                    return;
                  }
                  setNotice(null);
                  setValidIdFile(prepared.file);
                }}
              />
            </div>

            {/* Info banner */}
            <div className="rounded-xl border border-[var(--fc-border)] bg-[rgba(198,125,56,0.08)] px-4 py-3">
              <div className="flex items-start gap-2.5">
                <IconWarning aria-hidden className="mt-0.5 h-4 w-4 text-[var(--fc-accent-2)] shrink-0" />
                <div className="text-[12px] leading-relaxed text-fc-text">
                  <strong>{uiText("Verification Notice:")}</strong>{uiText(" The shop name and BIR registered name will be verified against submitted documents by administrators.")}</div>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setSellerFormStep(1)}
                className="flex-1 rounded-full border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--fc-text)] transition-[transform,background-color] duration-150 hover:bg-[rgba(198,125,56,0.08)] active:scale-[0.98]"
              >{uiText("← Back")}</button>
              <button
                type="button"
                onClick={handleSellerSubmit}
                disabled={isSubmitting}
                className="btn btn-primary flex-[2]"
              >
                {isSubmitting ? uiText("Uploading & Submitting...") : uiText("Submit Application")}
              </button>
            </div>
          </div>
        )}
        </fieldset>
    </Modal>
  );
}
