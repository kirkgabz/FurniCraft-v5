"use client";

import { useEffect, useState } from "react";
import { Camera, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useLanguage } from "@/components/language/language-context";
import type { Allowance } from "@/lib/shops/allowance";

/** Shown on each visit, including direct links to the uploader. */
export function PhotoGenerationNotices({ allowance }: { allowance: Allowance | null }) {
  const { t } = useLanguage();
  // An unread allowance is unknown; explain the free plan without claiming
  // that this shop has a trial left. The server still enforces actual usage.
  const firstNotice = allowance?.onPro ? "photos" : "trial";
  const [notice, setNotice] = useState<"trial" | "photos" | null>(null);
  // Open after the portal mounts so the shared modal can focus its panel.
  useEffect(() => setNotice(firstNotice), [firstNotice]);
  const advance = () => setNotice(notice === "trial" ? "photos" : null);
  const trial = notice === "trial";
  const title = trial ? "One free Image to 3D generation" : "Choose a clear photo of one furniture item";
  const Icon = trial ? Sparkles : Camera;

  return (
    <>
      <button type="button" className="mt-4 text-sm font-semibold text-[var(--fc-ink-accent)] underline underline-offset-4" onClick={() => setNotice(firstNotice)}>
        {t("Photo guidelines & usage")}
      </button>
      <Modal
        open={notice !== null}
        onClose={advance}
        title={t(title)}
        ariaLabel={t(title)}
        eyebrow={t(trial ? "Image to 3D · Free trial" : "Image to 3D · Photo guidelines")}
        className="sm:max-w-xl"
        dismissOnBackdrop={false}
        footer={
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={advance}>{t(trial ? "Continue to photo guidelines" : "Got it")}</button>
          </div>
        }
      >
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-4">
          <Icon aria-hidden="true" strokeWidth={1.5} className="mt-0.5 h-6 w-6 shrink-0 text-[var(--fc-ink-accent)]" />
          <p className="text-sm leading-relaxed text-[var(--fc-text)]">
            {t(trial
              ? "Shops without an active FurniCraft Pro subscription receive one free Image to 3D trial generation per shop. This is a one-time allowance, not a monthly benefit."
              : "A well-prepared photo helps the system identify the furniture and build a more accurate 3D model.")}
          </p>
        </div>
        {trial ? (
          <div className="space-y-3 text-sm leading-relaxed text-[var(--fc-text)]">
            <p>{t(allowance?.trialUsed
              ? "Your shop has already used its free trial. Subscribe to FurniCraft Pro to start new generations. You can still resume an unfinished generation without using another generation."
              : allowance
                ? "Your shop's free trial is available. Choose your photo carefully before starting. After the trial is used, an active FurniCraft Pro subscription is required for new generations."
                : "After the free trial is used, an active FurniCraft Pro subscription is required for new generations. Check the allowance shown on this page before starting.")}</p>
          </div>
        ) : (
          <ul className="list-disc space-y-4 pl-5 text-sm leading-relaxed text-[var(--fc-text)]">
            <li>{t("Show one furniture item only, with the entire piece visible. Avoid room scenes, furniture sets, people, and other objects.")}</li>
            <li>{t("Use a plain, uncluttered background. If possible, remove the background so the furniture is clearly isolated.")}</li>
            <li>{t("Upload a PNG (.png) or JPEG (.jpg or .jpeg) image. Other file formats are not supported.")}</li>
            <li>{t("Use a sharp, well-lit photo. If you add extra views in High detail, every photo must show the same furniture item.")}</li>
          </ul>
        )}
      </Modal>
    </>
  );
}
