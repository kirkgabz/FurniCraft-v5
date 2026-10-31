"use client";

import { useEffect, useState } from "react";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";
import { createClient } from "@/lib/supabase/client";
import FurnitureStudio from "@/components/design/studio/furniture-studio";
import { generatedModelFromFile } from "@/components/design/studio/generated-model";
import {
  parseStudioDesign,
  resolveStudioModel,
  stageStudioDesignForOpen,
} from "@/components/design/studio/studio-design-state";
import type { StudioModel } from "@/components/design/studio/studio-models";
import type { SharedOffer } from "@/lib/shops/shared-offer";

/**
 * An order a shop wrote, opened from the link it shared.
 *
 * The sibling of SharedTemplateView, and deliberately so: the piece turns in
 * 3D for anyone, and an account is asked for only at the point of actually
 * taking the order.
 *
 * What is different is that the price is already decided. This is not a
 * design to customize -- it is a quote to accept or walk away from -- so the
 * studio is view-only and the figures sit where they cannot be missed. The
 * downpayment is shown in pesos as well as a percentage, because a customer
 * checks the first number against their GCash and the second against nothing.
 *
 * Signed out, "Order this" goes to sign-up and comes back. Signed in, it
 * calls claim_order_offer, which makes the order from the offer's own
 * figures -- nothing here is trusted to say what anything costs.
 */

type Load = { status: "loading" } | { status: "ready"; model: StudioModel } | { status: "error"; message: string };

const UNAVAILABLE = "This piece can't be shown in 3D right now. The shop may have changed it.";

export default function SharedOfferView({ offer }: { offer: SharedOffer }) {
  const { t: uiText } = useUiLanguage();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [claiming, setClaiming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    void (async () => {
      const design = parseStudioDesign(offer.cadState);
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
        if (!offer.modelUrl) {
          setLoad({ status: "error", message: UNAVAILABLE });
          return;
        }
        try {
          const response = await fetch(offer.modelUrl);
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
      stageStudioDesignForOpen(offer.cadState, offer.projectName);
      setLoad({ status: "ready", model });
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [offer]);

  const downpayment = Math.round((offer.quotedTotal * offer.downpaymentPercent) / 100);
  const balance = Math.round(offer.quotedTotal) - downpayment;
  const money = (amount: number) => `₱${amount.toLocaleString("en-US")}`;

  const take = async () => {
    setClaiming(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        // Sign-up rather than sign-in: whoever follows one of these links is
        // usually somebody the shop met offline and who has no account yet.
        // The sign-in page is one tap from there for everyone else.
        window.location.assign(`/auth/sign-up?next=${encodeURIComponent(`/o/${offer.token}`)}`);
        return;
      }

      const { data, error } = await supabase.rpc("claim_order_offer", { p_token: offer.token });
      if (error) {
        console.error("Failed to claim the offer:", error);
        // The function raises the sentence a customer should read, so it is
        // shown rather than replaced with something vaguer.
        setProblem(error.message || uiText("This order could not be taken. Ask the shop for a new link."));
        return;
      }
      window.location.assign(`/protected/orders/${String(data)}`);
    } finally {
      setClaiming(false);
    }
  };

  const actions = (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={() => void take()}
      disabled={claiming}
    >
      {claiming ? uiText("Opening…") : uiText("Order this — {0}", { 0: money(offer.quotedTotal) })}
    </button>
  );

  const about = (
    <div className="text-xs leading-snug text-[var(--fc-text)]">
      <p>
        <strong className="font-display text-sm font-bold">{offer.projectName}</strong>
        <span className="text-[var(--fc-muted)]"> {uiText("from {0}", { 0: offer.shop.name })}</span>
        {offer.furnitureType ? <span className="ml-2 text-[var(--fc-muted)]">· {offer.furnitureType}</span> : null}
      </p>
      <p className="mt-1 text-[var(--fc-text)]">
        <strong>{money(offer.quotedTotal)}</strong>
        <span className="text-[var(--fc-muted)]">
          {" "}
          — {uiText("{0} to start ({1}%), {2} on pick up.", { 0: money(downpayment), 1: offer.downpaymentPercent, 2: money(balance) })}
        </span>
      </p>
      {offer.notes ? <p className="mt-1 max-w-prose text-[var(--fc-muted)]"><AdaptiveText text={offer.notes} /></p> : null}
      <p className="mt-1 text-[var(--fc-muted)]">
        {uiText("Drag to turn it around. You only need an account when you take the order.")}
      </p>
      {problem ? (
        <p role="alert" className="mt-1 text-fc-danger">
          {uiText(problem)}
        </p>
      ) : null}
    </div>
  );

  if (load.status === "ready") {
    return <FurnitureStudio model={load.model} banner={about} viewOnlyActions={actions} />;
  }

  // The same page without the 3D: the quote is the point, and it reads
  // perfectly well beside a still. A piece that cannot be shown is still an
  // order somebody agreed to.
  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--fc-bg)] px-4 py-10 text-[var(--fc-text)]">
      <div className="w-full max-w-md text-center">
        {offer.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={offer.previewUrl} alt="" className="mx-auto mb-5 aspect-square w-56 rounded-2xl object-cover" />
        ) : null}
        <h1 className="font-display text-2xl font-bold">{offer.projectName}</h1>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("from {0}", { 0: offer.shop.name })}</p>
        <p className="mt-3 text-lg font-bold">{money(offer.quotedTotal)}</p>
        <p className="text-xs text-[var(--fc-muted)]">
          {uiText("{0} to start ({1}%), {2} on pick up", { 0: money(downpayment), 1: offer.downpaymentPercent, 2: money(balance) })}
        </p>

        {load.status === "loading" ? (
          <p role="status" className="mt-5 text-sm text-[var(--fc-muted)] motion-safe:animate-pulse">
            {uiText("Loading the 3D model…")}
          </p>
        ) : (
          <p role="alert" className="mt-5 text-sm text-[var(--fc-text)]">
            {uiText(load.message)}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>
        {problem ? (
          <p role="alert" className="mt-3 text-xs text-fc-danger">
            {uiText(problem)}
          </p>
        ) : null}
      </div>
    </main>
  );
}
