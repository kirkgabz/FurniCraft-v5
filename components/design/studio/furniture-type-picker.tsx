"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import CommissionPath from "@/components/solihiya/commission-path";
import { APP_NAVIGATION_EVENT } from "@/components/ui/history-depth";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";
import { stepsAfter } from "@/lib/commission-path";
import {
  IconArrowLeft,
  IconBed,
  IconBookshelf,
  IconCabinet,
  IconChair,
  IconDesk,
  IconSofa,
  IconStool,
  IconTable,
  type SolihiyaIcon,
} from "@/components/solihiya/icons";
import { MaterialTagChips, MaterialTagFilter } from "@/components/design/material-tag-chips";
import { MATERIAL_TAGS, materialTagsForModel, type MaterialTagId } from "./material-tags";
import FurnitureStudio from "./furniture-studio";
import { GeneratedModelError, rebuildGeneratedModel } from "./generated-model";
import { discardStagedStudioDesign, peekStagedModel, restoreStudioDesignForReturn } from "./studio-design-state";
import {
  MODEL_CATEGORY,
  STUDIO_MODELS,
  studioModel,
  type FurnitureCategoryId,
  type StudioModel,
  type StudioModelId,
} from "./studio-models";

/**
 * The "what are we building?" step in front of the studio.
 *
 * Two ways to look at the same four pieces, because they answer different
 * questions. The grid answers "what can I make?" at a glance -- every piece on
 * screen, the buildable ones obviously apart from the ones that are not.
 * Spotlight answers "what is this one like?" -- one card at a time, large, with
 * the neighbours sitting back behind it. Neither is right for both, so the view
 * is the visitor's choice and it is remembered.
 *
 * It is deliberately honest about what exists: an entry only opens if the
 * studio has a real model behind it (see studio-models.ts). Anything else is
 * listed as unavailable rather than hidden, so the page says what is coming
 * instead of implying the shipped pieces are all there will ever be.
 *
 * The picker steps aside automatically when the visitor is not browsing but
 * resuming: opening an order or a shop template stages a design in
 * localStorage, and the existing dashboard links carry ?type=chair. In both
 * cases the studio opens directly, so no existing entry point gains a click.
 */

type FurnitureType = {
  id: string;
  name: string;
  blurb: string;
  /** Fallback art for entries with nothing to render yet. */
  icon: string;
  /**
   * A render of the actual model, baked from the shipped GLTF with the
   * studio's own lighting. An emoji is a category; this is the piece.
   */
  thumbnail?: string;
  /**
   * A photograph of the piece in a room, shown instead of the render where we
   * have one.
   *
   * It fills the frame rather than floating inside it, because a photograph is
   * a scene and a render is a cutout: the render wants air and a drop shadow
   * around it, the photograph wants edges. Entries with no photograph keep
   * their render and lose nothing.
   */
  photo?: string;
  /**
   * Where to anchor the crop of `photo`, as a CSS object-position.
   *
   * Stock photographs frame their subject wherever the photographer stood, so
   * one anchor cannot serve them all: the default sits low because most of
   * these are rooms with the furniture below the middle, and the close-up of
   * the chair needs a higher one or the crop returns its backrest alone.
   */
  photoPosition?: string;
  /** Set when a real model backs this entry; unset entries are shown greyed out. */
  modelId?: StudioModelId;
  /** Values older links already use for this type. */
  aliases?: string[];
};

type PickerView = "grid" | "spotlight";

