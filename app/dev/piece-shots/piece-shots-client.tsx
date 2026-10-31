"use client";

import { useEffect, useState } from "react";
import FurnitureStudio from "@/components/design/studio/furniture-studio";
import { STUDIO_MODELS, type StudioModelId } from "@/components/design/studio/studio-models";

/** Reads ?model= after mount: the page has no server data to wait on. */
export default function PieceShotsClient() {
  const [modelId, setModelId] = useState<StudioModelId | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("model") ?? "";
    if (requested in STUDIO_MODELS) setModelId(requested as StudioModelId);
    else setUnknown(true);
  }, []);

  if (unknown) return <p className="p-6">Unknown ?model=. One of: {Object.keys(STUDIO_MODELS).join(", ")}</p>;
  if (!modelId) return null;
  return <FurnitureStudio key={modelId} model={STUDIO_MODELS[modelId]} />;
}
