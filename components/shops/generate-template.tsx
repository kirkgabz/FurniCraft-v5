"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useRef, useState } from "react";
import FurnitureStudio from "@/components/design/studio/furniture-studio";
import type { FurnitureFamily } from "@/components/design/studio/studio-config";
import type { FurnitureCategoryId, StudioModel } from "@/components/design/studio/studio-models";
import {
  LabellingError,
  PipelineRejectedError,
  SignedOutError,
  analyseModelFiles,
  keepGeneratedModel,
  labelViaApi,
  startGeneration,
  waitForModel,
  type CanonicalUpload,
  type PipelineStage,
} from "@/components/design/studio/generation-pipeline";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import {
  GENERATION_COST,
  SUBSCRIPTION_COLUMNS,
  describeAllowance,
  toAllowance,
  type Allowance,
} from "@/lib/shops/allowance";
import { IconArrowLeft, IconChevronDown } from "@/components/solihiya/icons";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";
import { PhotoGenerationNotices } from "@/components/shops/photo-generation-notices";

/**
 * Photo in, publishable template out -- the shop owners' side of the model
 * lab, running the same pipeline (generation-pipeline.ts).
 *
 * Its job beyond the lab's is to be careful with the shop's allowance:
 *
 *   - A paid generation must not be lost to a closed tab. Meshy keeps working
 *     whether or not anyone is watching, so anything left mid-way is listed
 *     under "Unfinished" and can be picked up without spending again.
 *   - A model OUR pipeline cannot use is refunded ('pipeline_rejected'); a
 *     result the shop merely does not like is not.
 *   - The AI names the parts inconsistently -- the same model has labelled at
 *     100%, 31% and 89% -- so the shop reviews them in the studio before
 *     publishing, and can relabel a capped number of times.
 *
 * Publishing itself is the studio's existing template action, which stages
 * the design into the dashboard's template form. Nothing here writes a
 * template.
 */

export type PendingGeneration = {
  taskId: string;
  createdAt: string;
  mode?: GenerationMode;
  category?: FurnitureCategoryId | null;
  textured?: boolean;
};

type Step = "preparing" | "generating" | "separating" | "splitting" | "naming" | "keeping";

const STEP_LABELS: Record<Step, string> = {
  preparing: "Preparing your photo",
  generating: "Building the 3D model",
  separating: "Separating it into parts",
  splitting: "Reading the parts",
  naming: "Naming each part",
  keeping: "Keeping a copy for your template",
};

/** The steps a run goes through. High detail adds the split; a texture rides along inside the build. */
function stepsFor(mode: GenerationMode): Step[] {
  if (mode === "quick") return ["preparing", "generating", "splitting", "naming", "keeping"];
  return ["preparing", "generating", "separating", "splitting", "naming", "keeping"];
}

type Retry = { taskId: string; file: File };

type Phase =
  | { kind: "form" }
  | { kind: "working"; step: Step; progress: number | null }
  | {
      kind: "review";
      model: StudioModel;
      taskId: string;
      upload: CanonicalUpload;
      passesLeft: number | null;
      round: number;
      note: string | null;
    }
  | { kind: "failed"; message: string; retry: Retry | null };

type GenerationMode = "quick" | "detailed";

/**
 * The kinds of piece, with a starting height for each.
 *
 * The same eight a customer picks from in the studio. The kind decides three
 * things: which parts a high-detail split is told to look for, which
 * vocabulary the parts are named from (a bed's is its own), and the height
 * the form starts at -- nudged only while it is still the previous kind's
 * default, never over a height the shop typed.
 */
const CATEGORY_CHOICES: Array<{ value: FurnitureCategoryId; label: string; height: number }> = [
  { value: "chair", label: "Chair", height: 90 },
  { value: "table", label: "Table", height: 75 },
  { value: "sofa", label: "Sofa", height: 85 },
  { value: "cabinet", label: "Cabinet", height: 180 },
  { value: "bed", label: "Bed", height: 110 },
  { value: "bookshelf", label: "Bookshelf", height: 180 },
  { value: "desk", label: "Desk", height: 75 },
  { value: "stool", label: "Stool", height: 45 },
];

function familyOf(category: FurnitureCategoryId): FurnitureFamily {
  return category === "bed" ? "bed" : "generic";
}

/** High detail can read up to four views; the first is the one it is painted from. */
const MAX_PHOTOS = 4;

/** A piece shorter than a footstool or taller than a room is a typo, not furniture. */
const MIN_HEIGHT_CM = 20;
const MAX_HEIGHT_CM = 400;

const CREATED_AT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
};

const BUTTON_PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-fc-btn px-5 py-2.5 [@media(pointer:coarse)]:min-h-11 text-sm font-bold text-fc-btn-fg transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-fc-btn-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";
const BUTTON_QUIET =
  "inline-flex items-center justify-center rounded-full border border-[var(--fc-border)] px-4 py-2 [@media(pointer:coarse)]:min-h-11 text-sm font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform,opacity] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

