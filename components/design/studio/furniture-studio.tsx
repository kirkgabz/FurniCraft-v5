"use client";
import { materialLabel } from "@/components/language/material-label";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import MaterialColorPicker from "@/components/design/material-color-picker";
import { MaterialSkin } from "@/components/design/material-skin";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { ZoomIn, ZoomOut } from "lucide-react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { useTheme } from "@/components/theme/theme-context";
import CommissionPath, { CommissionProgress } from "@/components/solihiya/commission-path";
import { pushStep } from "@/lib/commission-path";

/**
 * This surface's place in the commission trail.
 *
 * A fragment distinguishes the studio from the picker on the same route.
 * It also requests the tab's return snapshot when coming back from Review.
 * One constant so the
 * header and the hand-off to the cart cannot name the step differently.
 */
const STUDIO_STEP_HREF = "/customize-furniture#shape";
import { createClient } from "@/lib/supabase/client";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import { closestStockedFinish, stockColorLabel, stockMaterialGroup } from "@/lib/shops/material-stock";
import { getDashboardMode } from "@/lib/dashboard-mode";
import { SHOP_LIST_COLUMNS, SHOPS_PUBLIC_TABLE } from "@/components/shops/shop-types";
import { Modal } from "@/components/ui/modal";
import { BlueprintViewer } from "@/components/design/blueprint-viewer";
import ConfirmModal from "@/components/ui/confirm-modal";
import {
  IconCabinetOpen,
  IconCart,
  IconArrowUpRight,
  IconClose,
  IconDocument,
  IconEdit,
  IconMore,
  IconRotate,
  IconRuler,
  IconSave,
  IconTemplates,
  IconUndo,
} from "@/components/solihiya/icons";
import { EyeIcon, EyeOffIcon } from "@/components/shops/shop-icons";
import BottomSheet from "@/components/ui/bottom-sheet";
import ImageLightbox from "@/components/design/image-lightbox";
import { segmentChair } from "./chair-segmentation";
import { setTextureAnisotropy } from "./texture-loader";
import { installThreeConsoleFilter } from "./three-console";
import { AddToCartDialog, AddedToCartDialog } from "./add-to-cart-dialog";
import {
  addToCart,
  replaceLine,
  cartLineCount,
  cartPieceCount,
  readCart,
  groupCartByShop,
  stageBuyNow,
  BUY_NOW_PATH,
} from "./design-cart";
import { buildChairRig, type ChairRig } from "./chair-rig";
import {
  DEFAULT_EDGE_RADIUS,
  ORIGINAL_SHAPE_ID,
  shapesForPart,
  shapeAcceptsApertures,
  CARVINGS,
  CARVING_NONE_ID,
  defaultAperture,
  APERTURE_SHAPES,
  MAX_APERTURES,
  type PartShape,
  type Aperture,
} from "./part-shapes";
import { DEFAULT_SURFACE_HEIGHT_LABEL, measureRig, type ChairMeasurement } from "./studio-dimensions";
import { surveyRig, type StructureSurvey } from "./structure-survey";
import { analyseDesign, type DesignAnalysis } from "./design-analysis";
import { DesignAnalysisPanel } from "./design-analysis-panel";
import { generateStudioBlueprintSvg } from "./studio-blueprint-svg";
import LengthUnitPicker, { usePreferredLengthUnit } from "../length-unit-picker";
import { formatLength, formatLengthValue, lengthUnitLabel, lengthUnitName, type LengthUnit } from "../length-units";
import StudioTour, { type TourStep } from "./studio-tour";
import { measureSizes, planSizes, solveSize, type AxisPlan, type SizeAxis } from "./studio-size-solver";
import { STUDIO_TOUR_STEPS, shouldAutoOpenStudioTour, markStudioTourSeen } from "./studio-tour-steps";
import { computeSilhouettes } from "./studio-silhouette";
import {
  buildStudioCadState,
  buildStudioDesignItem,
  consumeStagedStudioDesign,
  rememberStudioDesignForReturn,
  resolveFinish,
  type StudioDesignItem,
} from "./studio-design-state";
import {
  COUNT_KEYS,
  DEFAULT_PART_COLORS,
  DEFAULT_RIG_PARAMS,
  resolveCountControl,
  snapCount,
  surfacesForPart,
  type PartDef,
  RIG_PARAM_DIMENSION,
  type PartId,
  type RigParams,
} from "./studio-config";
import {
  partsById,
  rolesOf,
  studioModel,
  type StudioModel,
} from "./studio-models";
import {
  LIFESTYLE_QUESTIONS,
  CONDITION_QUESTIONS,
  BUDGET_OPTIONS,
  STYLE_OPTIONS,
  partFocusOf,
  AGE_QUESTIONS,
  PERSON_OPTIONS,
  NO_LIFESTYLE,
  describeAudience,
  allowedMaterialsForSurfaces,
  ALL_SURFACES,
  groupByCategory,
  materialCategoryOf,
  MATERIAL_CATEGORIES,
  type MaterialCategoryId,
  varnishById,
  VARNISHES,
  DEFAULT_VARNISH_ID,
  type VarnishId,
  type Varnish,
  type MaterialProfile,
  hasAnyLifestyle,
  materialById,
  supportsVarnish,
  combineAllowedMaterials,
  MATERIALS,
  type LifestyleAnswers,
} from "./materials-db";
import { adviseForPart, bestMatchFor, type ChosenPart } from "./material-advisor";

/** The part tabs' names. Shape also holds the texture (the sheen) and the cutouts. */
const PART_TAB_LABEL = { finish: "Finish", shape: "Shape & texture", size: "Size" } as const;

/** Where the advisor's answers are kept between visits, in this browser only. */
const ADVISOR_STORAGE_KEY = "fc-material-advisor";

/** Reads stored answers back defensively: anything malformed falls back to "not asked". */
function readStoredLifestyle(): LifestyleAnswers | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ADVISOR_STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return null;
    const bool = (value: unknown) => value === true;
    return {
      ...NO_LIFESTYLE,
      pets: bool(stored.pets),
      kids: bool(stored.kids),
      outdoor: bool(stored.outdoor),
      humid: bool(stored.humid),
      sun: bool(stored.sun),
      ages: Array.isArray(stored.ages) ? stored.ages.filter((age: unknown) => AGE_QUESTIONS.some((q) => q.key === age)) : [],
      who: PERSON_OPTIONS.some((option) => option.key === stored.who) ? stored.who : "unspecified",
      budget: stored.budget === "budget" || stored.budget === "premium" ? stored.budget : null,
      styles: Array.isArray(stored.styles) ? stored.styles.filter((style: unknown) => STYLE_OPTIONS.some((o) => o.key === style)) : [],
    };
  } catch {
    return null;
  }
}

/**
 * The colours and finish ids a model opens with.
 *
 * Split in two because the studio keeps them in two pieces of state for a
 * reason documented on `materialIds`: the hex is what renders, prints on the
 * blueprint and lives inside every already-saved design, and the id is what
 * carries the texture and the shop's restriction. A default has to set both or
 * the renderer treats it as a hand-picked colour and drops the grain.
 */
function seedColors(model: StudioModel): Record<PartId, string> {
  const colors = { ...DEFAULT_PART_COLORS };
  for (const [id, materialId] of Object.entries(model.defaultFinishes ?? {})) {
    const profile = materialById(materialId);
    if (profile) colors[id as PartId] = profile.hex;
  }
  return colors;
}

/** The seal the piece opens under, applied to every part that has one. */
function seedVarnishIds(model: StudioModel): Partial<Record<PartId, VarnishId>> {
  if (!model.defaultVarnish) return {};
  const ids: Partial<Record<PartId, VarnishId>> = {};
  for (const part of model.parts) ids[part.id] = model.defaultVarnish;
  return ids;
}

function seedMaterialIds(model: StudioModel): Partial<Record<PartId, string>> {
  const ids: Partial<Record<PartId, string>> = {};
  for (const [id, materialId] of Object.entries(model.defaultFinishes ?? {})) {
    if (materialById(materialId)) ids[id as PartId] = materialId;
  }
  return ids;
}

/** Viewport background per theme, so the canvas is not a lit panel in a dark app. */
const VIEWPORT_BG = { light: 0xece4d9, dark: 0x14110f } as const;
/** Shadow strength per theme; a dark shadow on a dark ground reads as nothing. */
const SHADOW_OPACITY = { light: 0.24, dark: 0.5 } as const;

/**
 * The ground grid, which exists for dark mode.
 *
 * In daylight the piece sits on a pale ground and its own contact shadow tells
 * you where the floor is. Against the near-black dark ground that shadow has
 * nothing to fall on, so the furniture floats in a void with no horizon and no
 * sense of depth -- which is the whole reason this was asked for. A white grid
 * gives the eye a floor to read the piece against.
 *
 * It is drawn only in dark mode. In light mode the shadow already does this
 * job, and a grid there would be clutter over a ground that reads fine.
 */
const GRID_COLOR_LINE = 0xd0d0d0;
const GRID_COLOR_AXIS = 0xffffff;
const GRID_OPACITY = 0.5;
/**
 * How far the grid reaches, in model heights. Every model is 1.0 unit tall.
 *
 * Five rather than three so the grid runs past the edge of the frame at every
 * camera distance the controls allow (0.9 to 5). At three the grid ended
 * inside the shot and read as a rug the piece had been stood on, which is a
 * different thing from a floor.
 */
const GRID_SPAN_UNITS = 5;
/**
 * Cell sizes the grid is allowed to use, in centimetres.
 *
 * The cell is picked from this list rather than fixed, so it stays a round
 * real-world number on every model while the grid keeps roughly the same
 * visual density. A fixed cell in scene units would be 13.75cm under the
 * Victorian chair and 22.5cm under the cabinet -- meaningless on both. A fixed
 * cell in centimetres would be comfortable under the chair and a thicket under
 * the 1.8m cabinet.
 */
const GRID_CELL_CHOICES_CM = [5, 10, 20, 25, 50, 100] as const;
/** Cells across the grid, roughly. Drives which cell size above gets picked. */
const GRID_TARGET_CELLS = 26;

/** A pointer that moved further than this between down and up was an orbit drag, not a click. */
const CLICK_SLOP_PX = 5;

/**
 * How every saved design, order and template is pictured.
 *
 * These pictures used to be screenshots of whatever the studio showed at the
 * moment of saving -- the owner's own zoom and angle, a part glowing because
 * it was selected, the canvas's shape on that screen, the dark theme's floor.
 * On the published templates that came to four pictures in three shapes, the
 * piece filling as little as a sixth of the frame, one shot square-on with its
 * shadow running out of the picture -- and each card then cropped them to its
 * own shape. So the shot is fixed instead: one angle, one framing, one
 * backdrop for every piece, in the 4:3 every card frames it in.
 */
const PRODUCT_SHOT = {
  width: 800,
  height: 600,
  /** Narrower than the studio's 42, so the nearest corner of a piece does not balloon. */
  fov: 30,
  /** Front-right three-quarter: the front, one side and the depth, all at once. */
  azimuth: THREE.MathUtils.degToRad(35),
  /** A little above seat height, the way furniture is photographed. */
  elevation: THREE.MathUtils.degToRad(16),
  /** Share of the frame the piece spans, on whichever axis is tighter. */
  fill: 0.82,
  /** The light theme's floor whatever the owner's theme: a card is not the studio. */
  background: VIEWPORT_BG.light,
  shadowOpacity: SHADOW_OPACITY.light,
  quality: 0.86,
} as const;

/** A camera framing whatever of `root` is visible, per PRODUCT_SHOT. */
function productShotCamera(root: THREE.Object3D): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(PRODUCT_SHOT.fov, PRODUCT_SHOT.width / PRODUCT_SHOT.height, 0.05, 100);

  // Only what is drawn: a part the customer hid or a size control removed
  // must not leave empty space in the frame where it would have been.
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    if ((object as THREE.Mesh).isMesh) box.expandByObject(object);
  });
  if (box.isEmpty()) {
    camera.position.set(1.25, 0.95, 1.85);
    camera.lookAt(0, 0.5, 0);
    return camera;
  }

  const { azimuth, elevation } = PRODUCT_SHOT;
  // +Z is the front of every piece (see segmentChair).
  const direction = new THREE.Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  );
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      )
  );
  const target = box.getCenter(new THREE.Vector3());
  let distance = box.getSize(new THREE.Vector3()).length() * 2;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(PRODUCT_SHOT.fov / 2));
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const onScreen = new THREE.Vector3();

  // Aim, see where the box lands on screen, then re-centre and re-distance on
  // that. Perspective makes each guess slightly off; a few passes settle it.
  for (let pass = 0; pass < 4; pass++) {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      onScreen.copy(corner).project(camera);
      minX = Math.min(minX, onScreen.x);
      maxX = Math.max(maxX, onScreen.x);
      minY = Math.min(minY, onScreen.y);
      maxY = Math.max(maxY, onScreen.y);
    }
    const halfHeight = halfTan * distance;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    target
      .addScaledVector(right, ((minX + maxX) / 2) * halfHeight * camera.aspect)
      .addScaledVector(up, ((minY + maxY) / 2) * halfHeight);
    distance *= Math.max(maxX - minX, maxY - minY) / 2 / PRODUCT_SHOT.fill;
  }

  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return camera;
}

type Status = "loading" | "ready" | "error";
type Role = "customer" | "shop";

type SceneHandle = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * Kept on the handle so the turntable toggle can reach it. OrbitControls
   * owns the auto-rotation itself -- it already runs the damped orbit this
   * viewport uses, and driving the camera separately would fight it.
   */
  controls: OrbitControls;
  ruler: THREE.Group;
  rulerAnchors: { w: THREE.Vector3; h: THREE.Vector3; d: THREE.Vector3 };
  ground: THREE.Mesh;
  /** Dark-mode only; see GRID_COLOR_LINE. */
  grid: THREE.GridHelper;
};

/**
 * Releases a ruler's GPU resources. The ruler is rebuilt on every parameter
 * change -- which means on every slider tick -- so dropping the old one without
 * disposing it would leak a geometry and a material per frame of a drag.
 */
function disposeRulerContents(holder: THREE.Group) {
  for (const child of holder.children) {
    child.traverse((object) => {
      const line = object as THREE.LineSegments;
      line.geometry?.dispose();
      (line.material as THREE.Material | undefined)?.dispose();
    });
  }
  holder.clear();
}

/** Wireframe envelope + label anchor points for the on-screen ruler. */
function buildRuler(box: THREE.Box3) {
  const group = new THREE.Group();
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);
  boxGeometry.dispose(); // only existed to derive the edge lines

  const edges = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color: 0x8b5a2b, transparent: true, opacity: 0.75 })
  );
  edges.position.copy(center);
  group.add(edges);

  const pad = Math.max(size.x, size.y, size.z) * 0.06;
  return {
    group,
    anchors: {
      w: new THREE.Vector3(center.x, box.min.y - pad, box.max.z + pad),
      h: new THREE.Vector3(box.max.x + pad, center.y, box.max.z + pad),
      d: new THREE.Vector3(box.max.x + pad, box.min.y - pad, center.z),
    },
  };
}

/**
 * @param model - which piece to open; everything model-specific (asset URL,
 *   segmentation, part list, real-world scale) comes from here. See
 *   studio-models.ts.
 * @param onBack - supplied when the studio was opened from the furniture type
 *   picker, so "Back" returns to the choice instead of leaving for the
 *   dashboard. Absent when the studio was opened directly (a staged order or
 *   template, or a ?type= link), where there is no picker to go back to.
 */
/**
 * The range a corrected height may take -- the same bounds the photo form
 * accepts, so a piece cannot be corrected to a size it could not be made at.
 */
const STUDIO_HEIGHT_MIN_CM = 20;
const STUDIO_HEIGHT_MAX_CM = 400;

/** Centimetres in one of each unit, for reading a typed size back into cm. */
const CM_PER_UNIT: Record<LengthUnit, number> = { cm: 1, mm: 0.1, m: 100, in: 2.54, ft: 30.48 };

