"use client";

/**
 * Standalone test: upload a 3D model, get back real editable furniture.
 *
 * Not linked from any nav or the real furniture picker -- this is a test
 * harness for the AI-vision labeling pipeline (`scripts/architect-analysis.mts`
 * proved the labeling half; this proves the labels are good enough to drive
 * the real rig-building and render pipeline a customer actually uses).
 *
 * Everything through classification runs client-side (GLTFLoader.parse on
 * the raw file, shell splitting, grouping, and rendering a group-colored
 * preview to this page's own WebGL canvas -- no puppeteer needed, the
 * browser already has a real GPU context). Only the AI call itself goes to
 * the server, via /api/architect-analysis, because that is the only step
 * that needs a secret key. Once labeled, the uploaded file is handed to the
 * real, unmodified <FurnitureStudio> as an in-memory StudioModel -- the
 * same segmentChair/buildChairRig path every shipped model goes through.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import FurnitureStudio from "@/components/design/studio/furniture-studio";
import { MODEL_CATEGORY, type FurnitureCategoryId, type StudioModel } from "@/components/design/studio/studio-models";
import type { FurnitureFamily } from "@/components/design/studio/studio-config";
import type { OrientationResult } from "@/components/design/studio/model-leveling";
import {
  analyseModelFiles,
  keepGeneratedModel,
  labelViaApi,
  startGeneration,
  waitForModel,
  type CanonicalUpload,
} from "@/components/design/studio/generation-pipeline";
import { fetchStoredModel, listStoredModels, type StoredModel } from "@/lib/meshy/stored-model";

/**
 * Which family the upload belongs to -- it steers both the shell grouping
 * and the role vocabulary the AI is offered. Asked up front rather than
 * guessed; see `FurnitureFamily` in studio-config.ts. In the real
 * shop-owner flow the visitor will have picked a furniture type before ever
 * reaching an upload field, so nothing here is a question they would not
 * already have answered.
 */
const FAMILY_OPTIONS: Array<{ value: FurnitureFamily; label: string }> = [
  { value: "generic", label: "Chair or table" },
  { value: "bed", label: "Bed" },
];

type Stage =
  | "idle"
  | "generating"
  | "parsing"
  | "splitting"
  | "grouping"
  | "rendering"
  | "classifying"
  | "storing"
  | "ready"
  | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  generating: "Generating a 3D model from the photo (Meshy)...",
  parsing: "Parsing the file...",
  splitting: "Splitting meshes into shells...",
  grouping: "Grouping near-duplicate shells...",
  rendering: "Rendering a group-colored preview...",
  classifying: "Asking the AI to label each group...",
  storing: "Keeping a copy so this piece can be reopened...",
  ready: "Ready.",
  error: "Failed.",
};

