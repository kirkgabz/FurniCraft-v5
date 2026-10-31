import type { PartDef, PartId, PartRole } from "./studio-config";
import type { VarnishId } from "./materials-db";
import { creditFor } from "./model-credits";
import {
  classifyBookshelfShell,
  classifySofaShell,
  classifySofaBedShell,
  classifyCabinetShell,
  classifyCushionShell,
  classifyRattanShell,
  classifyPatioShell,
  classifyStoolShell,
  classifyVictorianShell,
  classifyTableShell,
  classifySideTableShell,
  classifyDeskShell,
  classifyBedShell,
  classifyRockerShell,
  bookshelfSurface,
  sofaSurface,
  sofaBedSurface,
  cabinetSurface,
  cushionSurface,
  rattanSurface,
  patioSurface,
  stoolSurface,
  victorianSurface,
  tableSurface,
  sideTableSurface,
  deskSurface,
  bedSurface,
  rockerSurface,
  type ShellClassifier,
  type SurfaceResolver,
} from "./chair-segmentation";

/**
 * The models the studio can open.
 *
 * Everything that differs between one piece of furniture and another lives in a
 * `StudioModel`: where the asset is, how its shells are recognised, which parts
 * the customer sees, and what one unit means in centimetres. The studio itself,
 * the rig, the ruler, the blueprint and the order pipeline are all written
 * against this shape, so adding a third model means adding an entry here and a
 * classifier — not touching the studio.
 */

export type StudioModelId =
  | "victorian-chair"
  | "cushion-chair"
  | "rattan-chair"
  | "patio-armchair"
  | "rattan-stool"
  | "sofa"
  | "sofa-bed"
  | "cabinet"
  | "table"
  | "side-table"
  | "desk"
  | "bed"
  | "bookshelf"
  | "rocking-chair";

/** The kinds of furniture a customer chooses between, before choosing a piece. */
export type FurnitureCategoryId = "chair" | "table" | "sofa" | "cabinet" | "bed" | "bookshelf" | "desk" | "stool";

/**
 * Which kind each studio model is. Keyed on every model id, so a model added to
 * the studio without a kind is a type error here rather than a piece that
 * silently never appears in the picker. The measurements read it too, to name
 * a piece's headline height in its own terms (a desk's, not a table's).
 */
export const MODEL_CATEGORY: Record<StudioModelId, FurnitureCategoryId> = {
  "victorian-chair": "chair",
  "cushion-chair": "chair",
  "rattan-chair": "chair",
  "patio-armchair": "chair",
  "rocking-chair": "chair",
  "rattan-stool": "stool",
  sofa: "sofa",
  "sofa-bed": "sofa",
  bookshelf: "bookshelf",
  cabinet: "cabinet",
  table: "table",
  "side-table": "table",
  desk: "desk",
  bed: "bed",
};

export type StudioModel = {
  /**
   * Usually one of the 5 built-in ids below, but not required to be: the
   * `/dev/model-lab` test harness constructs a `StudioModel` at runtime for
   * an uploaded file with an id that was never in `StudioModelId`. Every
   * consumer of this field already treats it as an opaque string (see
   * `StudioBlock.modelId` in studio-design-state.ts), so this stays `string`
   * rather than the narrower union.
   */
  id: string;
  /**
   * True for a model that exists only for this browser session -- one the
   * model lab built from an upload or a generated file, whose `url` is a blob
   * URL that dies on reload.
   *
   * It exists because a design records only its model's ID, and reopening one
   * resolves that ID against the five shipped models. An ephemeral id matches
   * none of them, and `studioModel` answers an unknown id with the DEFAULT
   * model -- so a bed designed from a photograph came back, silently and
   * without error, as a Victorian chair carrying the bed's colours and
   * dimensions. A shop would have built the wrong piece of furniture.
   *
   * So an ephemeral model cannot be saved or ordered; the studio hides both
   * actions and says why. A generated model stops being ephemeral the moment
   * it has a `source` -- a stored file plus the labels that go with it --
   * because from then on a saved design can be rebuilt rather than
   * substituted (see generated-model.ts). An upload that was never stored
   * stays ephemeral for good.
   */
  ephemeral?: boolean;
  /** Shown in the studio header and stored on orders and templates. */
  name: string;
  /** Default project name for a fresh design. */
  defaultProjectName: string;
  url: string;
  /**
   * How tall the real piece is, in centimetres. The rig normalizes every model
   * to exactly 1.0 unit tall, so this single number converts the whole design
   * — ruler, blueprint, order dimensions, price — into real units.
   */
  cmPerUnit: number;
  classify: ShellClassifier;
  resolveSurface: SurfaceResolver;
  parts: PartDef[];
  /**
   * How densely this asset's UVs already tile, relative to the others.
   *
   * A material says how many times its texture should repeat across a part,
   * but that only means something against a known UV layout. These models were
   * unwrapped by different people for different purposes: the patio chair's
   * UVs already tile its weave at roughly furniture scale, so a material asking
   * for four repeats would get sixteen. This scales every material's repeat for
   * the model it lands on. 1 is the layout the Victorian and cushion chairs
   * share; measure a new model rather than assuming.
   */
  uvScale?: number;
  /**
   * Which UVs a finish's scanned maps tile through -- the asset's own unwrap
   * (the default), or a set the rig projects over each part. Generated models
   * take "projected": their files carry either no UVs or a baking atlas,
   * neither of which a grain can follow. See FinishUv in chair-rig.ts.
   */
  finishUv?: "model" | "projected";
  /**
  * What each part is finished in when the piece is first opened, by material
  * id.
  *
  * Absent for the photoscanned models, and that absence is right: their GLTFs
  * ship their own baked colour and grain, so "Original" already looks like the
  * timber somebody photographed. A generated asset has no such photograph --
  * it carries a flat baseColorFactor and nothing else -- so opened with no
  * finish chosen it reads as tinted cardboard beside the scanned pieces. This
  * is the stock those pieces are drawn in until the customer says otherwise.
  *
  * Seeded into the studio's own state on mount rather than applied to the
  * asset, so it behaves exactly like a finish the customer picked: it is
  * written onto the order, it can be changed part by part, and Reset returns
  * to it rather than to nothing.
  */
  defaultFinishes?: Partial<Record<PartId, string>>;
  /**
   * The seal every part opens under, where the piece ships sealed.
   *
   * One value rather than a per-part map because that is how a furniture shop
   * actually finishes a piece: the whole thing goes under the same coat. Absent
   * means raw, which is the right default for the photoscanned models -- their
   * scans already carry whatever sheen they were photographed with, and laying
   * a clearcoat over that would double it.
   */
  defaultVarnish?: VarnishId;
  /** Shown in the studio's piece rail. */
  icon: string;
  /**
   * Attribution required by the asset's licence.
   *
   * Optional, and the absence means one thing only: this asset is the
   * project's own and there is nobody to credit. Every model sourced from
   * somewhere else MUST carry one -- attribution is a shipping condition for
   * the CC-BY-4.0 and free-model assets here (see PRODUCT.md), so leaving this
   * off a third-party model is a licence breach, not a tidier panel.
   *
   * Filled from model-credits.ts rather than written out here, and no longer
   * printed in the studio's side panel: the credits are shown together in the
   * site footer instead. The field stays because it is the model's own record
   * of where it came from, and because a credit attached to the thing it
   * credits is harder to lose than a list somewhere else.
   */
  credit?: string;
  /**
   * For a generated piece, how to rebuild this model in a later session.
   *
   * Absent on the five shipped models -- their id resolves them. Present means
   * the model was reconstructed from, or is storable as, a `GeneratedSource`,
   * and `buildStudioDesignItem` copies it into the saved design so reopening
   * has something to work from.
   */
  source?: GeneratedSource;
};

/**
 * Everything needed to rebuild a `StudioModel` for a piece that was generated
 * from a photograph rather than shipped with the app.
 *
 * A StudioModel cannot be stored directly -- it holds `classify` and
 * `resolveSurface` as functions. Neither is a real closure, though:
 * `resolveSurface` is always `genericResolveSurface`, a module function with
 * nothing to capture, and `classify` is `buildAiClassifier(shellRoles)`, which
 * ignores the shell it is handed and keys purely on its INDEX. So the whole
 * classifier reduces to one array, and `parts` is derivable from that same
 * array once the file is re-split. What has to be kept is small.
 *
 * THE INVARIANT: `shellRoles[i]` describes the i-th shell that
 * `splitMeshesIntoShells` produces. Reopening re-splits the file and reuses
 * these labels positionally, so a re-split that yields a different order or a
 * different count makes every label wrong -- and wrong quietly, as a chair
 * whose arms are labelled legs, not as an error. Two things protect it:
 *
 *   - The stored file must be byte-identical to the one that was classified,
 *     which is why `storagePath` points at the model the studio actually
 *     loaded and not at the raw download it came from.
 *   - `v` and `shellCount` catch the rest. Bump `v` whenever a change to
 *     chair-segmentation could renumber shells; `shellCount` is the cheap
 *     tripwire that turns a drifted re-split into a visible failure instead
 *     of a silently mislabelled piece.
 *
 * A useful side effect of freezing the labels: the AI pass has been observed
 * scoring 100%, 31% and 89% across identical inputs. Classifying once, at
 * publish time and under the shop owner's eye, means a customer replays a
 * result someone approved rather than rolling for a fresh one.
 */
export type GeneratedSource = {
  /** Pipeline version. Bump when a re-split could number shells differently. */
  v: 1;
  /** Object path inside the `generated-models` bucket. */
  storagePath: string;
  /** One role per shell, in shell order. The only irreducible AI output. */
  shellRoles: PartRole[];
  /** What the re-split must produce for `shellRoles` to still line up. */
  shellCount: number;
  cmPerUnit: number;
  name: string;
};

/** The pipeline version this build of the app writes and can read back. */
export const GENERATED_SOURCE_VERSION = 1;