const FURNITURE_TYPES: FurnitureType[] = [
  {
    id: "victorian-chair",
    name: STUDIO_MODELS["victorian-chair"].name,
    blurb:
      "A balloon-back side chair you can resize and refinish part by part — legs, seat, backrest and carvings — with a live ruler and a printable blueprint.",
    icon: "🪑",
    thumbnail: "/models/victorian-chair/thumbnail.png",
    modelId: "victorian-chair",
    // /customize-furniture?type=chair predates the second model and has to
    // keep landing on the chair it has always opened.
    aliases: ["chair"],
  },
  {
    id: "cushion-chair",
    name: STUDIO_MODELS["cushion-chair"].name,
    blurb:
      "A low, deep tub chair: a moulded upholstered shell with a seat pad, a back pad and a pair of arms you can resize or remove.",
    icon: "🛋️",
    thumbnail: "/models/cushion-chair/thumbnail.png",
    photo: "/models/cushion-chair/photo.jpg",
    // A close-up: anchored high, the square crop keeps the back and the seat
    // rather than the backrest and the wall behind it.
    photoPosition: "center 38%",
    modelId: "cushion-chair",
    aliases: ["cushion"],
  },
  {
    id: "rattan-chair",
    name: STUDIO_MODELS["rattan-chair"].name,
    blurb:
      "A caned lounge armchair: a bent hoop that forms the back and both arms in one piece, with woven seat and back panels you can stain apart from the frame.",
    icon: "🪑",
    thumbnail: "/models/rattan-chair/thumbnail.png",
    modelId: "rattan-chair",
    aliases: ["rattan", "rattan-sit", "armchair"],
  },
  /*
   * The Patio Armchair is withdrawn from this list and is deliberately NOT
   * deleted from STUDIO_MODELS.
   *
   * Three records already hold one: a sent order and two saved designs. The
   * model definition is what reopens them -- in the studio, in the order's
   * drawing on the shop's screen, in the preview on the order page -- so
   * removing it would not tidy anything up, it would break work somebody has
   * already done and, in the order's case, work a furniture shop has been asked to
   * build. Taking it out of the picker stops it being chosen from here on,
   * which is the part that was asked for.
   */
  {
    id: "rattan-stool",
    name: STUDIO_MODELS["rattan-stool"].name,
    blurb:
      "A caned drum stool with a buttoned pad: photoscanned rattan, the lightest piece here, and the quickest thing to restain.",
    icon: "🪑",
    thumbnail: "/models/rattan-stool/thumbnail.png",
    photo: "/models/rattan-stool/photo.jpg",
    modelId: "rattan-stool",
    aliases: ["stool", "ottoman", "pouf"],
  },
  {
    id: "cabinet",
    name: STUDIO_MODELS["cabinet"].name,
    blurb:
      "A painted aparador with narra fronts and brass pulls: two doors on a recessed plinth, a drawer bank below, shelves behind. Resize the box, thicken or remove the shelves, and refinish any panel.",
    icon: "🗄️",
    thumbnail: "/models/cabinet/thumbnail.png",
    photo: "/models/cabinet/photo.jpg",
    modelId: "cabinet",
    aliases: ["cabinet", "cupboard", "storage", "wardrobe", "aparador"],
  },
  {
    id: "table",
    name: STUDIO_MODELS["table"].name,
    blurb:
      "A six-seater in Philippine ebony with a narra panel set into its deep rim. Resize the top, change the rim depth, thin or drop the stretchers, and swap the panel for glass, cane or another timber.",
    icon: "🍽️",
    thumbnail: "/models/table/thumbnail.png",
    photo: "/models/table/photo.jpg",
    modelId: "table",
    aliases: ["table", "dining", "dining-table", "mesa", "hapag"],
  },
  {
    id: "side-table",
    name: STUDIO_MODELS["side-table"].name,
    blurb:
      "A square rattan side table with a woven top and a shelf near the floor. Raise or widen it, thicken the poles, and refinish the frame and the top panel apart.",
    icon: "🪑",
    thumbnail: "/models/side-table/preview.jpg",
    modelId: "side-table",
    aliases: ["side-table", "end-table", "nightstand", "lamp-table", "rattan-table"],
  },
  {
    id: "desk",
    name: STUDIO_MODELS["desk"].name,
    blurb:
      "An ipil writing desk with a wide narra top and two brass-pulled drawers under it. Raise it to standing height, deepen the drawer box, or take the foot rail out if you sit close.",
    icon: "🖥️",
    thumbnail: "/models/desk/thumbnail.png",
    photo: "/models/desk/photo.jpg",
    modelId: "desk",
    aliases: ["desk", "writing-desk", "study", "office"],
  },
  {
    id: "bed",
    name: STUDIO_MODELS["bed"].name,
    blurb:
      "A tanguile queen platform bed on six feet, with a charcoal upholstered headboard and a low foot rail. Size it from single to king, deepen the mattress, or take the foot rail off.",
    icon: "\u{1F6CF}\u{FE0F}",
    thumbnail: "/models/bed/thumbnail.png",
    photo: "/models/bed/photo.jpg",
    modelId: "bed",
    aliases: ["bed", "platform-bed", "queen", "king", "kama", "papag", "bedroom"],
  },
  {
    id: "bookshelf",
    name: STUDIO_MODELS["bookshelf"].name,
    blurb:
      "An open narra bookcase on a recessed toe kick. Choose how many shelves divide it -- none to six -- and they space themselves evenly as you go.",
    icon: "\u{1F4DA}",
    thumbnail: "/models/bookshelf/thumbnail.png",
    photo: "/models/bookshelf/photo.jpg",
    modelId: "bookshelf",
    aliases: ["bookshelf", "bookcase", "shelf", "shelves", "shelving", "estante"],
  },
  {
    id: "sofa",
    name: STUDIO_MODELS.sofa.name,
    blurb:
      "Two metres of narra show-wood under a dusty violet: three loose seat cushions with rolled fronts, a channel-tufted back a shade deeper, and ochre pillows in the corners.",
    icon: "\u{1F6CB}\uFE0F",
    thumbnail: "/models/sofa/thumbnail.png",
    photo: "/models/sofa/photo.jpg",
    modelId: "sofa",
    aliases: ["sofa", "couch", "settee", "three-seater", "3-seater", "lounge", "sala set"],
  },
  {
    id: "sofa-bed",
    name: STUDIO_MODELS["sofa-bed"].name,
    blurb:
      "A grey velvet two-seater that pulls out into a 146cm bed -- one whole mattress, one whole back cushion, on kamagong feet, with cream bolsters and the straps you open it by.",
    icon: "\u{1F6CF}\u{FE0F}",
    thumbnail: "/models/sofa-bed/thumbnail.png",
    modelId: "sofa-bed",
    aliases: ["sofa bed", "sofabed", "sofa-bed", "pull-out", "pullout", "convertible", "daybed", "futon", "papag", "guest bed", "loveseat"],
  },
  {
    id: "rocking-chair",
    name: STUDIO_MODELS["rocking-chair"].name,
    blurb:
      "A caned tumba-tumba on steam-bent runners: reeded espresso panels set into a narra frame, with arms you can resize or take off.",
    icon: "🪑",
    thumbnail: "/models/rocking-chair/thumbnail.png",
    modelId: "rocking-chair",
    aliases: ["rocking", "rocker", "tumba-tumba", "tumbatumba"],
  },
];