function stepForStage(stage: PipelineStage): Step {
  return stage === "classifying" ? "naming" : "splitting";
}

/** The photo's name, minus its extension -- what the template's title starts as. */
function pieceName(photoName: string): string {
  return photoName.replace(/\.[^.]+$/, "").trim() || "Generated piece";
}

export default function GenerateTemplate({
  shop,
  initialAllowance,
  pending,
}: {
  shop: { id: string; name: string };
  initialAllowance: Allowance | null;
  pending: PendingGeneration[];
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  /**
   * Null until the shop picks one. It used to start as "chair", so a table
   * photographed in a hurry was generated as a chair: the type decides which
   * parts the split looks for and how they are named, and nothing asked.
   * The photo cannot be chosen until this is.
   */
  const [category, setCategory] = useState<FurnitureCategoryId | null>(null);
  /**
   * Empty until the shop types it. It used to start at a chair's 90 cm and
   * follow the type's default, so it was never actually entered: every
   * measurement on the finished template is scaled from this one number, and a
   * guessed one is wrong in every dimension. The type's usual height is shown
   * as a hint instead of being filled in.
   */
  const [heightCm, setHeightCm] = useState(Number.NaN);
  /** The first is the main photo; the rest are extra views, which only High detail reads. */
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const photo = photos[0] ?? null;
  const [allowance, setAllowance] = useState(initialAllowance);
  const [unfinished, setUnfinished] = useState(pending);
  const [activeTab, setActiveTab] = useState<"new" | "unfinished">("new");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  /**
   * Quick or High detail.
   *
   * Quick until the shop chooses otherwise, because High detail costs 3 of
   * the period's generations and that should never happen without being
   * picked. The steps a run shows are fixed when it starts, so switching
   * this mid-run cannot redraw a run already under way.
   */
  const [mode, setMode] = useState<GenerationMode>("quick");
  const [runSteps, setRunSteps] = useState<Step[]>(() => stepsFor("quick"));
  /**
   * Whether the model is painted from the photo as well as shaped.
   *
   * The shop's choice, and off until it makes it. A texture is what makes a
   * generated piece look finished rather than plain white, but it costs the
   * platform more at Meshy, and a customer who picks a catalogue finish never
   * sees it. It never costs the shop another generation.
   */
  const [textured, setTextured] = useState(false);
  /** Something the shop should know about the model that arrived -- a texture that couldn't be painted. */
  const noteRef = useRef<string | null>(null);
  /**
   * The kind the running generation was started as. Read by the naming step
   * instead of the form, so resuming an unfinished piece names its parts as
   * the kind it is, not whatever the form happens to say now.
   */
  const runCategoryRef = useRef<FurnitureCategoryId | null>(null);
  /**
   * The height the running generation is scaled by -- likewise set when it
   * starts, so a picked-up piece uses the height entered for it rather than
   * whatever the form held when analyse() was last recreated.
   */
  const runHeightRef = useRef(Number.NaN);
  /** The unfinished row whose height is being asked for before it is picked up. */
  const [pickingUp, setPickingUp] = useState<{
    taskId: string;
    heightCm: number;
    category: FurnitureCategoryId | null;
  } | null>(null);

  /**
   * Bumped whenever a run starts, is abandoned, or the page goes away. Every
   * await checks it, so a run the shop has walked away from stops writing to
   * the screen -- and stops polling Meshy -- instead of racing the next one.
   */
  const runIdRef = useRef(0);
  /** Blob URLs this page made, released when replaced or on the way out. */
  const modelUrlRef = useRef<string | null>(null);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );

  const heightValid = Number.isFinite(heightCm) && heightCm >= MIN_HEIGHT_CM && heightCm <= MAX_HEIGHT_CM;
  const { text: allowanceText, canGenerate } = describeAllowance(allowance);
  /**
   * High detail needs 3 generations left in the period. The trial is one
   * generation of either kind, so it can always be spent on either.
   */
  const generationsLeft = allowance ? Math.max(0, allowance.limit - allowance.used) : 0;
  const detailedAffordable = !allowance || !allowance.onPro || generationsLeft >= GENERATION_COST.detailed;
  const effectiveMode: GenerationMode = mode === "detailed" && detailedAffordable ? "detailed" : "quick";
  /** Extra views are read only by High detail; Quick builds from the main photo alone. */
  const photosToSend = effectiveMode === "detailed" ? photos : photos.slice(0, 1);

  const setPhotoList = (next: File[]) => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current = next.map((file) => URL.createObjectURL(file));
    setPhotoPreviews(previewUrlsRef.current);
    setPhotos(next);
  };
  const pickMainPhoto = (file: File | null) => {
    if (file) setPhotoList([file, ...photos.slice(1)]);
  };
  const addViews = (files: File[]) => setPhotoList([...photos, ...files].slice(0, MAX_PHOTOS));
  const removePhoto = (index: number) => setPhotoList(photos.filter((_, i) => i !== index));

  // Choosing a type no longer fills the height in; the height is the shop's
  // own measurement and is required (see heightCm).
  const chooseCategory = (value: FurnitureCategoryId) => setCategory(value);
  const typicalHeight = CATEGORY_CHOICES.find((choice) => choice.value === category)?.height ?? null;
  /** Both are asked before the photo, because both decide how it is read. */
  const canAddPhoto = Boolean(category) && heightValid;

  const refreshAllowance = useCallback(async () => {
    const { data } = await createClient()
      .from("shop_subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("shop_id", shop.id)
      .maybeSingle();
    if (data) setAllowance(toAllowance(data, Date.now()));
  }, [shop.id]);

  /**
   * Meshy was paid and returned something our pipeline cannot use -- a model
   * it cannot split into parts, whether the split failed at Meshy or here.
   * That is the platform failing the shop, so the generation goes back, while
   * this period's retries last, which the database decides. Refunded by task,
   * so a High detail generation comes back as the 2 it cost. Best-effort:
   * the message is true either way.
   */
  const refundRejected = useCallback(
    async (taskId: string, error: PipelineRejectedError, stale: () => boolean) => {
      const supabase = createClient();
      await supabase.rpc("refund_generation", { p_shop_id: shop.id, p_reason: "pipeline_rejected", p_task_id: taskId });
      await supabase.rpc("set_generation_outcome", { p_task_id: taskId, p_outcome: "rejected" });
      if (stale()) return;
      setUnfinished((list) => list.filter((entry) => entry.taskId !== taskId));
      await refreshAllowance();
      setPhase({
        kind: "failed",
        message: `${error.message} That's on our side, not your photo, so this generation goes back to your allowance while this period's retries last. A different angle or a plainer background usually helps.`,
        retry: null,
      });
    },
    [refreshAllowance, shop.id]
  );

  /** Everything after the model file exists: split, label, keep, review. */
  const analyse = useCallback(
    async (taskId: string, file: File, runId: number, round: number) => {
      const stale = () => runIdRef.current !== runId;
      const passes: { left: number | null } = { left: null };
      try {
        // Set by generate() and resume(), which both require a type first.
        const runCategory = runCategoryRef.current ?? category;
        if (!runCategory) throw new Error("Choose what the piece is before generating it.");
        const runHeight = Number.isFinite(runHeightRef.current) ? runHeightRef.current : heightCm;
        const { model, upload } = await analyseModelFiles([file], {
          cmPerUnit: runHeight,
          family: familyOf(runCategory),
          category: runCategory,
          label: labelViaApi({ taskId, onRemaining: (left) => (passes.left = left) }),
          onStage: (stage) => {
            if (!stale()) setPhase({ kind: "working", step: stepForStage(stage), progress: null });
          },
        });
        if (stale()) {
          URL.revokeObjectURL(model.url);
          return;
        }

        setPhase({ kind: "working", step: "keeping", progress: null });
        const kept = await keepGeneratedModel(taskId, upload);
        if (stale()) {
          URL.revokeObjectURL(model.url);
          return;
        }
        if ("error" in kept) {
          // Without a stored copy there is nothing for a customer to open, so
          // this is not a piece that can be published -- but the labels were
          // fine, so trying again is the right offer.
          URL.revokeObjectURL(model.url);
          setPhase({
            kind: "failed",
            message: `The model is ready, but a copy couldn't be kept for your template (${kept.error}). Try again in a moment.`,
            retry: { taskId, file },
          });
          return;
        }

        if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
        modelUrlRef.current = model.url;
        setPhase({
          kind: "review",
          model: { ...model, ...kept.patch },
          taskId,
          upload,
          passesLeft: passes.left,
          round,
          note: noteRef.current,
        });
        notifySuccess("Your 3D model is ready to review");
      } catch (error) {
        if (stale()) return;

        if (error instanceof PipelineRejectedError) {
          await refundRejected(taskId, error, stale);
          return;
        }

        setPhase({
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
          // Out of labelling passes, or signed out, means trying again here
          // cannot work -- and the message says what will.
          retry:
            (error instanceof LabellingError && error.exhausted) || error instanceof SignedOutError
              ? null
              : { taskId, file },
        });
      }
    },
    [category, heightCm, refundRejected]
  );

  /** From a task Meshy has accepted: wait for it, keep the raw file, analyse. */
  const continueFrom = useCallback(
    async (taskId: string, runId: number, name: string) => {
      const stale = () => runIdRef.current !== runId;
      noteRef.current = null;
      setPhase({ kind: "working", step: "generating", progress: null });
      let glb: Blob | null;
      try {
        glb = await waitForModel(taskId, {
          isCancelled: stale,
          onProgress: (progress, _credits, stage) => {
            if (stale()) return;
            // A high-detail chain says which of its steps it is on; a quick
            // generation never does, and is only ever building.
            const step: Step = stage === "separating" ? "separating" : "generating";
            setPhase({ kind: "working", step, progress });
          },
          onNote: (note) => {
            noteRef.current = note;
          },
        });
      } catch (error) {
        // The split failing after the model was built and paid for: ours,
        // not the photo's, and refunded like any model we cannot use.
        if (error instanceof PipelineRejectedError) {
          if (!stale()) await refundRejected(taskId, error, stale);
          return;
        }
        throw error;
      }
      if (!glb || stale()) return;

      // Already kept: the server filed the raw model the moment Meshy
      // finished (waitForModel). The canonical scene replaces that copy once
      // the parts are named (keepGeneratedModel).
      await analyse(taskId, new File([glb], `${name}.glb`, { type: "model/gltf-binary" }), runId, 0);
    },
    [analyse, refundRejected]
  );

  const generate = useCallback(async () => {
    // The button is disabled without all three; this is the same rule for
    // anything that calls it some other way.
    if (!photo || !category || !heightValid) return;
    runIdRef.current += 1;
    const runId = runIdRef.current;
    setRunSteps(stepsFor(effectiveMode));
    runCategoryRef.current = category;
    runHeightRef.current = heightCm;
    setPhase({ kind: "working", step: "preparing", progress: null });
    try {
      const { taskId, remaining } = await startGeneration(photosToSend, {
        shopId: shop.id,
        textured,
        mode: effectiveMode,
        category,
      });
      if (remaining !== null) {
        setAllowance((current) =>
          current ? (current.onPro ? { ...current, used: current.limit - remaining } : { ...current, trialUsed: true }) : current
        );
      }
      // Listed straight away: if the tab closes from here on, this is how the
      // shop gets back to a generation it has already paid for.
      setUnfinished((list) => [
        { taskId, createdAt: new Date().toISOString(), mode: effectiveMode, category, textured },
        ...list,
      ]);
      await continueFrom(taskId, runId, pieceName(photo.name));
    } catch (error) {
      if (runIdRef.current !== runId) return;
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error), retry: null });
    }
  }, [photo, photosToSend, shop.id, textured, effectiveMode, category, heightCm, heightValid, continueFrom]);

  const resume = useCallback(
    async (entry: PendingGeneration, runHeight: number, fallbackCategory: FurnitureCategoryId | null) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;
      setPickingUp(null);
      setRunSteps(stepsFor(entry.mode ?? "quick"));
      // The kind it was started as, not whatever the form now says: it is what
      // the split was told to look for, and what the parts should be named as.
      runCategoryRef.current = entry.category ?? fallbackCategory;
      runHeightRef.current = runHeight;
      try {
        await continueFrom(entry.taskId, runId, photo ? pieceName(photo.name) : "Generated piece");
      } catch (error) {
        if (runIdRef.current !== runId) return;
        setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error), retry: null });
      }
    },
    [continueFrom, photo]
  );

  const retry = useCallback(
    (again: Retry, round = 0) => {
      runIdRef.current += 1;
      setPhase({ kind: "working", step: "splitting", progress: null });
      void analyse(again.taskId, again.file, runIdRef.current, round);
    },
    [analyse]
  );

  const startOver = useCallback(() => {
    runIdRef.current += 1;
    setActiveTab("new");
    setPhase({ kind: "form" });
  }, []);

  // ------------------------------------------------------------ review
  if (phase.kind === "review") {
    const { passesLeft } = phase;
    return (
      <FurnitureStudio
        // A relabel is a different model under the same id; remounting keeps
        // the studio from carrying finishes and sizes across to parts that
        // may now be named differently.
        key={`${phase.taskId}-${phase.round}`}
        model={phase.model}
        onBack={startOver}
        // The photo this piece was made from, to check the model against.
        // None when picking up an earlier generation after a reload.
        referenceImage={photoPreviews[0] ?? null}
        banner={
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs leading-snug text-[var(--fc-text)]">
            <div className="max-w-prose space-y-1">
              <p>
                <strong className="font-semibold">{uiText("Check the parts before you publish.")}</strong>{uiText(" Each one in the list should be named for what it is. If some are wrong, relabel")}{passesLeft !== null ? uiText(" ({0} {1} left)", { 0: passesLeft, 1: passesLeft === 1 ? "try" : "tries" }) : ""}{uiText(". When it looks right, publish it with “Publish as Template” at the top.")}</p>
              {phase.note ? <p className="text-[var(--fc-muted)]">{uiText(phase.note)}</p> : null}
            </div>
            <button
              type="button"
              className={BUTTON_QUIET}
              disabled={passesLeft === 0}
              onClick={() =>
                retry(
                  {
                    taskId: phase.taskId,
                    // The canonical scene, already levelled -- so a relabel
                    // renames the same shells rather than re-deriving them.
                    file: new File([phase.upload.glb], `${phase.upload.name}.glb`, { type: "model/gltf-binary" }),
                  },
                  phase.round + 1
                )
              }
            >{uiText("Relabel parts")}</button>
          </div>
        }
      />
    );
  }

  // --------------------------------------------------------------- page
  const working = phase.kind === "working" ? phase : null;
  const currentStep = working ? runSteps.indexOf(working.step) : -1;

  return (
    <main className="min-h-screen bg-[var(--fc-bg)] px-4 py-8 text-[var(--fc-text)] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <a
          href="/protected/shop"
          className={BACK_BUTTON_CLASS}
        >
          <IconArrowLeft aria-hidden className="h-4 w-4" /> {shop.name}
        </a>

        <h1 className="mt-6 font-display text-3xl font-bold tracking-tight sm:text-4xl">{uiText("Make a template from a photo")}</h1>
        <p className="mt-2 max-w-[56ch] text-[var(--fc-muted)]">{uiText("Photograph a piece you build and we’ll turn it into a 3D model your customers can resize and refinish in the studio.")}</p>
        <PhotoGenerationNotices allowance={allowance} />

        {phase.kind === "form" ? (
          <div role="tablist" aria-label={uiText("Image to 3D templates")} className="mt-6 grid grid-cols-2 gap-1 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-1">
            {([
              { id: "new", label: "Image to 3D" },
              { id: "unfinished", label: "Unfinished templates" },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`generation-tab-${tab.id}`}
                aria-controls={`generation-panel-${tab.id}`}
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => {
                  let next: "new" | "unfinished";
                  if (event.key === "Home") next = "new";
                  else if (event.key === "End") next = "unfinished";
                  else if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = activeTab === "new" ? "unfinished" : "new";
                  else return;
                  event.preventDefault();
                  setActiveTab(next);
                  document.getElementById(`generation-tab-${next}`)?.focus();
                }}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition-[background-color,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fc-accent)] ${activeTab === tab.id ? "bg-[var(--fc-btn)] text-[var(--fc-btn-fg)]" : "text-[var(--fc-muted)] hover:bg-[var(--fc-bg)]"}`}
              >
                {uiText(tab.label)}
                {tab.id === "unfinished" ? <span className="rounded-full bg-current/10 px-2 py-0.5 font-mono text-xs tabular-nums">{unfinished.length}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        <div
          id="generation-panel-new"
          role={phase.kind === "form" ? "tabpanel" : undefined}
          aria-labelledby={phase.kind === "form" ? "generation-tab-new" : undefined}
          tabIndex={phase.kind === "form" ? 0 : undefined}
          hidden={phase.kind === "form" && activeTab !== "new"}
        >
        {working ? (
          <section
            className="mt-8 rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm"
            aria-labelledby="progress-heading"
          >
            <h2 id="progress-heading" className="font-display text-xl font-bold">{uiText("Working on it")}</h2>
            <ol className="mt-5 space-y-3" role="status" aria-live="polite">
              {runSteps.map((step, index) => {
                const state = index < currentStep ? "done" : index === currentStep ? "current" : "todo";
                return (
                  <li key={step} className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden
                      className={
                        state === "done"
                          ? "grid h-5 w-5 place-items-center rounded-full bg-[var(--fc-accent)] text-[11px] font-bold text-white"
                          : state === "current"
                            ? "h-5 w-5 rounded-full border-2 border-[var(--fc-accent)] motion-safe:animate-pulse"
                            : "h-5 w-5 rounded-full border border-[var(--fc-border)]"
                      }
                    >
                      {state === "done" ? "✓" : null}
                    </span>
                    <span className={state === "todo" ? "text-[var(--fc-muted)]" : "font-semibold"}>
                      {STEP_LABELS[step]}
                      {state === "current" && (step === "generating" || step === "separating") && working.progress !== null ? (
                        <span className="ml-2 font-mono text-xs tabular-nums text-[var(--fc-muted)]">{working.progress}%</span>
                      ) : null}
                      <span className="sr-only">{state === "done" ? uiText(" (done)") : state === "current" ? uiText(" (in progress)") : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-5 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("Building the model takes a minute or two. You can leave this page: it keeps going, and you can pick it up again here in the Unfinished templates tab.")}</p>
          </section>
        ) : phase.kind === "failed" ? (
          <section
            className="mt-8 rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm"
            role="alert"
          >
            <h2 className="font-display text-xl font-bold">{uiText("That didn’t work")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fc-text)]">{uiText(phase.message)}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {phase.retry ? (
                <button type="button" className={BUTTON_PRIMARY} onClick={() => phase.retry && retry(phase.retry)}>{uiText("Try again")}</button>
              ) : null}
              <button type="button" className={phase.retry ? BUTTON_QUIET : BUTTON_PRIMARY} onClick={startOver}>{uiText("Start over")}</button>
            </div>
          </section>
        ) : (
          <section className="mt-8 rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
            {/* A dropdown rather than eight chips: one decision, one control,
                and it starts empty so it has to be made. */}
            <label className="block" htmlFor="piece-type">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("What is it? ")}<span className="normal-case tracking-normal text-fc-danger">{uiText("(required)")}</span>
              </span>
              <span className="relative mt-2 block w-full sm:max-w-xs">
                <select
                  id="piece-type"
                  required
                  value={category ?? ""}
                  onChange={(event) => chooseCategory(event.target.value as FurnitureCategoryId)}
                  aria-describedby="piece-type-hint"
                  className={`min-h-11 w-full cursor-pointer appearance-none rounded-2xl border bg-[var(--fc-panel)] py-2 pl-4 pr-10 text-sm font-semibold transition-[border-color] duration-150 ease-out focus:border-[var(--fc-accent)] focus:outline-none ${
                    category ? "border-[var(--fc-border)] text-[var(--fc-text)]" : "border-[var(--fc-accent)] text-[var(--fc-muted)]"
                  }`}
                >
                  <option value="" disabled>{uiText("Choose a type")}</option>
                  {CATEGORY_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {uiText(choice.label)}
                    </option>
                  ))}
                </select>
                <IconChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fc-muted)]"
                />
              </span>
              <span id="piece-type-hint" className="mt-1 block text-xs text-[var(--fc-muted)]">{uiText("Decides which parts are looked for in the photo and what they are called.")}</span>
            </label>

            <label className="mt-6 block" htmlFor="piece-height">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Real height ")}<span className="normal-case tracking-normal text-fc-danger">{uiText("(required)")}</span>
              </span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  id="piece-height"
                  type="number"
                  inputMode="numeric"
                  required
                  min={MIN_HEIGHT_CM}
                  max={MAX_HEIGHT_CM}
                  value={Number.isFinite(heightCm) ? heightCm : ""}
                  placeholder={typicalHeight ? String(typicalHeight) : undefined}
                  onChange={(event) => setHeightCm(event.target.valueAsNumber)}
                  aria-describedby="piece-height-hint"
                  // Only once something has been typed: an empty required
                  // field is unfinished, not wrong.
                  aria-invalid={Number.isFinite(heightCm) && !heightValid}
                  className={`w-28 rounded-2xl border bg-[var(--fc-panel)] px-3 py-2 font-mono tabular-nums text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] placeholder:opacity-60 ${
                    heightValid ? "border-[var(--fc-border)]" : "border-[var(--fc-accent)]"
                  }`}
                />
                <span className="text-sm text-[var(--fc-muted)]">{uiText("cm")}</span>
              </span>
              <span id="piece-height-hint" className="mt-1 block text-xs text-[var(--fc-muted)]">
                {Number.isFinite(heightCm) && !heightValid ? (
                  <span className="font-semibold text-fc-danger">{uiText("Between ")}{MIN_HEIGHT_CM}{uiText(" and ")}{MAX_HEIGHT_CM}{uiText(" cm.")}{" "}
                  </span>
                ) : null}{uiText("Measure it: floor to the highest point. A photo carries no scale, so every measurement is worked out from this.")}{typicalHeight ? uiText(" A {0} is usually about {1} cm.", { 0: CATEGORY_CHOICES.find((choice) => choice.value === category)?.label.toLowerCase(), 1: typicalHeight }) : ""}
              </span>
            </label>

            <fieldset className="mt-6">
              <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Detail")}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "quick",
                      title: "Quick",
                      cost: `${GENERATION_COST.quick} generation`,
                      blurb: "Ready in about two minutes. Fine for simple, boxy pieces.",
                    },
                    {
                      value: "detailed",
                      title: "High detail",
                      cost: `${GENERATION_COST.detailed} generations`,
                      blurb: detailedAffordable
                        ? "Smooth curves, and carving or fluting in the shape itself, in cleaner parts. About five minutes."
                        : `Needs ${GENERATION_COST.detailed} generations in this period, and ${generationsLeft === 0 ? "none are" : generationsLeft === 1 ? "only 1 is" : `only ${generationsLeft} are`} left.`,
                    },
                  ] as const
                ).map((option) => {
                  const selected = effectiveMode === option.value;
                  const disabled = option.value === "detailed" && !detailedAffordable;
                  return (
                    <label
                      key={option.value}
                      className={`flex items-start gap-3 rounded-2xl border p-4 transition-[border-color,background-color] duration-150 ease-out ${
                        disabled
                          ? "cursor-not-allowed border-[var(--fc-border)] opacity-60"
                          : selected
                            ? "cursor-pointer border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)]"
                            : "cursor-pointer border-[var(--fc-border)] hover:border-[var(--fc-accent)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="piece-detail"
                        value={option.value}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => setMode(option.value)}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--fc-accent)]"
                      />
                      <span className="min-w-0 text-sm">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="font-semibold">{uiText(option.title)}</span>
                          <span className="font-mono text-xs tabular-nums text-[var(--fc-muted)]">{option.cost}</span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--fc-muted)]">{uiText(option.blurb)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-6">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Photo")}</span>
              {/* Locked until a type is chosen: the type decides how the photo
                  is read, so it is asked first rather than guessed. */}
              <label
                htmlFor="piece-photo"
                aria-disabled={!canAddPhoto}
                className={`mt-2 flex items-center gap-4 rounded-2xl border-2 border-dashed border-[var(--fc-border)] p-4 transition-[border-color,background-color,opacity] duration-150 ease-out ${
                  canAddPhoto
                    ? "cursor-pointer hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)]"
                    : "cursor-not-allowed opacity-50"
                }`}
              >
                {photoPreviews[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreviews[0]} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span aria-hidden className="grid h-20 w-20 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-[var(--fc-ink-accent)]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  </span>
                )}
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">
                    {!category ? uiText("Choose what it is first") : !heightValid ? uiText("Enter its real height first") : photo ? photo.name : uiText("Choose a photo")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-[var(--fc-muted)]">
                    {!canAddPhoto ? uiText("Pick the type and enter the height above, then add a photo of the piece.") : uiText("The whole piece in frame, straight on or at an angle, against a plain background. JPEG or PNG.")}
                  </span>
                </span>
              </label>
              <input
                id="piece-photo"
                type="file"
                accept="image/jpeg,image/png"
                disabled={!canAddPhoto}
                className="sr-only"
                onChange={(event) => {
                  pickMainPhoto(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </div>

            {effectiveMode === "detailed" && photo ? (
              <div className="mt-4">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("More angles ")}<span className="normal-case tracking-normal text-[var(--fc-muted)]">{uiText("(optional)")}</span>
                </span>
                <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("Up to three more photos of the same piece. The back and sides help most: from one photo the model has to guess what it can’t see, which is how a solid pedestal can come out hollow.")}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {photos.slice(1).map((view, index) => (
                    <li key={`${view.name}-${index}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photoPreviews[index + 1]} alt={uiText("Extra view {0}", { 0: index + 1 })} className="h-16 w-16 rounded-xl object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index + 1)}
                        aria-label={uiText("Remove extra view {0}", { 0: index + 1 })}
                        className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] text-sm font-bold text-[var(--fc-text)] shadow-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,var(--fc-panel))] active:scale-[0.94] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
                      >
                        <span aria-hidden>×</span>
                      </button>
                    </li>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <li>
                      <label
                        htmlFor="piece-views"
                        className="grid h-16 w-16 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-[var(--fc-border)] text-2xl text-[var(--fc-ink-accent)] transition-[border-color,background-color] duration-150 ease-out hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)]"
                      >
                        <span aria-hidden>+</span>
                        <span className="sr-only">{uiText("Add another view")}</span>
                      </label>
                      <input
                        id="piece-views"
                        type="file"
                        accept="image/jpeg,image/png"
                        multiple
                        className="sr-only"
                        onChange={(event) => {
                          addViews(Array.from(event.target.files ?? []));
                          event.target.value = "";
                        }}
                      />
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            <label
              htmlFor="piece-textured"
              className={`mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-[border-color,background-color] duration-150 ease-out ${
                textured
                  ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)]"
                  : "border-[var(--fc-border)] hover:border-[var(--fc-accent)]"
              }`}
            >
              <input
                id="piece-textured"
                type="checkbox"
                checked={textured}
                onChange={(event) => setTextured(event.target.checked)}
                aria-describedby="piece-textured-hint"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--fc-accent)]"
              />
              <span className="min-w-0 text-sm">
                <span className="block font-semibold">{uiText("Realistic textures")}</span>
                <span id="piece-textured-hint" className="mt-0.5 block text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("Wood grain, fabric and leather taken from your photo, instead of a plain white model. Customers see it when they keep the “Original” finish. Painted while the piece is built, so it adds no waiting and never uses another generation.")}</span>
              </span>
            </label>

            <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-[var(--fc-border)] pt-5">
              <button
                type="button"
                className={BUTTON_PRIMARY}
                disabled={!photo || !category || !heightValid || !canGenerate}
                onClick={() => void generate()}
              >{uiText("Generate the model")}</button>
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--fc-muted)]">
                {effectiveMode === "detailed" && allowance?.onPro ? uiText("Uses {0} generations. ", { 0: GENERATION_COST.detailed }) : null}
                {uiText(allowanceText)}
                {allowance && (!allowance.onPro || !canGenerate) ? (
                  <>
                    {" "}
                    <a
                      href="/protected/shop?section=subscription"
                      className="font-semibold text-[var(--fc-ink-accent)] underline-offset-2 hover:underline"
                    >
                      {allowance.onPro ? uiText("Renew early") : uiText("Upgrade to Pro")}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          </section>
        )}
        </div>

          <section id="generation-panel-unfinished" role="tabpanel" aria-labelledby="generation-tab-unfinished" tabIndex={0} hidden={phase.kind !== "form" || activeTab !== "unfinished"} className="mt-6">
            <h2 id="unfinished-heading" className="font-display text-xl font-bold">{uiText("Unfinished templates")}</h2>
            <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Models you started but haven’t published. Picking one up doesn’t use another generation; it keeps the type it was started as, and asks for the piece’s real height.")}</p>
            {unfinished.length > 0 ? (
            <ul className="mt-3 divide-y divide-[var(--fc-border)] rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)]">
              {unfinished.map((entry) => {
                const asking = pickingUp?.taskId === entry.taskId ? pickingUp : null;
                const askCategory = entry.category ?? asking?.category ?? null;
                const askTypical = CATEGORY_CHOICES.find((choice) => choice.value === askCategory)?.height ?? null;
                const askHeightValid =
                  asking !== null &&
                  Number.isFinite(asking.heightCm) &&
                  asking.heightCm >= MIN_HEIGHT_CM &&
                  asking.heightCm <= MAX_HEIGHT_CM;
                return (
                  <li key={entry.taskId} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-xs text-[var(--fc-muted)]">
                        <span className="font-mono tabular-nums">{new Intl.DateTimeFormat(uiLocale, CREATED_AT_OPTIONS).format(new Date(entry.createdAt))}</span>
                        {entry.category || entry.mode === "detailed" ? (
                          <span className="ml-2">
                            {[
                              CATEGORY_CHOICES.find((choice) => choice.value === entry.category)?.label,
                              entry.mode === "detailed" ? "High detail" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      {/* shrink-0 + nowrap: a longer row ("Cabinet · High detail")
                          squeezed the button until "Pick up" broke over two lines. */}
                      <button
                        type="button"
                        className={`${BUTTON_QUIET} shrink-0 whitespace-nowrap`}
                        aria-expanded={asking !== null}
                        onClick={() =>
                          setPickingUp(
                            asking
                              ? null
                              : {
                                  taskId: entry.taskId,
                                  // The form's height only if it was entered for this kind of piece.
                                  heightCm:
                                    heightValid && (!entry.category || entry.category === category) ? heightCm : Number.NaN,
                                  category: entry.category ?? category,
                                }
                          )
                        }
                      >
                        {asking ? uiText("Cancel") : uiText("Pick up")}
                      </button>
                    </div>
                    {/* The height is asked here rather than read from the form
                        above: that one is for the next photo, and a picked-up
                        piece is scaled entirely from the number given. */}
                    {asking ? (
                      <form
                        className="mt-3 flex flex-wrap items-end gap-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (askHeightValid && askCategory) void resume(entry, asking.heightCm, askCategory);
                        }}
                      >
                        {!entry.category ? (
                          <label className="block text-xs" htmlFor={`pickup-type-${entry.taskId}`}>
                            <span className="font-semibold text-[var(--fc-ink-accent)]">{uiText("What is it?")}</span>
                            <select
                              id={`pickup-type-${entry.taskId}`}
                              required
                              value={asking.category ?? ""}
                              onChange={(event) =>
                                setPickingUp({ ...asking, category: event.target.value as FurnitureCategoryId })
                              }
                              className="mt-1 block min-h-10 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm font-semibold text-[var(--fc-text)]"
                            >
                              <option value="" disabled>{uiText("Choose a type")}</option>
                              {CATEGORY_CHOICES.map((choice) => (
                                <option key={choice.value} value={choice.value}>
                                  {uiText(choice.label)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <label className="block text-xs" htmlFor={`pickup-height-${entry.taskId}`}>
                          <span className="font-semibold text-[var(--fc-ink-accent)]">{uiText("Real height")}</span>
                          <span className="mt-1 flex items-center gap-2">
                            <input
                              id={`pickup-height-${entry.taskId}`}
                              type="number"
                              inputMode="numeric"
                              required
                              autoFocus
                              min={MIN_HEIGHT_CM}
                              max={MAX_HEIGHT_CM}
                              value={Number.isFinite(asking.heightCm) ? asking.heightCm : ""}
                              placeholder={askTypical ? String(askTypical) : undefined}
                              onChange={(event) => setPickingUp({ ...asking, heightCm: event.target.valueAsNumber })}
                              aria-invalid={Number.isFinite(asking.heightCm) && !askHeightValid}
                              className="w-24 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 font-mono tabular-nums text-[var(--fc-text)] placeholder:text-[var(--fc-muted)] placeholder:opacity-60"
                            />
                            <span className="text-sm text-[var(--fc-muted)]">{uiText("cm")}</span>
                          </span>
                        </label>
                        <button type="submit" className={BUTTON_PRIMARY} disabled={!askHeightValid || !askCategory}>{uiText("Continue")}</button>
                        <p className="w-full text-xs text-[var(--fc-muted)]">
                          {Number.isFinite(asking.heightCm) && !askHeightValid ? (
                            <span className="font-semibold text-fc-danger">{uiText("Between ")}{MIN_HEIGHT_CM}{uiText(" and ")}{MAX_HEIGHT_CM}{uiText(" cm.")}{" "}
                            </span>
                          ) : null}{uiText("Floor to the highest point; every measurement is worked out from this.")}</p>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            ) : (
              <div className="mt-4 rounded-3xl border border-dashed border-[var(--fc-border)] bg-[var(--fc-panel)] px-6 py-12 text-center">
                <p className="font-display text-lg font-bold">{uiText("No unfinished templates")}</p>
                <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("When you start a generation, you can return to it here if you leave before it is finished.")}</p>
                <button type="button" className={`${BUTTON_QUIET} mt-5`} onClick={() => setActiveTab("new")}>{uiText("Create a template")}</button>
              </div>
            )}
          </section>
      </div>
    </main>
  );
}
