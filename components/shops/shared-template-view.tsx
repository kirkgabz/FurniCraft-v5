"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import FurnitureStudio from "@/components/design/studio/furniture-studio";
import { generatedModelFromFile } from "@/components/design/studio/generated-model";
import { combineAllowedMaterials } from "@/components/design/studio/materials-db";
import {
  parseStudioDesign,
  resolveStudioModel,
  stageStudioDesignForOpen,
} from "@/components/design/studio/studio-design-state";
import type { StudioModel } from "@/components/design/studio/studio-models";
import { openItemInDesigner, resolveDesignItem } from "@/components/design/design-state-utils";
import { createClient } from "@/lib/supabase/client";
import type { SharedTemplate } from "@/lib/shops/shared-template";
import { CopyLinkButton } from "./share-template-button";

/**
 * The shared-template page's client half: the piece in 3D, exactly as the
 * shop published it, and the one way on from there.
 *
 * The studio itself draws it, in view-only mode, so the finishes, sizes,
 * shapes and carvings are applied by the same code that applies them when a
 * customer opens the template -- a second, lighter viewer would be a second
 * thing to keep in step, and the first place the two disagreed would be a
 * customer ordering something other than what they were shown.
 *
 * "Customize & order" is where an account comes in. Signed in, it opens the
 * template in the studio addressed to this shop, the same as the shop page's
 * Customize button. Signed out, it goes to sign in and comes back here.
 */

type Load = { status: "loading" } | { status: "ready"; model: StudioModel } | { status: "error"; message: string };

const UNAVAILABLE = "This piece can't be shown in 3D right now. The shop may have changed it.";

export default function SharedTemplateView({ template }: { template: SharedTemplate }) {
  const { t: uiText } = useUiLanguage();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    void (async () => {
      const design = parseStudioDesign(template.cadState);
      if (!design) {
        setLoad({ status: "error", message: UNAVAILABLE });
        return;
      }
      const resolution = resolveStudioModel(design.modelId, design.source);
      if (resolution.kind === "missing") {
        setLoad({ status: "error", message: UNAVAILABLE });
        return;
      }

      let model: StudioModel;
      if (resolution.kind === "shipped") {
        model = resolution.model;
      } else {
        if (!template.modelUrl) {
          setLoad({ status: "error", message: UNAVAILABLE });
          return;
        }
        try {
          const response = await fetch(template.modelUrl);
          if (!response.ok) throw new Error(String(response.status));
          const file = await response.blob();
          model = await generatedModelFromFile(resolution.id, resolution.source, file);
          blobUrl = model.url;
        } catch {
          if (!cancelled) setLoad({ status: "error", message: UNAVAILABLE });
          return;
        }
      }
      if (cancelled) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }
      // Staged just before mounting: the studio applies a staged design once
      // its model is ready, which is how the published finishes and sizes go on.
      stageStudioDesignForOpen(template.cadState, template.title);
      setLoad({ status: "ready", model });
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [template]);

  const customize = async () => {
    setOpening(true);
    try {
      const { data } = await createClient().auth.getUser();
      if (!data.user) {
        window.location.assign(`/auth/login?next=${encodeURIComponent(`/t/${template.id}`)}`);
        return;
      }
      const item = resolveDesignItem(template.cadState);
      // The same staging as the shop page's Customize: held to the finishes the
      // shop will build in, and addressed to the shop that published it.
      const staged =
        item &&
        openItemInDesigner(
          item,
          `🧩 Template: ${template.title}`,
          combineAllowedMaterials(template.allowedMaterials, template.shop.allowedMaterials),
          null,
          null,
          { id: template.shop.id, name: template.shop.name }
        );
      if (!staged) {
        setLoad({ status: "error", message: UNAVAILABLE });
        return;
      }
      window.location.assign("/customize-furniture");
    } finally {
      setOpening(false);
    }
  };

  const actions = (
    <>
      <CopyLinkButton templateId={template.id} title={template.title} />
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void customize()} disabled={opening}>
        {opening ? uiText("Opening…") : uiText("Customize & order")}
      </button>
    </>
  );

  const about = (
    <div className="text-xs leading-snug text-[var(--fc-text)]">
      <p>
        <strong className="font-display text-sm font-bold">{template.title}</strong>
        <span className="text-[var(--fc-muted)]">{uiText(" by ")}{template.shop.name}</span>
        {template.tag ? <span className="ml-2 text-[var(--fc-muted)]">· {template.tag}</span> : null}
      </p>
      {template.description ? <p className="mt-1 max-w-prose text-[var(--fc-muted)]"><AdaptiveText text={template.description} automatic textClassName="line-clamp-2" /></p> : null}
      <p className="mt-1 text-[var(--fc-muted)]">{uiText("Drag to turn it around. Sign in only when you want to change it or order it.")}</p>
    </div>
  );

  if (load.status === "ready") {
    return <FurnitureStudio model={load.model} banner={about} viewOnlyActions={actions} />;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--fc-bg)] px-4 py-10 text-[var(--fc-text)]">
      <div className="w-full max-w-md text-center">
        {template.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={template.previewUrl} alt="" className="mx-auto mb-5 aspect-square w-56 rounded-2xl object-cover" />
        ) : null}
        <h1 className="font-display text-2xl font-bold">{template.title}</h1>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("by ")}{template.shop.name}</p>
        {load.status === "loading" ? (
          <p role="status" className="mt-5 text-sm text-[var(--fc-muted)] motion-safe:animate-pulse">{uiText("Loading the 3D model…")}</p>
        ) : (
          <>
            <p role="alert" className="mt-5 text-sm text-[var(--fc-text)]">
              {uiText(load.message)}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>
          </>
        )}
      </div>
    </main>
  );
}
