"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useLanguage } from "@/components/language/language-context";
import { Modal } from "@/components/ui/modal";

/** Every photo-template entry asks for acknowledgment before opening the uploader. */
export function PhotoTemplatePolicyButton({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button type="button" className={className} onClick={() => {
        setAcknowledged(false);
        setOpen(true);
      }}>{children}</button>
      <Modal
        open={open}
        onClose={close}
        ariaLabel={t("Image & design use policy")}
        title={t("Image & design use policy")}
        eyebrow={t("Before you upload")}
        className="sm:max-w-xl"
        dismissOnBackdrop={false}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={close}>{t("Cancel")}</button>
            <button type="button" className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-40" disabled={!acknowledged} onClick={() => {
              if (!acknowledged) return;
              close();
              router.push("/protected/shop/generate");
            }}>{t("Agree & continue")}</button>
          </div>
        }
      >
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-4">
          <ShieldCheck aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-[var(--fc-ink-accent)]" />
          <p className="text-sm leading-relaxed text-[var(--fc-text)]">{t("Your shop is responsible for the images and designs it uses to create a template.")}</p>
        </div>
        <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-[var(--fc-text)]">
          <li>{t("Only upload images and use designs that your shop owns, or that you have permission or a valid license to use for this purpose.")}</li>
          <li>{t("Your shop is accountable for obtaining the necessary rights and for any claims arising from its use of an image or design. FurniCraft does not grant those rights or assume responsibility for your shop's unauthorized use.")}</li>
          <li>{t("Unauthorized use may infringe intellectual property rights and may lead to legal claims or penalties under applicable law.")}</li>
        </ul>
        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--fc-border)] p-4 text-sm font-semibold leading-relaxed text-[var(--fc-text)]">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--fc-ink-accent)]" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>{t("I have the necessary rights or permission and accept responsibility for my shop's use of these images and designs.")}</span>
        </label>
      </Modal>
    </>
  );
}