// --------------------------------------------------------------- Victorian
const VICTORIAN_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four turned legs. Raising them lifts the seat and back with them.",
    surface: "wood",
    controls: [
      { key: "legHeight", label: "Seat height", hint: "Stretches the legs and lifts everything above", min: 0.7, max: 1.4, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each leg in place", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "seatFrame",
    role: "seatFrame",
    label: "Seat frame",
    blurb: "The four rails that box in the seat and tie the legs together.",
    surface: "wood",
    controls: [
      { key: "seatWidth", label: "Width", hint: "Widens the chair and spreads the legs", min: 0.8, max: 1.3, step: 0.01 },
      { key: "seatDepth", label: "Depth", hint: "Deepens the seat and moves the back rearward", min: 0.8, max: 1.3, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Seat cushion",
    blurb: "Upholstered seat pad. Follows the seat frame's width and depth.",
    surface: "cloth",
    controls: [
      { key: "seatCushionThickness", label: "Thickness", hint: "Plumps the pad upward from its base", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Backrest frame",
    blurb: "The carved wooden crown and stiles behind the back cushion.",
    surface: "wood",
    controls: [
      { key: "backHeight", label: "Back height", hint: "Grows the backrest upward from the seat", min: 0.7, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Back cushion",
    blurb: "Upholstered back panel. Follows the backrest frame.",
    surface: "cloth",
    controls: [
      { key: "backCushionThickness", label: "Thickness", hint: "Pads the panel forward from the frame", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "ornaments",
    role: "accessory",
    label: "Leg ornaments",
    blurb: "Carved detailing applied to the front legs. Set to zero to strip them off.",
    surface: "wood",
    controls: [
      { key: "ornamentScale", label: "Ornament size", hint: "Zero removes the carvings entirely", min: 0, max: 1.6, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------ cushion chair
/**
 * The cushion chair splits into four pieces, verified by driving each control
 * and watching what actually moves: a timber frame (legs, arm supports and
 * back, all one connected shell), a seat pad, a back pad, and the two
 * upholstered pads sitting on top of the arms.
 *
 * The arm control removes those pads only — the wooden arm supports belong to
 * the frame, so this never becomes an armless chair, and the label says pads
 * rather than arms for that reason. There is no ornament or leg-thickness
 * control because the model carries nothing they would act on.
 */
const CUSHION_PARTS: PartDef[] = [
  {
    id: "frame",
    role: "base",
    label: "Frame",
    blurb: "The timber frame: legs, arm supports and back. Raising it lifts the pads with it.",
    surface: "wood",
    controls: [
      { key: "legHeight", label: "Seat height", hint: "Stretches the frame upward from the floor", min: 0.75, max: 1.35, step: 0.01 },
      { key: "seatWidth", label: "Width", hint: "Widens the chair and spreads the arms", min: 0.85, max: 1.25, step: 0.01 },
      { key: "seatDepth", label: "Depth", hint: "Deepens the chair front to back", min: 0.85, max: 1.25, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Seat cushion",
    blurb: "The pad you sit on. Plumps upward from where it rests in the frame.",
    surface: "cloth",
    controls: [
      { key: "seatCushionThickness", label: "Thickness", hint: "Plumps the pad upward from its base", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Back cushion",
    blurb: "The upholstered back pad. Grows upward and pads forward off the frame.",
    surface: "cloth",
    controls: [
      { key: "backHeight", label: "Back height", hint: "Grows the back upward from the seat", min: 0.75, max: 1.35, step: 0.01 },
      { key: "backCushionThickness", label: "Thickness", hint: "Pads the back forward", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "armrests",
    role: "armrest",
    label: "Arm pads",
    blurb: "The upholstered pads on top of the arms. They spread as the chair widens.",
    surface: "cloth",
    controls: [
      { key: "armScale", label: "Pad size", hint: "Zero leaves the bare timber arms", min: 0, max: 1.5, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------ rattan chair
/**
 * A caned armchair, which is structurally unlike the other two: it has no
 * upholstery at all. The woven seat and back are cane, not fabric, so they take
 * the same wood finishes as the frame and are listed as surfaces of their own
 * rather than as cushions -- the part ids underneath are still seatCushion and
 * backCushion, because those are what the rig understands by "the panel that
 * rides the seat" and "the panel that rides the back".
 *
 * The arms are one continuous bent piece with the back hoop in this design, so
 * there is no separate armrest part to expose; widening the seat carries them
 * with the back frame, which is how the real chair behaves.
 *
 * Two of the rig's parameters are deliberately not offered here, and the reason
 * is the same for both: on this chair the legs run the full height and the arms
 * are socketed onto them, so the base and the back frame are one structure.
 *
 *   backHeight  lifts the back frame off a base that does not follow. Even at
 *               1.08 all four leg-to-arm joints open a visible gap.
 *   seatDepth   moves the legs apart front to back, but the rig only ever
 *               scales the back frame across its width, never its depth -- so
 *               the hoop stays put and every joint separates at once.
 *
 * Both were measured, not assumed. Width and height work because the rig scales
 * the back frame in X and lifts everything above the legs together.
 */
const RATTAN_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four splayed legs, running the full height to carry the arms.",
    surface: "wood",
    controls: [
      { key: "legHeight", label: "Seat height", hint: "Stretches the legs and lifts everything above", min: 0.75, max: 1.35, step: 0.01 },
      // Capped at 1.15: the legs pass through sockets in the arms, and past
      // about 1.2 they burst out of them and leave a visible gap.
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each leg in place", min: 0.85, max: 1.15, step: 0.01 },
    ],
  },
  {
    id: "seatFrame",
    role: "seatFrame",
    label: "Seat rails",
    blurb: "The rails the seat is woven onto, and the stretcher tying the legs together.",
    surface: "wood",
    controls: [
      { key: "seatWidth", label: "Width", hint: "Widens the chair and spreads the legs", min: 0.85, max: 1.25, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Woven seat",
    blurb: "The caned seat panel. Its weave is modelled strand by strand, so it takes a colour and a sheen rather than a woven texture.",
    surface: "cane",
    stock: "Cane",
    controls: [
      { key: "seatCushionThickness", label: "Weave depth", hint: "Deepens the cane where it dishes under you", min: 0.7, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Back and arms",
    blurb: "One bent hoop forming the back and both arms. Shaped with the legs it grows from, so it takes a finish rather than a size.",
    surface: "wood",
    controls: [],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Woven back",
    blurb: "The caned back panel, set into the hoop. Modelled strand by strand, like the seat.",
    surface: "cane",
    stock: "Cane",
    controls: [
      { key: "backCushionThickness", label: "Weave depth", hint: "Bows the cane forward off the frame", min: 0.7, max: 1.4, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------- patio armchair
/**
 * The outdoor chair, and the simplest part list here: a single woven box that
 * stands on the floor and carries two loose cushions. There are no legs to
 * lengthen and no arms to resize -- the arms are panels of the box.
 *
 * The cushions carry no UVs in the shipped asset, so they take a tint but can
 * never take a texture map. That costs nothing today, because every fabric in
 * the catalogue is already tint-only; it matters the day a scanned fabric set
 * arrives, and it is the reason not to promise otherwise in a blurb.
 *
 * Width and depth are deliberately not offered. The woven box splits into three
 * shells -- the body and its two arm panels -- and the rig gives every shell of
 * a base its own slot so that four legs can spread. That is right for legs and
 * wrong for a box: at seatWidth 1.25 both arms float clear of the body, and at
 * seatDepth 1.25 the seat cushion stretches out through the right arm. Height
 * is safe because it scales all three shells together from the floor.
 */
const PATIO_PARTS: PartDef[] = [
  {
    id: "frame",
    role: "base",
    label: "Woven shell",
    blurb: "The rattan body: sides, arms and back in one woven box. Carries both cushions.",
    surface: "rattan",
    stock: "Rattan",
    controls: [
      { key: "legHeight", label: "Shell height", hint: "Grows the whole box upward from the floor", min: 0.85, max: 1.2, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Seat cushion",
    blurb: "The loose seat pad. Plumps upward from where it rests in the shell.",
    surface: "cloth",
    controls: [
      { key: "seatCushionThickness", label: "Thickness", hint: "Plumps the pad upward from its base", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Back cushion",
    blurb: "The loose back pad, resting against the woven back.",
    surface: "cloth",
    controls: [
      { key: "backHeight", label: "Back height", hint: "Grows the pad upward against the shell", min: 0.85, max: 1.15, step: 0.01 },
      { key: "backCushionThickness", label: "Thickness", hint: "Pads the back forward", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
];

// --------------------------------------------------------- rattan stool
/**
 * The simplest piece in the studio: a caned drum and the pad on top of it.
 * No back, no arms, no legs that move independently -- so the only dimensions
 * worth offering are how tall the drum stands and how deep the pad sits.
 */
const STOOL_PARTS: PartDef[] = [
  {
    id: "frame",
    role: "base",
    label: "Caned drum",
    blurb: "The bent rattan body, woven and bound. Carries the pad on top.",
    surface: "cane",
    stock: "Rattan",
    controls: [
      { key: "legHeight", label: "Height", hint: "Stretches the drum upward from the floor", min: 0.8, max: 1.3, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Seat pad",
    blurb: "The buttoned pad on top. Plumps upward from where it rests on the rim.",
    surface: "cloth",
    controls: [
      { key: "seatCushionThickness", label: "Thickness", hint: "Plumps the pad upward from its base", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
];

/**
 * The first casegood in the studio, and the first piece whose controls are not
 * about how someone sits in it.
 *
 * `seatWidth` and `seatDepth` appear here under plain names -- the rig reads
 * them as "how wide and deep is the whole piece", which a carcass rides exactly
 * as a tabletop does, and inventing cabinet-only synonyms would have meant a
 * second code path in the rig for identical behaviour. The customer never sees
 * the key, only the label.
 */
const CABINET_PARTS: PartDef[] = [
  {
    id: "plinth",
    role: "base",
    label: "Plinth",
    blurb: "The recessed base the cabinet stands on. Raising it lifts the whole carcass.",
    surface: "wood",
    controls: [
      { key: "legHeight", label: "Plinth height", hint: "Lifts the cabinet off the floor", min: 0.5, max: 2, step: 0.01 },
      { key: "legThickness", label: "Plinth footprint", hint: "Sets how far the base is recessed under the carcass", min: 0.8, max: 1.2, step: 0.01 },
    ],
  },
  {
    id: "carcass",
    role: "carcass",
    label: "Carcass",
    blurb: "The box itself -- sides, deck, top and back. Everything else is fitted to it.",
    surface: "wood",
    controls: [
      { key: "seatWidth", label: "Width", hint: "Widens the whole cabinet and everything fitted to it", min: 0.7, max: 1.4, step: 0.01 },
      { key: "seatDepth", label: "Depth", hint: "Deepens the carcass front to back", min: 0.8, max: 1.3, step: 0.01 },
      { key: "cabinetHeight", label: "Height", hint: "Grows the box upward from the plinth", min: 0.6, max: 1.5, step: 0.01 },
    ],
  },
  {
    id: "doors",
    role: "door",
    label: "Doors",
    blurb: "The upper doors. They stretch with the carcass they close against, and the pair share the opening between them.",
    surface: "wood",
    controls: [
      {
        key: "doorCount",
        label: "Doors",
        hint: "Two leaves, one wide leaf, or none at all for open shelving",
        // 0 to 2 is what a single opening can be: a pair, one leaf, or none.
        // Three would put a 28cm strip on a standard carcass, which is a
        // shutter rather than a door -- and the range narrows further as the
        // piece widens, since a lone leaf stops being buildable long before
        // a pair does. See resolveCountControl.
        min: 0,
        max: 2,
        step: 1,
      },
    ],
  },
  {
    id: "drawers",
    role: "drawer",
    label: "Drawer fronts",
    blurb: "The two drawer faces below the doors. Quoted per drawer, not per metre.",
    surface: "wood",
    controls: [],
  },
  {
    id: "shelves",
    role: "shelf",
    label: "Shelves",
    blurb: "Interior shelves behind the doors. They divide the bay evenly, so adding one moves the rest.",
    surface: "wood",
    controls: [
      {
        key: "shelfCount",
        label: "Shelves",
        hint: "Spaced evenly up the bay. Four is the most that leaves a usable gap",
        min: 0,
        max: 4,
        step: 1,
      },
      { key: "shelfThickness", label: "Shelf thickness", hint: "Zero removes the shelves entirely", min: 0, max: 2.5, step: 0.01 },
    ],
  },
  {
    id: "handles",
    role: "hardware",
    label: "Handles",
    blurb: "Brass pulls on the doors and drawers. Set to zero for a push-catch cabinet with no visible hardware.",
    surface: "metal",
    stock: "Solid brass",
    controls: [
      { key: "handleScale", label: "Handle size", hint: "Zero removes the pulls entirely", min: 0, max: 1.8, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------------- table
/**
 * A dining table, and the first piece here built around a top rather than a
 * seat.
 *
 * It exists as much to use the rig as to be a table. `tabletop`, `apron`,
 * `tabletopBorder` and `stretcher` have been wired into chair-rig.ts since it
 * was written, each with its own parenting and scaling rules, and until now no
 * model exercised any of them. This piece uses all four.
 *
 * The form is a narra frame with a woven panel set into the middle of the top,
 * held by a hardwood rim -- which is what `tabletopBorder` was documented for,
 * "a frame or rim in the SAME plane as the top, bordering a materially distinct
 * inset", and is also the product's own language: a caned panel in a hardwood
 * frame is the thesis this whole redesign is built on.
 *
 * Two things about it are worth knowing before changing anything:
 *
 *   seatWidth / seatDepth  mean the whole piece here, not a seat. The rig has
 *                          always used those two keys for "how wide and deep is
 *                          this piece", which is why a cabinet uses them too;
 *                          only the labels differ.
 *   no separate apron      on purpose. The rig gives a model one part in its
 *                          frame slot and `apron` and `tabletopBorder` share
 *                          it, so declaring both silently drops one. The rim
 *                          hangs deep instead and does both jobs -- see
 *                          scripts/make-table.mts.
 *   legs                   are four separate shells, unlike the rattan
 *                          armchair's single welded frame, so the design
 *                          analysis can check them as four columns. That is a
 *                          property of the generated asset -- see the shell
 *                          separation notes in scripts/make-table.mts.
 */
const TABLE_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four square legs, set in from the corners. Raising them raises the whole table.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      // 75cm is standard dining height; the range spans a low coffee table at
      // 0.55 to a counter-height table at 1.25.
      { key: "legHeight", label: "Table height", hint: "Lifts the top, apron and all", min: 0.55, max: 1.25, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each leg in place", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "stretchers",
    role: "stretcher",
    label: "Stretchers",
    blurb: "The low braces between the legs. Zero removes them for a clear floor.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "stretcherThickness", label: "Stretcher thickness", hint: "Zero takes the braces out entirely", min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    id: "tabletopBorder",
    role: "tabletopBorder",
    label: "Top",
    blurb: "The hardwood top, framing the inset panel. It hangs deep enough to brace the legs, so it is the apron as well as the edge -- and its four edges can each be extended with a hinged leaf.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "seatWidth", label: "Table width", hint: "Widens the whole table and everything on it", min: 0.6, max: 1.6, step: 0.01 },
      { key: "seatDepth", label: "Table depth", hint: "Deepens the table front to back", min: 0.7, max: 1.4, step: 0.01 },
      // This key scales whatever part fills the rig's frame slot, which on
      // this piece is the top itself -- so it really is a top-depth control.
      { key: "apronThickness", label: "Top depth", hint: "How thick the top is, and how far it hangs below", min: 0.5, max: 1.8, step: 0.01 },
    ],
  },
  {
    // Built and measured, but not a row in the parts list: the leaves are the
    // top's own edges unfolded, so they are controlled from the top's panel
    // ("Extend the top") and wear whatever finish the top is wearing.
    id: "leaves",
    role: "leaf",
    hidden: true,
    label: "Drop leaves",
    blurb: "Boards hinged along the edges of the top, extending it when raised.",
    surface: "wood",
    stock: "Solid hardwood",
    // None of its own. The four edge buttons and the width slider live on the
    // top, where a customer asking for a longer table actually looks.
    controls: [],
  },
  {
    id: "tabletop",
    role: "tabletop",
    label: "Inset panel",
    blurb: "The panel set into the middle of the top. Woven as drawn; a glass or stone slab drops into the same opening.",
    surface: "rattan",
    stock: "Woven rattan panel",
    // Breaks its role's rule in both directions, which is why it is declared
    // rather than inferred. A weave is not in ROLE_SURFACES.tabletop, because
    // most tops are slabs; and the weave surfaces alone would drop the glass
    // and stone this top is equally built to hold.
    accepts: ["rattan", "cane", "glass", "stone", "wood"],
    controls: [
      { key: "seatCushionThickness", label: "Panel thickness", hint: "Thickens the inset panel in its opening", min: 0.4, max: 2, step: 0.01 },
    ],
  },
];

/**
 * The rattan side table. The same roles as the dining table, mapped onto a
 * piece with a lower shelf and no leaves.
 *
 * Its stretchers are two rings -- one under the top, one framing the shelf --
 * plus the shelf's woven panel, all in one part because the rig gives a role
 * one pivot. That is also why they carry no thickness control: scaling the
 * pivot would squeeze the two rings toward each other. And it is why the
 * height range is narrow, so both rings stay on the legs as they stretch.
 */
const SIDE_TABLE_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four rattan poles, bound at the joints. Raising them raises the top and both braces.",
    surface: "cane",
    stock: "Rattan pole",
    controls: [
      { key: "legHeight", label: "Table height", hint: "Lifts the top, braces and shelf", min: 0.85, max: 1.15, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each pole in place", min: 0.8, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "stretchers",
    role: "stretcher",
    label: "Braces and shelf",
    blurb: "The ring of braces under the top and the woven shelf near the floor. They spread with the top as it is resized.",
    surface: "cane",
    stock: "Rattan pole",
    controls: [],
  },
  {
    id: "tabletopBorder",
    role: "tabletopBorder",
    label: "Top frame",
    blurb: "The bound rattan frame around the top panel.",
    surface: "cane",
    stock: "Rattan pole",
    controls: [
      { key: "seatWidth", label: "Table width", hint: "Widens the top, braces and shelf", min: 0.8, max: 1.4, step: 0.01 },
      { key: "seatDepth", label: "Table depth", hint: "Deepens the table front to back", min: 0.8, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "tabletop",
    role: "tabletop",
    label: "Top panel",
    blurb: "The panel set into the frame. Woven as drawn; glass, stone or timber drops into the same opening.",
    surface: "rattan",
    stock: "Woven rattan panel",
    // Declared for the same reason as the dining table's inset: a weave is not
    // a tabletop surface by default, and glass or stone suit this opening too.
    accepts: ["rattan", "cane", "glass", "stone", "wood"],
    controls: [
      { key: "seatCushionThickness", label: "Panel thickness", hint: "Thickens the panel in its frame", min: 0.5, max: 2, step: 0.01 },
    ],
  },
];

// -------------------------------------------------------------- bookshelf
/**
 * An open bookcase: a case, a toe kick, and however many shelves are wanted.
 *
 * Three parts, which is the whole point of the piece. There are no doors, no
 * drawers and no pulls, so everything a customer can say about it is about
 * proportion and about how the inside is divided -- which is exactly what the
 * shelf count is for.
 */
const BOOKSHELF_PARTS: PartDef[] = [
  {
    id: "carcass",
    role: "carcass",
    label: "Case",
    blurb: "The sides, top, bottom and back, housed together as one box. Everything else sits inside it.",
    surface: "wood",
    stock: "Solid hardwood",
    // A case is not only ever timber. A woven back or panelled end is an
    // ordinary Philippine build, and a painted carcass is how most shop-made
    // shelving is finished -- so the list is wider than the stock it ships in.
    accepts: ["wood", "rattan", "cane", "plastic", "cloth", "metal"],
    controls: [
      { key: "seatWidth", label: "Case width", hint: "Widens the whole case and every shelf in it", min: 0.6, max: 1.5, step: 0.01 },
      { key: "cabinetHeight", label: "Case height", hint: "Grows the case upward, spacing the shelves as it goes", min: 0.55, max: 1.35, step: 0.01 },
      { key: "seatDepth", label: "Case depth", hint: "Front to back. A hardback needs about 24cm", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "shelves",
    role: "shelf",
    label: "Shelves",
    blurb: "The boards that divide the case. They space themselves evenly, so adding one moves the rest to make room.",
    surface: "wood",
    stock: "Solid hardwood",
    // Glass and stone shelves are both real answers here and neither is in
    // the wood list: a glass shelf lets light down a dark case, and a stone
    // one is what goes under something heavy.
    accepts: ["wood", "glass", "stone", "rattan", "metal", "plastic"],
    controls: [
      {
        // The control this piece exists for. Zero is a real answer -- an empty
        // case is a cubby for something tall -- and six is the most that still
        // leaves a compartment worth having at full height. The buildability
        // rule in studio-config.ts narrows the ceiling further as the case is
        // made shorter, so the number offered is always one that fits.
        key: "shelfCount",
        label: "How many shelves",
        hint: "Spaced evenly up the case. Zero leaves it open",
        min: 0,
        max: 6,
        step: 1,
      },
      { key: "shelfThickness", label: "Shelf thickness", hint: "Thicker boards sag less over a wide span", min: 0.5, max: 2.5, step: 0.01 },
    ],
  },
  {
    id: "plinth",
    role: "base",
    label: "Toe kick",
    blurb: "The recessed base the case stands on. It keeps the bottom shelf off a wet floor and your toes out from under it.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "legHeight", label: "Toe kick height", hint: "Lifts the whole case off the floor", min: 0.4, max: 2.2, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------------- sofa
/**
 * A three-seat sofa: a joiner's base under an upholsterer's mass.
 *
 * The first piece here that two trades build, and the parts list is drawn
 * along that seam rather than along what the eye sees. Legs and base rail are
 * timber and always will be; everything above the deck is covered, and the
 * finish lists say so -- offering narra for a seat cushion would be offering
 * something nobody can sit on.
 *
 * Bounds come from scripts/make-sofa.mts, which is also where the asset comes
 * from. A sofa that cannot go up a stairwell is a sofa somebody pays twice to
 * find out about, so the width stops at 2.4m.
 */
const SOFA_PARTS: PartDef[] = [
  {
    id: "seatFrame",
    role: "seatFrame",
    label: "Base rail",
    blurb:
      "The show-wood rail and deck the whole sofa is built on. It carries the cushions and is the only timber you see from the front.",
    surface: "wood",
    stock: "Solid hardwood",
    // A base rail is timber on almost every sofa, but a woven or cane-fronted
    // base is an ordinary Philippine build and reads beautifully under cloth.
    accepts: ["wood", "rattan", "cane", "plastic", "metal"],
    controls: [
      { key: "seatWidth", label: "Sofa width", hint: "Two metres seats three; wider needs a wider door", min: 0.7, max: 1.2, step: 0.01 },
      { key: "seatDepth", label: "Sofa depth", hint: "Front to back. Deeper is for lying on, not sitting", min: 0.8, max: 1.25, step: 0.01 },
      { key: "apronThickness", label: "Rail depth", hint: "How deep the show-wood rail reads under the cushions", min: 0.6, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four turned or tapered legs. They set how high the sofa sits and whether you can get a broom under it.",
    surface: "wood",
    stock: "Solid hardwood",
    accepts: ["wood", "metal", "plastic"],
    controls: [
      { key: "legHeight", label: "Leg height", hint: "Lifts the whole sofa. Low reads modern, high reads lighter", min: 0.5, max: 2.1, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "A slimmer leg under two metres of sofa has work to do", min: 0.6, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "armrests",
    role: "armrest",
    label: "Arms",
    blurb: "The upholstered ends. Their height decides whether the corner is somewhere to rest an arm or somewhere to lie down.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth", "rattan", "cane"],
    controls: [
      { key: "armScale", label: "Arm size", hint: "Slimmer arms give the same sofa more seat", min: 0.5, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Back",
    blurb: "The upholstered back between the arms, which the cushions lean against.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth", "rattan", "cane"],
    controls: [
      { key: "backHeight", label: "Back height", hint: "How far up your back the sofa supports you", min: 0.7, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Seat cushions",
    blurb: "Three loose cushions across the seat. Thicker sits softer and higher, and wears longer before it flattens.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth"],
    controls: [
      { key: "seatCushionThickness", label: "Seat thickness", hint: "Also raises the seat: a thicker cushion sits higher", min: 0.6, max: 1.7, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Back cushions",
    blurb: "Three loose cushions along the back. Deeper ones shorten the seat, which is how a deep sofa is made sittable.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth"],
    controls: [
      { key: "backCushionThickness", label: "Back thickness", hint: "Deeper cushions bring you forward on the seat", min: 0.6, max: 1.7, step: 0.01 },
    ],
  },
  {
    id: "pillows",
    role: "pillows",
    label: "Throw pillows",
    blurb: "The two in the corners. Not structural, and the first thing anybody changes — so they have their own cloth.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth"],
    controls: [
      { key: "ornamentScale", label: "Pillow size", hint: "From a small lumbar cushion to a full square", min: 0.6, max: 1.5, step: 0.01 },
    ],
  },
];


// --------------------------------------------------------------- sofa bed
/**
 * A two-seat pull-out sofa bed, shown open.
 *
 * The parts list is drawn along the same seam the three-seater's is -- what a
 * joiner cuts versus what an upholsterer covers -- but the line falls in a
 * different place, and that is a fact about the piece rather than a choice
 * made here. On a show-wood sofa the base rail is timber and the customer
 * sees it; on a sofa bed the base is a cavity with a mechanism in it, so it
 * is covered, and the only bare timber left is the four feet.
 *
 * Two parts here exist on no other piece in the studio: the mattress and the
 * pull-out that carries it. They borrow the bed's roles rather than the
 * sofa's, which is deliberate --
 *
 *   mattress         is what somebody lies on, so it takes `mattress`, and
 *                    with it the mattress-depth mechanics a bed already has.
 *                    Not `seatCushion`: the rig allows one role from that
 *                    chain, and this piece's seat and bed are the same object
 *   mattressSupport  is a platform spanning the footprint low down, which is
 *                    exactly what a slat deck is. It takes the same role and
 *                    behaves the same way
 *
 * Bounds come from scripts/make-sofa-bed.mts, which is also where the asset
 * comes from, and where the fold is solved. Width stops at 1.25 for the
 * ordinary reason -- a two-seater that will not go up a stairwell is a
 * two-seater somebody pays twice to find out about -- and depth stops at 1.1
 * for a reason peculiar to this piece: the bed's length is twice the body's
 * depth, so stretching the body stretches the bed at double the rate.
 */
const SOFA_BED_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Feet",
    blurb:
      "Four short dark feet. Short on purpose: the bed platform has to pass over them when it shuts, so every centimetre of foot is a centimetre off the cavity.",
    surface: "wood",
    stock: "Solid hardwood",
    accepts: ["wood", "metal", "plastic"],
    controls: [
      { key: "legHeight", label: "Foot height", hint: "Lifts the whole piece. Taller reads lighter but shortens the cavity the bed folds into", min: 0.6, max: 1.6, step: 0.01 },
      { key: "legThickness", label: "Foot thickness", hint: "Thickens each foot in place", min: 0.7, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "seatFrame",
    role: "seatFrame",
    label: "Body",
    blurb:
      "The deck the bed lies on, the wall behind it and the runners down each side. Open at the front, because that is where the bed comes out.",
    surface: "cloth",
    stock: "Upholstery",
    // Upholstered as shown, but a show-wood body is an ordinary build and a
    // caned one is an ordinary Philippine build, so neither is shut out.
    accepts: ["cloth", "wood", "rattan", "cane", "metal", "plastic"],
    controls: [
      { key: "seatWidth", label: "Sofa width", hint: "Widens the piece and the bed with it", min: 0.75, max: 1.25, step: 0.01 },
      { key: "seatDepth", label: "Sofa depth", hint: "Deeper body, longer bed -- the bed is twice the depth, so this moves fast", min: 0.85, max: 1.1, step: 0.01 },
    ],
  },
  {
    id: "armrests",
    role: "armrest",
    label: "Arms",
    blurb:
      "The upholstered ends. They also set how wide the bed can be, since the mattress can only ever be the span between them.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth", "rattan", "cane"],
    controls: [
      { key: "armScale", label: "Arm size", hint: "Slimmer arms give the same piece a wider bed", min: 0.5, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Back",
    blurb: "The upholstered back between the arms, which the tufted cushions are fixed to.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth", "rattan", "cane"],
    controls: [
      { key: "backHeight", label: "Back height", hint: "How far up your back the sofa supports you when it is shut", min: 0.7, max: 1.35, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Back cushion",
    blurb: "One cushion across the whole back. Deeper brings you forward on the seat.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth"],
    controls: [
      { key: "backCushionThickness", label: "Back thickness", hint: "Deeper tufting stands further off the back", min: 0.6, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "mattress",
    role: "mattress",
    label: "Mattress",
    blurb:
      "One whole mattress, folded in half when the sofa is shut. Thicker sleeps better and sits higher -- and folds to twice whatever you choose here, which is what has to clear the arms.",
    surface: "cloth",
    stock: "Upholstered mattress",
    // The `mattress` role's own list is upholstery already; stated anyway,
    // because this is the one part on the piece where a wrong answer is a
    // customer being offered a plywood bed.
    accepts: ["cloth"],
    controls: [
      { key: "seatCushionThickness", label: "Mattress depth", hint: "Folded it doubles, so a thick mattress is a high seat", min: 0.6, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "mattressSupport",
    role: "mattressSupport",
    label: "Pull-out",
    blurb:
      "The platform that slides out and the skirt across its front, with the straps you open it by. Upholstered, because when the bed is out it stands in the middle of the room.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth", "wood", "metal", "plastic"],
    controls: [
      // Deliberately never zero. Every other stretcher-shaped part in this
      // studio can be taken off at the bottom of its range; this one is the
      // mechanism, and a sofa bed without it is a sofa.
      { key: "stretcherThickness", label: "Skirt depth", hint: "How far the skirt drops in front of the platform", min: 0.6, max: 1.3, step: 0.01 },
    ],
  },
  {
    id: "pillows",
    role: "pillows",
    label: "Bolsters",
    blurb:
      "The two round bolsters against the back. Not structural, and the first thing anybody changes -- so they have their own cloth.",
    surface: "cloth",
    stock: "Upholstery",
    accepts: ["cloth"],
    controls: [
      { key: "ornamentScale", label: "Bolster size", hint: "From a slim neck roll to a full cushion", min: 0.5, max: 1.5, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------------- desk
/**
 * A writing desk: legs carrying a top, and a shallow drawer box under it.
 *
 * The first piece here that is a table and a casegood at once, which is not a
 * flourish -- chair-rig.ts builds drawer fronts and pulls inside `if
 * (carcass)`, so a desk with drawers has to declare one. The drawer box IS
 * that carcass. See scripts/make-desk.mts, which the asset and these bounds
 * both come from.
 */
const DESK_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four square legs, set in from the corners. Raising them raises the desk and everything under the top.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      // 75cm is the height the asset is built at and the height a desk is
      // normally worked at seated. The top of the range is a standing desk,
      // which is a real thing to be asked for and costs nothing to allow.
      { key: "legHeight", label: "Desk height", hint: "Lifts the top, the drawers and all", min: 0.8, max: 1.5, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each leg in place", min: 0.7, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "stretchers",
    role: "stretcher",
    label: "Foot rail",
    blurb: "The low brace between the legs. Zero removes it, which is what you want if you sit close.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "stretcherThickness", label: "Rail thickness", hint: "Zero takes the rail out entirely", min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Modesty panel",
    blurb: "The board across the back of the knee hole. Raise it for a desk that faces into a room.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "backHeight", label: "Panel height", hint: "Grows the panel upward from its lower edge", min: 0.5, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "carcass",
    role: "carcass",
    label: "Drawer box",
    blurb: "The shallow case under the top that the drawers run in. Deepening it gives deeper drawers.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "cabinetHeight", label: "Box depth", hint: "How deep the drawer box hangs under the top", min: 0.6, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "drawers",
    role: "drawer",
    label: "Drawer fronts",
    blurb: "The faces across the front of the box. However many you ask for, they divide the same opening between them.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      // The count divides the run rather than adding drawers beside it: four
      // drawers are four narrower drawers filling the same opening, because
      // the opening is the drawer box and does not grow when you ask for
      // more. Narrowed at both ends by what a furniture shop will actually build --
      // see BUILDABLE.drawerWidthCm -- so the slider stops where the joinery
      // does. Zero is a real answer: a desk with no drawers is a writing
      // table, which people buy on purpose.
      { key: "drawerCount", label: "Drawers", hint: "How many drawers divide the box", min: 0, max: 6, step: 1 },
    ],
  },
  {
    id: "handles",
    role: "hardware",
    label: "Handles",
    blurb: "Brass bar pulls, one to a drawer. They keep their size as the desk grows, because a pull is a bought part.",
    surface: "metal",
    stock: "Solid brass",
    controls: [
      { key: "handleScale", label: "Handle size", hint: "Zero leaves the drawers with no pull at all", min: 0, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "tabletop",
    role: "tabletop",
    label: "Desktop",
    blurb: "One solid board. Width and depth here set the whole desk, since everything under it rides the same frame.",
    surface: "wood",
    stock: "Solid hardwood",
    // A plain slab, unlike the dining table's inset panel, so it takes the
    // ordinary tabletop list: timber, glass, stone, metal or a moulded
    // polymer. No `accepts` override is needed for that -- the role says it.
    controls: [
      { key: "seatWidth", label: "Desk width", hint: "Widens the desk, the drawer box and the legs with it", min: 0.7, max: 1.5, step: 0.01 },
      { key: "seatDepth", label: "Desk depth", hint: "Deepens the desk front to back", min: 0.8, max: 1.4, step: 0.01 },
      { key: "seatCushionThickness", label: "Top thickness", hint: "Thickens the board itself", min: 0.5, max: 2.2, step: 0.01 },
    ],
  },
];

// ------------------------------------------------------------------- bed
/**
 * A Philippine platform bed -- a kama.
 *
 * The part list is unusual only in what it does NOT use. There are no
 * drawers, no doors and no hardware, because a bed has none of the rig's
 * casegood machinery in it; and the mattress takes the `tabletop` role rather
 * than `seatCushion`, which is the one decision here worth reading the note on
 * the part itself for.
 *
 * Everything else maps onto the rig exactly as it already works: six legs the
 * frame rides, a frame that spreads with the bed, a pad that thickens from its
 * own underside, an upright at the head that grows in height, and a padded
 * insert that pads forward off that upright's face.
 */
const BED_PARTS: PartDef[] = [
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Six feet -- four corners and a pair at the middle of each side, which is what stops a two-metre frame sagging at mid-span.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      // The asset stands the mattress at 51cm, which is where a bed is easy to
      // sit down onto and get up from. The range runs from a low platform to a
      // high bed with storage room underneath it.
      { key: "legHeight", label: "Bed height", hint: "Lifts the frame, the mattress and the headboard together", min: 0.7, max: 1.5, step: 0.01 },
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each foot in place", min: 0.7, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "apron",
    role: "apron",
    label: "Bed frame",
    blurb: "The side and end rails, and the slat deck inside them. The mattress sits down into the frame rather than on top of it.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "apronThickness", label: "Rail depth", hint: "A deeper rail hides more of the mattress and carries more load", min: 0.6, max: 1.8, step: 0.01 },
    ],
  },
  {
    id: "stretchers",
    role: "stretcher",
    label: "Foot rail",
    blurb: "A low board across the foot of the bed. Zero removes it, which is what you want if the bed is walked past on that side.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "stretcherThickness", label: "Foot rail height", hint: "Zero takes the rail out entirely", min: 0, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "tabletop",
    role: "tabletop",
    label: "Mattress",
    blurb: "Width and length here set the whole bed -- the frame, the legs and the headboard all follow the mattress.",
    surface: "cloth",
    stock: "Upholstered mattress",
    /**
     * The `tabletop` role's own list is boards, panes and slabs, because that
     * is what a tabletop is. This part borrows the role for its MECHANICS --
     * a pad resting on a frame, thickening from its own underside -- and not
     * for its material, so the list is put back to upholstery here.
     *
     * The reason it is not simply a `seatCushion`, which would have given the
     * cloth list for free, is in scripts/make-bed.mts: that role is what
     * `isSeating` is read from, and a bed answering yes to that is analysed as
     * a chair -- a 1300 N point load through the legs and a "Backrest under
     * load" result on the headboard.
     */
    accepts: ["cloth"],
    controls: [
      // A queen is 152 x 203cm and the asset is built at it. The range reaches
      // a single at the bottom and a king at the top, which is the span a
      // furniture shop actually cuts frames for.
      { key: "seatWidth", label: "Bed width", hint: "Single through to king; the frame and the legs follow", min: 0.6, max: 1.25, step: 0.01 },
      { key: "seatDepth", label: "Bed length", hint: "Lengthens the bed and moves the headboard back with it", min: 0.9, max: 1.15, step: 0.01 },
      { key: "seatCushionThickness", label: "Mattress depth", hint: "How thick a mattress the frame is built to take", min: 0.5, max: 1.6, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Headboard",
    blurb: "Two posts with a crest rail and a lower rail, framing the panel. It widens with the bed and moves back as the bed lengthens.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "backHeight", label: "Headboard height", hint: "Grows the headboard upward from the frame", min: 0.5, max: 1.4, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Headboard panel",
    blurb: "The upholstered insert inside the headboard frame. This is what you actually lean against sitting up in bed.",
    surface: "cloth",
    stock: "Upholstered panel",
    controls: [
      // Capped at 1.4 rather than rounded up to 2, and the cap is geometric
      // rather than a matter of taste: the panel pads FORWARD off the
      // headboard's face, and the mattress is 3.8cm in front of that face. Any
      // further and an upholstered headboard sinks into the mattress it is
      // supposed to sit behind. verify:bed asserts the clearance, so this
      // number and that geometry cannot drift apart unnoticed.
      { key: "backCushionThickness", label: "Padding", hint: "How far the panel is padded forward of the frame", min: 0.5, max: 1.4, step: 0.01 },
    ],
  },
];

// ----------------------------------------------------- rocking chair
/**
 * A caned rocking chair -- a tumba-tumba.
 *
 * The first piece here that stands on something other than the floor: its legs
 * land on a pair of curved runners, which is what makes it rock and what makes
 * it awkward to rig. Two of the rig's parameters are deliberately not offered,
 * and both were read out of chair-rig.ts's applyParams rather than found by
 * accident:
 *
 *   legHeight           scales the leg group about y = 0 and separately lifts
 *                       the stretcher pivot by (legHeight - 1) x its attach
 *                       height. Here the "stretchers" are the runners, which
 *                       have to stay on the floor, and the legs stand on a
 *                       curve rather than on the ground -- so raising the seat
 *                       would lift the rockers off the floor and pull the legs
 *                       up off the rockers, opening two gaps at once.
 *   stretcherThickness  scales the runner's Y about its own centre. On a
 *                       straight brace that thickens it in place; on an arc it
 *                       stretches the curve, and high in the range it drives
 *                       the rocker's lowest point through the floor.
 *
 * Everything else behaves, so width, depth, leg thickness, back height, both
 * panel thicknesses and the arms are all offered. The runners take the
 * `stretcher` role because that is the one the rig spreads with the base
 * without coupling to leg height -- exactly what a runner needs.
 */
const ROCKER_PARTS: PartDef[] = [
  {
    id: "stretchers",
    role: "stretcher",
    label: "Runners",
    blurb: "The curved rockers the whole chair stands on. They spread and lengthen with the seat, and are not resized on their own.",
    surface: "wood",
    stock: "Steam-bent hardwood",
    controls: [],
  },
  {
    id: "legs",
    role: "base",
    label: "Legs",
    blurb: "Four posts standing on the runners. Their feet are buried inside the rockers, so thickening them never exposes a joint.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "legThickness", label: "Leg thickness", hint: "Thickens each post in place", min: 0.7, max: 1.5, step: 0.01 },
    ],
  },
  {
    id: "seatFrame",
    role: "seatFrame",
    label: "Seat rails",
    blurb: "The frame the woven seat is stretched across. Widening it widens the whole chair.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "seatWidth", label: "Seat width", hint: "Widens the seat, the back and the runners together", min: 0.8, max: 1.3, step: 0.01 },
      { key: "seatDepth", label: "Seat depth", hint: "Deepens the seat and lengthens the rockers with it", min: 0.85, max: 1.25, step: 0.01 },
    ],
  },
  {
    id: "seatCushion",
    role: "seatCushion",
    label: "Woven seat",
    blurb: "The panel you sit on, woven into the seat rails. A weave gives against you where a board does not.",
    surface: "rattan",
    stock: "Woven rattan panel",
    accepts: ["rattan", "cane", "cloth", "wood"],
    controls: [
      { key: "seatCushionThickness", label: "Seat thickness", hint: "Thickens the woven panel", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "backFrame",
    role: "backFrame",
    label: "Back frame",
    blurb: "Two posts, a crest rail and a lower rail. Raising it raises the crest you lean your head against.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "backHeight", label: "Back height", hint: "Raises the crest rail and stretches the panel with it", min: 0.8, max: 1.25, step: 0.01 },
    ],
  },
  {
    id: "backCushion",
    role: "backCushion",
    label: "Woven back",
    blurb: "The panel inside the back frame. Woven so the chair breathes, which is the point of one in this climate.",
    surface: "rattan",
    stock: "Woven rattan panel",
    accepts: ["rattan", "cane", "cloth", "wood"],
    controls: [
      { key: "backCushionThickness", label: "Back thickness", hint: "Thickens the woven panel", min: 0.5, max: 2, step: 0.01 },
    ],
  },
  {
    id: "armrests",
    role: "armrest",
    label: "Arms",
    blurb: "A bar and its front post on each side. Zero removes them for an armless rocker.",
    surface: "wood",
    stock: "Solid hardwood",
    controls: [
      { key: "armScale", label: "Arm size", hint: "Zero leaves an armless rocking chair", min: 0, max: 1.4, step: 0.01 },
    ],
  },
];

export const STUDIO_MODELS: Record<StudioModelId, StudioModel> = {
  "rocking-chair": {
    id: "rocking-chair",
    name: "Rocking Chair",
    defaultProjectName: "My Rocking Chair",
    url: "/models/rocking-chair/scene.glb",
    /**
     * 95cm to the crest rail, the height the generator builds it at -- change
     * one and change the other (scripts/make-rocking-chair.mts).
     */
    cmPerUnit: 95,
    classify: classifyRockerShell,
    resolveSurface: rockerSurface,
    /**
     * A narra frame with reeded espresso panels set into it.
     *
     * Narra because a rocker is a piece that gets used every day for decades,
     * and narra is the timber traditionally picked for exactly that.
     *
     * The design was originally written the other way round -- a PALE frame
     * with the cane stained dark against it, so the woven areas read as
     * panels rather than as holes on a chair this open. That contrast is no
     * longer available in this direction, and the note below says why: the
     * pale finish it depended on only looks pale by lifting a photographic
     * scan that a generated asset does not have. The contrast survives, with
     * the two values swapped -- the panels now read lighter than the frame
     * rather than darker.
     */
    /**
     * Narra rather than the molave this was authored in, and the swap is a
     * rendering fix rather than a change of mind about the piece.
     *
     * Molave takes the `gain` path: it keeps the model's own baseColor and
     * lifts it to a pale timber, which is right on a photoscanned asset where
     * a dark scan sits underneath. This asset is generated
     * (scripts/make-rocking-chair.mts) and has no scan under it, only a flat
     * baseColor, so the lift blew past white and the whole frame shipped as a
     * flat, grainless #f8c572 -- pale yellow plastic, with none of the figure
     * the piece is supposed to show.
     *
     * Narra is the palest timber that takes the albedo path, so it keeps the
     * pale warm frame the design asks for and gains the grain back. It is also
     * an entirely ordinary timber for a tumba-tumba.
     *
     * `npm run verify:finishes` now fails on any generated model that reaches
     * for a gain finish, which is what would have caught this at the time.
     */
    defaultFinishes: {
      stretchers: "wood-narra",
      legs: "wood-narra",
      seatFrame: "wood-narra",
      backFrame: "wood-narra",
      armrests: "wood-narra",
      seatCushion: "reed-espresso",
      backCushion: "reed-espresso",
    },
    // Hand-rubbed wax, not a film. A rocker is handled constantly and a waxed
    // surface can be refreshed in place where a worn lacquer has to be
    // stripped back.
    defaultVarnish: "wax",
    icon: "\u{1FA91}",
    parts: ROCKER_PARTS,
  },

  table: {
    id: "table",
    name: "Dining Table",
    defaultProjectName: "My Dining Table",
    url: "/models/table/scene.glb",
    /**
     * 75cm, the height the asset is generated at and the height almost every
     * dining table is built to. As with the cabinet this is not a measurement
     * taken after the fact but the height the generator was told to build --
     * change one and change the other (scripts/make-table.mts).
     */
    cmPerUnit: 75,
    classify: classifyTableShell,
    resolveSurface: tableSurface,
    /**
     * Acacia around a slab of Carrara marble.
     *
     * Frame and panel: ebony around a floating oak field.
     *
     * Two other insets were built and rejected, both by this app's own design
     * analysis and by looking at them. Carrara marble failed the structural
     * check outright -- a 30mm slab spanning 1.44m on nothing but its rim is
     * the exact case stone-properties warns about, "immensely stiff and weak
     * in bending... needs continuous support, not a span" -- and tempered
     * glass, which passes structurally, renders as a hole in a picker card at
     * 22% opacity. A timber panel is the oldest answer to this joint anyway: a
     * panel floating in a grooved frame is how a top is built when it has to
     * move with the weather.
     *
     * Kamagong for the frame, which is the loudest choice on this list and the
     * point of it. Every finish that carries real grain here is drawn from one
     * timber scan and separated only by its tint, so two warm hardwoods on two
     * different pieces come out looking like the same piece twice -- acacia
     * was tried and was indistinguishable from the cabinet's narra. Kamagong
     * is the one timber in the catalogue that reads near-black, which is what
     * throws the pale field forward and makes this table unmistakably not the
     * cabinet. It is also the exact inverse of the rocking chair -- pale
     * frame, dark panels -- so the two read as a pair of decisions rather
     * than a pair of accidents.
     *
     * That pale field is molave, and it was lanete for one revision, which is
     * worth recording because the app's own analysis is what rejected it. A
     * dining top is the surface this whole catalogue is hardest on -- see the
     * "Hardness where it shows" check -- and lanete rates 3.0 kN, under the
     * 5 kN that shrugs off daily use, so the shipped default failed its own
     * durability report. Molave is 5.9 kN and renders paler still on this
     * asset, so it answers the structural objection and the visual intent at
     * once.
     */
    /**
     * Narra under a near-black kamagong frame.
     *
     * The inset has been through three timbers and the history is worth
     * keeping, because each move fixed one thing and broke another. It began
     * as honey oak; that was replaced when the catalogue moved to Philippine
     * species. Lanete followed and failed the analysis outright -- 3.0 kN
     * Janka on a dining surface, which the "Hardness where it shows" check
     * scored at 45%. Molave fixed the hardness (5.9 kN, 100%) and quietly
     * broke the rendering instead: it takes the `gain` path, this asset is
     * generated, and a gain finish on a generated asset blows past white. The
     * table shipped with a pale yellow plastic top and a passing analysis.
     *
     * Narra satisfies both at once -- `albedo: true`, so the grain is real,
     * and 5.0 kN, which is exactly the threshold that check calls "shrugs off
     * daily use". It is also still pale against the kamagong, which was the
     * point of an inset panel in the first place.
     */
    defaultFinishes: {
      legs: "wood-kamagong",
      stretchers: "wood-kamagong",
      tabletopBorder: "wood-kamagong",
      // The leaves are not a part a customer selects -- they extend the top,
      // and the studio finishes them in whatever the top is wearing (see
      // `leafHostId` in furniture-studio.tsx). This is only what they open as,
      // before the top has been touched.
      leaves: "wood-kamagong",
      tabletop: "wood-narra",
    },
    // High-gloss on the timber, to meet the polish already on the stone. A
    // satin frame beside a polished slab reads as two unrelated surfaces.
    defaultVarnish: "lacquer",
    icon: "\u{1F37D}\u{FE0F}",
    parts: TABLE_PARTS,
  },

  "side-table": {
    id: "side-table",
    name: "Rattan Side Table",
    defaultProjectName: "My Rattan Side Table",
    url: "/models/side-table/scene.glb",
    /**
     * 70cm tall. The source is in metres -- 0.64 x 0.70 x 0.64 -- which is a
     * side table to the centimetre, so this is the asset's own height rather
     * than a chosen one, and the top comes out 64cm square.
     *
     * Prepared from a 351,000-triangle, 7MB file: parts renamed for the
     * classifier, debug colours stripped, simplified to about 88,000 triangles
     * (about 1MB). It carries no normals; the rig smooths it on load.
     *
     * The legs were thickened 30% across, outer faces held, at the same time.
     * As modelled they were ~26mm square-equivalent over 64cm -- slenderness
     * 50, exactly the design analysis's column limit -- so the piece opened
     * with "Legs as columns" at zero and Durability at 45%. At ~33mm it opens
     * at 89%, and real rattan poles are at least that thick.
     */
    cmPerUnit: 70,
    classify: classifySideTableShell,
    resolveSurface: sideTableSurface,
    // No UVs in the file, so the woven panel's map is projected over it.
    finishUv: "projected",
    /**
     * Espresso cane on the poles, espresso reed in the panel. A cane finish is
     * a colour and a sheen with no map, and this asset has no photograph
     * under it the way the stool's scan does -- so natural honey, the stool's
     * default, opened here as flat cream.
     */
    defaultFinishes: {
      legs: "cane-espresso",
      stretchers: "cane-espresso",
      tabletopBorder: "cane-espresso",
      tabletop: "reed-espresso",
    },
    defaultVarnish: "wax",
    icon: "🪑",
    parts: SIDE_TABLE_PARTS,
  },

  desk: {
    id: "desk",
    name: "Writing Desk",
    defaultProjectName: "My Writing Desk",
    url: "/models/desk/scene.glb",
    /**
     * 75cm, the height the asset is generated at. As with the table and the
     * cabinet this is not a measurement taken after the fact but the height
     * the generator was told to build -- change one and change the other
     * (scripts/make-desk.mts).
     */
    cmPerUnit: 75,
    classify: classifyDeskShell,
    resolveSurface: deskSurface,
    /**
     * Ipil understructure, narra top, antique brass pulls.
     *
     * The choice is constrained in a way that is worth writing down, because
     * it caught the first version of this entry. A finish in this catalogue
     * either takes the scanned albedo (`albedo: true`) or keeps the model's
     * own baseColor and lifts it with `gain`. The gain path is built for the
     * photoscanned pieces, where a DARK scan sits underneath and the lift
     * brings it up to a pale timber. A generated asset has no scan under it,
     * only a flat baseColor, so the same lift blows straight past white:
     * molave (gain 1.5) was tried here first and rendered as pale yellow
     * plastic. Every finish below is an `albedo: true` one for that reason,
     * and the same rule applies to any piece built by a script in scripts/.
     *
     * Within that, ipil and narra: the darkest and the lightest timbers that
     * take the albedo path, so this is as much separation as the catalogue
     * can actually give. It is less than it sounds. Every timber here is the
     * same scanned grain under a different tint, so two of them on one piece
     * read as one board lit unevenly rather than as two species -- the top
     * comes out lighter and more golden than the frame, and that is all. The
     * one timber that genuinely reads as a different material is kamagong,
     * which is near-black, and it belongs to the dining table.
     *
     * It is still a different pair from the cabinet (narra throughout) and
     * the table (kamagong under a pale inset), which is what stops the three
     * generated pieces looking like one piece in three silhouettes.
     *
     * Brass on the pulls is the one thing it shares with the cabinet, which
     * is correct: hardware is bought rather than finished, and a furniture shop
     * fits the same pull to both.
     */
    defaultFinishes: {
      legs: "wood-ipil",
      stretchers: "wood-ipil",
      backFrame: "wood-ipil",
      carcass: "wood-ipil",
      drawers: "wood-ipil",
      tabletop: "wood-narra",
      handles: "metal-antique-brass",
    },
    // Satin rather than the table's lacquer: a desk is written on, and a
    // mirror finish under a lamp is the one thing you cannot work at.
    defaultVarnish: "satin",
    icon: "\u{1F5A5}\u{FE0F}",
    parts: DESK_PARTS,
  },

  bed: {
    id: "bed",
    name: "Platform Bed",
    defaultProjectName: "My Bed",
    url: "/models/bed/scene.glb",
    /**
     * 105cm, the height the asset is generated at -- measured to the top of
     * the headboard, which is the tallest thing on it. As with the table, the
     * cabinet and the desk this is not a figure taken after the fact but the
     * height the generator was told to build, and the rig normalizes every
     * model to exactly 1.0 unit tall before applying it. Change one and change
     * the other (scripts/make-bed.mts prints the number to use).
     */
    cmPerUnit: 105,
    classify: classifyBedShell,
    resolveSurface: bedSurface,
    /**
     * Tanguile throughout the timber, with the mattress in unbleached canvas
     * and the headboard panel in charcoal.
     *
     * Tanguile because it is the timber a Philippine bedroom is actually made
     * of -- the affordable, warm, straight-grained red lauan family stock that
     * a local furniture shop turns beds out of by the dozen -- and because it takes
     * the albedo path.
     *
     * That last clause is not a detail. A finish in this catalogue either
     * takes the scanned albedo (`albedo: true`) or keeps the model's own
     * baseColor and lifts it with `gain`. The gain path is built for the
     * photoscanned pieces, where a DARK scan sits underneath and the lift
     * brings it up to a pale timber; a generated asset has no scan under it,
     * only a flat baseColor, so the same lift blows straight past white. The
     * desk hit this first and rendered as pale yellow plastic. Every timber
     * finish here is an `albedo: true` one for that reason, and the same rule
     * applies to any piece built by a script in scripts/ -- which
     * `npm run verify:finishes` now checks rather than leaving to memory.
     *
     * The two cloth finishes are a different case and need no such care: no
     * cloth finish uses gain at all, so each one simply tints the near-white
     * base colour the generator gives the mattress and the panel, and arrives
     * as the colour on the swatch.
     *
     * Charcoal against tanguile is the one deliberate contrast on the piece.
     * Every other generated model in the catalogue is timber-on-timber, where
     * two species read as one board lit unevenly; an upholstered panel is a
     * genuinely different material, so the headboard reads as a headboard
     * from across the room rather than as a flat area of the same wood.
     */
    defaultFinishes: {
      legs: "wood-tanguile",
      apron: "wood-tanguile",
      stretchers: "wood-tanguile",
      backFrame: "wood-tanguile",
      tabletop: "cloth-canvas-natural",
      backCushion: "cloth-charcoal",
    },
    // Wax rather than the desk's satin or the table's lacquer. A bed is
    // touched with bare skin and slept beside for years; a hand-rubbed wax is
    // what a bedroom piece is finished in, and a gloss on a headboard throws
    // the bedside lamp straight back at whoever is reading under it.
    defaultVarnish: "wax",
    icon: "\u{1F6CF}\u{FE0F}",
    parts: BED_PARTS,
  },

  "victorian-chair": {
    id: "victorian-chair",
    name: "Victorian Chair",
    defaultProjectName: "My Victorian Chair",
    url: "/models/victorian-chair/scene.gltf",
    /**
     * 110cm is chosen so the seat lands at roughly 45cm, the ergonomic standard
     * for a dining seat: the model's seat cushion tops out at 41% of total
     * height, and 0.41 * 110 ~= 45. The resulting footprint (about 49cm wide by
     * 58cm deep) is consistent with a tall-backed Victorian side chair.
     */
    cmPerUnit: 110,
    classify: classifyVictorianShell,
    resolveSurface: victorianSurface,
    icon: "🪑",
    parts: VICTORIAN_PARTS,
    /**
     * Kamagong and burgundy: a tall-backed Victorian side chair is a dark
     * close-grained hardwood with a deep upholstered seat, and kamagong is
     * the Philippine timber that reads that way.
     */
    defaultFinishes: {
      legs: "wood-kamagong",
      seatFrame: "wood-kamagong",
      backFrame: "wood-kamagong",
      ornaments: "wood-kamagong",
      seatCushion: "cloth-burgundy",
      backCushion: "cloth-burgundy",
    },
    defaultVarnish: "lacquer",
    credit: creditFor("Victorian Chair"),
  },
  "cushion-chair": {
    id: "cushion-chair",
    name: "Cushion Chair",
    defaultProjectName: "My Cushion Chair",
    url: "/models/cushion-chair/scene.gltf",
    /**
     * A tub chair is shorter than a dining chair: 78cm total puts the seat pad
     * at about 39cm, which is the low, deep seat this shape is meant to have,
     * and gives a footprint near 61cm wide by 62cm deep.
     */
    cmPerUnit: 78,
    classify: classifyCushionShell,
    resolveSurface: cushionSurface,
    icon: "🛋️",
    parts: CUSHION_PARTS,
    /**
     * A tub chair is upholstery over a frame that is barely seen, so the
     * cloth leads: natural canvas, which is what this shape is usually made
     * up in and what shows a customer's own colour choice against.
     */
    defaultFinishes: {
      frame: "wood-tanguile",
      seatCushion: "cloth-canvas-natural",
      backCushion: "cloth-canvas-natural",
      armrests: "cloth-canvas-natural",
    },
    defaultVarnish: "satin",
    credit: creditFor("Cushion Chair"),
  },
  "rattan-chair": {
    id: "rattan-chair",
    name: "Rattan Armchair",
    defaultProjectName: "My Rattan Armchair",
    url: "/models/rattan-chair/scene.glb",
    /**
     * Unlike the other two, this asset arrived at real-world scale: the source
     * measures 69cm wide, 74cm tall and 58cm deep, which is a caned lounge
     * armchair to the centimetre. So the figure here is the model's own height
     * rather than one chosen to land the seat somewhere -- and the seat lands
     * near 37cm, the low seat this shape is meant to have.
     */
    cmPerUnit: 74,
    classify: classifyRattanShell,
    resolveSurface: rattanSurface,
    icon: "🪑",
    parts: RATTAN_PARTS,
    /**
     * Narra frame, honey cane. The caned panels are 401 modelled strands, so
     * the finish on them is a colour and a sheen only -- natural honey is the
     * colour unbleached cane dries to.
     */
    defaultFinishes: {
      legs: "wood-narra",
      seatFrame: "wood-narra",
      backFrame: "wood-narra",
      seatCushion: "cane-honey",
      backCushion: "cane-honey",
    },
    defaultVarnish: "wax",
    credit: creditFor("Rattan Armchair"),
  },
  "patio-armchair": {
    id: "patio-armchair",
    name: "Patio Armchair",
    defaultProjectName: "My Patio Armchair",
    url: "/models/patio-armchair/scene.gltf",
    /**
     * The asset is already at real-world scale: 71cm wide, 72cm deep and 79cm
     * tall, with the seat cushion sitting at about 42cm. Those are outdoor
     * lounge proportions, so the figure here is the model's own height rather
     * than one chosen to place the seat.
     */
    cmPerUnit: 79,
    /**
     * Measured, not guessed: this asset's frame carries 16.5 UV units per world
     * unit where the other three carry 1.0-1.3, because it was unwrapped to
     * tile its own weave rather than to take an arbitrary material. Without
     * this every finish would tile roughly fourteen times too finely and read
     * as flat colour.
     */
    uvScale: 0.07,
    classify: classifyPatioShell,
    resolveSurface: patioSurface,
    icon: "🌿",
    parts: PATIO_PARTS,
    /**
     * All-weather rattan in sandstone, which is the colour the synthetic weave
     * is spun in when it is meant to pass for natural cane, with canvas
     * cushions. No varnish: a woven polymer frame takes none, and the outdoor
     * cushions are not sealed either.
     */
    defaultFinishes: {
      frame: "synth-sandstone",
      seatCushion: "cloth-canvas-natural",
      backCushion: "cloth-canvas-natural",
    },
    // CC-BY-SA-4.0, unlike the other models here: the licence additionally
    // requires that modified versions carry the same licence, which covers the
    // re-export in public/models/patio-armchair/.
    credit: creditFor("Patio Armchair"),
  },
  bookshelf: {
    id: "bookshelf",
    name: "Bookshelf",
    defaultProjectName: "My Bookshelf",
    url: "/models/bookshelf/scene.glb",
    /**
     * Generated to real-world metric scale by scripts/make-bookshelf.mts --
     * 1.80m tall, 0.80 wide, 0.30 deep -- so this is not a measurement taken
     * after the fact but the height the generator was told to build. Change
     * one and change the other.
     */
    cmPerUnit: 180,
    classify: classifyBookshelfShell,
    resolveSurface: bookshelfSurface,
    /**
     * One timber throughout, unlike the cabinet.
     *
     * A cabinet is two-tone because its carcass is never seen once the doors
     * are shut, so the money goes into the fronts. An open case has no fronts
     * and no inside: every surface of it is on show from across the room, and
     * a painted box with timber shelves would read as a carcass somebody
     * forgot to finish. Narra takes the scanned grain (`albedo`), so the
     * figure is real rather than a tint over flat colour.
     */
    defaultFinishes: {
      carcass: "wood-narra",
      shelves: "wood-narra",
      plinth: "wood-narra",
    },
    // Satin: a bookcase is handled constantly at one height and dusted at
    // every other, and gloss shows both.
    defaultVarnish: "satin",
    icon: "\u{1F4DA}",
    parts: BOOKSHELF_PARTS,
    // No credit line: generated by scripts/make-bookshelf.mts rather than
    // sourced, so there is no third party to attribute.
  },

  cabinet: {
    id: "cabinet",
    name: "Storage Cabinet",
    defaultProjectName: "My Storage Cabinet",
    url: "/models/cabinet/scene.glb",
    /**
     * Unlike the five chairs, this asset was generated to real-world metric
     * scale by scripts/make-cabinet.mts -- 1.80m tall, 0.90 wide, 0.45 deep --
     * so this figure is not a measurement taken after the fact but the height
     * the generator was told to build. Change one and change the other.
     */
    cmPerUnit: 180,
    classify: classifyCabinetShell,
    resolveSurface: cabinetSurface,
    /**
     * A painted aparador: white body, timber fronts, brass.
     *
     * Two-tone rather than one timber throughout, because that is how a
     * painted cabinet is actually built -- a panel carcass costs a fraction of
     * solid stock and is never seen once the doors are on, so the money goes
     * into the fronts. It also gives the piece somewhere to put contrast: the
     * narra doors read as timber precisely because the box behind them does
     * not, and the ply shelves show that thinking through when a door opens.
     */
    defaultFinishes: {
      // Solid timber where it matters: the plinth carries the whole cabinet
      // and stands on the floor, which is the one place a panel should never
      // be -- MDF swells permanently once it meets water. The shelves are
      // solid for a plainer reason: they are what things get dragged across.
      plinth: "wood-narra",
      carcass: "panel-mdf-white",
      doors: "wood-narra",
      drawers: "wood-narra",
      shelves: "wood-narra",
      handles: "metal-brass",
    },
    // Satin polyurethane: the usual choice for daily use, and the only one
    // that sits equally well on paint and on timber.
    defaultVarnish: "satin",
    icon: "🗄️",
    parts: CABINET_PARTS,
    // No credit line: this cabinet is generated by scripts/make-cabinet.mts
    // rather than sourced, so there is no third party to attribute.
  },
  sofa: {
    id: "sofa",
    name: "Three-seat Sofa",
    defaultProjectName: "My Sofa",
    url: "/models/sofa/scene.glb",
    /**
     * Generated to real-world metric scale by scripts/make-sofa.mts -- 2.00m
     * wide, 0.88 deep, 0.85 tall -- so this is the height the generator was
     * told to build rather than a measurement taken after the fact. Change one
     * and change the other.
     *
     * The seat lands at 42cm, which is the number that matters: a dining chair
     * is 45, and a sofa much below 40 is one an older person cannot get out of.
     */
    cmPerUnit: 85,
    classify: classifySofaShell,
    resolveSurface: sofaSurface,
    icon: "\u{1F6CB}\uFE0F",
    parts: SOFA_PARTS,
    /**
     * Narra below the deck, natural canvas above it, abaca on the pillows.
     *
     * Two timbers would be wrong here: the legs and the rail are one piece of
     * joinery and a furniture shop cuts them from the same board. The pillows are
     * deliberately a different cloth from the seat -- they are the part
     * everybody changes, and a sofa that opens with them matching reads as
     * three-piece-suite rather than as somebody's room.
     */
    defaultFinishes: {
      legs: "wood-narra",
      seatFrame: "wood-narra",
      armrests: "cloth-violet",
      backFrame: "cloth-violet",
      seatCushion: "cloth-violet",
      /*
       * Tonal violet, with one warm accent.
       *
       * Three tones rather than one: opened all in a single colour, the
       * channelling and the cushion rolls vanished into one silhouette -- the
       * piece was well made and read as a block. So the channelled back goes a
       * shade deeper than the arms around it, which lets the flutes read by
       * their own shadow instead of needing a second colour to separate them,
       * and the pillows carry the only warm note.
       *
       * Ochre against violet is the pairing doing the work here, and it is the
       * same one the narra underneath is already making -- a warm red-brown
       * under a cool purple. The pillows just say it again at eye level.
       */
      backCushion: "cloth-aubergine",
      pillows: "cloth-ochre",
    },
    defaultVarnish: "satin",
    credit: creditFor("Sofa"),
  },
  "sofa-bed": {
    id: "sofa-bed",
    name: "Sofa Bed",
    defaultProjectName: "My Sofa Bed",
    url: "/models/sofa-bed/scene.glb",
    /**
     * Generated to real-world metric scale by scripts/make-sofa-bed.mts --
     * 1.40m wide, 1.00 deep shut, 0.84 tall -- so this is the height the
     * generator was told to build rather than a measurement taken after the
     * fact. Change one and change the other.
     *
     * The seat lands at 43cm, the same as the three-seater and a dining
     * chair. The number that is peculiar to this piece is the depth: 100cm is
     * deep for a two-seater, and it is deep because the bed folds in half on
     * the front edge, so the body's depth is half the bed's length. A 90cm
     * body gives a 134cm bed, which is too short to lie on.
     */
    cmPerUnit: 84,
    classify: classifySofaBedShell,
    resolveSurface: sofaBedSurface,
    icon: "\u{1F6CF}\uFE0F",
    parts: SOFA_BED_PARTS,
    /**
     * Grey velvet in three tones, kamagong feet, one cream note.
     *
     * The same lesson the three-seater taught, and it matters more here than
     * it did there. The bed and the back are each ONE smooth mass, so neither
     * has any internal shadow of its own to be read by -- opened in a single
     * colour, the whole upper half of the piece is one silhouette and the back
     * cushion disappears into the arms behind it. So the back goes a shade
     * deeper, which is what separates them, and the mattress sits a shade
     * lighter because it is the surface the light actually falls on.
     *
     * The bolsters are the only warm thing on it, and they are doing the same
     * job the three-seater's ochre pillows do: they are the part everybody
     * changes, and a piece that opens with everything matching reads as a
     * showroom set rather than as somebody's room.
     *
     * Kamagong rather than narra on the feet, which is the one place this
     * differs from the sofa: narra is a red-brown and reads warm against
     * violet, but against grey it reads orange. Philippine ebony is almost
     * black, and almost black is what a foot under a grey sofa bed wants to be.
     */
    defaultFinishes: {
      legs: "wood-kamagong",
      seatFrame: "cloth-velvet-dove",
      armrests: "cloth-velvet-dove",
      backFrame: "cloth-velvet-pewter",
      backCushion: "cloth-velvet-pewter",
      mattress: "cloth-velvet-dove",
      mattressSupport: "cloth-velvet-dove",
      pillows: "cloth-canvas-natural",
    },
    defaultVarnish: "satin",
    // No credit line: generated by scripts/make-sofa-bed.mts rather than
    // sourced, so there is no third party to attribute.
  },
  "rattan-stool": {
    id: "rattan-stool",
    name: "Rattan Stool",
    defaultProjectName: "My Rattan Stool",
    url: "/models/rattan-stool/scene.glb",
    /**
     * A caned drum stool stands at about seat height and no more, so 42cm is
     * the whole piece. The asset's own units are arbitrary -- it measures
     * 17.8 x 16.4 x 17.8 -- and the rig normalises height to 1 regardless, so
     * this figure is the real-world height rather than a scale factor.
     */
    cmPerUnit: 42,
    classify: classifyStoolShell,
    resolveSurface: stoolSurface,
    icon: "🪑",
    parts: STOOL_PARTS,
    defaultFinishes: {
      frame: "cane-honey",
      seatCushion: "cloth-canvas-natural",
    },
    defaultVarnish: "wax",
    credit: creditFor("Rattan Stool"),
  },
};

export const DEFAULT_STUDIO_MODEL_ID: StudioModelId = "victorian-chair";

/**
 * The shipped model with this exact id, or null.
 *
 * Prefer this wherever the answer matters. `studioModel` below substitutes a
 * default for an unknown id, which is right for a picker that must show
 * something and badly wrong for a saved design, where it silently turns one
 * piece of furniture into another.
 */
export function findStudioModel(id: string | null | undefined): StudioModel | null {
  return id && id in STUDIO_MODELS ? STUDIO_MODELS[id as StudioModelId] : null;
}

/**
 * The shipped model with this id, falling back to the default.
 *
 * The fallback is a display convenience, not a resolution: callers that need
 * to know whether the id was real must ask `findStudioModel` instead.
 */
export function studioModel(id: string | null | undefined): StudioModel {
  return findStudioModel(id) ?? STUDIO_MODELS[DEFAULT_STUDIO_MODEL_ID];
}

/** The role each part id plays in a model, as the rig needs it. */
export function rolesOf(model: StudioModel): Record<string, PartRole> {
  const roles: Record<string, PartRole> = {};
  for (const part of model.parts) roles[part.id] = part.role;
  return roles;
}

export function partsById(model: StudioModel): Record<string, PartDef> {
  const map: Record<string, PartDef> = {};
  for (const part of model.parts) map[part.id] = part;
  return map;
}

/** Human labels for every part this model exposes, for orders and blueprints. */
export function labelsOf(model: StudioModel): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of model.parts) labels[part.id] = part.label;
  return labels;
}

export function labelFor(model: StudioModel, id: PartId): string {
  return model.parts.find((part) => part.id === id)?.label ?? id;
}