const AVAILABLE = FURNITURE_TYPES.filter((type) => type.modelId);

/**
 * The kinds of furniture, chosen before the pieces.
 *
 * Ten pieces fit on one page of cards, but they are not one list to a
 * customer: somebody furnishing a bedroom does not want to read past five
 * chairs to find the bed. So the first question is what KIND of piece, and
 * the cards that follow are only that kind.
 *
 * Kinds with nothing behind them yet are listed, not hidden -- the same rule
 * this page already keeps for pieces -- so the page says sofas and bookshelves
 * are coming instead of implying they will never exist. They cannot be opened.
 */
const CATEGORIES: Array<{ id: FurnitureCategoryId; label: string; icon: SolihiyaIcon }> = [
  { id: "chair", label: "Chairs", icon: IconChair },
  { id: "table", label: "Tables", icon: IconTable },
  { id: "sofa", label: "Sofas", icon: IconSofa },
  { id: "cabinet", label: "Cabinets", icon: IconCabinet },
  { id: "bed", label: "Beds", icon: IconBed },
  { id: "bookshelf", label: "Bookshelves", icon: IconBookshelf },
  { id: "desk", label: "Desks", icon: IconDesk },
  { id: "stool", label: "Stools", icon: IconStool },
];

function typesIn(category: FurnitureCategoryId): FurnitureType[] {
  return FURNITURE_TYPES.filter((type) => type.modelId && MODEL_CATEGORY[type.modelId] === category);
}

function categoryFromUrl(): FurnitureCategoryId | null {
  const value = new URLSearchParams(window.location.search).get("category");
  return CATEGORIES.some((kind) => kind.id === value) ? (value as FurnitureCategoryId) : null;
}

/**
 * What each buildable piece is made of, worked out from its own parts rather
 * than written onto the entry (see material-tags.ts). Once, at load: the
 * shipped models do not change while the page is open.
 */
const TAGS_BY_TYPE = new Map(
  AVAILABLE.map((type) => [type.id, materialTagsForModel(STUDIO_MODELS[type.modelId as StudioModelId])])
);