/** One typed size: the number in the chosen unit, and the range it can be. */
function SizeField({
  axis,
  label,
  plan,
  unitLabel,
  format,
  value,
  autoFocus,
  onChange,
}: {
  axis: SizeAxis;
  label: string;
  plan: AxisPlan | undefined;
  unitLabel: string;
  /** A length in cm, as a number in the unit being typed. */
  format: (cm: number) => string;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const hintId = `size-hint-${axis}`;
  return (
    <label className="block min-w-0">
      <span className="block truncate text-[10px] uppercase tracking-wider text-[var(--fc-muted)]">{uiText(label)}</span>
      <span className="mt-1 flex items-center rounded-lg border border-[var(--fc-border)] bg-[var(--fc-panel)] transition-colors focus-within:border-[var(--fc-accent)]">
        <input
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          value={value}
          disabled={!plan}
          autoFocus={autoFocus}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={hintId}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-base font-bold tabular-nums text-[var(--fc-text)] outline-none disabled:opacity-50"
        />
        <span aria-hidden className="pr-2 text-xs text-[var(--fc-muted)]">{unitLabel}</span>
      </span>
      <span id={hintId} className="mt-1 block text-[10px] tabular-nums text-[var(--fc-muted)]">
        {plan ? `${format(plan.minCm)}–${format(plan.maxCm)}` : uiText("Fixed on this piece")}
      </span>
    </label>
  );
}

/**
 * One tile in the studio's desktop tool tray: the icon over its name, a brass
 * inlay along the foot while it is on, and a hover card saying what it does
 * and its key. Module scope, so the tray's tiles are not rebuilt on every
 * frame the studio re-renders.
 */
/** A small chevron for the minimise and show controls on the view. */
function ChevronGlyph({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={`h-5 w-5 ${direction === "down" ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

/** What the tool tray folds down to: one small pill that brings it back. */
function ToolsPill({ onClick, label, hint }: { onClick: () => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hint}
      title={hint}
      aria-expanded={false}
      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-panel)_94%,transparent)] px-3.5 py-2 text-xs font-semibold text-[var(--fc-text)] shadow-fc-lg backdrop-blur-md transition-transform active:scale-[0.97] [@media(pointer:coarse)]:min-h-11"
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">
        <ChevronGlyph direction="up" />
      </span>
      {label}
    </button>
  );
}

function TrayTool({
  label,
  hint,
  shortcut,
  icon,
  active = false,
  disabled = false,
  tour,
  onClick,
}: {
  label: string;
  hint: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Absent for a tool the tour does not walk through, such as Hide. */
  tour?: string;
  onClick: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-keyshortcuts={shortcut}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      data-tour={tour}
      data-active={active || undefined}
      className="studio-tray-tool group/tool"
    >
      {icon}
      <span className="studio-tray-label">{uiText(label)}</span>
      <span aria-hidden className="studio-tray-inlay" />
      <span aria-hidden className="studio-tray-tip">
        {uiText(hint)}
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
    </button>
  );
}

/** A named row in the studio's More sheet: icon, what it is, what it does. */
const MORE_ROW =
  "flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left text-[var(--fc-text)] transition-[background-color,transform] duration-150 ease-out hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45";
const MORE_ICON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_12%,transparent)] text-[var(--fc-ink-accent)]";

export default function FurnitureStudio({
  model = studioModel(null),
  onBack,
  banner,
  viewOnlyActions,
  referenceImage,
}: {
  model?: StudioModel;
  onBack?: () => void;
  /**
   * Opens the studio as a viewer: the piece with its finishes and sizes, and
   * the view tools, but nothing that edits, saves or orders it. What is passed
   * takes the place of the header's actions and the phone's bottom bar -- the
   * shared-template page puts its "Customize & order" there.
   *
   * Nothing is ever written in this mode. Autosave in particular is off: a
   * template applied over the default model counts as modified, and would
   * otherwise file a draft into the account of whoever opened the link.
   */
  viewOnlyActions?: ReactNode;
  /** Supplied by the picker so the rail can switch pieces without leaving. */
  /**
   * A line of guidance under the header, for a caller that opens the studio
   * for one particular job -- the shop photo page uses it to ask for the
   * parts to be checked before publishing.
   */
  banner?: ReactNode;
  /**
   * The photo the piece was generated from, shown small at the top left of
   * the view so the shop can check the model against it; a click opens it
   * full size. Display only -- nothing here stores it.
   */
  referenceImage?: string | null;
}) {
  const { t: uiText } = useUiLanguage();
  const [referenceOpen, setReferenceOpen] = useState(false);
  const PART_DEFS: PartDef[] = model.parts;
  const viewOnly = viewOnlyActions !== undefined;
  /**
   * The real height of a generated piece, when the shop has corrected it.
   *
   * A generated piece is converted to centimetres by the one height the shop
   * typed when it was made, and until recently that form opened at a chair's
   * 90 cm and was rarely changed -- so a table, a cabinet and a bed all came out
   * 90 cm tall and wrong in every other dimension by the same factor. One
   * number is the whole fix: entering the real height rescales every
   * measurement, the blueprint and the order together.
   *
   * Kept apart from `model` on purpose. The scene is rebuilt whenever `model`
   * changes, and a height correction changes no geometry at all -- only what a
   * unit of it is called. So everything that turns units into centimetres reads
   * `sizedModel`, and everything that draws reads `model`. The corrected height
   * is saved in the generated source's own `cmPerUnit`, the field that already
   * carries it, so a design reopened later opens at the corrected size.
   */
  const [heightOverrideCm, setHeightOverrideCm] = useState<number | null>(null);
  /** What is typed in the height box, kept as text so a half-typed "1" is not applied as 1 cm. */
  const [heightDraft, setHeightDraft] = useState(() => String(model.cmPerUnit));
  const heightDraftValid = (() => {
    const cm = Number(heightDraft);
    return heightDraft.trim() !== "" && Number.isFinite(cm) && cm >= STUDIO_HEIGHT_MIN_CM && cm <= STUDIO_HEIGHT_MAX_CM;
  })();
  const sizedModel = useMemo<StudioModel>(
    () =>
      heightOverrideCm && model.source
        ? { ...model, cmPerUnit: heightOverrideCm, source: { ...model.source, cmPerUnit: heightOverrideCm } }
        : model,
    [model, heightOverrideCm]
  );
  const PART_DEF_BY_ID = useMemo(() => partsById(model), [model]);
  const clothParts = useMemo(
    () => model.parts.filter((part) => part.surface === "cloth").map((part) => part.id),
    [model]
  );
  /** Shown but never built; kept off the blueprint's outline as measureRig keeps them off its sizes. */
  const stagingParts = useMemo(() => model.parts.filter((part) => part.staging).map((part) => part.id), [model]);
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<ChairRig | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const { theme } = useTheme();
  // The scene effect runs once and must not re-run on a theme change, so it
  // reads the current theme through a ref rather than closing over the value.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const labelWRef = useRef<HTMLDivElement>(null);
  const labelHRef = useRef<HTMLDivElement>(null);
  const labelDRef = useRef<HTMLDivElement>(null);
  // The ruler starts on everywhere -- customer, shop and shared links alike.
  // Product shots hide it themselves (capturePreview), so previews stay clean.
  const showRulerRef = useRef(true);

  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [availableParts, setAvailableParts] = useState<PartId[]>([]);
  const [selected, setSelected] = useState<PartId | null>(null);
  /**
   * Which half of the part sheet a phone is showing. Ignored from lg up, where
   * finish and size are stacked in the sidebar with room for both.
   *
   * The sheet is capped at 60dvh and the finish grid alone runs to ~690px, so
   * without this the size sliders sat below the swatches and needed a scroll
   * to reach -- the same problem the sheet was built to remove, moved inside
   * it. Split in two, size fits the sheet whole and finish scrolls only its
   * own swatches.
   */
  const [sheetTab, setSheetTab] = useState<"finish" | "shape" | "size">("finish");
  /**
   * The sidebar's two tabs on a desktop: the parts and what is being done to
   * one, or the piece's name and measurements. Everything used to stack in one
   * column -- name, measurements, every part, then finish, shape and size --
   * and changing a leg's size meant scrolling past all of it. Below lg the
   * sidebar is already split into the part sheet, so this does nothing there.
   */
  // Opens on the name and measurements -- what the piece is -- and moves to
  // Parts as soon as a part is chosen on the model or in the list.
  const [panelTab, setPanelTab] = useState<"parts" | "details">("details");
  const [hovered, setHovered] = useState<PartId | null>(null);
  /**
   * The finishes a piece opens in.
   *
   * Read once, on mount, which is safe because the studio is keyed by model id
   * (see furniture-type-picker.tsx) -- switching pieces remounts it rather than
   * reusing state built for the other one. A design restored from an order or a
   * template overwrites this afterwards, which is the right precedence: the
   * customer's own finishes beat the model's defaults.
   */
  const [colors, setColors] = useState<Record<PartId, string>>(() => seedColors(model));
  /**
   * Which named finish each part is wearing.
   *
   * Kept beside `colors` rather than replacing it. The hex is what renders,
   * what the blueprint prints and what every already-saved design contains;
   * the id is what carries the texture, the tags and the shop's restriction.
   * A design saved before materials existed has no ids, and is read back by
   * matching its hex -- so nothing that already exists loses its finish.
   */
  const [materialIds, setMaterialIds] = useState<Partial<Record<PartId, string>>>(() =>
    seedMaterialIds(model)
  );
  // The seal over the finish, chosen per part like the finish itself: a caned
  // seat is often left raw on a frame that is lacquered.
  const [varnishIds, setVarnishIds] = useState<Partial<Record<PartId, VarnishId>>>(() =>
    seedVarnishIds(model)
  );
  /**
   * Which shape each part has been rebuilt as, and how hard its edges are
   * broken. Empty to begin with, because every part opens as the model drew
   * it -- see part-shapes.ts.
   *
   * Two maps rather than one of pairs, because they are written at different
   * moments and read by different controls: picking a shape must not disturb
   * a radius the customer already dialled, and sliding the radius must not
   * touch the shape.
   */
  const [shapes, setShapes] = useState<Partial<Record<PartId, string>>>({});
  const [edgeRadii, setEdgeRadii] = useState<Partial<Record<PartId, number>>>({});
  /**
   * Holes cut through each part, and what fills them.
   *
   * Kept beside `shapes` rather than inside it because they answer different
   * questions -- which of the furniture shop's shapes this is, versus where a hole
   * goes in it -- and because a hole outlives a change of shape only when the
   * new shape can carry one. See the guard in the shape picker.
   */
  const [apertures, setApertures] = useState<Partial<Record<PartId, Aperture[]>>>({});
  /**
   * Relief worked into each part's face.
   *
   * Its own state beside `shapes` rather than folded into it, for the reason
   * set out on the catalogue: a fluted case and a plain case are the same
   * case, and a shape list carrying every combination of silhouette and
   * ornament is one nobody can publish or reopen.
   */
  const [carvings, setCarvings] = useState<Partial<Record<PartId, string>>>({});
  // How many of this piece to build. A dining set is six of one chair far more
  // often than it is six different ones, so this is the common shape of a bulk
  // order and it needs no cart to express.
  // The cart flow: ask how many, add, then ask what next. Quantity is no longer
  // a permanent control in the panel -- it says nothing about the design and
  // only matters at the moment a piece is committed to an order.
  const [askQuantityOpen, setAskQuantityOpen] = useState(false);
  const [addedSummary, setAddedSummary] = useState<{
    quantity: number;
    lines: number;
    pieces: number;
    /** Furniture shops the cart is addressed to, so the confirmation can say how many orders this becomes. */
    shopCount: number;
    undecidedCount: number;
  } | null>(null);
  const [cartLines, setCartLines] = useState(0);
  // Set when the studio was opened from a cart line. The edited piece goes
  // back into that line rather than becoming a second copy beside the stale one.
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  /** null until a template says otherwise, which is what unrestricted means. */
  const [templateMaterials, setAllowedMaterials] = useState<string[] | null>(null);
  const [shopStock, setShopStock] = useState<string[] | null>(null);
  const allowedMaterials = useMemo(() => combineAllowedMaterials(templateMaterials, shopStock), [templateMaterials, shopStock]);
  /**
   * The shop whose template this design came out of, if any.
   *
   * Held in state rather than read at add-to-cart time because the staged
   * payload is consumed once, on load -- reading it again would find nothing.
   */
  const [originShop, setOriginShop] = useState<{ id: string; name: string } | null>(null);
  const [lifestyle, setLifestyle] = useState<LifestyleAnswers>(NO_LIFESTYLE);
  /**
   * The design-analysis card and the tool tray, minimised to give the piece
   * the whole view. Remembered in this browser, so whoever prefers them folded
   * does not fold them on every visit. Read after mount: the server render has
   * no storage.
   */
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  useEffect(() => {
    try {
      setAnalysisCollapsed(window.localStorage.getItem("fc-studio-analysis-min") === "1");
      setToolsCollapsed(window.localStorage.getItem("fc-studio-tools-min") === "1");
    } catch {
      // Storage blocked: both start open.
    }
  }, []);
  const toggleAnalysis = useCallback(() => {
    setAnalysisCollapsed((current) => {
      try {
        window.localStorage.setItem("fc-studio-analysis-min", current ? "0" : "1");
      } catch {
        // Only remembered for this visit.
      }
      return !current;
    });
  }, []);
  const toggleTools = useCallback(() => {
    setToolsCollapsed((current) => {
      try {
        window.localStorage.setItem("fc-studio-tools-min", current ? "0" : "1");
      } catch {
        // Only remembered for this visit.
      }
      return !current;
    });
  }, []);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  // Remembered in this browser, so the questions are answered once rather than
  // on every piece. Loaded after mount: the server render has no storage.
  const lifestyleLoaded = useRef(false);
  useEffect(() => {
    const stored = readStoredLifestyle();
    if (stored) setLifestyle(stored);
    lifestyleLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!lifestyleLoaded.current) return;
    try {
      window.localStorage.setItem(ADVISOR_STORAGE_KEY, JSON.stringify(lifestyle));
    } catch {
      // Storage blocked: the answers simply last for this visit.
    }
  }, [lifestyle]);
  /** The owner's own shop, when this tab is working as the shop. */
  const [ownShopId, setOwnShopId] = useState<string | null>(null);
  /** The customer's chosen shop (user_profiles.selected_shop_id). */
  const [selectedShopPref, setSelectedShopPref] = useState<string | null>(null);
  /**
   * Whose stock the studio is showing, and why. Every material and colour on
   * screen, and every recommendation, comes from this shop's declared list.
   */
  const [stockShop, setStockShop] = useState<{
    id: string;
    name: string;
    source: "template" | "cart" | "own" | "selected";
    declared: boolean;
  } | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [pickerPurpose, setPickerPurpose] = useState<"order" | "stock">("order");
  const audience = describeAudience(lifestyle);
  // Parts hidden from view. A hidden part is still measured, still priced,
  // and still listed on the blueprint's component schedule -- only the
  // blueprint's own drawn elevation/plan views leave it out too, matching
  // the 3D view (see the isHidden check in studio-silhouette.ts).
  //
  // The exception is a STAGING part (an uploaded bed's duvet or pillows;
  // see PartDef.staging), which was never being built whether it is hidden
  // or not -- so the reassurance below has to be told apart from it, or it
  // promises a customer that bedlinen is on the quote.
  const [hiddenParts, setHiddenParts] = useState<PartId[]>([]);
  const [params, setParams] = useState<RigParams>(DEFAULT_RIG_PARAMS);
  const [measurement, setMeasurement] = useState<ChairMeasurement | null>(null);
  // How many of the hidden parts are actually part of the build -- the count
  // the "still measured, priced and built" reassurance is about. Hiding only
  // staging parts leaves this at zero, and the reassurance is dropped rather
  // than made false.
  const hiddenBuiltCount = hiddenParts.filter(
    (id) => !model.parts.find((part) => part.id === id)?.staging
  ).length;
  /**
   * The posed piece as structure -- member lengths, real cross-sections, where
   * the mass sits. Held beside the measurement because it is taken on the same
   * beat from the same rig, and kept out of the measurement because the two
   * answer different questions: one is what a furniture shop cuts to, the other is
   * what a beam formula needs. See structure-survey.ts.
   *
   * Never saved. It is derived from the rig, so a stored copy could only ever
   * disagree with the design it came from.
   */
  const [survey, setSurvey] = useState<StructureSurvey | null>(null);
  const [projectName, setProjectName] = useState(model.defaultProjectName);
  const [showRuler, setShowRuler] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [doorsOpen, setDoorsOpen] = useState(false);
  /**
   * Whether this model has doors, and how many spaces they cover.
   *
   * Set from the rig once it is built rather than read off the model
   * definition, because the compartment count is a fact about the mesh -- how
   * many shelves actually sit behind the doors -- and only the rig has that.
   */
  const [doorInfo, setDoorInfo] = useState<{ has: boolean; bayWidth: number; bayHeight: number }>({
    has: false,
    bayWidth: 0,
    bayHeight: 0,
  });
  /**
   * The run the drawer fronts divide, straight off the rig.
   *
   * Held beside `doorInfo` and for the identical reason: it is the AUTHORED
   * span, so it survives the customer dropping the count to zero -- at which
   * point there are no drawers left to measure, and a limit read from the
   * live piece would vanish exactly when it is needed to add them back.
   */
  const [drawerInfo, setDrawerInfo] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  /**
   * The guided tour. Opens by itself the first time somebody reaches a loaded
   * studio and never again on that device; the toolbar's Tutorial button
   * reopens it on demand.
   *
   * Started from `status === "ready"` rather than on mount: the tour points at
   * controls, several of which are disabled or absent until the model has
   * loaded, and a tour that begins by spotlighting a greyed-out Blueprint
   * button teaches the wrong thing.
   */
  const [tourOpen, setTourOpen] = useState(false);
  // The tour walks through the tray's tools, so they are out for it even when
  // minimised -- worked out at render, so they are there when it first looks.
  const toolsShown = !toolsCollapsed || tourOpen;
  const [moreOpen, setMoreOpen] = useState(false);
  // Typed sizes: the plan for each dimension (which control, what range),
  // the numbers being typed, which field to focus, and what the last Apply
  // could not reach.
  const [sizeEditor, setSizeEditor] = useState<{
    plans: Partial<Record<SizeAxis, AxisPlan>>;
    draft: Record<SizeAxis, string>;
    focus: SizeAxis;
  } | null>(null);
  const [sizeNotes, setSizeNotes] = useState<string[]>([]);
  const measurementsRef = useRef<HTMLElement | null>(null);
  // Shortcuts for the tray, read through a ref so the listener is attached once.
  const trayKeysRef = useRef<(key: string) => boolean>(() => false);
  const tourAutoStarted = useRef(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [blueprintItem, setBlueprintItem] = useState<StudioDesignItem | null>(null);
  // One unit for every size the studio shows -- the cards, the size fields,
  // the part readouts, the ruler on the model and the blueprint -- and the
  // same remembered choice the order pages read. Changing it closes the size
  // fields, whose numbers are in the old unit.
  const [unit, setUnit] = usePreferredLengthUnit();
  const chooseUnit = (next: LengthUnit) => {
    setUnit(next);
    setSizeEditor(null);
  };
  const len = (cm: number) => formatLength(cm, unit);
  const dims = (size: { w: number; h: number; d: number }) =>
    unit === "ft"
      ? `${len(size.w)} × ${len(size.h)} × ${len(size.d)}`
      : `${formatLengthValue(size.w, unit)} × ${formatLengthValue(size.h, unit)} × ${formatLengthValue(size.d, unit)} ${lengthUnitLabel(unit)}`;
  // Feet-and-inches is typed as inches: one number per box.
  const inputUnit: LengthUnit = unit === "ft" ? "in" : unit;
  const [role, setRole] = useState<Role>("customer");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Which row in customer_designs this session is writing to, once one exists.
   *
   * Null until the first autosave (a brand-new piece) or until a staged design
   * from "My templates" is restored (an existing one). Kept in a ref rather
   * than state alongside `customerDesignKind`: both are written from inside the
   * autosave effect's own timer callback, and reading them there through state
   * would mean listing them as effect dependencies -- rescheduling the debounce
   * timer the instant the first autosave assigns an id.
   */
  const customerDesignIdRef = useRef<string | null>(null);
  const customerDesignKindRef = useRef<"draft" | "saved">("draft");
  const [saveNamePromptOpen, setSaveNamePromptOpen] = useState(false);
  /**
   * Choosing a shop without leaving the design.
   *
   * Creating an order with no shop selected used to print "pick one from the
   * Templates tab, then come back" -- an instruction to go somewhere else and
   * return, at the exact moment the customer had finished and wanted to send.
   * The choice is one field, so it is asked for here instead.
   */
  const [shopPickerOpen, setShopPickerOpen] = useState(false);
  const [pickerShops, setPickerShops] = useState<Array<{ id: string; name: string; specialty: string; location: string }>>([]);
  const [isPickingShop, setIsPickingShop] = useState(false);

  useEffect(() => {
    showRulerRef.current = showRuler;
    const handle = sceneRef.current;
    if (handle) handle.ruler.visible = showRuler;
  }, [showRuler]);

  /**
   * The turntable.
   *
   * Handed to OrbitControls rather than spun by hand, so a drag interrupts it
   * the way a drag interrupts everything else in this viewport: the controls
   * already own the camera and already damp it, and a second thing moving the
   * same camera would stutter against them. The speed is deliberately slow --
   * a shade over half a minute for a full turn -- because this is for reading
   * a piece from every side, not for showing off.
   */
  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    handle.controls.autoRotate = autoRotate;
    handle.controls.autoRotateSpeed = 1.6;
  }, [autoRotate, status]);

  // Use the same target and distance limits as scroll/pinch zoom.
  function zoomView(factor: number) {
    const handle = sceneRef.current;
    if (!handle || status !== "ready") return;
    const { camera, controls } = handle;
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
  }

  // One toggle opens whatever the piece has: doors, drawers, or both.
  useEffect(() => {
    rigRef.current?.setDoorsOpen(doorsOpen);
    rigRef.current?.setDrawersOpen(doorsOpen);
  }, [doorsOpen, status]);

  // Doors and drawers jump rather than travel for a visitor who has asked for
  // less motion, and follow the setting if it changes mid-visit.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => rigRef.current?.setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [status]);

  /**
   * A new piece arrives shut.
   *
   * The toggle is hidden on a model with no doors, so without this a customer
   * who opened the cabinet, went to look at a chair and came back would find
   * the cabinet open with nothing on screen having asked for it.
   */
  useEffect(() => {
    setDoorsOpen(false);
  }, [model.id]);

  // ---- scene lifecycle: runs once, owns every Three.js resource it creates
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let frame = 0;

    installThreeConsoleFilter();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap is deprecated in three 0.185 and silently falls back to
    // PCFShadowMap anyway, logging a warning on every studio load. Ask for what
    // it actually uses.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // A chair is looked at from a low angle, and a wood grain seen edge-on
    // across a seat is exactly the case trilinear filtering smears into mush.
    // Ask the card what it can actually do rather than assuming a floor.
    setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VIEWPORT_BG[themeRef.current]);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.05, 100);
    camera.position.set(1.25, 0.95, 1.85);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.9;
    controls.maxDistance = 5;
    // Polar angle is clamped at BOTH ends, and the top matters more than it
    // looks. Orbit keeps the camera's up vector pinned to world +Y, so as the
    // polar angle approaches zero and the camera arrives directly overhead,
    // that up vector and the view direction line up and azimuth stops being a
    // turn around the piece -- it becomes a roll of the whole image. The piece
    // then reads as tipped over and hanging in the air, which is alarming on
    // something a customer is trying to judge the proportions of, and is
    // purely an artefact of where the camera got to: a bed that renders
    // perfectly level goes slanted after one upward drag. Stopping short of
    // the pole keeps a genuine look-down-at-the-layout view (useful on a bed,
    // where the plan IS the thing you want to see) while leaving enough angle
    // that the horizon never rolls.
    controls.minPolarAngle = Math.PI * 0.16;
    // The bottom stop sits a little past level so you can see just under the
    // piece -- how a leg meets the floor, the underside of a rail -- without
    // being able to get beneath it and look up through the floor.
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.target.set(0, 0.5, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b7355, 0.5));

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.6, 4.2, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -1.6;
    key.shadow.camera.right = 1.6;
    key.shadow.camera.top = 1.6;
    key.shadow.camera.bottom = -1.6;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-3.2, 2.4, -2.2);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY[themeRef.current] })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const spanCm = GRID_SPAN_UNITS * model.cmPerUnit;
    const idealCellCm = spanCm / GRID_TARGET_CELLS;
    const cellCm =
      GRID_CELL_CHOICES_CM.find((choice) => choice >= idealCellCm) ??
      GRID_CELL_CHOICES_CM[GRID_CELL_CHOICES_CM.length - 1];
    const divisions = Math.max(2, Math.round(spanCm / cellCm));
    // Sized from the rounded division count rather than from the span, so a
    // cell is exactly the round number of centimetres it claims to be.
    const gridSize = (divisions * cellCm) / model.cmPerUnit;

    const grid = new THREE.GridHelper(gridSize, divisions, GRID_COLOR_AXIS, GRID_COLOR_LINE);
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = GRID_OPACITY;
    // The grid is a backdrop, not an object in the scene: it must not write
    // depth, or the lines punch holes in the contact shadow that lands on the
    // same plane. It still reads depth, so the furniture occludes it.
    gridMaterial.depthWrite = false;
    // Clear of the shadow plane at y=0, which the two would otherwise fight
    // over pixel by pixel as the camera orbits.
    grid.position.y = 0.002;
    grid.visible = themeRef.current === "dark";
    scene.add(grid);

    const rulerHolder = new THREE.Group();
    rulerHolder.visible = showRulerRef.current;
    scene.add(rulerHolder);

    sceneRef.current = {
      ground,
      grid,
      renderer,
      scene,
      camera,
      controls,
      ruler: rulerHolder,
      rulerAnchors: { w: new THREE.Vector3(), h: new THREE.Vector3(), d: new THREE.Vector3() },
    };

    // ---- picking
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownAt: { x: number; y: number } | null = null;

    function partAt(clientX: number, clientY: number): PartId | null {
      const rig = rigRef.current;
      if (!rig) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      // `m.visible` covers both reasons a part can be off screen -- removed
      // by a size control, or hidden by the customer -- since setPartHidden
      // now takes a part out of the draw entirely rather than ghosting it.
      // Either way it is unpickable, which is the point of hiding it: you
      // cannot click what you asked to see past.
      const hit = raycaster.intersectObjects(
        rig.pickables.filter((m) => m.visible),
        false
      )[0];
      return hit ? ((hit.object.userData.partId as PartId) ?? null) : null;
    }

    function onPointerMove(event: PointerEvent) {
      const part = partAt(event.clientX, event.clientY);
      setHovered(part);
      renderer.domElement.style.cursor = part ? "pointer" : "grab";
    }
    function onPointerDown(event: PointerEvent) {
      pointerDownAt = { x: event.clientX, y: event.clientY };
    }
    function onPointerUp(event: PointerEvent) {
      if (!pointerDownAt) return;
      const travelled = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
      pointerDownAt = null;
      if (travelled > CLICK_SLOP_PX) return;
      setSelected(partAt(event.clientX, event.clientY));
    }
    function onPointerLeave() {
      setHovered(null);
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    new GLTFLoader()
      .loadAsync(model.url)
      .then((gltf) => {
        if (disposed) return;
        const parts = segmentChair(gltf.scene, model.classify, model.resolveSurface);
        const rig = buildChairRig(parts, rolesOf(model), model.uvScale, model.finishUv);
        rigRef.current = rig;
        scene.add(rig.root);

        const center = rig.bounds.getCenter(new THREE.Vector3());
        controls.target.set(0, center.y, 0);

        /**
         * Pull the camera back far enough to hold the whole piece.
         *
         * The authored position frames a chair, and for five models that was
         * the end of it -- every one of them is roughly as wide as it is tall,
         * because the rig normalises height to 1.0 unit and a chair's width is
         * about its height. A 180cm dining table is 2.4 units wide at the same
         * 1.0 tall, so the camera that framed a chair opens *inside* the table,
         * looking out through its own top.
         *
         * Only ever moves outward, and along the direction the camera is
         * already pointing, so the five chairs keep the framing they were
         * composed with and only a piece too big for it is pushed back. Both
         * axes are checked: on a phone the viewport is tall and narrow, so the
         * horizontal field is the tighter of the two and a wide piece needs
         * more room than its height alone would ask for.
         */
        const span = rig.bounds.getBoundingSphere(new THREE.Sphere()).radius;
        const halfV = (camera.fov * Math.PI) / 360;
        const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
        const fit = (span / Math.sin(Math.min(halfV, halfH))) * 1.1;
        const toCamera = camera.position.clone().sub(controls.target);
        if (fit > toCamera.length()) {
          camera.position.copy(controls.target).addScaledVector(toCamera.normalize(), fit);
          // The orbit limits were written for a chair too, and a table sits
          // outside them; without this the controls would haul it straight
          // back in on the next frame.
          controls.maxDistance = Math.max(controls.maxDistance, fit * 1.6);
        }

        controls.update();

        setAvailableParts(rig.availableParts);
        setDoorInfo({ has: rig.hasDoors, bayWidth: rig.baySpan.width, bayHeight: rig.baySpan.height });
        setDrawerInfo({ width: rig.drawerSpan.width, height: rig.drawerSpan.height });
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setErrorMessage(error instanceof Error ? error.message : "Failed to load the chair model.");
        setStatus("error");
      });

    // ---- render loop; ruler labels are written straight to the DOM so tracking
    // them every frame never triggers a React render.
    const projected = new THREE.Vector3();
    function placeLabel(element: HTMLDivElement | null, anchor: THREE.Vector3) {
      if (!element) return;
      if (!showRulerRef.current || rulerHolder.children.length === 0) {
        element.style.opacity = "0";
        return;
      }
      projected.copy(anchor).project(camera);
      const behind = projected.z > 1;
      element.style.opacity = behind ? "0" : "1";
      if (behind) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      element.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px)`;
    }

    // The doors ease open over time rather than snapping, so the loop has to
    // tell the rig how much time has passed. Three's own timer rather than a
    // hand-rolled timestamp: it already handles the first frame, where there
    // is no previous time to subtract, and -- connected to the document -- it
    // ignores the time the tab spent hidden, so a door doesn't jump shut in
    // one frame when you come back to it.
    const timer = new THREE.Timer();
    timer.connect(document);

    function tick(timestamp?: number) {
      frame = requestAnimationFrame(tick);
      timer.update(timestamp);
      rigRef.current?.advance(timer.getDelta());
      controls.update();
      renderer.render(scene, camera);
      const handle = sceneRef.current;
      if (handle) {
        placeLabel(labelWRef.current, handle.rulerAnchors.w);
        placeLabel(labelHRef.current, handle.rulerAnchors.h);
        placeLabel(labelDRef.current, handle.rulerAnchors.d);
      }
    }
    tick();

    const observer = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    observer.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      timer.dispose();
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      rigRef.current?.dispose();
      rigRef.current = null;
      disposeRulerContents(rulerHolder);
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
      sceneRef.current = null;
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [model]);

  // ---- restore a design staged from an order or template
  useEffect(() => {
    if (status !== "ready") return;
    // A cached studio must leave the next piece staged for the picker, not
    // discard it while its previous model is still mounted.
    const staged = consumeStagedStudioDesign(model.id);
    if (!staged) return;
    setParams(staged.params);
    setColors(staged.colors);
    setAllowedMaterials(staged.allowedMaterials);
    setOriginShop(staged.originShop);
    /**
     * Recover which named finish each part was wearing, so a reopened design
     * keeps its texture rather than degrading to a flat tint of the same
     * colour.
     *
     * The stored ids answer this outright and are trusted where present. The
     * hex search below is only for designs saved before those were written,
     * and it is a guess: a colour does not identify a finish, several entries
     * share one, and the first match is simply the first the catalogue lists.
     * It searches the whole catalogue rather than the four surfaces it used
     * to, which was already why a glass or metal part came back untextured
     * and is now the difference between recovering a stone top and losing it.
     */
    setMaterialIds(() => {
      const recovered: Partial<Record<PartId, string>> = { ...staged.materials };
      for (const [partId, hex] of Object.entries(staged.colors)) {
        if (recovered[partId as PartId]) continue;
        const match = MATERIALS.find(
          (material) => material.hex.toLowerCase() === String(hex).toLowerCase()
        );
        if (match) recovered[partId as PartId] = match.id;
      }
      return recovered;
    });
    setVarnishIds(staged.varnishes);
    setShapes(staged.shapes);
    setEdgeRadii(staged.edgeRadii);
    setApertures(staged.apertures);
    setCarvings(staged.carvings);
    setEditingLineId(staged.cartLineId);
    setProjectName(staged.name);
    // A design opened from "My templates" keeps autosaving into the same row
    // it came from; anything else (an order, a shop template) starts a fresh
    // draft of its own rather than overwriting someone else's saved work.
    customerDesignIdRef.current = staged.customerDesignId;
    customerDesignKindRef.current = staged.customerDesignKind ?? "draft";
    if (!viewOnly) {
      setNotice(
        staged.originShop
          ? `Loaded "${staged.name}" for editing. It is ${staged.originShop.name}'s template: you can order it from ${staged.originShop.name}, but not save it to My templates or send it to another shop.`
          : `Loaded "${staged.name}" for editing.`
      );
    }
  }, [status, model.id, viewOnly]);

  // ---- which action the header offers depends on whether this is a shop owner
  // working as their shop. Owning a shop is not enough: an account that is also
  // a customer opens this same studio from the customer dashboard, and there it
  // must get the customer's actions only (see lib/dashboard-mode.ts).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (getDashboardMode() !== "shop") return;
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const { data: shop } = await supabase
          .from("shops")
          .select("id")
          .eq("user_id", userData.user.id)
          .eq("status", "approved")
          .maybeSingle();
        if (!cancelled && shop) {
          setRole("shop");
          setOwnShopId(shop.id);
        }
      } catch {
        // Non-fatal: fall back to the customer action.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- hidden parts -> scene
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || status !== "ready") return;
    for (const def of model.parts) rig.setPartHidden(def.id, hiddenParts.includes(def.id));
  }, [hiddenParts, status, model]);

  // ---- repaint the viewport when the theme changes
  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    (handle.scene.background as THREE.Color)?.setHex(VIEWPORT_BG[theme]);
    (handle.ground.material as THREE.ShadowMaterial).opacity = SHADOW_OPACITY[theme];
    handle.grid.visible = theme === "dark";
  }, [theme, status]);

  // ---- state -> scene, and re-measure whatever the change produced
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig || status !== "ready") return;

    // Shape before size, and both before the measurement below, in that
    // order. A substituted part is a different piece of geometry with a
    // different envelope -- a round top is narrower at its corners than the
    // rectangle it replaced -- so measuring first would publish the old
    // shape's dimensions onto the new one's order. Cheap to run on every
    // params change: the rig skips a part whose shape and radius have not moved.
    for (const def of model.parts) {
      // Holes before the shape, because the hole is cut INTO the shape: this
      // call only records them and invalidates the cached geometry, and
      // setPartShape on the next line is what actually rebuilds. The other
      // order would draw one frame of a solid top before the hole appeared.
      const holes = apertures[def.id] ?? [];
      rig.setPartApertures(
        def.id,
        shapes[def.id] ?? ORIGINAL_SHAPE_ID,
        holes,
        holes.map((hole) => {
          const profile = materialById(hole.fill ?? undefined);
          return profile ? { profile, varnish: varnishById(varnishIds[def.id]) } : null;
        })
      );
      // Carving before the shape call, like the holes above: both only
      // record what to rebuild with, and setPartShape is what rebuilds.
      rig.setPartCarving(def.id, carvings[def.id] ?? CARVING_NONE_ID);
      rig.setPartShape(def.id, shapes[def.id] ?? ORIGINAL_SHAPE_ID, edgeRadii[def.id] ?? DEFAULT_EDGE_RADIUS);
    }
    rig.applyParams(params);

    // Measured shut: an open door or drawer is not part of the piece's size.
    const next = rig.withShut(() => measureRig(rig, sizedModel));
    setMeasurement(next);
    setSurvey(rig.withShut(() => surveyRig(rig, sizedModel)));

    const handle = sceneRef.current;
    if (handle) {
      disposeRulerContents(handle.ruler);
      const box = rig.withShut(() => new THREE.Box3().setFromObject(rig.root));
      const { group, anchors } = buildRuler(box);
      handle.ruler.add(group);
      handle.rulerAnchors.w.copy(anchors.w);
      handle.rulerAnchors.h.copy(anchors.h);
      handle.rulerAnchors.d.copy(anchors.d);
    }
  }, [params, status, model, sizedModel, shapes, edgeRadii, apertures, carvings, varnishIds]);

  /**
   * Pushes the chosen finishes onto the rig.
   *
   * `status` is in the dependency list and is load-bearing, not decoration.
   * The rig is built from an asynchronous GLTF load, so on first mount
   * `rigRef.current` is still null and this effect returns having done
   * nothing. That was harmless while every piece opened in plain white -- the
   * finishes only ever changed later, by hand, long after the rig existed.
   * It stopped being harmless the moment a model could open in a finish of its
   * own: the seeded colours never change again, so without a dependency that
   * does, the default was computed and then thrown away, and the studio opened
   * the cabinet, table and rocking chair in bare white while their picker cards
   * showed timber. Re-running when the rig becomes ready is what makes what you
   * clicked and what you get the same piece.
   */
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    for (const [id, hex] of Object.entries(colors)) {
      const partId = id as PartId;
      const profile = materialById(materialIds[partId]);
      // A named finish carries relief and roughness with it; a hand-picked
      // custom colour is a tint and nothing more, so it goes the old way.
      if (profile && profile.hex.toLowerCase() === hex.toLowerCase()) {
        rig.setMaterialProfile(partId, profile, varnishById(varnishIds[partId]));
      } else {
        rig.setColor(partId, hex);
      }
    }

    // The leaves follow the top, because they ARE the top -- hinged at its
    // edges and level with it when raised. They have no entry in the parts
    // list and so no finish of their own to change, and a leaf in a different
    // timber from the board it unfolds from would read as a repair.
    const host = model.parts.find(
      (part) => part.role === "tabletopBorder" || part.role === "apron" || part.role === "seatFrame"
    )?.id ?? model.parts.find((part) => part.role === "tabletop")?.id;
    if (host && rig.availableParts.includes("leaves")) {
      const hostHex = colors[host] ?? "#ffffff";
      const hostProfile = materialById(materialIds[host]);
      if (hostProfile && hostProfile.hex.toLowerCase() === hostHex.toLowerCase()) {
        rig.setMaterialProfile("leaves", hostProfile, varnishById(varnishIds[host]));
      } else {
        rig.setColor("leaves", hostHex);
      }
    }
  }, [colors, materialIds, varnishIds, status, model]);

  /**
   * Carvings a stock cannot hold are removed, not merely greyed out.
   *
   * Carving is subtractive: it needs a dense solid to cut into, and a woven
   * panel or a length of bamboo has nothing to take an edge. Leaving the
   * ornaments on screen while disabling the slider would show the customer a
   * piece no furniture shop could build, so the ornaments come off with the timber.
   */
  /**
   * The bay as it stands, in centimetres, which is what the count limits are
   * expressed in.
   *
   * Taken from the authored span times the parameters that stretch it, rather
   * than from the live measurement, so the limits hold steady even when the
   * thing being measured has been counted away: a cabinet with its doors set
   * to zero still has an opening, and the customer has to be able to put a
   * door back into it.
   */
  const bayCm = useMemo(
    () => ({
      width: doorInfo.bayWidth * sizedModel.cmPerUnit * params.seatWidth,
      height: doorInfo.bayHeight * sizedModel.cmPerUnit * params.cabinetHeight,
    }),
    [doorInfo, sizedModel.cmPerUnit, params.seatWidth, params.cabinetHeight]
  );

  /**
   * The run the drawers divide, in centimetres, as it stands.
   *
   * Scaled by whichever parameter actually stretches that axis, which is why
   * this is not simply the bay's width: a row of drawers set side by side
   * grows with the piece's width, and a stack of them grows with the carcass
   * height. The rig publishes the run on one axis and zero on the other, so
   * only one of these two terms is ever non-zero.
   */
  const drawerRunCm = useMemo(
    () =>
      drawerInfo.width * sizedModel.cmPerUnit * params.seatWidth +
      drawerInfo.height * sizedModel.cmPerUnit * params.cabinetHeight,
    [drawerInfo, sizedModel.cmPerUnit, params.seatWidth, params.cabinetHeight]
  );

  /** How many compartments the doors are shutting on, as chosen. */
  const compartments = Math.round(params.shelfCount) + 1;
  const doorsFitted = doorInfo.has && Math.round(params.doorCount) > 0;
  const drawersFitted = drawerInfo.width + drawerInfo.height > 0 && Math.round(params.drawerCount) > 0;
  /** What the open toggle opens, in words, for its title. */
  const openWhat = doorsFitted && drawersFitted ? "doors and drawers" : doorsFitted ? "doors" : "drawers";

  const ornamentMaterial = materialById(materialIds.ornaments);
  const ornamentsCarvable = ornamentMaterial ? ornamentMaterial.carvable !== false : true;
  useEffect(() => {
    if (ornamentsCarvable) return;
    setParams((prev) => (prev.ornamentScale === 0 ? prev : { ...prev, ornamentScale: 0 }));
  }, [ornamentsCarvable]);

  // What is highlighted right now, for capturePreview to put back after a
  // shot. A ref rather than a dependency: the autosave below waits on
  // capturePreview, and should not restart its countdown on every hover.
  const emphasisRef = useRef<{ selected: PartId | null; hovered: PartId | null }>({ selected: null, hovered: null });
  useEffect(() => {
    emphasisRef.current = { selected, hovered };
    rigRef.current?.setEmphasis(selected, hovered);
  }, [selected, hovered, status]);

  // Read once on mount so returning to the studio shows what is already there.
  useEffect(() => {
    setCartLines(cartLineCount());
  }, []);

  /**
   * Takes the product shot (see PRODUCT_SHOT) -- never a screenshot of the
   * live view, whatever the camera, theme or selection happens to be.
   *
   * It borrows the live renderer rather than making its own: a second WebGL
   * context could not use this one's environment map or its uploaded meshes.
   * The canvas is resized, drawn and read, and everything put back, all in one
   * task, so the swap is never painted. The read has to be in that same task
   * anyway: without `preserveDrawingBuffer` the buffer is cleared once a frame
   * is presented.
   */
  const capturePreview = useCallback((): string => {
    const handle = sceneRef.current;
    const rig = rigRef.current;
    if (!handle || !rig) return "";
    const { renderer, scene, camera, ruler, ground } = handle;
    const background = scene.background as THREE.Color;
    const shadow = ground.material as THREE.ShadowMaterial;
    const liveSize = renderer.getSize(new THREE.Vector2());
    const livePixelRatio = renderer.getPixelRatio();
    const liveBackground = background.getHex();
    const liveShadow = shadow.opacity;
    const liveRuler = ruler.visible;
    try {
      rig.setEmphasis(null, null);
      ruler.visible = false;
      background.setHex(PRODUCT_SHOT.background);
      shadow.opacity = PRODUCT_SHOT.shadowOpacity;
      renderer.setPixelRatio(1);
      renderer.setSize(PRODUCT_SHOT.width, PRODUCT_SHOT.height, false);
      // Shut, like the measurement: a template's picture is the piece, not the
      // piece with a customer's drawers left hanging open.
      rig.withShut(() => renderer.render(scene, productShotCamera(rig.root)));

      const shot = document.createElement("canvas");
      shot.width = PRODUCT_SHOT.width;
      shot.height = PRODUCT_SHOT.height;
      const ctx = shot.getContext("2d");
      if (!ctx) return "";
      ctx.drawImage(renderer.domElement, 0, 0);
      return shot.toDataURL("image/jpeg", PRODUCT_SHOT.quality);
    } catch {
      return "";
    } finally {
      renderer.setPixelRatio(livePixelRatio);
      renderer.setSize(liveSize.x, liveSize.y, false);
      background.setHex(liveBackground);
      shadow.opacity = liveShadow;
      ruler.visible = liveRuler;
      rig.setEmphasis(emphasisRef.current.selected, emphasisRef.current.hovered);
      renderer.render(scene, camera);
    }
  }, []);

  // Development only: lets scripts/capture-piece-shots.mts take the same
  // product shot of a freshly opened piece -- its default design -- for the
  // picker's card. Never defined in a production build.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || status !== "ready") return;
    const target = window as unknown as { __furnicraftStudioShot?: () => string };
    target.__furnicraftStudioShot = capturePreview;
    return () => {
      delete target.__furnicraftStudioShot;
    };
  }, [status, capturePreview]);

  /**
   * The design analysis.
   *
   * Derived, memoised, and stored nowhere. It recomputes when the structure
   * changes (a slider) or when a finish changes (a swatch), which is exactly
   * when either of its two scores can move. The arithmetic is a few dozen
   * operations over a handful of members -- the survey it reads is the
   * expensive half, and that is already cached per mesh.
   */
  const analysis = useMemo<DesignAnalysis | null>(() => {
    if (!survey) return null;

    // Resolved the same way the renderer and the order record resolve a
    // finish, so the timber the analysis reasons about is the timber the build
    // sheet will name. A hand-picked custom colour resolves to nothing, and
    // falls back to unspecified stock rather than to the last swatch's timber.
    const stockByPart: Partial<Record<PartId, MaterialProfile | null>> = {};
    const varnishByPart: Partial<Record<PartId, Varnish>> = {};
    for (const def of model.parts) {
      stockByPart[def.id] = resolveFinish(def, colors[def.id] ?? "#ffffff", materialIds[def.id]);
      varnishByPart[def.id] = varnishById(varnishIds[def.id]);
    }

    // Whether the piece is sat on decides which test loads apply: a cabinet
    // must not be analysed against a 1300 N seat load it will never see.
    // A seat, not a backrest. `backFrame` used to count here and could not
    // be wrong while every piece with a back also had something to sit on --
    // which was true of all eight models until the writing desk, whose
    // modesty panel takes the `backFrame` role because it is a panel riding
    // the base at back height and there is no other role that is. Counting it
    // made the desk "seating": its legs were checked against a 1300 N
    // occupant instead of a desk's load, and the analysis reported a
    // "Backrest under load" result on a piece nobody leans on.
    const isSeating = model.parts.some(
      (def) => def.role === "seatCushion" || def.role === "seatFrame"
    );

    return analyseDesign({ survey, stockByPart, varnishByPart, isSeating });
  }, [survey, colors, materialIds, varnishIds, model]);

  /**
   * Builds the saveable design. Tracing the outlines walks every triangle in
   * the model three times, so it is done only when a drawing is actually needed
   * -- opening the blueprint, or saving -- never while a slider is moving.
   */
  const makeDesignItem = useCallback(
    (withOutlines: boolean) => {
      const rig = rigRef.current;
      if (!measurement) return null;
      const item = buildStudioDesignItem({
        model: sizedModel,
        name: projectName.trim() || model.defaultProjectName,
        params,
        colors,
        varnishes: varnishIds,
        materials: materialIds,
        shapes,
        edgeRadii,
        apertures,
        carvings,
        measurement,
        silhouettes:
          withOutlines && rig
            ? rig.withShut(() => computeSilhouettes(rig, sizedModel.cmPerUnit, clothParts, stagingParts))
            : undefined,
      });
      return originShop ? { ...item, originShopId: originShop.id, originShopName: originShop.name } : item;
    },
    [measurement, projectName, params, colors, varnishIds, materialIds, shapes, edgeRadii, apertures, carvings, model, sizedModel, clothParts, stagingParts, originShop]
  );

  /** Cheap version used for enablement and the live price; carries no outlines. */
  const designItem = useMemo(() => {
    if (!measurement) return null;
    // An ephemeral model cannot be turned into a saved design, so it does not
    // get one. Everything that persists a design -- Save, Publish template,
    // Add to cart -- is already gated on this being non-null, so withholding
    // it disables all three together rather than leaving one route open.
    //
    // The reason is not squeamishness: a design records its model's id, and an
    // ephemeral model has nothing stored behind that id -- no file, no labels
    // -- so a saved copy could never be reopened. It would now fail loudly
    // rather than coming back as the default chair, but a design nobody can
    // open is still not one to let a customer order.
    if (model.ephemeral) return null;
    const item = buildStudioDesignItem({
      model: sizedModel,
      name: projectName.trim() || model.defaultProjectName,
      params,
      colors,
      varnishes: varnishIds,
      materials: materialIds,
      shapes,
      edgeRadii,
      apertures,
      carvings,
      measurement,
    });
    return originShop ? { ...item, originShopId: originShop.id, originShopName: originShop.name } : item;
  }, [measurement, projectName, params, colors, varnishIds, materialIds, shapes, edgeRadii, apertures, carvings, model, sizedModel, originShop]);

  /**
   * A piece opened from a shop's template is that shop's, edited or not. The
   * customer may change it and order it from that shop, but not keep a copy in
   * My templates (from where it could be sent anywhere), and no other shop may
   * republish it as its own. The owner publishing their own template is fine.
   */
  const savingLocked = originShop !== null;
  const publishingLocked = originShop !== null && originShop.id !== ownShopId;
  const templateLockNotice = originShop
    ? `This piece is ${originShop.name}'s template. You can change it and order it from ${originShop.name}, but it cannot be saved to My templates or sent to another shop.`
    : null;

  useEffect(() => {
    if (!viewOnly && status === "ready" && designItem) {
      rememberStudioDesignForReturn(
        designItem, projectName, templateMaterials,
        customerDesignIdRef.current ? { id: customerDesignIdRef.current, kind: customerDesignKindRef.current ?? "draft" } : null,
        editingLineId, originShop
      );
    }
  }, [viewOnly, status, designItem, projectName, templateMaterials, editingLineId, originShop]);

  /** Explains the disabled Save/Cart buttons; see the guard in `designItem`. */
  const ephemeralNotice = model.ephemeral
    ? "Generated preview — you can resize and refinish it here, but it cannot be saved or ordered until the model is stored."
    : null;

  /**
   * The app does not price the work any more -- the customer gives a budget
   * when they send the order and the shop quotes it.
   *
   * Held at zero rather than torn out, because unitPrice threads through the
   * cart (cartTotal, lineTotal, the line rows on the review screen) and
   * ripping that plumbing out is a far larger change than removing a number
   * nobody should have been shown. Every place that renders it already guards
   * on a non-zero value, so at zero they render nothing.
   */
  const price = 0;

  /**
   * Puts the piece on screen into the cart at the chosen count.
   *
   * Nothing is sent, and for most pieces no shop is chosen either: which
   * furniture shop builds a design the customer authored is a decision they make at
   * checkout, with the whole cart in front of them.
   *
   * The exception is a piece opened from a shop's published template. That
   * design is the shop's, so it arrives already addressed to them and locked;
   * see CartLine.shopLocked.
   */
  const shapeOf = (lines: ReturnType<typeof readCart>) => {
    const { groups, unassigned } = groupCartByShop(lines);
    return { shopCount: groups.length, undecidedCount: unassigned.length };
  };

  // The customer's chosen shop, read once. Shared links (view only) have no account to read.
  useEffect(() => {
    if (viewOnly) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const { data } = await supabase.from("user_profiles").select("selected_shop_id").eq("id", userData.user.id).maybeSingle();
        if (!cancelled) setSelectedShopPref(data?.selected_shop_id ?? null);
      } catch {
        // Offline: the studio stays a preview until a shop is chosen.
      }
    })();
    return () => { cancelled = true; };
  }, [viewOnly]);

  // Whose stock to show, most specific first: the template's own shop, the shop
  // a cart line is addressed to, the owner's shop when working as the shop,
  // then the customer's chosen shop. Read fresh from shops_public every time,
  // so a shop that changes its list is reflected the next time the studio opens.
  useEffect(() => {
    const cartShop = editingLineId ? readCart().find((line) => line.id === editingLineId)?.shopId ?? null : null;
    const target = originShop
      ? { id: originShop.id, source: "template" as const }
      : cartShop
        ? { id: cartShop, source: "cart" as const }
        : role === "shop" && ownShopId
          ? { id: ownShopId, source: "own" as const }
          : selectedShopPref
            ? { id: selectedShopPref, source: "selected" as const }
            : null;
    let cancelled = false;
    setShopStock(null);
    setStockShop(null);
    if (!target) {
      setStockLoading(false);
      return;
    }
    setStockLoading(true);
    void (async () => {
      try {
        const { data, error } = await createClient()
          .from(SHOPS_PUBLIC_TABLE)
          .select("shop_name, allowed_materials")
          .eq("id", target.id)
          .maybeSingle();
        if (cancelled || error || !data) return;
        const declared = Array.isArray(data.allowed_materials) && data.allowed_materials.length > 0;
        setShopStock(declared ? data.allowed_materials : null);
        setStockShop({ id: target.id, name: data.shop_name || originShop?.name || "", source: target.source, declared });
      } finally {
        if (!cancelled) setStockLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [originShop, editingLineId, role, ownShopId, selectedShopPref]);

  /** Add to cart, or Buy now -- which the quantity dialog is answering. */
  const [quantityMode, setQuantityMode] = useState<"cart" | "buy">("cart");

  const handleAddToCart = useCallback(
    (quantity: number) => {
      const designItem = makeDesignItem(true);
      if (!designItem) {
        setNotice("This design is not ready to add yet.");
        return;
      }

      const patch = {
        item: { ...designItem, ...(quantity > 1 ? { quantity } : {}) },
        modelName: model.name,
        previewUrl: capturePreview(),
        unitPrice: price,
        // Measured here while the rig is loaded, because the cart cannot.
        ...(measurement
          ? {
              sizeLabel: `${measurement.overall.w} × ${measurement.overall.h} × ${measurement.overall.d} cm`,
            }
          : {}),
        // A piece designed against the customer's chosen shop's stock is
        // addressed to that shop, unlocked: they can still move it at checkout,
        // where its materials are checked against the new shop's list.
        shopId: originShop?.id ?? (stockShop?.source === "selected" ? stockShop.id : null),
        shopName: originShop?.name ?? (stockShop?.source === "selected" ? stockShop.name : ""),
        shopLocked: Boolean(originShop),
        allowedMaterials: templateMaterials,
      };

      // Buy now: the very same piece, straight to checkout on its own. Held
      // apart from the cart (design-cart.ts stageBuyNow), so the cart is not
      // added to or emptied by buying one thing.
      if (quantityMode === "buy") {
        const staged = stageBuyNow(patch);
        setAskQuantityOpen(false);
        if (!staged.ok) {
          setNotice("There was no room to save this piece locally. Add it to your cart instead.");
          return;
        }
        window.location.assign(BUY_NOW_PATH);
        return;
      }

      // Editing an existing line updates it in place; only a new piece is added.
      if (editingLineId) {
        const lines = replaceLine(editingLineId, patch);
        setCartLines(lines.length);
        setAskQuantityOpen(false);
        setEditingLineId(null);
        setAddedSummary({
          quantity,
          lines: lines.length,
          pieces: cartPieceCount(lines),
          ...shapeOf(lines),
        });
        return;
      }

      const result = addToCart(patch);

      if (!result.ok) {
        setNotice(
          result.reason === "full"
            ? "Your cart is full. Check out what is in it before adding more."
            : "There was no room to save this piece locally. Try checking out what you have."
        );
        setAskQuantityOpen(false);
        return;
      }

      setCartLines(result.lines.length);
      setAskQuantityOpen(false);
      notifySuccess(editingLineId ? "Cart updated" : "Added to cart");
      setAddedSummary({
        quantity,
        lines: result.lines.length,
        pieces: cartPieceCount(result.lines),
        ...shapeOf(result.lines),
      });
    },
    [makeDesignItem, model.name, capturePreview, price, measurement, editingLineId, originShop, templateMaterials, stockShop, quantityMode]
  );

  const openQuantity = (mode: "cart" | "buy") => {
    setQuantityMode(mode);
    setAskQuantityOpen(true);
  };

  const handleCreateOrder = useCallback(async (overrideShopId?: string) => {
    setIsSaving(true);
    setNotice(null);
    try {
      const designItem = makeDesignItem(true);
      if (!designItem) return;
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        window.location.assign("/auth/login");
        return;
      }

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("selected_shop_id")
        .eq("id", userData.user.id)
        .maybeSingle();

      const shopId = originShop?.id ?? overrideShopId ?? profile?.selected_shop_id ?? null;
      if (!shopId) {
        // Ask for the missing field here rather than sending them away for it.
        const { data: available } = await supabase.from(SHOPS_PUBLIC_TABLE).select(SHOP_LIST_COLUMNS);
        setPickerShops(
          ((available ?? []) as unknown as Array<Record<string, string | null>>).map((row) => ({
            id: String(row.id),
            name: row.shop_name || "Shop",
            specialty: row.tagline || row.description || "Furniture shop",
            location: row.address || "Location pending",
          }))
        );
        setPickerPurpose("order");
        setShopPickerOpen(true);
        return;
      }

      // The customer's selected shop is somebody else's row, so it is read from
      // the public view rather than the restricted application table.
      const { data: shop } = await supabase
        .from(SHOPS_PUBLIC_TABLE)
        .select("shop_name")
        .eq("id", shopId)
        .maybeSingle();

      // Staged locally, not inserted: the customer reviews it, adds notes and
      // reference images, and confirms on /order-summary before it is sent.
      const pendingOrder = {
        shopId,
        shopName: shop?.shop_name || "Selected shop",
        projectName: designItem.name,
        furnitureType: `${model.name} Studio`,
        estimatedPrice: price,
        estimatedPriceText: `₱${price.toLocaleString("en-US")}`,
        savedAt: new Date().toISOString(),
        previewUrl: capturePreview(),
        cadState: JSON.stringify(buildStudioCadState(designItem)),
      };

      window.localStorage.setItem("pending-furniture-order", JSON.stringify(pendingOrder));
      // The same step the header announces. It used to push the picker's own
      // href under the piece's name, which overwrote "Shape it" on the way
      // out and left the cart's Back pointing at a step that no longer
      // matched the trail the customer had been following.
      pushStep({ href: STUDIO_STEP_HREF, label: "Shape it" });
      window.location.assign("/order-summary");
    } catch (error) {
      console.error("Failed to stage the order:", error);
      setNotice("Something went wrong preparing your order. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [makeDesignItem, price, capturePreview, model.name, originShop]);

  /**
   * Records the chosen shop and carries straight on into the order the customer
   * was already trying to create, so choosing costs one click rather than a
   * detour and a restart.
   */
  const handlePickShop = useCallback(
    async (shopId: string) => {
      setIsPickingShop(true);
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const { error } = await supabase
          .from("user_profiles")
          .update({ selected_shop_id: shopId })
          .eq("id", userData.user.id);
        if (error) {
          setNotice(error.message || "That shop could not be selected.");
          return;
        }
        setShopPickerOpen(false);
        notifySuccess("Shop selected");
        await handleCreateOrder(shopId);
      } finally {
        setIsPickingShop(false);
      }
    },
    [handleCreateOrder]
  );

  /** Lists the shops so the customer can choose whose materials the studio shows. */
  const openStockShopPicker = useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      window.location.assign("/auth/login");
      return;
    }
    const { data: available } = await supabase.from(SHOPS_PUBLIC_TABLE).select(SHOP_LIST_COLUMNS);
    setPickerShops(
      ((available ?? []) as unknown as Array<Record<string, string | null>>).map((row) => ({
        id: String(row.id),
        name: row.shop_name || "Shop",
        specialty: row.tagline || row.description || "Furniture shop",
        location: row.address || "Location pending",
      }))
    );
    setPickerPurpose("stock");
    setShopPickerOpen(true);
  }, []);

  /** Records the chosen shop, the same field the dashboard sets, and reloads its stock. */
  const chooseStockShop = useCallback(async (shopId: string) => {
    setIsPickingShop(true);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { error } = await supabase.from("user_profiles").update({ selected_shop_id: shopId }).eq("id", userData.user.id);
      if (error) {
        setNotice(error.message || "That shop could not be selected.");
        return;
      }
      setSelectedShopPref(shopId);
      setShopPickerOpen(false);
      notifySuccess("Shop selected. The studio now shows its materials.");
    } finally {
      setIsPickingShop(false);
    }
  }, []);

  const handlePublishTemplate = useCallback(async () => {
    setIsSaving(true);
    setNotice(null);
    try {
      if (getDashboardMode() !== "shop") {
        setNotice("Switch to your shop dashboard to publish a design as a template.");
        return;
      }
      const designItem = makeDesignItem(true);
      if (!designItem) return;
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        window.location.assign("/auth/login");
        return;
      }

      const { data: shop } = await supabase
        .from("shops")
        .select("id")
        .eq("user_id", userData.user.id)
        .eq("status", "approved")
        .maybeSingle();

      if (!shop) {
        setNotice("Only approved shop owners can publish design templates.");
        return;
      }
      if (originShop && originShop.id !== shop.id) {
        setNotice(`This piece is ${originShop.name}'s template. Only ${originShop.name} can publish it.`);
        return;
      }

      window.localStorage.setItem(
        "pending-template-design",
        JSON.stringify({
          shopId: shop.id,
          projectName: designItem.name,
          previewUrl: capturePreview(),
          cadState: JSON.stringify(buildStudioCadState(designItem)),
          savedAt: new Date().toISOString(),
        })
      );
      window.location.assign("/protected/shop");
    } catch (error) {
      console.error("Failed to stage the template:", error);
      setNotice("Something went wrong publishing this template. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [makeDesignItem, capturePreview, originShop]);

  const reset = useCallback(() => {
    setParams(DEFAULT_RIG_PARAMS);
    // Back to the piece as it was offered, not to bare white: on a generated
    // model those are different things, and "reset" meaning "strip the timber
    // out of it" would be a strange thing for the button to do.
    setColors(seedColors(model));
    setMaterialIds(seedMaterialIds(model));
    setVarnishIds(seedVarnishIds(model));
    // Back to the model's own geometry everywhere. No seed to go back to, the
    // way the finishes have one: a model is authored in a stock but never in
    // a substituted shape, so "as offered" and "as modelled" are the same
    // thing here.
    setShapes({});
    setEdgeRadii({});
    setHiddenParts([]);
    setSelected(null);
  }, [model]);

  const isModified =
    Object.entries(params).some(([k, v]) => v !== DEFAULT_RIG_PARAMS[k as keyof RigParams]) ||
    Object.entries(colors).some(([k, v]) => v !== DEFAULT_PART_COLORS[k as PartId]) ||
    // A substituted shape is a modification even when every slider is still
    // at its default, so the reset button has to offer itself for one.
    Object.values(shapes).some((id) => id && id !== ORIGINAL_SHAPE_ID) ||
    Object.values(edgeRadii).some((value) => (value ?? 0) > 0);

  /**
   * Keeps "My templates" current without asking the customer to remember to.
   *
   * Gated on isModified so opening the studio and looking around never creates
   * a draft nobody asked for -- only actually changing something does. Once a
   * row exists (autosaved, or reopened from an earlier session) every later
   * change updates that same row; kind stays whatever it already was, so an
   * autosave after a customer has explicitly saved a design keeps it filed as
   * "saved" rather than quietly demoting it back to an unnamed draft.
   *
   * Not gated on role: an approved shop owner working in the studio still has
   * their own account and their own "My templates" -- sketching something for
   * themselves is unrelated to whatever they separately choose to publish for
   * their shop. Autosaving under their customer_user_id and shop-publishing
   * under their shop_id are two different rows for two different purposes,
   * and both are available to them at once.
   */
  useEffect(() => {
    // A template's piece is never kept as a draft either; see savingLocked.
    if (viewOnly || !isModified || !designItem || savingLocked) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const item = makeDesignItem(false);
        if (!item) return;
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;
        const row = {
          customer_user_id: userData.user.id,
          name: item.name,
          furniture_type: `${model.name} Studio`,
          cad_state: buildStudioCadState(item),
          preview_url: capturePreview() || null,
          kind: customerDesignKindRef.current,
        };
        if (customerDesignIdRef.current) {
          await supabase.from("customer_designs").update(row).eq("id", customerDesignIdRef.current);
        } else {
          const { data } = await supabase.from("customer_designs").insert(row).select("id").maybeSingle();
          if (data?.id) customerDesignIdRef.current = data.id;
        }
      })();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [viewOnly, isModified, designItem, makeDesignItem, capturePreview, model, savingLocked]);

  const openSaveNamePrompt = useCallback(() => setSaveNamePromptOpen(true), []);

  /**
   * Explicit save: names the design and marks it "saved" rather than a draft.
   *
   * Takes the name as a parameter -- straight from the confirm modal's own
   * callback -- rather than reading it back out of state. Setting state and
   * then calling a useCallback in the same tick would read that callback's
   * stale closure, not the value just typed: React batches the state update,
   * so this function's own `name` variable would still hold whatever it
   * captured on the last render.
   */
  const handleSaveDesign = useCallback(
    async (typedName: string | undefined) => {
      if (templateLockNotice) {
        setSaveNamePromptOpen(false);
        setNotice(templateLockNotice);
        return;
      }
      const item = makeDesignItem(false);
      if (!item) return;
      setIsSaving(true);
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          window.location.assign("/auth/login");
          return;
        }
        const name = typedName?.trim() || projectName.trim() || model.defaultProjectName;
        const row = {
          customer_user_id: userData.user.id,
          name,
          furniture_type: `${model.name} Studio`,
          cad_state: buildStudioCadState({ ...item, name }),
          preview_url: capturePreview() || null,
          kind: "saved" as const,
        };
        let saveError: unknown = null;
        if (customerDesignIdRef.current) {
          ({ error: saveError } = await supabase.from("customer_designs").update(row).eq("id", customerDesignIdRef.current));
        } else {
          const { data, error } = await supabase.from("customer_designs").insert(row).select("id").maybeSingle();
          saveError = error;
          if (data?.id) customerDesignIdRef.current = data.id;
        }
        if (saveError) {
          console.error("Failed to save the design:", saveError);
          setNotice("Could not save your design. Please try again.");
          return;
        }
        customerDesignKindRef.current = "saved";
        setProjectName(name);
        setSaveNamePromptOpen(false);
        setNotice(`Saved "${name}" to My templates.`);
        notifySaved("Design saved");
      } finally {
        setIsSaving(false);
      }
    },
    [makeDesignItem, capturePreview, projectName, model, templateLockNotice]
  );

  const visibleParts = PART_DEFS.filter((def) => !def.hidden && availableParts.includes(def.id));
  const selectedDef = selected ? PART_DEF_BY_ID[selected] : null;
  const selectedMeasure = selected ? measurement?.parts.find((p) => p.id === selected) ?? null : null;

  /**
   * The finishes this part may wear, in the order worth reading them.
   *
   * Restriction first, because a finish the shop will not build is not a
   * choice however well it suits the room. Then the advisor's opinion, and
   * only when one was actually asked for -- with no lifestyle given, the list
   * keeps the shop's own order rather than being silently reranked.
   */
  /**
   * Every family this part can be built in, its own first.
   *
   * Not `selectedDef.surface` any more. A surface says which stock a part was
   * authored in; it is not the list of what a furniture shop could make the same
   * part from, and treating it as though it were is what kept the glass
   * finishes unreachable on every model that shipped. See `surfacesForPart`.
   */
  const selectedSurfaces = useMemo(
    () => (selectedDef ? surfacesForPart(selectedDef) : []),
    [selectedDef]
  );

  /**
   * The shapes this part can be rebuilt as.
   *
   * `status` is in the dependency list for the same reason it is on the
   * finish effect: the shell count comes off the rig, and on first render
   * there is no rig. Without it, a part selected before the model finished
   * loading would keep the shell-count-1 list for the rest of the session --
   * which for a four-legged chair means being offered drums and plinths for
   * its legs.
   */
  const selectedShapes: PartShape[] = useMemo(
    () =>
      selectedDef
        ? shapesForPart(selectedDef, rigRef.current?.shellCounts?.[selectedDef.id] ?? 1)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedDef, status]
  );
  const selectedShapeId = selectedDef ? shapes[selectedDef.id] ?? ORIGINAL_SHAPE_ID : ORIGINAL_SHAPE_ID;
  const selectedShape = selectedShapes.find((shape) => shape.id === selectedShapeId) ?? null;
  const selectedRadius = selectedDef ? edgeRadii[selectedDef.id] ?? DEFAULT_EDGE_RADIUS : DEFAULT_EDGE_RADIUS;

  /**
   * The pane the sheet actually shows.
   *
   * Not just `sheetTab`, because the tab a customer last chose may not exist
   * on the part they have just clicked: a cushion with no size controls has
   * no Size pane, and leaving the sheet on it would show an empty sheet with
   * a tab strip that does not contain the selection. The chosen tab is kept
   * rather than reset, so moving between two resizable parts still lands on
   * Size, which is where the customer was working.
   */
  const activeTab =
    selectedDef && selectedDef.controls.length === 0 && sheetTab === "size" ? "finish" : sheetTab;
  /**
   * The part the leaves extend, and whether this piece has any.
   *
   * The leaves are deliberately NOT a part of their own. A leaf is an
   * extension of the top's edge, not a component beside it: a customer
   * wanting a longer table looks at the top and asks for more of it, and a
   * separate "Drop leaves" row in the parts list invited them to finish the
   * extension in a different timber from the thing it extends.
   *
   * So the controls live on the top, the leaves take the top's finish, and
   * the parts list has one entry for one surface.
   */
  const leafHostId = useMemo(() => {
    const frame = model.parts.find(
      (part) => part.role === "tabletopBorder" || part.role === "apron" || part.role === "seatFrame"
    );
    return (frame ?? model.parts.find((part) => part.role === "tabletop"))?.id ?? null;
  }, [model]);

  const hasLeaves = Boolean(rigRef.current?.availableParts.includes("leaves")) && status === "ready";
  const showLeafControls = hasLeaves && selectedDef?.id === leafHostId;

  const isRestricted = allowedMaterials !== null;
  const selectedMaterial = selectedDef ? materialById(materialIds[selectedDef.id]) : null;

  /**
   * What may be let into a hole.
   *
   * Every surface, not the part's own. A glass round in a narra top is the
   * case this feature was asked for, and offering only the finishes the top
   * itself can be built in would make exactly that impossible. The shop's own
   * restriction still applies -- a furniture shop that does not work glass should
   * not be offered a glass insert either.
   */
  const fillMaterials = useMemo(
    () => allowedMaterialsForSurfaces(ALL_SURFACES, allowedMaterials),
    [allowedMaterials]
  );

  /** The holes on the selected part, and whether its shape can carry any. */
  const selectedApertures = selectedDef ? (apertures[selectedDef.id] ?? []) : [];
  const canCutHoles = shapeAcceptsApertures(selectedShapeId);

  /**
   * Rewrites one hole on the selected part.
   *
   * Passing null removes it. An empty list is stored as an absence, for the
   * same reason the original shape is: "apertures" in a saved record has to
   * mean the customer cut one.
   */
  const editAperture = (index: number, patch: Partial<Aperture> | null) => {
    if (!selectedDef) return;
    const partId = selectedDef.id;
    setApertures((prev) => {
      const current = prev[partId] ?? [];
      const next =
        patch === null
          ? current.filter((_, at) => at !== index)
          : current.map((hole, at) => (at === index ? { ...hole, ...patch } : hole));
      const updated = { ...prev };
      if (next.length) updated[partId] = next;
      else delete updated[partId];
      return updated;
    });
  };
  const permittedMaterials = useMemo(
    () => allowedMaterialsForSurfaces(selectedSurfaces, allowedMaterials),
    [selectedSurfaces, allowedMaterials]
  );
  const selectedMaterialAvailable = selectedMaterial && permittedMaterials.some((material) => material.id === selectedMaterial.id);
  /** Recommendations need a declared list: advice is never drawn from the open catalogue. */
  const stockConfirmed = Boolean(shopStock?.length);
  const selectedFocus = partFocusOf(selectedDef?.role);
  /** Every other part and what it is finished in now, for "goes with". */
  const otherChosenParts = useMemo<ChosenPart[]>(
    () =>
      model.parts
        .filter((part) => part.id !== selectedDef?.id && !part.staging)
        .flatMap((part) => {
          const material = materialById(materialIds[part.id]);
          return material ? [{ label: part.label, material }] : [];
        }),
    [model, selectedDef?.id, materialIds]
  );
  const rankedMaterials = useMemo(
    () => adviseForPart(permittedMaterials, stockConfirmed ? lifestyle : NO_LIFESTYLE, selectedFocus, otherChosenParts),
    [permittedMaterials, stockConfirmed, lifestyle, selectedFocus, otherChosenParts]
  );

  /** What every part was finished in before "Apply best matches", so it can be undone. */
  const [beforeBestMatches, setBeforeBestMatches] = useState<{
    materialIds: typeof materialIds;
    colors: typeof colors;
    varnishIds: typeof varnishIds;
  } | null>(null);

  /**
   * Sets each part to its own best match, from that part's permitted list --
   * the same list its panel shows, so nothing outside the shop's stock can be
   * applied. A part with no finish that suits the answers is left as it is.
   */
  const applyBestMatches = () => {
    if (!stockConfirmed) return;
    const nextIds = { ...materialIds };
    const nextColors = { ...colors };
    const nextVarnish = { ...varnishIds };
    let changed = 0;
    for (const def of model.parts) {
      // Drop leaves take the top's finish and have no picker of their own.
      if (def.staging || String(def.id) === "leaves") continue;
      const permitted = allowedMaterialsForSurfaces(surfacesForPart(def), allowedMaterials);
      const others = model.parts
        .filter((part) => part.id !== def.id && !part.staging)
        .flatMap((part) => {
          const material = materialById(nextIds[part.id]);
          return material ? [{ label: part.label, material }] : [];
        });
      const best = bestMatchFor(permitted, lifestyle, partFocusOf(def.role), others);
      if (!best || nextIds[def.id] === best.id) continue;
      nextIds[def.id] = best.id;
      nextColors[def.id] = best.hex;
      if (!supportsVarnish(best)) nextVarnish[def.id] = DEFAULT_VARNISH_ID;
      changed++;
    }
    if (!changed) {
      setNotice("Every part already uses its best match.");
      return;
    }
    setBeforeBestMatches({ materialIds, colors, varnishIds });
    setMaterialIds(nextIds);
    setColors(nextColors);
    setVarnishIds(nextVarnish);
    setNotice("Best matches applied. Undo puts every part back.");
  };

  /**
   * Keeps every part on a finish the shop actually lists.
   *
   * The picker only ever offered the shop's own stock, but the piece itself
   * kept whatever it opened in -- the model's authored finishes, or a saved
   * design's -- so the 3D view, the specification and the blueprint could all
   * show a material or colour the shop never declared, and the order was then
   * refused for it. Each such part is moved to the nearest listed finish (same
   * material in a listed colour first; see closestStockedFinish), as is any
   * hole filled with stock the shop does not list. Runs again whenever the
   * stock or the finishes change, and does nothing once everything is listed.
   * Never in a read-only view: that is a record of what was ordered.
   */
  useEffect(() => {
    if (viewOnly || status !== "ready" || stockLoading || allowedMaterials === null) return;
    const nextIds = { ...materialIds };
    const nextColors = { ...colors };
    const nextVarnish = { ...varnishIds };
    let changed = 0;
    for (const def of model.parts) {
      // Staging is never built; drop leaves take the top's finish.
      if (def.staging || String(def.id) === "leaves") continue;
      const permitted = allowedMaterialsForSurfaces(surfacesForPart(def), allowedMaterials);
      const current = materialById(materialIds[def.id]);
      const listed =
        current &&
        permitted.some((material) => material.id === current.id) &&
        colors[def.id]?.toLowerCase() === current.hex.toLowerCase();
      if (listed) continue;
      const replacement = closestStockedFinish(current, permitted, def.surface);
      if (!replacement) continue;
      nextIds[def.id] = replacement.id;
      nextColors[def.id] = replacement.hex;
      if (!supportsVarnish(replacement)) nextVarnish[def.id] = DEFAULT_VARNISH_ID;
      changed++;
    }
    let holesChanged = 0;
    const nextApertures = Object.fromEntries(
      Object.entries(apertures).map(([partId, holes]) => [
        partId,
        (holes ?? []).map((hole) => {
          if (!hole.fill || allowedMaterials.includes(hole.fill)) return hole;
          const fill = materialById(hole.fill);
          const replacement = closestStockedFinish(fill, fillMaterials, fill?.surface ?? "glass");
          holesChanged++;
          return { ...hole, fill: replacement?.id ?? null };
        }),
      ])
    ) as typeof apertures;
    if (!changed && !holesChanged) return;
    if (changed) {
      setMaterialIds(nextIds);
      setColors(nextColors);
      setVarnishIds(nextVarnish);
    }
    if (holesChanged) setApertures(nextApertures);
    setBeforeBestMatches(null);
    setNotice(
      stockShop
        ? "Finishes this shop doesn't list were switched to the closest ones it does."
        : "Finishes not listed for this design were switched to the closest listed ones."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, status, stockLoading, allowedMaterials, model, materialIds, colors, apertures, fillMaterials]);

  const undoBestMatches = () => {
    if (!beforeBestMatches) return;
    setMaterialIds(beforeBestMatches.materialIds);
    setColors(beforeBestMatches.colors);
    setVarnishIds(beforeBestMatches.varnishIds);
    setBeforeBestMatches(null);
  };

  /**
   * The same list, gathered into the families it declares.
   *
   * Gathered, not merely cut where the family changes. The advisor sorts the
   * whole list by score, so a recommended bamboo lands in the middle of the
   * timbers -- and a pass that only breaks runs then emits "Hardwood" twice,
   * once either side of it. That produced duplicate React keys and, worse, two
   * identical headings in a panel whose entire purpose is to stop the list
   * looking like a wall.
   *
   * So every family is collected once. The heading order comes from the
   * catalogue rather than the ranked list, so the sections stay put as the
   * advisor's answers change, and only the finishes move within them -- which
   * is what lets "Suits you" read as a hint rather than as a reshuffle.
   */
  const materialCategories = useMemo(
    () => groupByCategory(permittedMaterials, rankedMaterials),
    [permittedMaterials, rankedMaterials]
  );

  /**
   * Which category the Finish panel is showing.
   *
   * Remembered against the part it was picked on, so selecting another part
   * opens on THAT part's own stock rather than on whatever the last part was
   * being browsed in -- a seat cushion should not open on "Solid wood" because
   * the leg before it did. With no choice made, the panel opens on the category
   * of the finish the part already has, which is the one the customer is most
   * likely changing within.
   */
  const [categoryChoice, setCategoryChoice] = useState<{ partId: string; category: MaterialCategoryId } | null>(
    null
  );
  const activeCategory = useMemo((): MaterialCategoryId | null => {
    if (!materialCategories.length || !selectedDef) return null;
    const present = (id: MaterialCategoryId | null | undefined) =>
      id && materialCategories.some((group) => group.category === id) ? id : null;
    if (categoryChoice?.partId === selectedDef.id) {
      const chosen = present(categoryChoice.category);
      if (chosen) return chosen;
    }
    const current = materialById(materialIds[selectedDef.id]);
    return present(current ? materialCategoryOf(current) : null) ?? materialCategories[0].category;
  }, [materialCategories, selectedDef, categoryChoice, materialIds]);
  const shownCategory = materialCategories.find((group) => group.category === activeCategory) ?? null;

  useEffect(() => {
    if (viewOnly || status !== "ready" || tourAutoStarted.current) return;
    tourAutoStarted.current = true;
    if (shouldAutoOpenStudioTour()) setTourOpen(true);
  }, [status, viewOnly]);

  /**
   * The steps, bound to this studio's own handlers.
   *
   * Finish and Size do not exist until a part is chosen, so those steps choose
   * one first -- the first part in the list, which every model has. Selecting
   * an already-selected part is a no-op, so stepping back and forth is safe.
   */
  /**
   * Read inside `onEnter` rather than closed over, so the steps array below
   * can be built once.
   *
   * It has to be built once. StudioTour re-runs its "which of these controls
   * exist" pass whenever the steps array changes identity, and resets to the
   * first step when it does -- so a memo keyed on `selected` meant the Finish
   * step, whose whole job is to select a part, changed the array, reset the
   * tour, and sent the reader back to step one every time they reached it.
   */
  // Choosing a part -- on the model or in the list -- shows its controls, even
  // from the Name & measurements tab.
  useEffect(() => {
    if (selected) setPanelTab("parts");
  }, [selected]);

  const tourSelectionRef = useRef({ selected, visibleParts, setSelected });
  tourSelectionRef.current = { selected, visibleParts, setSelected };

  const tourSteps: TourStep[] = useMemo(
    () =>
      STUDIO_TOUR_STEPS.map((step) => {
        // The sidebar is tabbed on a desktop, so a step first opens the tab
        // its control is on -- a spotlight on a hidden control shows nothing.
        // setState functions are stable, so closing over them here is safe.
        const panel = step.id === "name" || step.id === "measurements" ? "details" : ["parts", "finish", "size"].includes(step.id) ? "parts" : null;
        const sheet = step.id === "finish" ? "finish" : step.id === "size" ? "size" : null;
        if (!step.needsSelection && !panel) return step;
        return {
          ...step,
          onEnter: () => {
            if (panel) setPanelTab(panel);
            if (sheet) setSheetTab(sheet);
            if (!step.needsSelection) return;
            const { selected: current, visibleParts: parts, setSelected: choose } =
              tourSelectionRef.current;
            if (!current && parts[0]) choose(parts[0].id);
          },
        };
      }),
    []
  );

  // The design is captured once, when the drawing opens, and only redrawn in
  // another unit after that -- so switching from cm to inches converts the
  // very numbers already on the sheet rather than re-measuring anything.
  const openBlueprint = useCallback(() => {
    const item = makeDesignItem(true);
    if (!item) return;
    setBlueprintItem(item);
    setShowBlueprint(true);
  }, [makeDesignItem]);
  const blueprintSvg = useMemo(
    () => (blueprintItem ? generateStudioBlueprintSvg(blueprintItem, { pieceName: model.name, unit: unit }) : ""),
    [blueprintItem, model.name, unit]
  );

  const labelClass =
    "pointer-events-none absolute left-0 top-0 rounded-full bg-[#8b5a2b] px-2 py-0.5 text-[11px] font-bold text-white opacity-0 transition-opacity";
  trayKeysRef.current = (key: string) => {
    if (status !== "ready") return false;
    if (key === "r") setShowRuler((value) => !value);
    else if (key === "t") setAutoRotate((value) => !value);
    else if (key === "o" && (doorsFitted || drawersFitted)) setDoorsOpen((value) => !value);
    else if (key === "b" && designItem) openBlueprint();
    else return false;
    return true;
  };
  // A round 44px control floating on the model; brass-filled while on.
  /** Opens the size fields, worked out against the piece as it is now. */
  const openSizeEditor = (focus: SizeAxis) => {
    const rig = rigRef.current;
    if (!rig || !measurement || status !== "ready") return;
    setSizeNotes([]);
    setSizeEditor({
      plans: planSizes(rig, sizedModel, params),
      draft: {
        w: formatLengthValue(measurement.overall.w, inputUnit),
        h: formatLengthValue(measurement.overall.h, inputUnit),
        d: formatLengthValue(measurement.overall.d, inputUnit),
        seat: formatLengthValue(measurement.seatHeight, inputUnit),
      },
      focus,
    });
    // On a phone the 3D view is pinned over the top 40% of the screen, and
    // the fields opened underneath it. The section's scroll margin is that
    // height, so this lands the form just below the view.
    window.requestAnimationFrame(() =>
      measurementsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
  };

  /**
   * Sets each typed dimension, seat first: overall height is solved on the
   * back, which sits on the seat, so the seat has to be where it is going
   * before the height above it is measured.
   *
   * What is in the fields is what the piece ends up as. Each dimension is
   * re-measured after the one before it is set, and set again if that moved
   * it -- an untouched Height field still holds when the seat is lowered,
   * rather than the back dropping with it.
   */
  const applySizeEditor = () => {
    const rig = rigRef.current;
    if (!rig || !measurement || !sizeEditor) return;
    const seatLabel = (measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL).toLowerCase();
    const words: Record<SizeAxis, { name: string; most: string; least: string }> = {
      w: { name: "Width", most: "widest", least: "narrowest" },
      h: { name: "Height", most: "tallest", least: "shortest" },
      d: { name: "Depth", most: "deepest", least: "shallowest" },
      seat: { name: seatLabel.charAt(0).toUpperCase() + seatLabel.slice(1), most: "highest", least: "lowest" },
    };
    let next = params;
    const notes: string[] = [];
    for (const axis of ["seat", "h", "w", "d"] as const) {
      const plan = sizeEditor.plans[axis];
      const raw = sizeEditor.draft[axis].trim().replace(",", ".");
      if (!plan || !raw) continue;
      const target = Number(raw) * CM_PER_UNIT[inputUnit];
      if (!Number.isFinite(target) || target <= 0) {
        notes.push(`${words[axis].name}: "${sizeEditor.draft[axis]}" is not a size in ${lengthUnitName(inputUnit).toLowerCase()}.`);
        continue;
      }
      if (Math.abs(target - measureSizes(rig, sizedModel, next)[axis]) < 0.05) continue;
      const solved = solveSize(rig, sizedModel, next, plan, target);
      next = solved.params;
      if (solved.limit) {
        notes.push(
          `${words[axis].name} stopped at ${len(solved.reachedCm)}, the ${solved.limit === "max" ? words[axis].most : words[axis].least} this piece can be built.`
        );
      }
    }
    setParams(next);
    setSizeNotes(notes);
    setSizeEditor(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target instanceof Element ? event.target : null;
      // Never while typing, and never under a dialog -- the blueprint, a
      // confirm, the tour -- where the letters belong to what is on top.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Only one actually showing: the More sheet stays mounted, hidden, while shut.
      const dialogOpen = Array.from(document.querySelectorAll("[aria-modal='true']")).some(
        (element) => getComputedStyle(element).visibility !== "hidden"
      );
      if (dialogOpen) return;
      if (trayKeysRef.current(event.key.toLowerCase())) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const viewToolClass = (on: boolean) =>
    `grid h-11 w-11 place-items-center rounded-full border shadow-sm backdrop-blur-md transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out active:scale-[0.94] disabled:pointer-events-none disabled:opacity-45 ${
      on
        ? "border-[#8b5a2b] bg-[color-mix(in_srgb,var(--fc-accent)_22%,var(--fc-panel))] text-[var(--fc-ink-accent)]"
        : "border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-panel)_88%,transparent)] text-[var(--fc-text)]"
    }`;

  return (
    // Fixed to the screen from lg, where the sidebar scrolls on its own. On a
    // phone the page itself scrolls, and grows to its content so the pinned
    // viewer below has the whole page to stay pinned through.
    <div className={`flex min-h-dvh flex-col bg-[var(--fc-bg)] text-[var(--fc-text)] lg:h-dvh${viewOnly ? " h-dvh" : " max-lg:pb-[calc(5rem+env(safe-area-inset-bottom))]"}`}>
      {/* Below lg the header is one slim row: the way back and More. It used
          to be three rows on a phone -- the trail, seven unlabelled round
          icons, then Add to cart -- 167px before the piece itself began. The
          view tools now sit on the model (see the viewport), the rest are
          named rows in the More sheet, and Add to cart lives in the bottom
          bar, under the thumb. The full toolbar returns from lg. */}
      {viewOnly ? null : (
        <CommissionProgress
          current="Shape it"
          onStep={{ "Pick a piece": onBack ?? (() => window.location.assign("/customize-furniture")) }}
          className="shrink-0"
        />
      )}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--fc-border)] px-3 py-2 sm:gap-3 sm:px-5 lg:py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {/* Opened from the picker, "back" is a state change rather than a
              navigation, so it stays a button -- but it now names where it
              goes. Opened directly (a saved design, a shared link), the trail
              knows what preceded this; the fallback is the picker rather than
              the dashboard, because that is the step actually before the studio. */}
          {/* One trail, whichever way the studio was opened. It used to be a
              bare "Pick a piece" button when the picker rendered it and a
              path only when it did not, so the steps a customer had been
              following simply stopped here. `onBack` keeps the picker's
              state-change behaviour -- see CommissionPath's own note.

              Its href carries the piece, so this step is distinct from the
              picker's: both surfaces live at /customize-furniture, and a
              shared href would make the trail read the studio as a return to
              the picker and truncate everything behind it. */}
          {viewOnly ? null : (
            <div data-tour="back" className="min-w-0">
              <CommissionPath
                current={{ href: STUDIO_STEP_HREF, label: "Shape it" }}
                fallback={{ href: "/customize-furniture", label: "Pick a piece" }}
                onBack={onBack}
                showSteps={false}
              />
            </div>
          )}
          {/* The name lives at the top of the side panel now, with the rest of
              what this design *is*, rather than in the toolbar with the things
              you do to it. */}
          {measurement ? (
            <span className={`${viewOnly ? "" : "hidden lg:inline "}text-xs tabular-nums text-[var(--fc-muted)]`}>
              {dims(measurement.overall)}
            </span>
          ) : null}
        </div>

        {viewOnly ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{viewOnlyActions}</div>
        ) : (
        <>
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          data-tour="more"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--fc-border)] px-3.5 text-sm font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-[rgba(178,106,56,0.1)] active:scale-[0.97] lg:hidden"
        >
          <IconMore aria-hidden className="h-4 w-4" />{uiText("More")}</button>

        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          {/* The way back into the tour. Always here, whether or not it has
              been seen, because "how does this work" is a question people ask
              again long after the first visit. */}
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            data-tour="tutorial"
            aria-label={uiText("Take the tutorial")}
            title={uiText("Show me how the studio works")}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--fc-border)] py-1.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-xs font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-[rgba(178,106,56,0.1)] active:scale-[0.97] max-sm:px-2.5 sm:px-3.5"
          >
            <span aria-hidden className="grid h-3.5 w-3.5 place-items-center rounded-full border border-current text-[9px] font-bold leading-none">
              ?
            </span>
            <span className="hidden sm:inline">{uiText("Tutorial")}</span>
          </button>
          {/* Ruler, Rotate, Open, Blueprint and Reset live on the model now --
              see the view tools in the viewport. They change what you see or
              put the piece back; the toolbar keeps what you do with it. */}
          <button
            type="button"
            onClick={openSaveNamePrompt}
            disabled={!designItem || isSaving || savingLocked}
            data-tour="save"
            className="btn btn-secondary btn-sm max-sm:px-2.5"
            aria-label={uiText("Save design")}
            title={templateLockNotice ? uiText(templateLockNotice) : uiText("Keep this design in My templates under a name")}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconSave aria-hidden className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{uiText("Save design")}</span>
            </span>
          </button>
          {role === "shop" ? (
            <button
              type="button"
              onClick={handlePublishTemplate}
              disabled={!designItem || isSaving || publishingLocked}
              data-tour="publish"
              className="btn btn-secondary btn-sm max-sm:px-2.5"
              aria-label={uiText("Publish as Template")}
              title={uiText("Publish this design to your shop so customers can start from it")}
            >
              <span className="inline-flex items-center gap-1.5">
                <IconTemplates aria-hidden className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{uiText("Publish as Template")}</span>
              </span>
            </button>
          ) : null}
          {/* The cart is the way out of the studio now. A commission is rarely
              one object, and sending each piece the moment it is finished gave a
              furniture shop six separate orders to reconcile by hand. */}
          {cartLines > 0 ? (
            <button
              type="button"
              onClick={() => window.location.assign("/order-summary")}
              data-tour="cart"
              className="btn btn-secondary btn-sm max-sm:px-2.5"
              aria-label={uiText("View cart ({0})", { 0: cartLines })}
              title={uiText("Review the pieces you have added and send them to a shop")}
            >
              <span className="inline-flex items-center gap-1.5">
                <IconCart aria-hidden className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{uiText("View cart")}</span> ({cartLines})
              </span>
            </button>
          ) : null}
          {/* Pushed to the far end of the row on a phone, so the one button
              that leaves the studio is never mixed in with the tools that
              stay in it. */}
          <button
            type="button"
            onClick={() => openQuantity("cart")}
            disabled={!designItem}
            data-tour="add-to-cart"
            className="btn btn-primary btn-sm"
          >
            <span className="inline-flex items-center gap-1.5">
              <IconCart aria-hidden className="h-3.5 w-3.5" />
              {editingLineId ? uiText("Update cart") : uiText("Add to cart")}
            </span>
          </button>
          {/* Straight to checkout with just this piece. Not while a cart line
              is being edited: that piece already lives in the cart. */}
          {editingLineId ? null : (
            <button
              type="button"
              onClick={() => openQuantity("buy")}
              disabled={!designItem}
              data-tour="buy-now"
              className="btn btn-sm border border-[var(--fc-accent)] bg-[var(--fc-panel)] text-[var(--fc-ink-accent)] hover:bg-[rgba(178,106,56,0.1)]"
              title={uiText("Check out this piece now, without adding it to your cart")}
            >
              <span className="inline-flex items-center gap-1.5">
                <IconArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                {uiText("Buy now")}
              </span>
            </button>
          )}
        </div>
        </>
        )}
        {ephemeralNotice ? (
          <p className="border-t border-[var(--fc-border)] px-4 py-2 text-[11px] leading-snug text-[var(--fc-muted)]">
            {uiText(ephemeralNotice)}
          </p>
        ) : null}
        {banner ? (
          <div className="border-t border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] px-4 py-2.5">
            {banner}
          </div>
        ) : null}
      </header>

      {/* Mounted only while it is running: the spotlight measures the page on
          resize and on scroll, and an idle tour doing that on every scroll of
          a 3D studio is work for nothing. */}
      {tourOpen ? (
        <StudioTour
          steps={tourSteps}
          open={tourOpen}
          onClose={() => {
            setTourOpen(false);
            // Seen means seen, finished or skipped. Somebody who skipped it
            // chose not to be shown it, and showing it again next visit reads
            // as the app not having listened.
            markStudioTourSeen();
          }}
        />
      ) : null}

      <AddToCartDialog
        open={askQuantityOpen}
        onClose={() => setAskQuantityOpen(false)}
        onConfirm={handleAddToCart}
        mode={quantityMode}
        editing={editingLineId !== null}
        pieceName={projectName.trim() || model.defaultProjectName}
        sizeLabel={
          measurement
            ? dims(measurement.overall)
            : null
        }
        lockedShopName={originShop?.name ?? null}
      />

      <AddedToCartDialog
        open={addedSummary !== null}
        pieceName={projectName.trim() || model.defaultProjectName}
        quantity={addedSummary?.quantity ?? 1}
        lineCount={addedSummary?.lines ?? 0}
        pieceCount={addedSummary?.pieces ?? 0}
        shopCount={addedSummary?.shopCount ?? 0}
        undecidedCount={addedSummary?.undecidedCount ?? 0}
        // Keep designing leaves the studio exactly as it is: the design stays on
        // screen so the next piece can be a variation of it rather than a
        // restart.
        onKeepDesigning={() => setAddedSummary(null)}
        onCheckout={() => {
          setAddedSummary(null);
          window.location.assign("/order-summary");
        }}
      />

      <ConfirmModal
        open={saveNamePromptOpen}
        title={uiText("Save this design")}
        body="It will appear under Saved designs in My templates."
        confirmLabel={isSaving ? uiText("Saving…") : uiText("Save")}
        busy={isSaving}
        reason={{
          label: "Name",
          placeholder: model.defaultProjectName,
          defaultValue: projectName.trim() || model.defaultProjectName,
          required: false,
        }}
        onConfirm={(name) => void handleSaveDesign(name)}
        onCancel={() => setSaveNamePromptOpen(false)}
      />

      {referenceImage && referenceOpen ? (
        <ImageLightbox src={referenceImage} alt={uiText("Reference image")} onClose={() => setReferenceOpen(false)} />
      ) : null}

      {notice ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] px-5 py-2 text-xs text-[var(--fc-text)]">
          <span>{uiText(notice)}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-bold" aria-label={uiText("Dismiss")}>
            <IconClose aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Pinned to the top on a phone. It used to scroll away with the page,
            so changing a part's finish further down, or in the part sheet
            that rises over the bottom 60%, showed no piece at all. 40dvh
            here and the sheet's 60dvh together fill the screen. */}
        <div
          className={
            // A viewer has no controls below the piece, so the piece has the whole screen.
            viewOnly
              ? "relative min-h-0 flex-1"
              : "relative min-h-[45vh] flex-1 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:h-[40dvh] max-lg:min-h-0 max-lg:flex-none max-lg:border-b max-lg:border-[var(--fc-border)] max-lg:bg-[var(--fc-bg)] lg:min-h-0"
          }
          data-tour="viewport"
        >
          <div ref={mountRef} className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" />

          <div ref={labelWRef} className={labelClass}>
            W {len(measurement?.overall.w ?? 0)}
          </div>
          <div ref={labelHRef} className={labelClass}>
            H {len(measurement?.overall.h ?? 0)}
          </div>
          <div ref={labelDRef} className={labelClass}>
            D {len(measurement?.overall.d ?? 0)}
          </div>

          {status !== "ready" ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--fc-bg)]/85">
              {status === "loading" ? (
                <div className="text-center">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--fc-border)] border-t-[#8b5a2b]" />
                  <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Loading chair & splitting parts…")}</p>
                </div>
              ) : (
                <div className="max-w-sm px-6 text-center">
                  <p className="font-semibold text-[#a8452c]">{uiText("Could not load the model")}</p>
                  <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText(errorMessage)}</p>
                </div>
              )}
            </div>
          ) : null}

          {referenceImage ? (
            <button
              type="button"
              onClick={() => setReferenceOpen(true)}
              aria-label={uiText("Reference image")}
              title={uiText("Reference image")}
              className="group absolute left-3 top-3 z-10 h-16 w-16 overflow-hidden rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-md transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97] lg:h-28 lg:w-28"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={referenceImage} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-center text-[10px] font-semibold text-white">
                {uiText("Reference image")}
              </span>
            </button>
          ) : null}

          {status === "ready" && hovered && hovered !== selected ? (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white lg:bottom-[6.75rem]">
              {uiText(PART_DEF_BY_ID[hovered].label)}
            </div>
          ) : null}

          {/* The verdict, beside the piece rather than inside the controls.
              The wrapper takes no pointer events so dragging the model through
              the empty space beside the card still orbits; the card itself
              takes them back, so its disclosure button works. */}
          {status === "ready" ? (
            <div
              data-tour="analysis"
              className="pointer-events-none absolute inset-y-3 right-3 z-10 hidden w-[19rem] items-start justify-end lg:flex"
            >
              <DesignAnalysisPanel
                analysis={analysis}
                placement="floating"
                collapsed={analysisCollapsed && !tourOpen}
                onToggle={toggleAnalysis}
              />
            </div>
          ) : null}

          {/* The view tools, on the view: they change only what you see, or put
              the piece back, so they belong with the model rather than in the
              toolbar of things done with the design. */}
          {status === "ready" ? (
            <>
              {/* Phone and tablet: round icons at the top right, in thumb reach.
                  Blueprint and Reset are in More there. */}
              <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => setShowRuler((value) => !value)}
                  aria-pressed={showRuler}
                  aria-label={uiText("Ruler")}
                  title={showRuler ? uiText("Hide the ruler") : uiText("Show the ruler on the model")}
                  data-tour="ruler"
                  className={viewToolClass(showRuler)}
                >
                  <IconRuler aria-hidden className="h-[18px] w-[18px]" />
                </button>
                {doorsFitted || drawersFitted ? (
                  <button
                    type="button"
                    onClick={() => setDoorsOpen((value) => !value)}
                    aria-pressed={doorsOpen}
                    aria-label={doorsOpen ? uiText("Close the {0}", { 0: openWhat }) : uiText("Open the {0}", { 0: openWhat })}
                    title={doorsOpen ? uiText("Close the {0}", { 0: openWhat }) : uiText("Open the {0}", { 0: openWhat })}
                    data-tour="open-doors"
                    className={viewToolClass(doorsOpen)}
                  >
                    <IconCabinetOpen aria-hidden className="h-[18px] w-[18px]" />
                  </button>
                ) : null}
              </div>

              {/* Keep zoom and rotation beneath every model on smaller screens. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center lg:hidden">
                {!toolsShown ? (
                  <ToolsPill onClick={toggleTools} label={uiText("Tools")} hint={uiText("Show the tools")} />
                ) : (
                <div role="toolbar" aria-label={uiText("Zoom and rotate")} className="studio-tray pointer-events-auto">
                  <TrayTool
                    label={uiText("Zoom in")}
                    hint={uiText("Look closer at the piece")}
                    tour="zoom-in"
                    onClick={() => zoomView(0.8)}
                    icon={<ZoomIn aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={uiText("Zoom out")}
                    hint={uiText("See more of the piece")}
                    tour="zoom-out"
                    onClick={() => zoomView(1.25)}
                    icon={<ZoomOut aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={autoRotate ? uiText("Stop") : uiText("Rotate")}
                    hint={autoRotate ? uiText("Stop turning the piece") : uiText("Turn it to see every side")}
                    active={autoRotate}
                    tour="rotate"
                    onClick={() => setAutoRotate((value) => !value)}
                    icon={<IconRotate aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={uiText("Hide")}
                    hint={uiText("Minimize the tools")}
                    onClick={toggleTools}
                    icon={<ChevronGlyph direction="down" />}
                  />
                </div>
                )}
              </div>

              {/* Desktop: a tool tray at the foot of the piece, like the tray on
                  a workbench. Two groups -- how you look at it, and the piece
                  itself -- with a brass inlay under whatever is switched on,
                  and each tool's key on its hover card. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-9 z-10 hidden justify-center lg:flex">
                {!toolsShown ? (
                  <ToolsPill onClick={toggleTools} label={uiText("Tools")} hint={uiText("Show the tools")} />
                ) : (
                <div role="toolbar" aria-label={uiText("View tools")} className="studio-tray pointer-events-auto">
                  <TrayTool
                    label={uiText("Zoom in")}
                    hint={uiText("Look closer at the piece")}
                    tour="zoom-in"
                    onClick={() => zoomView(0.8)}
                    icon={<ZoomIn aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={uiText("Zoom out")}
                    hint={uiText("See more of the piece")}
                    tour="zoom-out"
                    onClick={() => zoomView(1.25)}
                    icon={<ZoomOut aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={uiText("Ruler")}
                    hint={showRuler ? uiText("Hide the measurements") : uiText("Show the measurements")}
                    shortcut="R"
                    active={showRuler}
                    tour="ruler"
                    onClick={() => setShowRuler((value) => !value)}
                    icon={<IconRuler aria-hidden className="h-5 w-5" />}
                  />
                  <TrayTool
                    label={autoRotate ? uiText("Stop") : uiText("Rotate")}
                    hint={autoRotate ? uiText("Stop turning the piece") : uiText("Turn it to see every side")}
                    shortcut="T"
                    active={autoRotate}
                    tour="rotate"
                    onClick={() => setAutoRotate((value) => !value)}
                    icon={
                      <IconRotate
                        aria-hidden
                        className={`h-5 w-5 ${autoRotate ? "motion-safe:animate-spin motion-safe:[animation-duration:3.2s]" : ""}`}
                      />
                    }
                  />
                  {doorsFitted || drawersFitted ? (
                    <TrayTool
                      label={doorsOpen ? uiText("Close") : uiText("Open")}
                      hint={
                        doorsOpen ? uiText("Close the {0}", { 0: openWhat }) : doorsFitted ? uiText("Open the {0} to see the {1} compartments", { 0: openWhat, 1: compartments }) : uiText("Open the {0}", { 0: openWhat })
                      }
                      shortcut="O"
                      active={doorsOpen}
                      tour="open-doors"
                      onClick={() => setDoorsOpen((value) => !value)}
                      icon={<IconCabinetOpen aria-hidden className="h-5 w-5" />}
                    />
                  ) : null}
                  <span aria-hidden className="studio-tray-divider" />
                  <TrayTool
                    label={uiText("Blueprint")}
                    hint={uiText("The shop drawing, every part measured")}
                    shortcut="B"
                    disabled={!designItem}
                    tour="blueprint"
                    onClick={openBlueprint}
                    icon={<IconDocument aria-hidden className="h-5 w-5" />}
                  />
                  {viewOnly ? null : (
                    <TrayTool
                      label={uiText("Reset")}
                      hint={isModified ? uiText("Put every part back as it started") : uiText("Nothing changed yet")}
                      disabled={!isModified}
                      tour="reset"
                      onClick={reset}
                      icon={<IconUndo aria-hidden className="h-5 w-5" />}
                    />
                  )}
                  <span aria-hidden className="studio-tray-divider" />
                  <TrayTool
                    label={uiText("Hide")}
                    hint={uiText("Minimize the tools")}
                    onClick={toggleTools}
                    icon={<ChevronGlyph direction="down" />}
                  />
                </div>
                )}
              </div>
              <p className="pointer-events-none absolute inset-x-0 bottom-2 z-10 text-center text-[11px] text-[var(--fc-muted)]">
                <span className="rounded-full bg-[var(--fc-panel)] px-3 py-1">{uiText("Drag to rotate · Scroll or pinch to zoom")}</span>
              </p>
            </>
          ) : null}
        </div>

        {viewOnly ? null : (
        <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-[var(--fc-border)] lg:w-[350px] lg:border-l lg:border-t-0">
          {/* Desktop only: the sidebar's two tabs, pinned while the tab
              below them scrolls. */}
          <div
            role="tablist"
            aria-label={uiText("Studio panel")}
            className="sticky top-0 z-10 hidden grid-cols-2 gap-1 border-b border-[var(--fc-border)] bg-[var(--fc-panel)] p-2 lg:grid"
          >
            {([
              ["details", "Name & measurements"],
              ["parts", "Parts"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panelTab === id}
                onClick={() => setPanelTab(id)}
                className={`rounded-full px-3 py-2 text-xs font-bold transition-colors ${
                  panelTab === id
                    ? "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                    : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                }`}
              >
                {uiText(label)}
              </button>
            ))}
          </div>
          {/* Below lg the order is the order of use: the parts you came to
              change, then the facts about the piece. */}
          <section className={`border-b border-[var(--fc-border)] p-4 max-lg:order-4 ${panelTab === "details" ? "" : "lg:hidden"}`} data-tour="name">
            <label
              htmlFor="studio-project-name"
              className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]"
            >{uiText("Name")}</label>
            <input
              id="studio-project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={model.defaultProjectName}
              className="mt-2 w-full rounded-lg border border-[var(--fc-border)] bg-transparent px-3 py-2 text-base font-bold outline-none transition focus:border-[#8b5a2b]"
            />
          </section>

          {measurement ? (
            <section
              ref={measurementsRef}
              className={`border-b border-[var(--fc-border)] p-4 max-lg:order-3 max-lg:scroll-mt-[calc(40dvh+0.5rem)] ${panelTab === "details" ? "" : "lg:hidden"}`}
              data-tour="measurements"
            >
              {/* The title and the unit share a row; Edit sizes has its own,
                  full width under the sizes. Three controls on one line of a
                  350px panel pushed the button off its edge. */}
              <div className="flex items-center justify-between gap-2">
                <h2 className="shrink-0 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Measurements")}</h2>
                <div className="min-w-0">
                  <LengthUnitPicker value={unit} onChange={chooseUnit} variant="select" />
                </div>
              </div>

              {sizeEditor ? (
                // Typed sizes. Each field says the range this piece can be
                // built in; a dimension nothing on the piece changes is shown
                // but cannot be typed into.
                <form
                  className="mt-2.5 rounded-xl border border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applySizeEditor();
                  }}
                >
                  <div className="grid grid-cols-3 gap-2">
                    {(["w", "h", "d"] as const).map((axis) => (
                      <SizeField
                        key={axis}
                        axis={axis}
                        label={axis === "w" ? uiText("Width") : axis === "h" ? uiText("Height") : uiText("Depth")}
                        plan={sizeEditor.plans[axis]}
                        unitLabel={lengthUnitLabel(inputUnit)}
                        format={(cm) => formatLengthValue(cm, inputUnit)}
                        value={sizeEditor.draft[axis]}
                        autoFocus={sizeEditor.focus === axis}
                        onChange={(value) =>
                          setSizeEditor((editor) => (editor ? { ...editor, draft: { ...editor.draft, [axis]: value } } : editor))
                        }
                      />
                    ))}
                  </div>
                  {sizeEditor.plans.seat ? (
                    <div className="mt-2 w-1/2 pr-1">
                      <SizeField
                        axis="seat"
                        label={measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL}
                        plan={sizeEditor.plans.seat}
                        unitLabel={lengthUnitLabel(inputUnit)}
                        format={(cm) => formatLengthValue(cm, inputUnit)}
                        value={sizeEditor.draft.seat}
                        autoFocus={sizeEditor.focus === "seat"}
                        onChange={(value) =>
                          setSizeEditor((editor) => (editor ? { ...editor, draft: { ...editor.draft, seat: value } } : editor))
                        }
                      />
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("The parts that set each size stretch to fit, and you can fine-tune them in each part's Size tab.")}</p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setSizeEditor(null)} className="btn btn-secondary btn-sm active:scale-[0.97]">{uiText("Cancel")}</button>
                    <button type="submit" className="btn btn-primary btn-sm active:scale-[0.97]">{uiText("Apply")}</button>
                  </div>
                </form>
              ) : (
                <div className="mt-2.5 grid grid-cols-2 gap-2 text-sm">
                  {/* A piece with no seat, top or mattress has no surface height
                      to state, so the overall size takes the row rather than a
                      card reading "0 cm". The cards open the size fields. */}
                  <button
                    type="button"
                    onClick={() => openSizeEditor("w")}
                    disabled={status !== "ready"}
                    aria-label={uiText("Overall {0}. Edit", { 0: dims(measurement.overall) })}
                    className={`group relative rounded-xl border border-[var(--fc-border)] px-3 py-2 text-left transition-[border-color,background-color,transform] duration-150 hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] active:scale-[0.98] ${
                      measurement.seatHeight > 0 ? "" : "col-span-2"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Overall")}</div>
                    <div className="font-bold tabular-nums">
                      {dims(measurement.overall)}
                    </div>
                    <IconEdit aria-hidden className="absolute right-2 top-2 h-3 w-3 text-[var(--fc-muted)] opacity-60 transition-opacity group-hover:opacity-100" />
                  </button>
                  {measurement.seatHeight > 0 ? (
                    <button
                      type="button"
                      onClick={() => openSizeEditor("seat")}
                      disabled={status !== "ready"}
                      aria-label={uiText("{0} {1}. Edit", { 0: measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL, 1: len(measurement.seatHeight) })}
                      className="group relative rounded-xl border border-[var(--fc-border)] px-3 py-2 text-left transition-[border-color,background-color,transform] duration-150 hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] active:scale-[0.98]"
                    >
                      <div className="text-[10px] uppercase tracking-wider text-[var(--fc-muted)]">
                        {measurement.seatHeightLabel ?? DEFAULT_SURFACE_HEIGHT_LABEL}
                      </div>
                      <div className="font-bold tabular-nums">{len(measurement.seatHeight)}</div>
                      <IconEdit aria-hidden className="absolute right-2 top-2 h-3 w-3 text-[var(--fc-muted)] opacity-60 transition-opacity group-hover:opacity-100" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openSizeEditor("w")}
                    disabled={status !== "ready"}
                    className="col-span-2 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--fc-border)] px-3 py-2 text-xs font-semibold text-[var(--fc-ink-accent)] transition-[background-color,border-color,transform] duration-150 hover:border-[var(--fc-accent)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] active:scale-[0.98] disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
                  >
                    <IconEdit aria-hidden className="h-3.5 w-3.5" />
                    {uiText("Edit sizes")}
                  </button>
                </div>
              )}
              {sizeNotes.length > 0 ? (
                <div role="status" className="mt-2 space-y-1 rounded-lg bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--fc-text)]">
                  {sizeNotes.map((note) => (
                    <p key={note} className="m-0">{note}</p>
                  ))}
                </div>
              ) : null}
              {/* Only on a generated piece, and only for its shop. A shipped
                  model's height is a measured fact about its asset (see
                  verify-standard-sizes); a generated one's is whatever was typed
                  when it was made, and is the one number that can be wrong. A
                  customer is not offered it: the shop is the one who has the
                  real piece in front of them to measure. */}
              {model.source && role === "shop" ? (
                <div className="mt-2.5 rounded-xl border border-[var(--fc-border)] px-3 py-2">
                  <label htmlFor="studio-real-height" className="text-[11px] font-semibold">{uiText("Real height of this piece")}</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="studio-real-height"
                      type="number"
                      inputMode="decimal"
                      min={STUDIO_HEIGHT_MIN_CM}
                      max={STUDIO_HEIGHT_MAX_CM}
                      step={0.5}
                      value={heightDraft}
                      aria-invalid={!heightDraftValid}
                      aria-describedby="studio-real-height-hint"
                      onChange={(event) => {
                        const text = event.target.value;
                        setHeightDraft(text);
                        const cm = Number(text);
                        if (text.trim() && Number.isFinite(cm) && cm >= STUDIO_HEIGHT_MIN_CM && cm <= STUDIO_HEIGHT_MAX_CM) {
                          setHeightOverrideCm(cm === model.cmPerUnit ? null : cm);
                        }
                      }}
                      className="w-24 rounded-lg border border-[var(--fc-border)] bg-transparent px-2 py-1.5 text-sm tabular-nums"
                    />
                    <span className="text-xs text-[var(--fc-muted)]">{uiText("cm, floor to highest point")}</span>
                  </div>
                  <p id="studio-real-height-hint" className="mt-1 text-[10px] leading-snug text-[var(--fc-muted)]">
                    {!heightDraftValid ? uiText("Between {0} and {1} cm.", { 0: STUDIO_HEIGHT_MIN_CM, 1: STUDIO_HEIGHT_MAX_CM }) : heightOverrideCm ? uiText("Corrected from {0} cm. Every measurement above, the blueprint and the order are scaled to it. Publish again to keep it.", { 0: model.cmPerUnit }) : uiText("Every measurement is scaled from this one number. Measure the real piece as it was made, before any size changes.")}
                  </p>
                </div>
              ) : null}
              {/* No price here any more. The studio used to put a figure of
                  its own on the piece, which then followed the order all the
                  way to the shop's quote box -- so a furniture shop was quoting
                  against this app's materials table instead of its own, and
                  the customer had been shown a number nobody had agreed to.
                  The customer states a budget when they send the order, and
                  the shop quotes it. */}
              <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("You give your budget when you send this to a shop, and they quote it.")}</p>
            </section>
          ) : null}

          {/* Narrow screens only. From lg up this floats over the top-right
              of the viewport instead -- see the other instance above. Two
              placements rather than one moved by CSS, because the card has to
              be a child of the viewport to be positioned against it and a
              child of the sidebar to sit in its flow. Only one is ever
              mounted at a time. */}
          <div className="max-lg:order-5 lg:hidden" data-tour="analysis">
            <DesignAnalysisPanel analysis={analysis} collapsed={analysisCollapsed && !tourOpen} onToggle={toggleAnalysis} />
          </div>

          <section className={`border-b border-[var(--fc-border)] p-4 max-lg:order-1 ${panelTab === "parts" ? "" : "lg:hidden"}`} data-tour="parts">
            <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Parts")}</h2>
            <div className="mt-2.5 grid gap-1.5">
              {visibleParts.map((def) => {
                const isSelected = def.id === selected;
                const isHidden = hiddenParts.includes(def.id);
                return (
                  <div
                    key={def.id}
                    className={`flex items-center gap-1 rounded-xl border pr-1 transition ${
                      isSelected
                        ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)]"
                        : "border-[var(--fc-border)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(isSelected ? null : def.id)}
                      onMouseEnter={() => setHovered(def.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={`flex flex-1 items-center justify-between gap-2 rounded-l-xl px-3 py-2 [@media(pointer:coarse)]:min-h-11 text-left text-sm font-semibold transition ${
                        isSelected ? "text-[var(--fc-ink-accent)]" : "hover:bg-[rgba(178,106,56,0.06)]"
                      } ${isHidden ? "opacity-45" : ""}`}
                    >
                      <span>{uiText(def.label)}</span>
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-black/15"
                        style={{ background: colors[def.id] }}
                      />
                    </button>
                    <button
                      type="button"
                      aria-pressed={isHidden}
                      aria-label={isHidden ? uiText("Show {0}", { 0: uiText(def.label) }) : uiText("Hide {0}", { 0: uiText(def.label) })}
                      title={uiText("{0} {1} (view only)", { 0: isHidden ? uiText("Show") : uiText("Hide"), 1: uiText(def.label) })}
                      onClick={() =>
                        setHiddenParts((prev) =>
                          prev.includes(def.id) ? prev.filter((id) => id !== def.id) : [...prev, def.id]
                        )
                      }
                      className="grid shrink-0 place-items-center rounded-lg px-2 py-1.5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 text-sm leading-none text-[var(--fc-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[rgba(178,106,56,0.1)] hover:text-[var(--fc-text)] active:scale-[0.95] lg:flex lg:items-center lg:gap-1"
                    >
                      {isHidden ? <EyeOffIcon size={16} aria-hidden /> : <EyeIcon size={16} aria-hidden />}
                      <span aria-hidden className="hidden text-xs font-semibold lg:inline">{isHidden ? uiText("Show") : uiText("Hide")}</span>
                    </button>
                  </div>
                );
              })}
              {hiddenParts.length > 0 ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--fc-border)] px-3 py-2 text-[11px] text-[var(--fc-muted)]">
                  <span>
                    {hiddenBuiltCount > 0 ? uiText("{0} hidden from view — still measured, priced and built.", { 0: hiddenBuiltCount }) : uiText("{0} hidden from view.", { 0: hiddenParts.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHiddenParts([])}
                    className="shrink-0 font-semibold text-[var(--fc-ink-accent)] underline"
                  >{uiText("Show all")}</button>
                </div>
              ) : null}
              {visibleParts.length === 0 && status === "ready" ? (
                <p className="text-sm text-[var(--fc-muted)]">{uiText("No parts were recovered from the model.")}</p>
              ) : null}
            </div>
          </section>

          {selectedDef ? (
            <div className={`studio-part-sheet ${panelTab === "parts" ? "" : "lg:hidden"}`}>
              {/* The sheet's own bar, phone only: a grab handle to say the thing
                  can be dismissed, the part's name so it is clear what these
                  controls belong to, and a close that clears the selection.
                  From lg up this panel is just part of the sidebar and needs
                  none of it. */}
              <div className="sticky top-0 z-10 border-b border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 pb-2 pt-3 lg:hidden">
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-[var(--fc-border)]"
                />
                <div className="flex items-center gap-2">
                  <h2 className="flex-1 truncate text-sm font-bold">{uiText(selectedDef.label)}</h2>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label={uiText("Close {0} controls", { 0: selectedDef.label })}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--fc-muted)] transition-transform active:scale-[0.94]"
                  >
                    <IconClose aria-hidden className="h-4 w-4" />
                  </button>
                </div>

                {/* Shape is offered for every part, so the sheet always has at
                    least two panes; the third appears only when there is a
                    size to change. */}
                <div
                  className={`mt-2 grid gap-1 rounded-full bg-[rgba(178,106,56,0.10)] p-1 ${
                    selectedDef.controls.length > 0 ? "grid-cols-3" : "grid-cols-2"
                  }`}
                >
                  {(selectedDef.controls.length > 0
                    ? (["finish", "shape", "size"] as const)
                    : (["finish", "shape"] as const)
                  ).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setSheetTab(tab)}
                      aria-pressed={activeTab === tab}
                      className={`rounded-full px-3 py-2 [@media(pointer:coarse)]:min-h-11 text-xs font-bold capitalize transition-colors ${
                        activeTab === tab
                          ? "bg-[var(--fc-panel)] text-[var(--fc-ink-accent)] shadow-sm"
                          : "text-[var(--fc-muted)]"
                      }`}
                    >
                      {uiText(PART_TAB_LABEL[tab])}
                    </button>
                  ))}
                </div>
              </div>

              <section className="border-b border-[var(--fc-border)] p-4">
                {/* The sheet bar above already names the part on a phone. */}
                <h2 className="hidden text-sm font-bold lg:block">{uiText(selectedDef.label)}</h2>
                <p className="mt-1 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText(selectedDef.blurb)}</p>
                {selectedMeasure ? (
                  <p className="mt-2 text-xs font-semibold tabular-nums text-[var(--fc-ink-accent)]">
                    {dims(selectedMeasure)}
                  </p>
                ) : null}
                {/* Desktop: the same Finish / Shape / Size tabs the phone's
                    sheet has, so one of the three shows at a time instead of
                    all of them stacked. */}
                <div
                  role="tablist"
                  aria-label={uiText("{0} controls", { 0: uiText(selectedDef.label) })}
                  className={`mt-3 hidden gap-1 rounded-full bg-[rgba(178,106,56,0.10)] p-1 lg:grid ${
                    selectedDef.controls.length > 0 ? "grid-cols-3" : "grid-cols-2"
                  }`}
                >
                  {(selectedDef.controls.length > 0
                    ? (["finish", "shape", "size"] as const)
                    : (["finish", "shape"] as const)
                  ).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab}
                      onClick={() => setSheetTab(tab)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                        activeTab === tab
                          ? "bg-[var(--fc-panel)] text-[var(--fc-ink-accent)] shadow-sm"
                          : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                      }`}
                    >
                      {uiText(PART_TAB_LABEL[tab])}
                    </button>
                  ))}
                </div>
              </section>

              {/* ---- extending the top
                  First in the panel, above Finish, because it is the biggest
                  thing a customer can do to a table and the one they came for:
                  how long is it. Only on the part the leaves extend, and only
                  on a piece that has them. */}
              {showLeafControls ? (
                <section
                  className={`border-b border-[var(--fc-border)] p-4 ${
                    activeTab === "size" ? "" : "hidden"
                  }`}
                >
                  <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Extend the top")}</h2>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("Each edge of the top carries a hinged leaf. Raise the ones you need; the rest hang down against the legs.")}</p>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      { key: "leafWest" as const, label: "Left", hint: "the west edge" },
                      { key: "leafEast" as const, label: "Right", hint: "the east edge" },
                      { key: "leafNorth" as const, label: "Back", hint: "the north edge" },
                      { key: "leafSouth" as const, label: "Front", hint: "the south edge" },
                    ].map((edge) => {
                      const up = (params[edge.key] ?? 0) > 0.5;
                      return (
                        <button
                          key={edge.key}
                          type="button"
                          aria-pressed={up}
                          title={uiText("Extend {0}", { 0: edge.hint })}
                          disabled={params.leafWidth <= 0.02}
                          onClick={() =>
                            setParams((prev) => ({ ...prev, [edge.key]: up ? 0 : 1 }))
                          }
                          className={`rounded-xl border px-3 py-2.5 text-center text-xs font-bold leading-tight transition-colors disabled:opacity-40 ${
                            up
                              ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)] text-[var(--fc-ink-accent)]"
                              : "border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.06)]"
                          }`}
                        >
                          {uiText(edge.label)}
                          <span className="mt-0.5 block text-[10px] font-medium opacity-70">
                            {up ? uiText("extended") : uiText("folded")}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between">
                      <label htmlFor="leaf-width" className="text-sm font-semibold">{uiText("Leaf width")}</label>
                      <span className="text-xs tabular-nums text-[var(--fc-muted)]">
                        {params.leafWidth <= 0.02 ? uiText("none") : len(params.leafWidth * (rigRef.current?.leafReach ?? 0) * sizedModel.cmPerUnit)}
                      </span>
                    </div>
                    <input
                      id="leaf-width"
                      type="range"
                      min={0}
                      max={1.6}
                      step={0.01}
                      value={params.leafWidth}
                      onChange={(event) =>
                        setParams((prev) => ({ ...prev, leafWidth: Number(event.target.value) }))
                      }
                      className="mt-1.5 w-full accent-[#8b5a2b]"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
                      {params.leafWidth <= 0.02 ? uiText("No leaves: the table is built as a plain top with no extensions.") : uiText("How far a raised leaf reaches out past the edge. The same for all four.")}
                    </p>
                  </div>
                </section>
              ) : null}

              <section
                data-tour="finish"
                className={`border-b border-[var(--fc-border)] p-4 ${
                  activeTab === "finish" ? "" : "hidden"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Material · ")}{uiText(selectedDef.label)}</h2>
                  <button
                    type="button"
                    onClick={() => setAdvisorOpen((open) => !open)}
                    aria-expanded={advisorOpen}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                      hasAnyLifestyle(lifestyle)
                        ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                        : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                    }`}
                  >{uiText("Help me choose")}</button>
                </div>

                {/* The advisor asks about the person and the room, not about
                    the material -- a customer knows they have a dog and that
                    the piece is for their mother; they do not know that a
                    loose weave is the wrong answer to the first, or that an
                    oiled finish is a chore handed to the second. */}
                {advisorOpen ? (
                  <div className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-3">
                    <p className="text-[11px] text-[var(--fc-muted)]">{uiText("Who is this piece for?")}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {PERSON_OPTIONS.map((option) => {
                        const on = lifestyle.who === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setLifestyle((prev) => ({
                                ...prev,
                                // Pressing the one already chosen clears it,
                                // so a customer is never stuck having said
                                // something about a person they did not mean.
                                who: prev.who === option.key ? "unspecified" : option.key,
                              }))
                            }
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(option.label)}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {AGE_QUESTIONS.map((question) => {
                        const on = lifestyle.ages.includes(question.key);
                        return (
                          <button
                            key={question.key}
                            type="button"
                            title={uiText(question.hint)}
                            aria-pressed={on}
                            onClick={() =>
                              setLifestyle((prev) => ({
                                ...prev,
                                // More than one, because a piece is often for
                                // a household rather than a person: a dining
                                // chair that a child climbs and a grandparent
                                // steadies themselves on has to answer both.
                                ages: on
                                  ? prev.ages.filter((age) => age !== question.key)
                                  : [...prev.ages, question.key],
                              }))
                            }
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(question.label)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("And the room it lives in?")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {LIFESTYLE_QUESTIONS.map((question) => {
                        const on = lifestyle[question.key];
                        return (
                          <button
                            key={question.key}
                            type="button"
                            title={uiText(question.hint)}
                            aria-pressed={on}
                            onClick={() =>
                              setLifestyle((prev) => ({ ...prev, [question.key]: !prev[question.key] }))
                            }
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(question.label)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("Conditions where it will be")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {CONDITION_QUESTIONS.map((question) => {
                        const on = lifestyle[question.key];
                        return (
                          <button
                            key={question.key}
                            type="button"
                            title={uiText(question.hint)}
                            aria-pressed={on}
                            onClick={() =>
                              setLifestyle((prev) => ({ ...prev, [question.key]: !prev[question.key] }))
                            }
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(question.label)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("Budget")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {BUDGET_OPTIONS.map((option) => {
                        const on = lifestyle.budget === option.key;
                        return (
                          <button
                            key={option.key ?? "none"}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setLifestyle((prev) => ({ ...prev, budget: option.key }))}
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(option.label)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("Style")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {STYLE_OPTIONS.map((option) => {
                        const on = lifestyle.styles.includes(option.key);
                        return (
                          <button
                            key={option.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setLifestyle((prev) => ({
                                ...prev,
                                styles: on ? prev.styles.filter((style) => style !== option.key) : [...prev.styles, option.key],
                              }))
                            }
                            className={`rounded-full border px-2.5 py-1 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                              on
                                ? "border-[#8b5a2b] bg-[#b26a38] text-white"
                                : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                            }`}
                          >
                            {uiText(option.label)}
                          </button>
                        );
                      })}
                    </div>

                    {/* Said back in a sentence, so the customer can check the
                        advice is about the person they meant before trusting
                        the list under it. */}
                    {audience ? (
                      <p className="mt-2.5 text-[11px] font-semibold text-[var(--fc-ink-accent)]">{uiText(audience)}</p>
                    ) : null}
                    {!stockConfirmed ? (
                      // Advice is only ever drawn from a shop's declared stock,
                      // so with no declared stock there is nothing honest to rank.
                      <p className="mt-2 text-[11px] text-[var(--fc-muted)]">
                        {stockShop
                          ? uiText("{0} hasn't listed its materials yet, so nothing can be recommended.", { 0: stockShop.name })
                          : uiText("Choose a shop first. Recommendations come only from the materials and colors it supplies.")}
                      </p>
                    ) : hasAnyLifestyle(lifestyle) ? (
                      <>
                        <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("Only {0}'s materials and colors are recommended. The best match is marked and listed first.", { 0: stockShop?.name ?? "" })}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={applyBestMatches}
                            className="rounded-full bg-[var(--fc-btn)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-btn-fg)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97]"
                          >{uiText("Apply best matches to every part")}</button>
                          {beforeBestMatches ? (
                            <button
                              type="button"
                              onClick={undoBestMatches}
                              className="rounded-full border border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.97]"
                            >{uiText("Undo")}</button>
                          ) : null}
                        </div>
                      </>
                    ) : lifestyle.who !== "unspecified" ? (
                      <p className="mt-1 text-[11px] text-[var(--fc-muted)]">{uiText("Add an age and the list below will be ranked for them.")}</p>
                    ) : null}
                  </div>
                ) : null}

                {stockLoading ? (
                  <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("Checking the shop's materials…")}</p>
                ) : stockShop ? (
                  <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">
                    {stockShop.declared
                      ? uiText("Materials and colors from {0}.", { 0: stockShop.name })
                      : uiText("{0} hasn't listed its materials yet. You can preview finishes, but this can't be ordered until it does.", { 0: stockShop.name })}
                  </p>
                ) : isRestricted ? (
                  <p className="mt-2.5 text-[11px] text-[var(--fc-muted)]">{uiText("Only materials listed by this shop for this design are shown.")}</p>
                ) : (
                  <p className="mt-2.5 text-xs text-[var(--fc-muted)]">
                    {uiText("No shop chosen yet, so every finish is shown as a preview.")}
                    {!viewOnly ? (
                      <>
                        {" "}
                        <button type="button" onClick={() => void openStockShopPicker()} className="font-semibold text-[var(--fc-ink-accent)] underline underline-offset-2">{uiText("Choose a shop")}</button>
                      </>
                    ) : null}
                  </p>
                )}

                {/* What the part is in now, at a glance -- so the picker below
                    can show one step at a time without losing the answer. */}
                <div aria-live="polite" aria-atomic="true" className="mt-3">
                  {selectedMaterial ? (
                    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-2">
                      <MaterialSkin material={selectedMaterial} className="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Current finish")}</p>
                        <p className="truncate text-sm font-semibold text-[var(--fc-text)]">
                          {uiText(stockMaterialGroup(selectedMaterial).label)}
                          {stockColorLabel(selectedMaterial) !== stockMaterialGroup(selectedMaterial).label ? ` · ${uiText(stockColorLabel(selectedMaterial))}` : ""}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--fc-muted)]">{uiText("Select a listed material to replace this saved custom or unknown finish before ordering.")}</p>
                  )}
                  {selectedMaterial && (!selectedMaterialAvailable || colors[selectedDef.id]?.toLowerCase() !== selectedMaterial.hex.toLowerCase()) ? (
                    <p className="mt-1.5 text-xs text-[var(--fc-danger)]">{uiText("This saved material or color is not an available choice. Select a listed material before ordering.")}</p>
                  ) : null}
                </div>

                {/* Categories, then a material, then its colour -- one step at
                    a time; see material-color-picker.tsx. A part built in a
                    single category gets no category row. The dot repeats the
                    advisor's mark, so a recommendation in another category is
                    still visible from here. */}
                <MaterialColorPicker
                  key={`${selectedDef.id}:${activeCategory}`}
                  materials={(shownCategory?.families ?? []).flatMap((group) => group.items)}
                  selectedId={materialIds[selectedDef.id]}
                  selectedHex={colors[selectedDef.id]}
                  categories={materialCategories.map((group) => ({
                    id: group.category,
                    label: group.label,
                    count: group.count,
                    suits: group.families.some(({ items }) => items.some((item) => item.recommended)),
                  }))}
                  activeCategory={activeCategory}
                  onCategory={(category) => setCategoryChoice({ partId: selectedDef.id, category: category as MaterialCategoryId })}
                  onSelect={(material) => {
                    setBeforeBestMatches(null);
                    setColors((prev) => ({ ...prev, [selectedDef.id]: material.hex }));
                    setMaterialIds((prev) => ({ ...prev, [selectedDef.id]: material.id }));
                    if (!supportsVarnish(material)) setVarnishIds((prev) => ({ ...prev, [selectedDef.id]: DEFAULT_VARNISH_ID }));
                  }}
                />
                {permittedMaterials.length === 0 ? (
                  <p role="status" className="mt-3 rounded-xl border border-[var(--fc-border)] p-3 text-xs text-[var(--fc-muted)]">{uiText("This shop has no listed material for ")}{uiText(selectedDef.label.toLowerCase())}{uiText(" in this design. Ask the shop to update its materials or choose another design.")}</p>
                ) : null}

              </section>

              {/* ---- shape
                  Between finish and size on purpose. A customer picks the
                  stock first, then what the part is, then how big -- and the
                  middle question only became askable when part-shapes.ts
                  arrived. Sits above Size because a substituted shape changes
                  what the size sliders are stretching. */}
              <section
                className={`border-b border-[var(--fc-border)] p-4 ${
                  activeTab === "shape" ? "" : "hidden"
                }`}
              >
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Shape")}</h2>
                <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
                  {selectedShapes.length > 1 ? uiText("How {0} is made. Every option here is something a furniture shop can cut.", { 0: selectedDef.label.toLowerCase() }) : uiText("This part is built as drawn.")}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {selectedShapes.map((shape) => {
                    const active = shape.id === selectedShapeId;
                    return (
                      <button
                        key={shape.id}
                        type="button"
                        aria-pressed={active}
                        title={uiText(shape.blurb)}
                        onClick={() =>
                          setShapes((prev) => {
                            // The original is stored as an absence rather than
                            // as an id. Anything else would write a shape into
                            // every design the moment a part was inspected,
                            // and "shapes" in a saved record would stop meaning
                            // "the customer changed something".
                            const next = { ...prev };
                            if (shape.id === ORIGINAL_SHAPE_ID) delete next[selectedDef.id];
                            else next[selectedDef.id] = shape.id;
                            return next;
                          })
                        }
                        className={`rounded-xl border px-3 py-2.5 text-center text-xs font-bold leading-tight transition-colors ${
                          active
                            ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)] text-[var(--fc-ink-accent)]"
                            : "border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.06)]"
                        }`}
                      >
                        {uiText(shape.label)}
                      </button>
                    );
                  })}
                </div>

                {/* ---- edge radius
                    Part of the shape rather than of the size, because it is a
                    question about the same thing the buttons above answer:
                    what the part IS. It is disabled rather than hidden on a
                    shape that cannot take it, so the control does not appear
                    and vanish as the customer moves along the row -- and the
                    line underneath says which shape is refusing it, which
                    "disabled" on its own never does. */}
                <div className="mt-4 border-t border-[var(--fc-border)] pt-4">
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="edge-radius" className="text-sm font-semibold">{uiText("Edge radius")}</label>
                    <span className="text-xs tabular-nums text-[var(--fc-muted)]">
                      {selectedShape?.radiusable && selectedApertures.length === 0
                        ? `${Math.round(selectedRadius * 100)}%`
                        : "—"}
                    </span>
                  </div>
                  <input
                    id="edge-radius"
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    disabled={!selectedShape?.radiusable || selectedApertures.length > 0}
                    value={selectedRadius}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setEdgeRadii((prev) => {
                        const updated = { ...prev };
                        // Stored as an absence at zero, for the same reason
                        // the original shape is: a sharp edge is the default,
                        // not a decision worth recording.
                        if (next <= 0) delete updated[selectedDef.id];
                        else updated[selectedDef.id] = next;
                        return updated;
                      });
                    }}
                    className="mt-1.5 w-full accent-[#8b5a2b] disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
                    {selectedApertures.length > 0 ? uiText("A panel with a cutout in it is finished square. Easing the outer edge would ease the rim of the hole with it, and past a point that closes the hole over — so this stays off while there is one. Remove the cutout to get the slider back.") : selectedShape?.radiusable ? uiText("Breaks the sharp arrises off this part. Nothing at zero; a full bullnose at the top of the range.") : selectedShapeId === ORIGINAL_SHAPE_ID ? uiText("Only a substituted shape can have its edges eased — the piece as drawn is cut the way it was modelled. Pick a shape above.") : uiText("{0} is already round all the way over, so there is no arris left to break.", { 0: selectedShape?.label ?? uiText("This shape") })}
                  </p>
                </div>

                {/* ---- texture
                    What the surface is sealed with -- raw, waxed, satin or
                    gloss. With the shape, the carving and the cutouts, because
                    it is about how the part is worked, not which stock it is;
                    the Finish tab is left to the material and its colour.
                    Offered only on a catalogue finish that takes a seal. */}
                <div className="mt-4 border-t border-[var(--fc-border)] pt-4">
                  <h3 className="text-sm font-semibold">{uiText("Texture")}</h3>
                  {supportsVarnish(selectedMaterial) && selectedMaterialAvailable ? (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {VARNISHES.map((varnish) => {
                          const active =
                            (varnishIds[selectedDef.id] ?? DEFAULT_VARNISH_ID) === varnish.id;
                          return (
                            <button
                              key={varnish.id}
                              type="button"
                              title={uiText(varnish.blurb)}
                              aria-pressed={active}
                              onClick={() =>
                                setVarnishIds((prev) => ({ ...prev, [selectedDef.id]: varnish.id }))
                              }
                              className={`rounded-xl border px-2.5 py-2 text-center text-xs font-bold leading-tight transition-colors [@media(pointer:coarse)]:min-h-11 ${
                                active
                                  ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)] text-[var(--fc-ink-accent)]"
                                  : "border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.06)]"
                              }`}
                            >
                              {uiText(varnish.name)}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-[var(--fc-muted)]">
                        {uiText(varnishById(varnishIds[selectedDef.id]).blurb)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("Uses the material’s supplied finish.")}</p>
                  )}
                </div>

                {/* ---- carving
                    Under the shape and above the cutouts, which is the order
                    a maker works in: cut the part, work its face, then bore
                    it. Offered on every part and every shape, including the
                    piece as modelled -- relief is worked into a face that is
                    already there, so unlike a cutout it needs nothing of the
                    geometry underneath. */}
                <div className="mt-4 border-t border-[var(--fc-border)] pt-4">
                  <h3 className="text-sm font-semibold">{uiText("Carving")}</h3>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("Relief worked into the face of ")}{uiText(selectedDef.label.toLowerCase())}{uiText(". It follows whatever shape you pick above.")}</p>

                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    {CARVINGS.map((carving) => {
                      const active = (carvings[selectedDef.id] ?? CARVING_NONE_ID) === carving.id;
                      return (
                        <button
                          key={carving.id}
                          type="button"
                          aria-pressed={active}
                          title={uiText(carving.blurb)}
                          onClick={() =>
                            setCarvings((prev) => {
                              // Plain is stored as an absence, the same way the
                              // original shape is: "carvings" in a saved record
                              // has to mean somebody asked for one.
                              const next = { ...prev };
                              if (carving.id === CARVING_NONE_ID) delete next[selectedDef.id];
                              else next[selectedDef.id] = carving.id;
                              return next;
                            })
                          }
                          className={`rounded-xl border px-3 py-2.5 text-center text-xs font-bold leading-tight transition-colors ${
                            active
                              ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)] text-[var(--fc-ink-accent)]"
                              : "border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.06)]"
                          }`}
                        >
                          {uiText(carving.label)}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-1.5 text-[11px] leading-snug text-[var(--fc-muted)]">
                    {uiText(CARVINGS.find((entry) => entry.id === (carvings[selectedDef.id] ?? CARVING_NONE_ID))?.blurb ?? "")}
                  </p>
                </div>

                {/* ---- cutouts
                    A hole through the part, and what goes in it. Lives under
                    Shape rather than under Finish because a hole is a cut, not
                    a colour -- but the thing let INTO it is a second material,
                    which is why each hole carries its own finish here instead
                    of borrowing the part's. */}
                <div className="mt-4 border-t border-[var(--fc-border)] pt-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold">{uiText("Cutouts")}</h3>
                    {canCutHoles ? (
                      <button
                        type="button"
                        disabled={selectedApertures.length >= MAX_APERTURES}
                        onClick={() =>
                          setApertures((prev) => ({
                            ...prev,
                            [selectedDef.id]: [...(prev[selectedDef.id] ?? []), defaultAperture()],
                          }))
                        }
                        className="rounded-lg border border-[var(--fc-border)] px-2.5 py-1 text-[11px] font-bold text-[var(--fc-ink-accent)] transition-colors hover:bg-[rgba(178,106,56,0.08)] disabled:opacity-40"
                      >{uiText("+ Add a hole")}</button>
                    ) : null}
                  </div>

                  {!canCutHoles ? (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
                      {selectedShapeId === ORIGINAL_SHAPE_ID ? uiText("Pick a shape above first. A hole is cut into a shape this studio builds — the piece as drawn is the mesh it was modelled as, and cutting into that is not something a slider can do honestly.") : uiText("{0} is not a flat panel, so there is no face to cut through. Tops and shelves can take a cutout.", { 0: selectedShape?.label ?? uiText("This shape") })}
                    </p>
                  ) : selectedApertures.length === 0 ? (
                    <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("Cut a hole through ")}{uiText(selectedDef.label.toLowerCase())}{uiText(" and let another material into it — a glass round in a timber top, a stone inset, or leave it open for a planter or a cable.")}</p>
                  ) : null}

                  {canCutHoles
                    ? selectedApertures.map((hole, index) => (
                        <div
                          key={index}
                          className="mt-3 rounded-xl border border-[var(--fc-border)] p-3"
                        >
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Hole ")}{index + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => editAperture(index, null)}
                              className="text-[11px] font-semibold text-[var(--fc-danger)]"
                            >{uiText("Remove")}</button>
                          </div>

                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            {APERTURE_SHAPES.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                title={uiText(option.blurb)}
                                aria-pressed={hole.shape === option.id}
                                onClick={() => editAperture(index, { shape: option.id })}
                                className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                                  hole.shape === option.id
                                    ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.12)] text-[var(--fc-ink-accent)]"
                                    : "border-[var(--fc-border)] text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.06)]"
                                }`}
                              >
                                {uiText(option.label)}
                              </button>
                            ))}
                          </div>

                          {/* Size and position are fractions of the face, so a
                              hole keeps its proportions when the size sliders
                              move, and every combination is buildable -- the
                              geometry clamps the offsets against whatever
                              travel the current size leaves. */}
                          {[
                            { key: "size" as const, label: "Size", min: 0.08, max: 0.8, hint: "across the panel" },
                            { key: "x" as const, label: "Across", min: -1, max: 1, hint: "left to right" },
                            { key: "y" as const, label: "Along", min: -1, max: 1, hint: "front to back" },
                          ].map((control) => (
                            <div key={control.key} className="mt-2">
                              <div className="flex items-baseline justify-between">
                                <label className="text-[11px] font-semibold">{uiText(control.label)}</label>
                                <span className="text-[10px] tabular-nums text-[var(--fc-muted)]">
                                  {control.key === "size"
                                    ? `${Math.round(hole.size * 100)}%`
                                    : hole[control.key].toFixed(2)}
                                </span>
                              </div>
                              <input
                                type="range"
                                min={control.min}
                                max={control.max}
                                step={0.01}
                                value={hole[control.key]}
                                aria-label={`${uiText(control.label)} — ${uiText(control.hint)}`}
                                onChange={(event) =>
                                  editAperture(index, { [control.key]: Number(event.target.value) })
                                }
                                className="mt-1 w-full accent-[#8b5a2b]"
                              />
                            </div>
                          ))}

                          <div className="mt-2">
                            <label
                              htmlFor={`hole-fill-${index}`}
                              className="text-[11px] font-semibold"
                            >{uiText("What goes in it")}</label>
                            {/* Two steps, like the Finish panel: the kind of
                                stock, then the stock. The category is read back
                                off the fill itself rather than kept anywhere, so
                                a saved hole needs nothing new to reopen on the
                                right list. Choosing a category fills the hole
                                with its first finish, which the second list can
                                then change. */}
                            {(() => {
                              const fill = materialById(hole.fill);
                              const fillCategory = fill ? materialCategoryOf(fill) : "";
                              // The current fill is always listed, even one the
                              // shop has since stopped offering -- otherwise the
                              // selects would show a value they do not contain.
                              const choices =
                                fill && !fillMaterials.includes(fill) ? [fill, ...fillMaterials] : fillMaterials;
                              const categories = MATERIAL_CATEGORIES.filter(({ id }) =>
                                choices.some((material) => materialCategoryOf(material) === id)
                              );
                              return (
                                <div className="mt-1 flex items-center gap-1.5">
                                {fill ? <MaterialSkin material={fill} className="h-7 w-7" /> : null}
                                <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                                  <select
                                    id={`hole-fill-${index}`}
                                    aria-label={uiText("Material category")}
                                    value={fillCategory}
                                    onChange={(event) => {
                                      const first = fillMaterials.find(
                                        (material) => materialCategoryOf(material) === event.target.value
                                      );
                                      editAperture(index, { fill: first?.id ?? null });
                                    }}
                                    className="w-full rounded-lg border border-[var(--fc-border)] bg-transparent px-2 py-1.5 text-xs"
                                  >
                                    <option value="">{uiText("Nothing — leave it open")}</option>
                                    {categories.map((category) => (
                                      <option key={category.id} value={category.id}>
                                        {uiText(category.label)}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    aria-label={uiText("Material")}
                                    value={hole.fill ?? ""}
                                    disabled={!fill}
                                    onChange={(event) =>
                                      editAperture(index, { fill: event.target.value || null })
                                    }
                                    className="w-full rounded-lg border border-[var(--fc-border)] bg-transparent px-2 py-1.5 text-xs disabled:opacity-40"
                                  >
                                    {!fill ? <option value="">{uiText("Pick a category first")}</option> : null}
                                    {choices
                                      .filter((material) => fill && materialCategoryOf(material) === fillCategory)
                                      .map((material) => (
                                        <option key={material.id} value={material.id} disabled={!fillMaterials.includes(material)}>
                                          {materialLabel(material, uiText)}
                                        </option>
                                      ))}
                                  </select>
                                </div>
                                </div>
                              );
                            })()}
                            <p className="mt-1 text-[10px] leading-snug text-[var(--fc-muted)]">
                              {hole.fill ? uiText("Listed on the order as its own material, separately from the part it sits in.") : uiText("An open hole. A planter drops through one; a cable passes through one.")}
                            </p>
                          </div>
                        </div>
                      ))
                    : null}
                </div>
              </section>

              {/* A part with nothing to resize shows no panel rather than an empty
                  heading. The rattan chair's back-and-arms hoop is one piece
                  with its legs, so it has a finish to choose but no dimension
                  that can move without tearing the joint. */}
              {selectedDef.controls.length > 0 && (
              <section data-tour="size" className={`p-4 ${activeTab === "size" ? "" : "hidden"}`}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Size")}</h2>
                <div className="mt-3 grid gap-4">
                  {selectedDef.controls.map((rawControl) => {
                    // A count control is narrowed to what this piece can be
                    // built as at its current size, so the slider stops where
                    // the furniture shop does rather than accepting a number that
                    // would be quietly clamped somewhere further down.
                    const isCount = COUNT_KEYS.has(rawControl.key);
                    // Resolved unconditionally: the function hands back
                    // anything that is not a count untouched, and one type
                    // through the whole block beats narrowing a union at
                    // every use of it.
                    const control = resolveCountControl(
                      rawControl,
                      rawControl.key === "doorCount"
                        ? bayCm.width
                        : rawControl.key === "drawerCount"
                          ? drawerRunCm
                          : bayCm.height
                    );
                    const locked = control.key === "ornamentScale" && !ornamentsCarvable;
                    const value = params[control.key];
                    // Narrowing can leave the stored value outside the range --
                    // widen a two-door cabinet far enough and one leaf stops
                    // being buildable -- so the slider shows the value it will
                    // actually apply.
                    const shown = isCount ? Math.min(control.max, Math.max(control.min, Math.round(value))) : value;
                    const gapped = isCount && control.fittedMin > control.min;
                    // A real dimension where one can be measured, the raw
                    // multiplier only as a fallback: a part a control has taken
                    // out of the design has no size to report, a design saved
                    // before sizes were measured has none either, and a count or
                    // how far a leaf is raised is not a size at all.
                    const spec = RIG_PARAM_DIMENSION[control.key];
                    const size = spec ? measurement?.sizes?.[selectedDef.id]?.[spec.of] : undefined;
                    const cm =
                      spec && size
                        ? spec.axis === "max"
                          ? Math.max(size.w, size.h, size.d)
                          : size[spec.axis]
                        : null;
                    const readout = isCount
                      ? `${shown}`
                      : spec && value <= 0.02 && control.min <= 0
                        ? "Removed"
                        : cm !== null
                          ? len(cm)
                          : `${Math.round(value * 100)}%`;
                    return (
                    <div key={control.key}>
                      <div className="flex items-baseline justify-between">
                        <label htmlFor={control.key} className="text-sm font-semibold">
                          {uiText(control.label)}
                        </label>
                        <span className="text-xs tabular-nums text-[var(--fc-muted)]">{readout}</span>
                      </div>
                      <input
                        id={control.key}
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        disabled={locked || control.min === control.max}
                        value={shown}
                        onChange={(event) => {
                          const raw = Number(event.target.value);
                          const next = isCount ? snapCount(control, raw, shown) : raw;
                          setParams((prev) => ({ ...prev, [control.key]: next }));
                        }}
                        className="mt-1.5 w-full accent-[#8b5a2b] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                      <p className="mt-1 text-[11px] leading-snug text-[var(--fc-muted)]">
                        {locked ? uiText("{0} cannot be carved — it has no solid to cut into, so this piece is built without relief.", { 0: ornamentMaterial?.name ?? uiText("This finish") }) : gapped ? uiText("{0}. At this width a leaf on its own would be too wide, so it is none or {1}.", { 0: control.hint, 1: control.max }) : isCount && control.max < rawControl.max ? uiText("{0}. At this size there is room for {1}.", { 0: control.hint, 1: control.max }) : control.hint}
                      </p>
                    </div>
                    );
                  })}
                </div>
              </section>
              )}
            </div>
          ) : (
            <section className="p-4 max-lg:order-2">
              <p className="rounded-xl border border-dashed border-[var(--fc-border)] p-4 text-center text-sm text-[var(--fc-muted)]">{uiText("Select a part — on the piece or in the list above — to change its finish and size.")}</p>
            </section>
          )}

        </aside>
        )}
      </div>

      {/* Below lg: what this is, and the one action that moves it on, in the
          thumb's reach. The part sheet rises over it (z-40 over z-30) while a
          part is being changed, and it comes back when the sheet closes. */}
      {viewOnly ? null : (
      <div className="fc-bottom-action-bar fixed inset-x-0 bottom-0 z-30 border-t border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-bg)_94%,transparent)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{projectName.trim() || model.defaultProjectName}</div>
            <div className="truncate text-xs tabular-nums text-[var(--fc-muted)]">
              {measurement ? dims(measurement.overall) : uiText("Measuring…")}
            </div>
          </div>
          {cartLines > 0 ? (
            <button
              type="button"
              onClick={() => window.location.assign("/order-summary")}
              data-tour="cart"
              aria-label={uiText("View cart, {0} {1}", { 0: cartLines, 1: cartLines === 1 ? "piece" : "pieces" })}
              title={uiText("Review the pieces you have added and send them to a shop")}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.1)] active:scale-[0.95]"
            >
              <IconCart aria-hidden className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[var(--fc-btn)] px-1 text-[10px] font-bold leading-[18px] text-[var(--fc-btn-fg)] ring-2 ring-[var(--fc-bg)]">
                {cartLines > 9 ? "9+" : cartLines}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openQuantity("cart")}
            disabled={!designItem}
            data-tour="add-to-cart"
            className={`btn btn-primary shrink-0 ${editingLineId ? "px-5" : "px-3.5"}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconCart aria-hidden className="h-4 w-4" />
              {editingLineId ? uiText("Update cart") : uiText("Add to cart")}
            </span>
          </button>
          {editingLineId ? null : (
            <button
              type="button"
              onClick={() => openQuantity("buy")}
              disabled={!designItem}
              data-tour="buy-now"
              className="btn shrink-0 border border-[var(--fc-accent)] bg-[var(--fc-panel)] px-3.5 text-[var(--fc-ink-accent)]"
            >
              {uiText("Buy now")}
            </button>
          )}
        </div>
      </div>
      )}

      {/* The rest of the toolbar, named. On a phone these were round icons
          with no words -- a page, a disk, a grid -- and which did what was a
          guess until pressed. */}
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title={uiText("More")}>
        <div className="grid gap-1">
          <button
            type="button"
            disabled={!designItem}
            onClick={() => {
              setMoreOpen(false);
              openBlueprint();
            }}
            className={MORE_ROW}
          >
            <span className={MORE_ICON}>
              <IconDocument aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Blueprint")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">{uiText("The shop drawing, every part measured")}</span>
            </span>
          </button>
          <button
            type="button"
            disabled={!designItem || isSaving || savingLocked}
            onClick={() => {
              setMoreOpen(false);
              openSaveNamePrompt();
            }}
            className={MORE_ROW}
          >
            <span className={MORE_ICON}>
              <IconSave aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Save design")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">{uiText("Keep it in My templates under a name")}</span>
            </span>
          </button>
          {role === "shop" ? (
            <button
              type="button"
              disabled={!designItem || isSaving || publishingLocked}
              onClick={() => {
                setMoreOpen(false);
                handlePublishTemplate();
              }}
              className={MORE_ROW}
            >
              <span className={MORE_ICON}>
                <IconTemplates aria-hidden className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{uiText("Publish as template")}</span>
                <span className="block text-sm text-[var(--fc-muted)]">{uiText("Customers can start from it on your shop")}</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            disabled={!isModified}
            onClick={() => {
              setMoreOpen(false);
              reset();
            }}
            className={MORE_ROW}
          >
            <span className={MORE_ICON}>
              <IconUndo aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Reset")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">
                {isModified ? uiText("Put every part back to how it started") : uiText("Nothing changed yet")}
              </span>
            </span>
          </button>
          {/* Not a button: the choice is made right here, without leaving the
              sheet, and every size in the studio follows it. */}
          <div className="flex min-h-14 items-start gap-3 rounded-2xl px-2 py-2.5">
            <span className={MORE_ICON}>
              <IconRuler aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Measurement units")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">{uiText("Sizes, the ruler and the blueprint all use this")}</span>
              <span className="mt-2 block">
                <LengthUnitPicker value={unit} onChange={chooseUnit} />
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              setTourOpen(true);
            }}
            className={MORE_ROW}
          >
            <span className={MORE_ICON}>
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-current text-[11px] font-bold leading-none">
                ?
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Tutorial")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">{uiText("A short tour of the studio")}</span>
            </span>
          </button>
        </div>
      </BottomSheet>

      {/* The shared shell, so this finally gets Escape, a scroll lock and a
          close button a thumb can hit -- it had none of the three. */}
      <Modal
        open={Boolean(showBlueprint && blueprintSvg)}
        onClose={() => setShowBlueprint(false)}
        ariaLabel={uiText("Blueprint")}
        eyebrow={uiText("Shop drawing")}
        title={projectName}
        className="sm:max-w-5xl"
        bodyClassName="flex min-h-0 flex-col p-0 sm:p-0"
      >
        <div className="flex shrink-0 items-center justify-end border-b border-[var(--fc-border)] px-3 py-2">
          <LengthUnitPicker value={unit} onChange={chooseUnit} tone="sheet" />
        </div>
        <BlueprintViewer svg={blueprintSvg} label={projectName} />
      </Modal>

      <Modal
        open={shopPickerOpen}
        onClose={() => setShopPickerOpen(false)}
        ariaLabel={uiText("Choose a furniture shop")}
      >
        <h2 className="font-display text-xl font-bold tracking-[-0.02em]">{uiText("Which furniture shop should build this?")}</h2>
        <p className="mt-1 text-sm text-[var(--fc-muted)]">
          {pickerPurpose === "stock"
            ? uiText("The studio will show only the materials and colors this shop supplies.")
            : uiText("Pick one and your order carries on from here. You can change it on the review screen.")}
        </p>
        <ul className="mt-4 max-h-[50dvh] space-y-1.5 overflow-y-auto">
          {pickerShops.length === 0 ? (
            <li className="py-6 text-center text-sm text-[var(--fc-muted)]">{uiText("No approved furniture shops yet.")}</li>
          ) : (
            pickerShops.map((shop) => (
              <li key={shop.id}>
                <button
                  type="button"
                  disabled={isPickingShop}
                  onClick={() => void (pickerPurpose === "stock" ? chooseStockShop(shop.id) : handlePickShop(shop.id))}
                  className="w-full rounded-2xl border border-[var(--fc-border)] px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--fc-cane-soft)] disabled:opacity-50"
                >
                  <span className="block truncate font-semibold text-[var(--fc-text)]">{shop.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--fc-muted)]">
                    {shop.specialty} · {shop.location}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </Modal>
    </div>
  );
}