export default function ModelLabClient() {
  const [stage, setStage] = useState<Stage>("idle");
  /**
   * The blob URL currently handed to the studio, so it can be released when a
   * new model replaces it or the page goes away.
   *
   * A generated .glb is 5-7 MB and a blob URL pins it for the lifetime of the
   * document -- nothing collects it just because the last reference went out
   * of scope. Ten generations in a sitting is 70 MB held for nothing. Kept in
   * a ref rather than state because revoking must not itself cause a render,
   * and because the cleanup below has to see the latest value without being
   * re-run every time it changes.
   */
  const modelUrlRef = useRef<string | null>(null);
  /**
   * Bumped whenever a run starts or the component unmounts. The polling loop
   * compares against it and stops if it no longer matches, which is what ends
   * a generation that the page has navigated away from -- otherwise the loop
   * keeps hitting the API and setting state on a component that is gone, for
   * up to the full six-minute timeout.
   */
  const runIdRef = useRef(0);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
    },
    []
  );
  const [error, setError] = useState<string | null>(null);
  const [cmPerUnit, setCmPerUnit] = useState(80);
  const [model, setModel] = useState<StudioModel | null>(null);
  const [fileName, setFileName] = useState("");
  const [shellCount, setShellCount] = useState<number | null>(null);
  const [groupCount, setGroupCount] = useState<number | null>(null);
  const [excludedMeshCount, setExcludedMeshCount] = useState(0);
  const [family, setFamily] = useState<FurnitureFamily>("generic");
  // High detail: a standard-mode model split into parts. What shops get when
  // they pick it; see the chain in app/api/meshy/image-to-3d/route.ts.
  const [detailed, setDetailed] = useState(false);
  const [category, setCategory] = useState<FurnitureCategoryId>("table");
  const [orientation, setOrientation] = useState<OrientationResult>({ tiltDegrees: 0, yawDegrees: 0 });
  const [meshyProgress, setMeshyProgress] = useState<number | null>(null);
  const [meshyCredits, setMeshyCredits] = useState<number | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  /** Past generations this user has paid for and kept -- see the picker below. */
  const [stored, setStored] = useState<StoredModel[]>([]);

  const refreshStored = useCallback(() => {
    void listStoredModels().then(setStored);
  }, []);
  useEffect(refreshStored, [refreshStored]);

  /**
   * True while a run is in flight.
   *
   * Both inputs are disabled on it, because picking a second file while the
   * first is generating starts a SECOND Meshy generation -- another 5 credits
   * -- and leaves two runs writing to the same state. A file input gives no
   * hint that it is already busy, so nothing stopped a double-click from
   * costing twice.
   */
  const busy = stage !== "idle" && stage !== "ready" && stage !== "error";
  // Off by default: the texture costs 10 extra credits and does nothing for
  // segmentation, which reads material names (always one on a generated
  // model) rather than pixels. See lib/meshy/client.ts.
  const [textured, setTextured] = useState(false);

  const handleFiles = useCallback(
    async (
      files: File[],
      /**
       * Runs after the pipeline but BEFORE the studio is shown, and may amend
       * the model it is shown with. Used to file a generated model and attach
       * its seed. It has to happen before the model is handed over:
       * FurnitureStudio rebuilds its whole scene whenever the model object
       * changes, so patching the model afterwards reloaded the piece under
       * the user's cursor and threw away whatever they had started doing.
       */
      prepare?: (upload: CanonicalUpload) => Promise<Partial<StudioModel>>
    ): Promise<CanonicalUpload | null> => {
      setError(null);
      setModel(null);
      setShellCount(null);
      setGroupCount(null);
      setExcludedMeshCount(0);
      setOrientation({ tiltDegrees: 0, yawDegrees: 0 });
      const primary = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
      if (primary) setFileName(primary.name);

      try {
        // The pipeline itself lives in generation-pipeline.ts, shared with the
        // shop owners' photo page; this only wires its progress into the
        // readout below.
        const { model: built, upload } = await analyseModelFiles(files, {
          cmPerUnit,
          family,
          label: labelViaApi(),
          onStage: setStage,
          onReport: (report) => {
            if (report.orientation) setOrientation(report.orientation);
            if (report.shellCount !== undefined) setShellCount(report.shellCount);
            if (report.groupCount !== undefined) setGroupCount(report.groupCount);
            if (report.excludedMeshCount !== undefined) setExcludedMeshCount(report.excludedMeshCount);
          },
        });
        // The previous model is no longer on screen, so let go of its bytes
        // before taking hold of the next set.
        if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
        modelUrlRef.current = built.url;

        let shown = built;
        if (prepare) {
          setStage("storing");
          shown = { ...built, ...(await prepare(upload)) };
        }
        setModel(shown);
        setStage("ready");
        return upload;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStage("error");
        return null;
      }
    },
    [cmPerUnit, family]
  );

  /**
   * Photo in, editable furniture out.
   *
   * Meshy turns the picture into a .glb, and from there this is the SAME
   * path an uploaded model takes -- handleFiles does the levelling, the
   * squaring, the shell split, the grouping, the AI role pass and the rig.
   * Deliberately no second copy of that pipeline: a generated model is just
   * a model, and the moment the two paths diverge they start disagreeing
   * about what the studio can do with a piece.
   */
  const handlePhoto = useCallback(
    async (photo: File) => {
      setError(null);
      setModel(null);
      setShellCount(null);
      setGroupCount(null);
      setExcludedMeshCount(0);
      setOrientation({ tiltDegrees: 0, yawDegrees: 0 });
      setFileName(photo.name);
      setMeshyProgress(0);
      setMeshyCredits(null);
      setPhotoNote(null);
      setStorageNote(null);
      setStage("generating");

      // Claims this run. Anything started earlier -- or this one, once the
      // page goes away -- stops at the next check.
      runIdRef.current += 1;
      const runId = runIdRef.current;
      const stale = () => runIdRef.current !== runId;

      try {
        const { taskId, sent } = await startGeneration(photo, {
          textured,
          mode: detailed ? "detailed" : "quick",
          category,
        });
        setPhotoNote(
          `Sent ${sent.width}x${sent.height}, ` +
            `${(sent.encodedBytes / 1024 / 1024).toFixed(2)} MB ` +
            `(from ${(sent.originalBytes / 1024 / 1024).toFixed(2)} MB)`
        );

        const glb = await waitForModel(taskId, {
          isCancelled: stale,
          onProgress: (progress, credits) => {
            setMeshyProgress(progress);
            if (credits !== null) setMeshyCredits(credits);
          },
          onNote: (note) => setPhotoNote((current) => `${current ?? ""} -- ${note}`),
        });
        if (!glb || stale()) return;
        setMeshyProgress(null);

        // Already filed: the server stored the raw download before handing it
        // over (see waitForModel), so closing the page from here on loses
        // nothing that was paid for.
        setStorageNote("kept");
        refreshStored();
        // Named after the photo so everything downstream -- the project name,
        // the blueprint's title block -- reads as the piece rather than as a
        // task id.
        const base = photo.name.replace(/\.[^.]+$/, "") || "generated";
        // Filed twice, deliberately: once the parts are named, the canonical
        // scene replaces the raw download at the same path, so what is stored
        // is what was actually labelled. Done through `prepare`, before the
        // studio mounts, so the seed rides in on the first model the studio
        // sees -- see handleFiles.
        const fileCanonical = async (upload: CanonicalUpload): Promise<Partial<StudioModel>> => {
          const kept = await keepGeneratedModel(taskId, upload);
          if ("error" in kept) {
            // The raw download is still stored and still replays through the
            // lab, but it is not the scene these labels describe -- so no seed
            // is attached and the piece stays unsaveable.
            setStorageNote(`kept, unlevelled (${kept.error})`);
            return {};
          }
          setStorageNote("kept");
          return kept.patch;
        };
        await handleFiles([new File([glb], `${base}.glb`, { type: "model/gltf-binary" })], fileCanonical);
      } catch (err) {
        if (stale()) return;
        setMeshyProgress(null);
        setError(err instanceof Error ? err.message : String(err));
        setStage("error");
      }
    },
    [handleFiles, textured, detailed, category, refreshStored]
  );

  /**
   * Re-runs a generation that was already paid for.
   *
   * The pipeline between a .glb and an editable piece has changed repeatedly;
   * running a stored model through the current one costs nothing, where
   * generating the same photograph again costs credits.
   */
  const handleStored = useCallback(
    async (path: string) => {
      setError(null);
      setStorageNote(null);
      setPhotoNote(null);
      setStage("parsing");
      const file = await fetchStoredModel(path);
      if (!file) {
        setError("That stored model could not be fetched.");
        setStage("error");
        return;
      }
      await handleFiles([file]);
    },
    [handleFiles]
  );

  if (model) {
    return <FurnitureStudio model={model} onBack={() => setModel(null)} />;
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px", fontFamily: "var(--font-sans, system-ui)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Model Lab</h1>
      <p style={{ opacity: 0.75, marginBottom: 24 }}>
        Standalone test: give it a PHOTO of a piece and Meshy generates the model, or upload a clean,
        game-ready .glb/.gltf you already have -- a chair, a table or a bed. Either way it runs through
        levelling, shell splitting, grouping, an AI vision pass (via /api/architect-analysis), and the real
        production rig pipeline. Not part of the shop-owner-upload feature -- a test harness, not linked
        anywhere.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Real-world height (cm)
          <input
            type="number"
            min={1}
            value={cmPerUnit}
            onChange={(event) => setCmPerUnit(Number(event.target.value) || 80)}
            style={{ padding: 8, border: "1px solid currentColor", borderRadius: 6, maxWidth: 160 }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          What is it?
          <select
            value={family}
            onChange={(event) => setFamily(event.target.value as FurnitureFamily)}
            style={{ padding: 8, border: "1px solid currentColor", borderRadius: 6, maxWidth: 240 }}
          >
            {FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Picks the part vocabulary the AI is offered -- a bed gets headboard/rails/mattress/slats, everything
            else gets the chair and table roles.
          </span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Photograph of a piece (Meshy generates the model)
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(event) => {
              const photo = event.target.files?.[0];
              if (photo) void handlePhoto(photo);
              // Cleared so picking the SAME file again after this run still
              // fires a change event; a file input is silent when re-given
              // the value it already holds.
              event.target.value = "";
            }}
          />
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            One clear photo, the whole piece in frame, plain background. Generation takes a minute or two, then
            runs through exactly the same pipeline as an uploaded model.
          </span>
        </label>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <input type="checkbox" checked={detailed} onChange={(event) => setDetailed(event.target.checked)} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            High detail -- a standard-mode model split into parts, the way shops get it. About five minutes.
          </span>
        </label>

        {detailed && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Kind of piece (tells the split which parts to look for)
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as FurnitureCategoryId)}
              style={{ padding: 8, border: "1px solid currentColor", borderRadius: 6, maxWidth: 240 }}
            >
              {[...new Set([...Object.values(MODEL_CATEGORY), "sofa", "bookshelf"])].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <input type="checkbox" checked={textured} onChange={(event) => setTextured(event.target.checked)} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            Generate textures — <strong>{detailed ? (textured ? 40 : 30) : textured ? 15 : 5} credits</strong> this
            run ({detailed ? "30 without, 40 with" : "5 without, 15 with"}).
            Textures change nothing about how the piece is split into parts or measured; they only affect what
            the &ldquo;Original&rdquo; finish looks like before you pick a real one.
          </span>
        </label>

        {stored.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            ...or re-run one you already paid for
            <select
              defaultValue=""
              disabled={busy}
              onChange={(event) => {
                const path = event.target.value;
                event.target.value = "";
                if (path) void handleStored(path);
              }}
              style={{ padding: 8, border: "1px solid currentColor", borderRadius: 6, maxWidth: 420 }}
            >
              <option value="">Pick a stored generation…</option>
              {stored.map((entry) => (
                <option key={entry.path} value={entry.path}>
                  {(entry.createdAt || "").slice(0, 16).replace("T", " ")} · {(entry.bytes / 1048576).toFixed(1)} MB ·{" "}
                  {entry.taskId.slice(0, 8)}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              Runs the current pipeline over a model Meshy already produced. Costs no credits — the generation was
              paid for once and kept.
            </span>
          </label>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          ...or a model you already have
          <input
            type="file"
            accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2"
            multiple
            disabled={busy}
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length > 0) void handleFiles(Array.from(files));
              event.target.value = "";
            }}
          />
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Select just the .glb, or select every file in the model&rsquo;s folder (.gltf + .bin + textures) together.
          </span>
        </label>
      </div>

      {busy && (
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          Working — both pickers are disabled until this finishes, so a second click cannot start another
          generation.
        </p>
      )}
      {stage !== "idle" && (
        <p>
          <strong>{STAGE_LABEL[stage]}</strong>
          {meshyProgress !== null ? ` ${meshyProgress}%` : ""}
          {meshyCredits !== null ? ` -- ${meshyCredits} credits` : ""}
          {photoNote ? ` -- ${photoNote}` : ""}
          {storageNote ? ` -- ${storageNote}` : ""}
          {fileName ? ` (${fileName})` : ""}
          {shellCount !== null ? ` -- ${shellCount} shells` : ""}
          {groupCount !== null ? `, ${groupCount} groups` : ""}
          {excludedMeshCount > 0
            ? ` (excluded ${excludedMeshCount} mesh${excludedMeshCount === 1 ? "" : "es"} that looked like backdrop/staging geometry)`
            : ""}
          {orientation.tiltDegrees > 0 ? ` -- stood level, it was modelled ${orientation.tiltDegrees.toFixed(1)}° off` : ""}
          {orientation.yawDegrees > 0 ? ` -- squared to its own axes, it was turned ${orientation.yawDegrees.toFixed(1)}°` : ""}
        </p>
      )}
      {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
    </div>
  );
}