/**
 * Cards to a page in the grid view.
 *
 * Six: three across (see .ftp-grid) by two down. The number and the column
 * count are one decision, not two -- six in a four-column grid is a row and a
 * half, and three columns with five or seven leaves a ragged last row.
 *
 * Three across is a choice rather than a limit; the column is wide enough for
 * four. A small, regular block is a shape you take in at a glance and compare
 * across, which is what this page is for; four across with a ragged tail is a
 * list you scan.
 */
const PAGE_SIZE = 6;

/** How far a pointer must travel before a drag counts as a swipe, in px. */
const SWIPE_THRESHOLD = 50;

/** Remembers the chosen view between visits; a preference nobody wants to re-set. */
const VIEW_KEY = "furnicraft:picker-view";

function matchesType(value: string | null): FurnitureType | undefined {
  if (!value) return undefined;
  const wanted = value.toLowerCase();
  return AVAILABLE.find((type) => type.id === wanted || type.aliases?.includes(wanted));
}

/**
 * The card itself, identical in both views -- the layout differences are the
 * stylesheet's job, so the two views cannot drift apart in what they say.
 */
/**
 * The piece in its default design: the studio's own product shot of it,
 * exactly as it opens, captured by scripts/capture-piece-shots.mts. A card
 * shows this rather than the room photograph, because the photograph is a
 * different chair in someone else's room and the customer is choosing what
 * the studio will actually open. Re-run the script when a default changes.
 */
function previewOf(type: FurnitureType): string | null {
  return type.modelId ? `/models/${type.modelId}/preview.jpg` : null;
}

function FurnitureCard({
  type,
  onOpen,
  focusable = true,
}: {
  type: FurnitureType;
  onOpen: (modelId: StudioModelId) => void;
  /** False for the cards either side in spotlight, which are not reachable yet. */
  focusable?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const partCount = type.modelId ? STUDIO_MODELS[type.modelId].parts.length : undefined;
  const preview = previewOf(type);
  return (
    <article className={`ftp-card${type.modelId ? "" : " is-unavailable"}`}>
      <div className={`ftp-shot-frame${preview ? " has-photo has-preview" : type.photo ? " has-photo" : ""}`}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={uiText("{0} in its default design", { 0: type.name })}
            width={800}
            height={600}
            className="ftp-photo ftp-preview"
            loading="lazy"
            decoding="async"
          />
        ) : type.photo || type.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={type.photo ?? type.thumbnail}
            alt=""
            width={400}
            height={400}
            className={type.photo ? "ftp-photo" : "ftp-shot"}
            style={type.photo && type.photoPosition ? { objectPosition: type.photoPosition } : undefined}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span aria-hidden className="ftp-icon">
            {type.icon}
          </span>
        )}
      </div>
      <div className="ftp-card-body">
        <h2 className="ftp-card-title font-display">
          {uiText(type.name)}
          <span className="ftp-badge">{partCount ? uiText("{0} parts", { 0: partCount }) : uiText("Coming soon")}</span>
        </h2>
        <MaterialTagChips tags={TAGS_BY_TYPE.get(type.id) ?? []} className="mb-2.5" />
        <p className="ftp-blurb">{uiText(type.blurb)}</p>
        <button
          type="button"
          className="btn ftp-cta"
          disabled={!type.modelId}
          tabIndex={focusable ? 0 : -1}
          onClick={() => type.modelId && onOpen(type.modelId)}
        >
          {type.modelId ? uiText("Open in studio") : uiText("Not available yet")}
        </button>
      </div>
    </article>
  );
}

/**
 * One kind of furniture on the first step: one of its own pieces, its name
 * and how many pieces there are.
 *
 * The picture is the kind's first piece in its default design -- the same
 * studio product shot its card shows a step later (previewOf) -- rather than
 * a stock room photograph, which read as generated and showed furniture the
 * studio does not open. A kind with no pieces yet keeps its icon.
 */
function CategoryTile({
  kind,
  onChoose,
}: {
  kind: (typeof CATEGORIES)[number];
  onChoose: (id: FurnitureCategoryId) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const types = typesIn(kind.id);
  const count = types.length;
  const preview = types.length ? previewOf(types[0]) : null;
  const Icon = kind.icon;
  return (
    <button
      type="button"
      className="ftp-cat"
      aria-disabled={count === 0}
      aria-label={count ? uiText(count === 1 ? "{0}, {1} piece" : "{0}, {1} pieces", { 0: uiText(kind.label), 1: count }) : uiText("{0}, coming soon", { 0: uiText(kind.label) })}
      onClick={() => {
        if (count) onChoose(kind.id);
      }}
    >
      <span className={`ftp-cat-shot${preview ? " has-preview" : ""}`}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" width={800} height={600} className="ftp-cat-preview" loading="lazy" decoding="async" />
        ) : (
          <Icon aria-hidden className="ftp-cat-icon" />
        )}
      </span>
      <span className="ftp-cat-name font-display">{uiText(kind.label)}</span>
      <span className="ftp-cat-count">{count ? `${count} ${count === 1 ? "piece" : "pieces"}` : uiText("Coming soon")}</span>
    </button>
  );
}

/**
 * A staged design for a generated piece -- the one kind of model that cannot
 * simply be looked up, because it has to be rebuilt from its stored file
 * first. See generated-model.ts.
 */
type GeneratedState =
  | { status: "loading" }
  | { status: "ready"; model: StudioModel }
  | { status: "error"; message: string };

/** A design whose model id is unknown and which carries nothing to rebuild it from. */
const MISSING_MODEL_MESSAGE =
  "This design was made on a piece the studio no longer has, so it can't be reopened for editing. Its saved drawing and measurements are unaffected.";

/** Anything that failed without explaining itself -- a dropped connection, say. */
const REBUILD_FAILED_MESSAGE = "Something went wrong while opening this design. Please try again.";

export default function FurnitureTypePicker() {
  const { t: uiText } = useUiLanguage();
  const [openType, setOpenType] = useState<string | null>(null);
  // True when the studio was opened without the picker ever being shown, so
  // "Back" in the studio should leave rather than return to a choice the
  // visitor never made.
  const [skippedPicker, setSkippedPicker] = useState(false);
  const [generated, setGenerated] = useState<GeneratedState | null>(null);
  const [view, setView] = useState<PickerView>("grid");
  const [index, setIndex] = useState(0);
  const [page, setPage] = useState(0);
  /** The kind being browsed; null is the first step, choosing one. */
  const [category, setCategory] = useState<FurnitureCategoryId | null>(null);
  const [tagFilter, setTagFilter] = useState<MaterialTagId | null>(null);
  // The kind first, then the material; both views read the same list, so
  // switching view keeps the choice.
  const shownTypes = useMemo(() => {
    const inKind = category ? typesIn(category) : FURNITURE_TYPES;
    return tagFilter ? inKind.filter((type) => TAGS_BY_TYPE.get(type.id)?.includes(tagFilter)) : inKind;
  }, [category, tagFilter]);
  // Only materials some piece of this kind is made of.
  const filterTags = useMemo(() => {
    const inKind = category ? typesIn(category) : AVAILABLE;
    return MATERIAL_TAGS.map((tag) => tag.id).filter((id) =>
      inKind.some((type) => TAGS_BY_TYPE.get(type.id)?.includes(id))
    );
  }, [category]);
  const dragStart = useRef<number | null>(null);
  const gridTop = useRef<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);

  // Next keeps this route in Activity when navigating away. Its effects
  // release generated blob URLs, so the active studio must not survive with
  // that released file or consume the next template before we resolve it.
  // Reset synchronously on hide, before the preserved route can reappear.
  useLayoutEffect(() => () => {
    setOpenType(null);
    setGenerated(null);
    setSkippedPicker(false);
  }, []);

  // Runs after mount rather than during render: reading localStorage or the
  // query string while rendering would not match what the server produced.
  //
  // A staged design is resolved to its model HERE, once, and every outcome is
  // explicit. It used to go through `studioModel`, which answers an id it
  // does not know with the Victorian chair -- so a design for any piece the
  // studio could not find opened as a chair, carrying that piece's
  // measurements and finishes, with nothing on screen to say so.
  useEffect(() => {
    let cancelled = false;
    const requested = matchesType(new URLSearchParams(window.location.search).get("type"));
    if (window.location.hash === "#shape" || requested) restoreStudioDesignForReturn(requested?.modelId);
    const staged = peekStagedModel();
    if (staged) {
      setSkippedPicker(true);
      if (staged.kind === "shipped") {
        setOpenType(staged.model.id);
      } else if (staged.kind === "missing") {
        setGenerated({ status: "error", message: MISSING_MODEL_MESSAGE });
      } else {
        setGenerated({ status: "loading" });
        rebuildGeneratedModel(staged.id, staged.source).then(
          (model) => {
            // Unmounted mid-fetch: nothing will ever show this model, and its
            // blob URL would otherwise pin the whole file until the tab closes.
            if (cancelled) {
              URL.revokeObjectURL(model.url);
              return;
            }
            setGenerated({ status: "ready", model });
          },
          (error: unknown) => {
            if (cancelled) return;
            setGenerated({
              status: "error",
              message: error instanceof GeneratedModelError ? error.message : REBUILD_FAILED_MESSAGE,
            });
          }
        );
      }
    } else {
      if (requested) {
        setSkippedPicker(true);
        setOpenType(requested.id);
      } else {
        // A shared or reloaded ?category= link lands on that kind's pieces.
        setCategory(categoryFromUrl());
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Restoring the view is a separate effect from the staging check above, which
  // returns early when it opens the studio -- the preference should survive that.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "grid" || saved === "spotlight") setView(saved);
    } catch {
      // Blocked storage: the default view is fine.
    }
  }, []);

  // A rebuilt model's file is a blob URL this component made, so it is this
  // component's to release: when the studio moves on to another piece, or the
  // page goes away. Never sooner -- the studio loads from it when it mounts.
  const generatedUrl = generated?.status === "ready" ? generated.model.url : null;
  useEffect(() => {
    if (!generatedUrl) return;
    return () => URL.revokeObjectURL(generatedUrl);
  }, [generatedUrl]);

  const chooseView = useCallback((next: PickerView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not being able to remember it is not a reason to refuse the switch.
    }
  }, []);

  // Wraps, so the arrows never dead-end on a short carousel.
  const go = useCallback(
    (next: number) => {
      const total = shownTypes.length;
      setIndex(((next % total) + total) % total);
    },
    [shownTypes.length]
  );

  // The kind lives in the address, so the phone's Back button returns from a
  // kind's pieces to the kinds, and a link to "the beds" is shareable.
  const chooseCategory = useCallback((next: FurnitureCategoryId) => {
    setCategory(next);
    setTagFilter(null);
    setPage(0);
    setIndex(0);
    window.history.pushState(null, "", `${window.location.pathname}?category=${next}`);
    window.scrollTo({ top: 0 });
  }, []);

  const showAllCategories = useCallback(() => {
    setCategory(null);
    setTagFilter(null);
    setPage(0);
    setIndex(0);
    window.history.pushState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const requested = matchesType(new URLSearchParams(window.location.search).get("type"));
      setOpenType(requested?.modelId ?? null);
      if (!requested && window.location.hash !== "#shape") setGenerated(null);
      setCategory(categoryFromUrl());
      setTagFilter(null);
      setPage(0);
      setIndex(0);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener(APP_NAVIGATION_EVENT, onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(APP_NAVIGATION_EVENT, onPop);
    };
  }, []);

  const chooseTagFilter = useCallback((next: MaterialTagId | null) => {
    setTagFilter(next);
    // Back to the start: page two of the whole list need not exist in the
    // narrowed one, and neither need the slide that was showing.
    setPage(0);
    setIndex(0);
  }, []);

  // Arrow keys drive spotlight whenever focus is inside it.
  useEffect(() => {
    if (view !== "spotlight") return;
    const node = viewport.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(index + 1);
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [go, index, view]);

  if (generated?.status === "ready" && !openType) {
    return (
      <FurnitureStudio
        key={generated.model.id}
        model={generated.model}
      />
    );
  }

  if (generated && generated.status !== "ready" && !openType) {
    return (
      <main className="ftp-page">
        <div className="ftp-inner">
          <article
            className="ftp-card ftp-status"
            role={generated.status === "error" ? "alert" : "status"}
            aria-busy={generated.status === "loading"}
          >
            <div className="ftp-card-body">
              <h1 className="ftp-card-title font-display">
                {generated.status === "error" ? uiText("This design can't be opened") : uiText("Opening your piece")}
              </h1>
              <p className="ftp-blurb">
                {generated.status === "error" ? generated.message : uiText("Fetching its 3D model and matching the parts back up. This takes a few seconds.")}
              </p>
              {generated.status === "error" ? (
                <button
                  type="button"
                  className="btn ftp-cta"
                  onClick={() => {
                    // Dropped rather than left staged: otherwise a reload lands
                    // straight back on this same message.
                    discardStagedStudioDesign();
                    setGenerated(null);
                    setSkippedPicker(false);
                  }}
                >{uiText("Choose a piece instead")}</button>
              ) : (
                <span className="ftp-status-bar" aria-hidden />
              )}
            </div>
          </article>
        </div>
      </main>
    );
  }

  if (openType) {
    return (
      <FurnitureStudio
        // Keyed by model so switching pieces remounts the studio rather than
        // reusing a scene, project name and finishes built for the other one.
        key={openType}
        model={studioModel(openType)}
        onBack={skippedPicker ? undefined : () => window.history.back()}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(shownTypes.length / PAGE_SIZE));
  // Clamped rather than wrapped, unlike the spotlight arrows: a pager that
  // loops from the last page back to the first reads as a bug, because the
  // numbered pages say plainly where the ends are.
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageTypes = shownTypes.slice(pageStart, pageStart + PAGE_SIZE);

  // A page is two rows and the viewport holds about one and a half, so pressing
  // Next from the bottom of the list would otherwise leave the reader parked on
  // the new page's second row with the first scrolled off above them.
  const goToPage = (next: number) => {
    setPage(next);
    gridTop.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const active = shownTypes[Math.min(index, shownTypes.length - 1)];
  const activeCategory = CATEGORIES.find((kind) => kind.id === category) ?? null;
  const categoryCount = category ? typesIn(category).length : 0;
  const open = (modelId: StudioModelId) => {
    const query = new URLSearchParams(window.location.search);
    query.set("type", modelId);
    window.history.pushState(null, "", `${window.location.pathname}?${query}`);
    setOpenType(modelId);
  };

  return (
    <main className="ftp-page">
      <div className="ftp-inner">
        {/* Was a hardcoded `<a href="/protected">`, which returned a customer who
            had browsed in from a shop to the dashboard root instead of the shop.
            The eyebrow that sat above the heading is gone with it: the sequence it
            announced ("Step 1") is real information, so it now lives in the path,
            which can actually be navigated, rather than in a label that could not. */}
        {/* Inside a kind, a phone showed this trail's back link and "All
            furniture" stacked, two back buttons to different places. There
            the one that matters is "All furniture"; the trail returns from sm. */}
        <CommissionPath
          className={activeCategory ? "mb-4 max-sm:hidden" : "mb-4"}
          current={{ href: "/customize-furniture", label: "Pick a piece" }}
          fallback={{ href: "/protected", label: "Dashboard" }}
          upcoming={stepsAfter("Pick a piece")}
        />

        {activeCategory === null ? (
          <>
            <div className="ftp-head" ref={gridTop}>
              <div className="ftp-head-text">
                <h1 className="ftp-title font-display">{uiText("What are you building?")}</h1>
                <p className="ftp-lede">{uiText("Choose a furniture piece below to start customising.")}</p>
              </div>
            </div>
            <ul className="ftp-cat-grid">
              {CATEGORIES.map((kind) => (
                <li key={kind.id} className="flex min-w-0">
                  <CategoryTile kind={kind} onChoose={chooseCategory} />
                </li>
              ))}
            </ul>
          </>
        ) : (
        <>
        <div className="ftp-head" ref={gridTop}>
          <div className="ftp-head-text">
            <button type="button" className={`${BACK_BUTTON_CLASS} mb-3`} onClick={showAllCategories}>
              <IconArrowLeft aria-hidden className="h-4 w-4" />{uiText(" All furniture")}</button>
            <h1 className="ftp-title font-display">{uiText(activeCategory.label)}</h1>
            <p className="ftp-lede">
              {categoryCount === 1 ? uiText("One piece") : uiText("{0} pieces", { 0: categoryCount })}{uiText(" to customise — every part of the one you choose, size and finish, stays editable in the studio.")}</p>
          </div>

          {/* Segmented control: the thumb slides between the two, so the change
              reads as one control moving rather than two buttons swapping state. */}
          <div className="ftp-viewtoggle" role="tablist" aria-label={uiText("How to browse the pieces")}>
            <span aria-hidden className="ftp-viewtoggle-thumb" data-view={view} />
            <button
              type="button"
              role="tab"
              aria-selected={view === "grid"}
              className={`ftp-viewtoggle-btn${view === "grid" ? " is-active" : ""}`}
              onClick={() => chooseView("grid")}
            >
              <span aria-hidden>▦</span>{uiText(" All pieces")}</button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "spotlight"}
              className={`ftp-viewtoggle-btn${view === "spotlight" ? " is-active" : ""}`}
              onClick={() => chooseView("spotlight")}
            >
              <span aria-hidden>◧</span>{uiText(" Spotlight")}</button>
          </div>
        </div>

        <MaterialTagFilter
          tags={filterTags}
          value={tagFilter}
          onChange={chooseTagFilter}
          label={uiText("Filter pieces by material")}
          className="mb-5"
        />

        {view === "grid" ? (
          <>
            <ul className="ftp-grid">
              {pageTypes.map((type) => (
                <li key={type.id} className="ftp-grid-item">
                  <FurnitureCard type={type} onOpen={open} />
                </li>
              ))}
            </ul>

            {/* Hidden outright on a single page: a pager with nowhere to go is
                furniture, and this list is short enough that it may well end up
                with one page again. */}
            {pageCount > 1 ? (
              <>
                <nav className="ftp-pager" aria-label={uiText("Furniture type pages")}>
                  <button
                    type="button"
                    className="ftp-pager-btn"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 0}
                  >
                    <span aria-hidden>‹</span>{uiText(" Previous")}</button>

                  <div className="ftp-pager-nums">
                    {Array.from({ length: pageCount }, (_, pageIndex) => (
                      <button
                        key={pageIndex}
                        type="button"
                        className={`ftp-pager-num${pageIndex === currentPage ? " is-active" : ""}`}
                        aria-label={uiText("Page {0} of {1}", { 0: pageIndex + 1, 1: pageCount })}
                        aria-current={pageIndex === currentPage ? "page" : undefined}
                        onClick={() => goToPage(pageIndex)}
                      >
                        {pageIndex + 1}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="ftp-pager-btn"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === pageCount - 1}
                  >{uiText("Next ")}<span aria-hidden>›</span>
                  </button>
                </nav>

                {/* Which pieces are on screen, said in words: the numbered
                    buttons show where you are, not what you are looking at. */}
                <p className="ftp-count" aria-live="polite">
                  {pageStart + 1}–{pageStart + pageTypes.length}{uiText(" of ")}{shownTypes.length}{" "}{uiText("pieces")}</p>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div
              className="ftp-carousel"
              ref={viewport}
              tabIndex={0}
              role="group"
              aria-roledescription="carousel"
              aria-label={uiText("Furniture types")}
              onPointerDown={(event) => {
                dragStart.current = event.clientX;
              }}
              onPointerUp={(event) => {
                if (dragStart.current === null) return;
                const moved = event.clientX - dragStart.current;
                dragStart.current = null;
                if (moved <= -SWIPE_THRESHOLD) go(index + 1);
                else if (moved >= SWIPE_THRESHOLD) go(index - 1);
              }}
              onPointerCancel={() => {
                dragStart.current = null;
              }}
            >
              <div className="ftp-track" style={{ transform: `translate3d(-${index * 100}%, 0, 0)` }}>
                {shownTypes.map((type, slideIndex) => (
                  <div
                    key={type.id}
                    className="ftp-slide"
                    role="group"
                    aria-roledescription="slide"
                    aria-label={uiText("{0} of {1}: {2}", { 0: slideIndex + 1, 1: shownTypes.length, 2: type.name })}
                    aria-hidden={slideIndex !== index}
                  >
                    <FurnitureCard type={type} onOpen={open} focusable={slideIndex === index} />
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="ftp-arrow ftp-arrow-prev"
                aria-label={uiText("Previous furniture type")}
                onClick={() => go(index - 1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="ftp-arrow ftp-arrow-next"
                aria-label={uiText("Next furniture type")}
                onClick={() => go(index + 1)}
              >
                ›
              </button>
            </div>

            <div className="ftp-dots" role="tablist" aria-label={uiText("Choose a furniture type")}>
              {shownTypes.map((type, dotIndex) => (
                <button
                  key={type.id}
                  type="button"
                  role="tab"
                  aria-selected={dotIndex === index}
                  aria-label={uiText(type.name)}
                  className={`ftp-dot${dotIndex === index ? " is-active" : ""}`}
                  onClick={() => go(dotIndex)}
                />
              ))}
            </div>

            <p className="ftp-count" aria-live="polite">
              {Math.min(index, shownTypes.length - 1) + 1}{uiText(" of ")}{shownTypes.length} · {uiText(active.name)}
            </p>
          </>
        )}
        </>
        )}
      </div>
    </main>
  );
}
