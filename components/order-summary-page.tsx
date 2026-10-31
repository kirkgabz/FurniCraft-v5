"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import Link from "next/link";
import { designStockIssues } from "@/components/design/studio/material-availability";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { budgetMissesRange, formatRange, rangeMessage, rangesFrom, type PriceRange } from "@/lib/shops/price-range";
import CommissionPath from "@/components/solihiya/commission-path";
import { stepsAfter } from "@/lib/commission-path";
import OrderDesignPreview from "@/components/design/order-design-preview";
import ConfirmModal from "@/components/ui/confirm-modal";
import { Modal } from "@/components/ui/modal";
import { ShopLogo } from "@/components/shops/shop-logo";
import {
  SHOP_LIST_COLUMNS,
  SHOPS_PUBLIC_TABLE,
} from "@/components/shops/shop-types";
import {
  absorbLegacyPendingOrder,
  assignAllUnassigned,
  assignLineShop,
  cartPieceCount,
  clearCart,
  groupCartByShop,
  readCart,
  removeFromCart,
  setCartScope,
  updateLineQuantity,
  type CartLine,
  type ShopGroup,
} from "@/components/design/studio/design-cart";
import {
  quantityOf,
  MIN_QUANTITY,
  MAX_QUANTITY,
} from "@/components/design/studio/studio-design-state";
import { openItemInDesigner } from "@/components/design/design-state-utils";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconClose,
  IconEdit,
  IconLocation,
  IconPlus,
  IconTrash,
} from "@/components/solihiya/icons";
import { RatingLine } from "@/components/reviews/stars";
import { useOnlineUsers } from "@/lib/presence";
import { MATERIAL_CATEGORIES, materialById, materialCategoryOf } from "@/components/design/studio/materials-db";

type ReferenceImage = {
  name: string;
  dataUrl: string;
};

/**
 * A furniture shop as the picker needs it.
 *
 * Carries the cover photo as well as the name, because choosing who builds
 * your furniture off a list of bare names is a decision made on nothing. The
 * same three facts the dashboard's shop rail shows -- the photo, the tagline,
 * the town -- are the ones that make the choice, so they are the ones here.
 */
type Shop = {
  id: string;
  name: string;
  specialty: string;
  location: string;
  coverImageUrl: string | null;
  logoUrl: string | null;
  /** For the online dot: presence is keyed by the owner's user id. */
  ownerUserId: string | null;
  hours: string | null;
  /** shops.accepting_orders. A paused shop is listed but cannot be chosen. */
  acceptingOrders: boolean;
  /** What it builds in, as category names; empty means stock is unconfirmed. */
  materials: string[];
  allowedMaterials: string[] | null;
};

/**
 * A shop's allowed finishes as the categories a customer recognises ("Solid
 * wood", "Rattan & cane"), in the materials table's order. Forty finish ids
 * would be a list nobody reads; four categories say what the furniture shop does.
 */
function materialCategoriesOf(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const seen = new Set<string>();
  for (const id of ids) {
    const material = materialById(String(id));
    if (material) seen.add(materialCategoryOf(material));
  }
  return MATERIAL_CATEGORIES.filter((category) => category.id !== "other" && seen.has(category.id)).map(
    (category) => category.label
  );
}

/**
 * What the customer writes for one furniture shop's share of the cart.
 *
 * One of these per lane rather than one for the page, because each lane
 * becomes its own order: the shop reads the notes, quotes against the budget,
 * and sees the title in its queue. A single budget spread over three
 * furniture shops would be a number none of them could quote against.
 */
type LaneDraft = {
  title: string;
  budgetMin: string;
  budgetMax: string;
  notes: string;
  images: ReferenceImage[];
};

const MAX_IMAGES = 4;
const MAX_IMAGE_SIZE = 3 * 1024 * 1024;

const EMPTY_DRAFT: LaneDraft = { title: "", budgetMin: "", budgetMax: "", notes: "", images: [] };

/**
 * What to call one furniture shop's order.
 *
 * A single piece keeps its own name, which is what the customer typed and
 * what they will look for in their order list. Several get a count, because
 * naming a set after whichever piece happened to be added first would be
 * arbitrary and would hide the rest.
 */
function defaultTitle(lines: CartLine[]): string {
  if (lines.length === 0) return "Order";
  if (lines.length === 1) return lines[0].item.name || lines[0].modelName;
  return `${lines.length} pieces: ${lines.map((line) => line.modelName).join(", ")}`;
}

/**
 * What to tell someone whose order would not send.
 *
 * "Something went wrong, please try again" was what this said for every
 * failure, and it cost a month: a policy change had quietly made the insert
 * impossible for every customer, the real reason sat in the browser console
 * where nobody looks, and the advice it gave -- try again -- could never
 * work. A message has to distinguish what a retry fixes from what it cannot.
 *
 * Postgres codes rather than message text, because the text is Supabase's to
 * change. 42501 is row-level security refusing the row, which here only ever
 * means the furniture shop stopped taking orders between loading the page and
 * pressing send. 23514 is a CHECK constraint, in practice the budget range.
 * Anything else keeps its code in the line, so a shop owner reporting it
 * gives us something to search for rather than "it said something went
 * wrong".
 */
function sendFailureMessage(error: { code?: string; message?: string }): string {
  if (error.code === "42501") {
    return "One of these furniture shops has stopped taking new orders. Reload the page to see who is still open.";
  }
  if (error.code === "23514") {
    return "A budget range was not accepted. Check the figures and try again.";
  }
  if (error.code === "23505") {
    return "That order looks like it was already sent. Check your orders before sending again.";
  }
  const detail = error.code ? ` (error ${error.code})` : "";
  return `Your order could not be sent${detail}. Please try again, and tell us this if it keeps happening.`;
}

function peso(value: number): string {
  return `₱${value.toLocaleString("en-US")}`;
}

/**
 * The finishes a piece is being built in, as a short readable phrase.
 *
 * `materialNames` maps every part to its finish, and a chair whose frame and
 * seat are both narra should read "Narra", not "Narra, Narra, Narra". Two are
 * named and the rest are counted, because a row has one line to spend on this
 * and the point is recognition, not an inventory.
 *
 * Deliberately not an overall size. `dims` is per part, so any single width or
 * height for the whole piece would have to be guessed from parts that overlap
 * in space, and a made-up measurement on the order the furniture shop quotes from is
 * worse than no measurement at all. The real ones are in the full spec below.
 */
function finishesOf(line: CartLine): string {
  const names = Object.values(line.item.materialNames ?? {}).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  const unique = Array.from(new Set(names));
  if (unique.length === 0) return "";
  if (unique.length <= 2) return unique.join(", ");
  return `${unique.slice(0, 2).join(", ")} +${unique.length - 2}`;
}

export default function OrderSummaryPage() {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  /**
   * The cart, which may be bound for several furniture shops at once.
   *
   * It used to be one order to one shop, chosen here behind a "Change shop"
   * link. That made a narra dining table and a set of rattan chairs into two
   * separate trips through the studio, because the shop that mills one is not
   * the shop that weaves the other. A line now carries its own destination and
   * this page groups by it, sending one order per furniture shop.
   */
  const [lines, setLines] = useState<CartLine[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  /**
   * Whether the furniture shop query has come back yet.
   *
   * Without this the picker says "No approved shops yet" for the second or two
   * the query is in flight, which is a statement about the world made before
   * anyone has looked. An empty list and an unanswered question look the same
   * in the data and must not look the same on screen.
   */
  const [hasLoadedShops, setHasLoadedShops] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, LaneDraft>>({});
  const [laneErrors, setLaneErrors] = useState<Record<string, string>>({});
  /** Each shop's own price range (shops.price_range_min/max), where it set one. */
  const [priceRanges, setPriceRanges] = useState<Record<string, PriceRange>>({});
  /** The lane whose budget misses its shop's range, while the notice is up. */
  const [rangeNotice, setRangeNotice] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Names of the furniture shops just sent to, so the success note can list them. */
  const [justSent, setJustSent] = useState<string[] | null>(null);
  /** The line whose furniture shop is being chosen, or "all" for the bulk assign. */
  /**
   * Which picker is open: a line id, "all" for every unassigned piece, or
   * "lane:<shopId>" to move a whole furniture shop's pieces somewhere else.
   */
  const [assigning, setAssigning] = useState<string | null>(null);
  // The facts the picker compares furniture shops on, beyond the shop row itself.
  const [shopRatings, setShopRatings] = useState<Record<string, { average: number; count: number }>>({});
  const [shopPieceCounts, setShopPieceCounts] = useState<Record<string, number>>({});
  const [viewerId, setViewerId] = useState<string | null>(null);
  const onlineUserIds = useOnlineUsers(viewerId);
  /** What is typed in the picker's search box. Cleared every time it closes. */
  const [shopQuery, setShopQuery] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  /**
   * The one furniture shop whose paperwork is open, or null for all closed.
   *
   * One at a time rather than many, because the cart's whole point is that a
   * commission can span several furniture shops, and four lanes unfolded at once is
   * five screens of near-identical forms that a customer scrolls past rather
   * than reads. Collapsed, each lane states what it is and whether it is ready,
   * which is the thing being checked on this page.
   */
  const [openLaneId, setOpenLaneId] = useState<string | null>(null);
  /** The line being removed, held while the confirm dialog is up. */
  const [removingLine, setRemovingLine] = useState<CartLine | null>(null);
  /** True while the customer is being asked whether to empty the whole cart. */
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  /**
   * Opened from the studio's "Buy now" (?buy=now): this page then works on
   * that one piece alone, and the cart is left exactly as it was. Read before
   * the first paint of the lines, and the scope is put back on the way out so
   * nothing else ever reads the buy-now slot as the cart.
   */
  const [isBuyNow, setIsBuyNow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const buyNow = new URLSearchParams(window.location.search).get("buy") === "now";
    setIsBuyNow(buyNow);
    setCartScope(buyNow ? "buy-now" : "cart");
    // Folds in anything staged by the pre-cart flow, so a design left
    // mid-order by an earlier build is not stranded -- into the cart only.
    setLines(buyNow ? readCart() : absorbLegacyPendingOrder());
    return () => setCartScope("cart");
  }, []);

  // The same approved-shops view the browser and dashboard read, so a lane can
  // only be addressed to a furniture shop the customer could have picked anyway.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      // Ratings, published pieces and who is looking are read beside the
      // shops, not after them: none of them blocks the list, and a failure
      // in any one only leaves that fact off the rows.
      const [{ data }, ratingsResult, templatesResult, userResult, rangesResult] = await Promise.all([
        supabase.from(SHOPS_PUBLIC_TABLE).select(SHOP_LIST_COLUMNS),
        supabase.from("shop_ratings").select("shop_id, average_rating, review_count"),
        supabase.from("design_templates").select("shop_id").eq("is_hidden", false),
        supabase.auth.getUser(),
        // Read apart from the list so the page still loads before the
        // price-range migration (20261101100000); no ranges means no check.
        supabase.from(SHOPS_PUBLIC_TABLE).select("id, price_range_min, price_range_max"),
      ]);
      if (cancelled) return;
      setViewerId(userResult.data.user?.id ?? null);
      if (!rangesResult.error && rangesResult.data) setPriceRanges(rangesFrom(rangesResult.data));
      if (ratingsResult.data) {
        setShopRatings(
          Object.fromEntries(
            (
              ratingsResult.data as Array<{ shop_id: string; average_rating: number | string | null; review_count: number }>
            ).map((row) => [row.shop_id, { average: Number(row.average_rating ?? 0), count: row.review_count }])
          )
        );
      }
      if (templatesResult.data) {
        const counts: Record<string, number> = {};
        for (const row of templatesResult.data as Array<{ shop_id: string | null }>) {
          if (row.shop_id) counts[row.shop_id] = (counts[row.shop_id] ?? 0) + 1;
        }
        setShopPieceCounts(counts);
      }
      // Marked loaded even when the query failed. A customer staring at a
      // spinner that will never stop is worse off than one told there are no
      // furniture shops, and either way the send button already refuses to fire
      // while a piece has nowhere to go.
      setHasLoadedShops(true);
      if (!data) return;
      setShops(
        (data as unknown as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          name: (row.shop_name as string | null) || "Shop",
          specialty: (row.tagline as string | null) || (row.description as string | null) || "Furniture shop",
          location: (row.address as string | null) || "Location pending",
          coverImageUrl: (row.cover_image_url as string | null) ?? null,
          logoUrl: (row.logo_url as string | null) ?? null,
          ownerUserId: (row.user_id as string | null) ?? null,
          hours: (row.hours as string | null)?.trim() || null,
          acceptingOrders: row.accepting_orders !== false,
          materials: materialCategoriesOf(row.allowed_materials),
          allowedMaterials: Array.isArray(row.allowed_materials) ? row.allowed_materials as string[] : null,
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { groups, unassigned } = useMemo(() => groupCartByShop(lines), [lines]);

  /**
   * The lane's name from the live shop list, falling back to what the cart
   * recorded. The cart is read from localStorage before any query resolves,
   * and a lane headed "Loading…" is worse than one headed with a name that is
   * a few days stale.
   */
  const nameOf = (group: ShopGroup) =>
    shops.find((shop) => shop.id === group.shopId)?.name || group.shopName || "Shop";

  /** A furniture shop that has paused new orders since its pieces were put here. */
  const isPausedShop = (shopId: string) => shops.find((shop) => shop.id === shopId)?.acceptingOrders === false;

  const draftOf = (shopId: string): LaneDraft => drafts[shopId] ?? EMPTY_DRAFT;

  const patchDraft = (shopId: string, patch: Partial<LaneDraft>) =>
    setDrafts((current) => ({ ...current, [shopId]: { ...(current[shopId] ?? EMPTY_DRAFT), ...patch } }));

  const lanePieces = (group: ShopGroup) => cartPieceCount(group.lines);

  /**
   * Whether a lane has everything it needs to be sent.
   *
   * A lane needs a budget and confirmed stock for every piece. Title, notes
   * and reference images remain optional.
   */
  const stockIssuesFor = (group: ShopGroup) => group.lines.flatMap((line) =>
    designStockIssues(line.item, shops.find((shop) => shop.id === group.shopId)?.allowedMaterials, line.allowedMaterials)
      .map((issue) => `${line.item.name || line.modelName}: ${issue}`)
  );

  /**
   * The shop's range, when the customer's budget misses it entirely -- every
   * figure under the shop's lowest, or over its highest. A budget that reaches
   * into the range is fine: the shop quotes within the overlap. Null while the
   * budget is incomplete or the shop has set no range.
   */
  const rangeMissFor = (shopId: string): PriceRange | null => {
    const range = priceRanges[shopId];
    const draft = draftOf(shopId);
    if (!range || !draft.budgetMin || !draft.budgetMax) return null;
    const min = Number(draft.budgetMin);
    const max = Number(draft.budgetMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return budgetMissesRange(min, max, range) ? range : null;
  };

  const isLaneReady = (group: ShopGroup) => {
    const draft = draftOf(group.shopId);
    const min = Number(draft.budgetMin);
    const max = Number(draft.budgetMax);
    return Boolean(
      hasLoadedShops && stockIssuesFor(group).length === 0 && draft.budgetMin && draft.budgetMax && Number.isFinite(min) && Number.isFinite(max) && max >= min && !rangeMissFor(group.shopId)
    );
  };

  /**
   * The one line of fact a collapsed lane shows: how much, and for how much.
   *
   * Says nothing about a missing budget, because the chip beside it already
   * does; "Budget · 1 piece · no budget yet" told the customer the same thing
   * twice in one line and left less room for the part they had not been told.
   */
  const laneSummary = (group: ShopGroup) => {
    const count = lanePieces(group);
    const pieces = `${count} ${count === 1 ? "piece" : "pieces"}`;
    if (!isLaneReady(group)) return pieces;
    const draft = draftOf(group.shopId);
    return `${pieces} · ${peso(Number(draft.budgetMin))} to ${peso(Number(draft.budgetMax))}`;
  };

  const readyLanes = groups.filter((group) => isLaneReady(group));
  /** Named in the send bar, so the customer is told which lane is holding it up. */
  const firstUnreadyLane = groups.find((group) => !isLaneReady(group));

  /**
   * Opens the first lane that still needs a budget, once, when the lanes first
   * appear. Landing on a page of closed rows with no idea which to tap is worse
   * than landing with the work already in front of you; after that the customer
   * is steering and this must not fight them, which is what the ref guards.
   */
  const hasAutoOpened = useRef(false);
  useEffect(() => {
    if (hasAutoOpened.current || groups.length === 0) return;
    hasAutoOpened.current = true;
    setOpenLaneId(firstUnreadyLane?.shopId ?? null);
  }, [groups.length, firstUnreadyLane]);

  /**
   * Sends one line back to the studio to be changed.
   *
   * The line's id travels with it, so what comes back replaces this row
   * instead of arriving as a second copy beside the version being edited. A
   * locked line carries its shop along too, so the studio can say whose design
   * it is while it is being edited.
   */
  const handleEditLine = (line: CartLine) => {
    const name = line.item.name || line.modelName;
    const origin = line.shopLocked && line.shopId ? { id: line.shopId, name: line.shopName } : null;
    if (!openItemInDesigner(line.item, name, line.allowedMaterials, null, line.id, origin)) {
      setSubmitError("That design cannot be reopened in the studio.");
      return;
    }
    window.location.assign("/customize-furniture");
  };

  /**
   * The furniture shops matching what is typed, over the same three fields the
   * dashboard's shop search reads. A customer who knows they want someone in
   * Bacolod, or someone who does rattan, should not have to know the shop's
   * name to find them.
   */
  const visibleShops = useMemo(() => {
    const needle = shopQuery.trim().toLowerCase();
    const matching = needle
      ? shops.filter((shop) =>
          [shop.name, shop.specialty, shop.location, ...shop.materials].some((field) =>
            field?.toLowerCase().includes(needle)
          )
        )
      : shops;
    // Furniture shops taking orders first; a paused one stays listed, at the end.
    return [...matching].sort((a, b) => Number(b.acceptingOrders) - Number(a.acceptingOrders));
  }, [shops, shopQuery]);

  /** Closes the picker and forgets the search, so the next one opens clean. */
  const closePicker = () => {
    setAssigning(null);
    setShopQuery("");
  };

  const handleAssign = (shop: Shop) => {
    // The row is disabled too; this is the rule, the row is only its face.
    if (!shop.acceptingOrders) return;
    if (assigning === "all") setLines(assignAllUnassigned(shop.id, shop.name));
    else if (assigning?.startsWith("lane:")) {
      const from = assigning.slice("lane:".length);
      let next = lines;
      for (const line of lines.filter((candidate) => candidate.shopId === from)) {
        next = assignLineShop(line.id, shop.id, shop.name);
      }
      setLines(next);
      // The budget and notes written for that lane go with its pieces.
      setDrafts((current) => (current[shop.id] || !current[from] ? current : { ...current, [shop.id]: current[from] }));
    } else if (assigning) setLines(assignLineShop(assigning, shop.id, shop.name));
    closePicker();
  };

  const handleImageSelect = (shopId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setImageError(null);

    for (const file of files) {
      if (draftOf(shopId).images.length >= MAX_IMAGES) {
        setImageError(`You can attach up to ${MAX_IMAGES} images per furniture shop.`);
        break;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        setImageError(`${file.name} is over 3MB. Please use a smaller image.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setDrafts((current) => {
          const draft = current[shopId] ?? EMPTY_DRAFT;
          if (draft.images.length >= MAX_IMAGES) return current;
          return {
            ...current,
            [shopId]: { ...draft, images: [...draft.images, { name: file.name, dataUrl }] },
          };
        });
      };
      reader.readAsDataURL(file);
    }
  };

  /**
   * Empties the cart. Nothing has been sent, so nothing is recalled.
   *
   * This used to sit behind a button reading "Not now, keep designing", which
   * is a promise to leave things as they are and come back. Pressing it threw
   * the whole cart away without asking, and the customer arrived at the studio
   * having silently lost every piece they had designed. It is now reached only
   * through "Empty the cart", and only after confirming.
   */
  const handleDiscardPending = () => {
    clearCart();
    setLines([]);
    setDrafts({});
    setLaneErrors({});
    setImageError(null);
    setIsDiscardOpen(false);
  };

  const handleConfirmOrder = async () => {
    if (groups.length === 0 || unassigned.length > 0) return;

    // Checked here as well as by design_orders_budget_range_check, because the
    // constraint's job is to stop bad data and this one's is to tell someone
    // what to type -- and, now that there can be several, which lane it is
    // wrong in.
    const errors: Record<string, string> = {};
    for (const group of groups) {
      const draft = draftOf(group.shopId);
      const min = Number(draft.budgetMin);
      const max = Number(draft.budgetMax);
      if (!draft.budgetMin || !draft.budgetMax) {
        errors[group.shopId] = "Give a budget range so this shop knows what to quote against.";
      } else if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        errors[group.shopId] = "The higher figure needs to be the second one.";
      } else if (rangeMissFor(group.shopId)) {
        errors[group.shopId] = rangeMessage(nameOf(group), rangeMissFor(group.shopId)!);
      }
    }
    setLaneErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Opens the lane the complaint is about. An error message rendered
      // inside a collapsed lane is one nobody reads.
      setOpenLaneId(Object.keys(errors)[0]);
      const missed = groups.find((group) => rangeMissFor(group.shopId));
      if (missed) setRangeNotice(missed.shopId);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setSubmitError("You need to be signed in to send this order.");
        return;
      }

      // Do not trust the shop snapshot captured when this page or design opened.
      const { data: currentShops, error: stockError } = await supabase
        .from(SHOPS_PUBLIC_TABLE).select("id, allowed_materials").in("id", groups.map((group) => group.shopId));
      if (stockError || !currentShops) {
        setSubmitError("Could not confirm the furniture shops’ material stock. Please try again.");
        return;
      }
      // The ranges too: a shop may have changed its range since this page opened.
      const { data: currentRanges, error: rangeError } = await supabase
        .from(SHOPS_PUBLIC_TABLE).select("id, price_range_min, price_range_max").in("id", groups.map((group) => group.shopId));
      if (!rangeError && currentRanges) {
        const fresh = rangesFrom(currentRanges);
        setPriceRanges((current) => ({ ...current, ...fresh }));
        const rangeErrors: Record<string, string> = {};
        for (const group of groups) {
          const range = fresh[group.shopId];
          const draft = draftOf(group.shopId);
          if (range && budgetMissesRange(Number(draft.budgetMin), Number(draft.budgetMax), range)) {
            rangeErrors[group.shopId] = rangeMessage(nameOf(group), range);
          }
        }
        if (Object.keys(rangeErrors).length) {
          setLaneErrors(rangeErrors);
          setOpenLaneId(Object.keys(rangeErrors)[0]);
          setRangeNotice(Object.keys(rangeErrors)[0]);
          return;
        }
      }
      setShops((previous) => previous.map((shop) => {
        const current = currentShops.find((row) => row.id === shop.id);
        return current ? { ...shop, allowedMaterials: current.allowed_materials } : { ...shop, allowedMaterials: null };
      }));
      const stockErrors: Record<string, string> = {};
      for (const group of groups) {
        const stock = currentShops.find((shop) => shop.id === group.shopId)?.allowed_materials;
        const issues = group.lines.flatMap((line) => designStockIssues(line.item, stock, line.allowedMaterials));
        if (issues.length) stockErrors[group.shopId] = issues.join(" ");
      }
      if (Object.keys(stockErrors).length) {
        setLaneErrors(stockErrors);
        setOpenLaneId(Object.keys(stockErrors)[0]);
        setSubmitError("Material availability changed or is unconfirmed. Edit the affected designs below, or ask the shop to update its stock.");
        return;
      }

      // One row per furniture shop, inserted together. A multi-row insert is a
      // single statement and therefore a single transaction: either every
      // furniture shop gets its order or none does. Sending them one at a time could
      // leave a customer having commissioned the chairs but not the table,
      // with no way to tell which half went through.
      const rows = groups.map((group) => {
        const draft = draftOf(group.shopId);
        return {
          shop_id: group.shopId,
          customer_user_id: userData.user.id,
          project_name: draft.title.trim() || defaultTitle(group.lines),
          furniture_type:
            group.lines.length === 1 ? group.lines[0].modelName : `${group.lines.length} pieces`,
          budget_min: Number(draft.budgetMin),
          budget_max: Number(draft.budgetMax),
          // cad_state has always been `{ items: [...] }`. Each furniture shop
          // receives only the pieces it is actually building.
          cad_state: { items: group.lines.map((line) => line.item) },
          // The list thumbnail can only be one image, so it is this lane's
          // first piece. Every piece keeps its own drawing inside cad_state.
          preview_url: group.lines.find((line) => line.previewUrl)?.previewUrl || null,
          notes: draft.notes.trim() || null,
          reference_images: draft.images,
          status: "pending_quote",
        };
      });

      const { error } = await supabase.from("design_orders").insert(rows);

      if (error) {
        console.error("Failed to send orders:", error);
        setSubmitError(sendFailureMessage(error));
        return;
      }

      const sentTo = groups.map((group) => nameOf(group));
      clearCart();
      setJustSent(sentTo);
      notifySuccess(sentTo.length === 1 ? "Order sent" : "Orders sent");
      setLines([]);
      setDrafts({});
      setLaneErrors({});
    } finally {
      setIsSubmitting(false);
    }
  };

  const orderWord = groups.length === 1 ? "order" : "orders";
  /**
   * Every piece has a furniture shop, and every furniture shop has a budget.
   *
   * The budget half is new here. It used to be checked only on submit, which
   * worked when every lane was unfolded on the page: the error appeared under
   * the field it was about. Now that lanes collapse, an error raised on a shut
   * lane would be written somewhere nobody can see, so the button that would
   * raise it is held instead, and the bar beside it names the lane that is
   * holding things up. handleConfirmOrder keeps its own check as a backstop.
   */
  const pausedLane = groups.find((group) => isPausedShop(group.shopId)) ?? null;
  const canSend =
    groups.length > 0 && unassigned.length === 0 && readyLanes.length === groups.length && !pausedLane;

  return (
    <main className="min-h-screen bg-[var(--fc-bg)] text-[var(--fc-text)]">
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <CommissionPath
            current={{ href: "/order-summary", label: "Review" }}
            fallback={{ href: "/customize-furniture", label: "Pick a piece" }}
            upcoming={stepsAfter("Review")}
          />
        </div>

        {/* Only over a cart with something in it. Over the empty state it
            told the customer to check over and open furniture shops that were not
            there, above a box saying there was nothing to review. */}
        {lines.length > 0 ? (
          <div className="mb-7">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >{isBuyNow ? uiText("Buy now") : uiText("Your cart")}</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">{uiText("Check it over before it goes")}</h1>
            {isBuyNow ? (
              <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Checking out this one piece straight from the studio. Your cart is not changed.")}</p>
            ) : null}
          </div>
        ) : null}

        {justSent ? (
          <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[rgba(5,150,105,0.35)] bg-[rgba(5,150,105,0.1)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="m-0 text-xl font-semibold text-[var(--fc-text)]">
                {justSent.length === 1 ? uiText("Order sent to {0}", { 0: justSent[0] }) : uiText("{0} orders sent", { 0: justSent.length })}
              </h2>
              <p className="mt-1.5 text-sm text-[var(--fc-muted)]">
                {justSent.length === 1 ? uiText("The shop will review your design and reach out about next steps.") : uiText("{0} each received their own order, and will quote separately.", { 0: justSent.join(", ") })}
              </p>
            </div>
            <Link href="/protected" className="btn btn-primary btn-sm shrink-0">{uiText("Go to my orders")}</Link>
          </section>
        ) : null}

        {lines.length > 0 ? (
          /* Two columns from lg, the way the design file lays this page out:
             the pieces and the brief you write for them on the left, a summary
             that stays put on the right. Below lg it is one column and the
             summary's job is done by the sticky bar under the thumb. */
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
            {/* ------------------------------------------- not yet assigned */}
            {unassigned.length > 0 ? (
              <section className="mb-5 rounded-2xl border border-dashed border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.05)] p-5 sm:p-6">
                <h2 className="font-display text-lg font-bold text-[var(--fc-text)]">{uiText("Which furniture shop builds ")}{unassigned.length === 1 ? uiText("this?") : uiText("these?")}
                </h2>
                <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Pieces going to different furniture shops become separate orders, each quoted and paid on its own.")}</p>
                {unassigned.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setAssigning("all")}
                    className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-[var(--fc-ink-accent)] px-4 text-sm font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98]"
                  >{uiText("Send all ")}{unassigned.length}{uiText(" to one furniture shop")}</button>
                ) : null}

                {/* minmax(0, 1fr), not the default auto column: an auto
                    column grows to the row's longest unbroken line (the
                    finish description), so on a 375px phone the card ran
                    to 711px and pushed Choose a furniture shop, Edit and Remove
                    off the screen instead of truncating the text. */}
                <ul className="mt-4 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
                  {unassigned.map((line) => (
                    <li
                      key={line.id}
                      className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3"
                    >
                      <LineRow
                        line={line}
                        onQuantity={(next) => setLines(updateLineQuantity(line.id, next))}
                        onEdit={() => handleEditLine(line)}
                        onRemove={() => setRemovingLine(line)}
                      />
                      <button
                        type="button"
                        onClick={() => setAssigning(line.id)}
                        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-[var(--fc-btn)] px-4 text-sm font-bold text-[var(--fc-btn-fg)] transition-transform duration-150 active:scale-[0.98]"
                      >{uiText("Choose a furniture shop")}</button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* ------------------------------------------- one lane per shop */}
            {groups.map((group) => {
              const draft = draftOf(group.shopId);
              const shopName = nameOf(group);
              const error = laneErrors[group.shopId];
              const isOpen = openLaneId === group.shopId;
              const ready = isLaneReady(group);
              const logo = shops.find((shop) => shop.id === group.shopId)?.logoUrl ?? null;
              const panelId = `lane-panel-${group.shopId}`;

              return (
                <section
                  key={group.shopId}
                  className={`mb-3 overflow-hidden rounded-2xl border bg-[var(--fc-panel)] transition-colors duration-150 ${
                    isOpen ? "border-[var(--fc-ink-accent)]" : "border-[var(--fc-border)]"
                  }`}
                >
                  {/* The collapsed row is the whole lane when it is closed, so
                      it has to say everything the customer needs to decide
                      whether to open it: whose it is, how much is in it, what
                      they are prepared to spend, and whether it can be sent. */}
                  <h2 className="m-0">
                    <button
                      type="button"
                      onClick={() => setOpenLaneId(isOpen ? null : group.shopId)}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      className="flex w-full items-center gap-3 p-3.5 text-left transition-[background-color] duration-150 hover:bg-[var(--fc-cane-soft)] sm:p-4"
                    >
                      <ShopLogo logoUrl={logo} name={shopName} size={44} />

                      {/* The status chip sits on the second line beside the
                          summary, not up on the name's line. Sharing that line
                          left the name about 150px on a 375px phone, which
                          clipped "Mark Furniture Shop" to "Mark Furniture ...",
                          and the name is the one thing the row exists to say. */}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-base font-bold text-[var(--fc-text)]">
                          {shopName}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          {isPausedShop(group.shopId) ? (
                            <span className="shrink-0 rounded-full border border-fc-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fc-danger">{uiText("Paused")}</span>
                          ) : ready ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-fc-online px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fc-online">
                              <IconCheck aria-hidden className="h-2.5 w-2.5" />{uiText("Ready")}</span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-[var(--fc-ink-accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--fc-ink-accent)]">
                              {hasLoadedShops && stockIssuesFor(group).length ? uiText("Materials") : uiText("Budget")}
                            </span>
                          )}
                          <span className="truncate text-sm tabular-nums text-[var(--fc-muted)]">
                            {laneSummary(group)}
                          </span>
                        </span>
                      </span>

                      <IconChevronDown
                        aria-hidden
                        className={`h-4 w-4 shrink-0 text-[var(--fc-muted)] transition-transform duration-200 ease-fc ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </h2>

                  {/* Said on the lane, open or shut: these pieces cannot go
                      where they are addressed, and one button moves them all. */}
                  {isPausedShop(group.shopId) ? (
                    <div
                      role="alert"
                      className="mx-3.5 mb-3.5 rounded-xl border border-fc-danger/40 bg-[color-mix(in_srgb,var(--fc-danger)_6%,transparent)] p-3 sm:mx-4"
                    >
                      <p className="m-0 text-sm font-semibold text-[var(--fc-text)]">
                        {shopName}{uiText(" isn't taking new orders right now.")}</p>
                      <p className="m-0 mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("Move ")}{lanePieces(group) === 1 ? uiText("this piece") : uiText("these pieces")}{uiText(" to another furniture shop to send. Your budget and notes go with ")}{lanePieces(group) === 1 ? uiText("it") : uiText("them")}.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAssigning(`lane:${group.shopId}`)}
                        className="btn btn-secondary btn-sm mt-2.5 active:scale-[0.97]"
                      >{uiText("Choose another furniture shop")}</button>
                    </div>
                  ) : null}

                  {hasLoadedShops && stockIssuesFor(group).length ? (
                    <div role="status" className="border-t border-[var(--fc-border)] p-4 text-sm text-[var(--fc-danger)]">
                      <p className="font-semibold">{uiText("Materials need confirmation")}</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4">{stockIssuesFor(group).map((issue, index) => <li key={index}>{uiText(issue)}</li>)}</ul>
                      <div className="mt-2 flex flex-wrap gap-2">{group.lines.map((line) => <button key={line.id} type="button" className="btn btn-sm" onClick={() => handleEditLine(line)}>{uiText("Edit ")}{line.item.name || line.modelName}</button>)}</div>
                    </div>
                  ) : null}

                  {/* Unmounted rather than hidden when closed. Three shut lanes
                      would otherwise each keep a full OrderDesignPreview and
                      four form controls alive for nothing. */}
                  {isOpen ? (
                    <div id={panelId} className="border-t border-[var(--fc-border)]">
                      <ul className="grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-4 pb-0 sm:p-5 sm:pb-0">
                        {group.lines.map((line) => (
                          <li key={line.id} className="rounded-2xl border border-[var(--fc-border)] p-3">
                            <LineRow
                              line={line}
                              onQuantity={(next) => setLines(updateLineQuantity(line.id, next))}
                              onEdit={() => handleEditLine(line)}
                              onRemove={() => setRemovingLine(line)}
                            />
                            <div className="mt-2.5">
                              {line.shopLocked ? (
                                /* Said plainly rather than shown as a disabled
                                   dropdown. A control that looks available and
                                   does nothing explains less than a sentence
                                   does. */
                                <p className="m-0 text-xs text-[var(--fc-muted)]">
                                  {shopName}{uiText(" designed this, so they build it.")}</p>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setAssigning(line.id)}
                                  className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--fc-border)] px-4 text-xs font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98]"
                                >{uiText("Move to another furniture shop")}</button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {/* One region, not four stacked panels. The fields are
                          separated by space and by their own labels, which is
                          what a form is; boxing each of them in an identical
                          tinted card made four equal-weight objects out of one
                          question and three optional extras. */}
                      <div className="grid gap-6 p-4 sm:p-5">
                        <div>
                          <label
                            className="block text-sm font-semibold text-[var(--fc-text)]"
                            htmlFor={`title-${group.shopId}`}
                          >{uiText("What to call this order")}</label>
                          <input
                            id={`title-${group.shopId}`}
                            value={draft.title}
                            onChange={(event) => patchDraft(group.shopId, { title: event.target.value })}
                            placeholder={defaultTitle(group.lines)}
                            className="mt-1.5 min-h-[44px] w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 text-sm text-[var(--fc-text)] outline-none transition-colors duration-150 placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)]"
                          />
                        </div>

                        {/* A range, because that is how a budget is actually
                            held, and it leaves the shop room to come in under
                            it or to say the piece cannot be built for that. */}
                        <fieldset className="m-0 border-0 p-0">
                          <legend className="p-0 text-sm font-semibold text-[var(--fc-text)]">{uiText("Your budget for ")}{shopName}
                          </legend>
                          <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("What you are hoping to spend with this furniture shop. They quote against it.")}</p>
                          {priceRanges[group.shopId] ? (
                            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--fc-ink-accent)]">
                              {uiText("{0} builds for {1}", { 0: shopName, 1: formatRange(priceRanges[group.shopId]) })}
                            </p>
                          ) : null}
                          <div className="mt-2.5 grid grid-cols-2 gap-3">
                            {/* Labelled above rather than inside. A placeholder
                                reading "From" is a label that deletes itself
                                the moment the field is used, leaving two
                                identical boxes of digits. */}
                            <div>
                              <label
                                htmlFor={`budget-min-${group.shopId}`}
                                className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]"
                              >{uiText("Lowest")}</label>
                              <div className="mt-1.5 flex min-h-[44px] items-stretch gap-1.5 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 focus-within:border-[var(--fc-accent)]">
                                <span aria-hidden className="self-center text-sm text-[var(--fc-muted)]">
                                  ₱
                                  </span>
                                <input
                                  id={`budget-min-${group.shopId}`}
                                  value={draft.budgetMin}
                                  onChange={(event) =>
                                    patchDraft(group.shopId, {
                                      budgetMin: event.target.value.replace(/[^\d]/g, ""),
                                    })
                                  }
                                  onBlur={(event) => {
                                    // Not while moving between Lowest and Highest: only once they leave the budget.
                                    if ((event.relatedTarget as HTMLElement | null)?.id?.startsWith(`budget-`)) return;
                                    if (rangeMissFor(group.shopId)) setRangeNotice(group.shopId);
                                  }}
                                  inputMode="numeric"
                                  className="w-full min-w-0 bg-transparent text-sm tabular-nums text-[var(--fc-text)] outline-none"
                                />
                              </div>
                            </div>
                            <div>
                              <label
                                htmlFor={`budget-max-${group.shopId}`}
                                className="block text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]"
                              >{uiText("Highest")}</label>
                              <div className="mt-1.5 flex min-h-[44px] items-stretch gap-1.5 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 focus-within:border-[var(--fc-accent)]">
                                <span aria-hidden className="self-center text-sm text-[var(--fc-muted)]">
                                  ₱
                                  </span>
                                <input
                                  id={`budget-max-${group.shopId}`}
                                  value={draft.budgetMax}
                                  onChange={(event) =>
                                    patchDraft(group.shopId, {
                                      budgetMax: event.target.value.replace(/[^\d]/g, ""),
                                    })
                                  }
                                  onBlur={(event) => {
                                    // Not while moving between Lowest and Highest: only once they leave the budget.
                                    if ((event.relatedTarget as HTMLElement | null)?.id?.startsWith(`budget-`)) return;
                                    if (rangeMissFor(group.shopId)) setRangeNotice(group.shopId);
                                  }}
                                  inputMode="numeric"
                                  className="w-full min-w-0 bg-transparent text-sm tabular-nums text-[var(--fc-text)] outline-none"
                                />
                              </div>
                            </div>
                          </div>
                          {/* Sets the expectation before the quote arrives: a range is
                              a guide, and material prices move from day to day. */}
                          <p className="mt-2.5 rounded-xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--fc-muted)]">
                            {uiText("Your budget is a guide, not a fixed price. The shop's quote may come in above or below it, because the prices of materials change from day to day. The price you pay is the one in the quote you confirm.")}
                          </p>
                          {rangeMissFor(group.shopId) ? (
                            <p role="alert" className="mt-2 rounded-xl border border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-3 py-2 text-sm font-semibold text-fc-danger">
                              {uiText("Your budget doesn't match {0}'s price range of {1}. Adjust your budget range so it reaches into it.", {
                                0: shopName,
                                1: formatRange(rangeMissFor(group.shopId)!),
                              })}
                            </p>
                          ) : error ? (
                            <p className="mt-2 text-sm font-semibold text-fc-danger">{uiText(error)}</p>
                          ) : null}
                        </fieldset>

                        <div>
                          <label
                            className="block text-sm font-semibold text-[var(--fc-text)]"
                            htmlFor={`notes-${group.shopId}`}
                          >{uiText("Notes for ")}{shopName}
                          </label>
                          <textarea
                            id={`notes-${group.shopId}`}
                            value={draft.notes}
                            onChange={(event) => patchDraft(group.shopId, { notes: event.target.value })}
                            placeholder={uiText("Anything this shop should know: preferred finish, timeline, delivery details.")}
                            rows={3}
                            className="mt-1.5 w-full resize-y rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2.5 text-sm text-[var(--fc-text)] outline-none transition-colors duration-150 placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)]"
                          />
                        </div>

                        <div>
                          <p className="m-0 text-sm font-semibold text-[var(--fc-text)]">{uiText("Reference images")}</p>
                          <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Photographs of a piece you like, a room it has to sit in, a finish you want matched. Up to ")}{MAX_IMAGES}.
                          </p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-3">
                            {draft.images.map((image, index) => (
                              <div key={`${image.name}-${index}`} className="relative h-[76px] w-[76px]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={image.dataUrl}
                                  alt={image.name}
                                  className="h-full w-full rounded-xl border border-[var(--fc-border)] object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchDraft(group.shopId, {
                                      images: draft.images.filter((_, i) => i !== index),
                                    })
                                  }
                                  aria-label={uiText("Remove {0}", { 0: image.name })}
                                  className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border-2 border-[var(--fc-panel)] bg-[var(--fc-ink-accent)] text-white transition-transform duration-150 active:scale-[0.9] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
                                >
                                  <IconClose aria-hidden className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                            {draft.images.length < MAX_IMAGES ? (
                              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--fc-ink-accent)] px-4 text-xs font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98]">
                                <IconPlus aria-hidden className="h-3.5 w-3.5" />{uiText("Add image")}<input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={(event) => handleImageSelect(group.shopId, event)}
                                  className="hidden"
                                />
                              </label>
                            ) : null}
                          </div>
                        </div>

                        {/* The full spec is what the shop receives, but it is
                            long. It is here to be checked, not scrolled past on
                            the way to the send button. */}
                        <details className="rounded-xl border border-[var(--fc-border)]">
                          <summary className="flex min-h-[44px] cursor-pointer items-center px-3.5 text-sm font-semibold text-[var(--fc-text)]">{uiText("See everything ")}{shopName}{uiText(" receives")}</summary>
                          <div className="border-t border-[var(--fc-border)] p-3.5">
                            <OrderDesignPreview
                              previewUrl={group.lines.find((line) => line.previewUrl)?.previewUrl ?? null}
                              cadState={{ items: group.lines.map((line) => line.item) }}
                            />
                          </div>
                        </details>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {imageError ? <p className="mt-3 text-sm text-fc-danger">{uiText(imageError)}</p> : null}
            {submitError ? <p className="mt-3 text-sm text-fc-danger">{uiText(submitError)}</p> : null}

            {/* Two different things, which were one button before: going back
                to the studio with the cart intact, and throwing the cart away.
                The second is destructive and now says so, and asks. */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/customize-furniture"
                className="inline-flex min-h-[44px] items-center rounded-full border border-[var(--fc-border)] px-5 text-sm font-bold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.98]"
              >{uiText("Keep designing")}</Link>
              <button
                type="button"
                onClick={() => setIsDiscardOpen(true)}
                disabled={isSubmitting}
                className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold text-[var(--fc-muted)] transition-colors duration-150 hover:text-fc-danger disabled:cursor-not-allowed disabled:opacity-50"
              >{isBuyNow ? uiText("Cancel buy now") : uiText("Empty the cart")}</button>
            </div>
            </div>

            {/* The summary, which on a desktop stays beside the brief instead
                of waiting at the bottom of it. It says the same things the
                sticky bar says on a phone, with room to say them per furniture shop
                rather than only naming the first one that is not ready.

                No total. The design file ends this card with "Estimated total",
                which is the number FurniCraft stopped inventing; what a cart
                adds up to here is pieces and furniture shops, and the money is the
                budget the customer sets per furniture shop below. */}
            <aside className="hidden lg:sticky lg:top-6 lg:block">
              <div className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-sm">
                <h2 className="m-0 font-display text-lg font-bold text-[var(--fc-text)]">{uiText("Summary")}</h2>

                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-[var(--fc-muted)]">{uiText("Pieces")}</dt>
                    <dd className="m-0 font-bold tabular-nums text-[var(--fc-text)]">
                      {cartPieceCount(lines)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-[var(--fc-muted)]">{uiText("Furniture shops")}</dt>
                    <dd className="m-0 font-bold tabular-nums text-[var(--fc-text)]">
                      {groups.length}
                      {unassigned.length > 0 ? (
                        <span className="font-normal text-[var(--fc-ink-accent)]">
                          {" "}
                          +{unassigned.length}{uiText(" to choose")}</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>

                {/* Each furniture shop, then what it is actually being asked to
                    build. The design file's summary card lists the piece and
                    its specification; with a cart that can span furniture shops the
                    same idea is a short list under each one, so the column
                    answers "what am I sending, and to whom" without scrolling
                    back through the briefs to check. */}
                {groups.length > 0 ? (
                  <ul className="m-0 mt-3 list-none space-y-3 border-t border-[var(--fc-border)] p-0 pt-3">
                    {groups.map((group) => (
                      <li key={group.shopId} className="text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate font-semibold text-[var(--fc-text)]">
                            {nameOf(group)}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              isLaneReady(group)
                                ? "font-semibold text-[var(--fc-text)]"
                                : "text-[var(--fc-ink-accent)]"
                            }`}
                          >
                            {isLaneReady(group) ? `${peso(Number(draftOf(group.shopId).budgetMin))}-${Number(
                                  draftOf(group.shopId).budgetMax
                                ).toLocaleString(uiLocale)}` : hasLoadedShops && stockIssuesFor(group).length ? uiText("confirm materials") : uiText("no budget")}
                          </span>
                        </div>

                        <ul className="m-0 mt-1 list-none space-y-1 p-0">
                          {group.lines.map((line) => {
                            const count = quantityOf(line.item);
                            const finish = finishesOf(line);
                            return (
                              <li key={line.id} className="text-xs leading-snug text-[var(--fc-muted)]">
                                <span className="block truncate text-[var(--fc-text)]">
                                  {count > 1 ? `${count} × ` : ""}
                                  {line.item.name || line.modelName}
                                </span>
                                {/* Only what this piece actually carries. A
                                    line added before the studio recorded its
                                    size shows its finishes alone rather than a
                                    measurement nobody took. */}
                                {line.sizeLabel || finish ? (
                                  <span className="block truncate">
                                    {[line.sizeLabel, finish].filter(Boolean).join(" · ")}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <button
                  type="button"
                  onClick={() => setIsConfirmOpen(true)}
                  disabled={isSubmitting || !canSend}
                  className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--fc-btn)] px-5 font-bold text-[var(--fc-btn-fg)] transition-transform duration-150 ease-fc active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmitting ? uiText("Sending…") : groups.length <= 1 ? uiText("Send it") : uiText("Send {0} orders", { 0: groups.length })}
                </button>

                <p className="mt-2.5 text-center text-xs leading-snug text-[var(--fc-muted)]">{uiText("No payment today. Each furniture shop quotes against your budget first.")}</p>
              </div>
            </aside>
          </div>
        ) : !justSent ? (
          <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-9 text-center shadow-sm">
            <h1 className="m-0 font-display text-2xl font-bold">{isBuyNow ? uiText("Nothing to buy now") : uiText("Your cart is empty")}</h1>
            <p className="mx-auto mt-3 max-w-md text-[var(--fc-muted)]">{isBuyNow ? uiText("Open the studio and press Buy now on a finished piece to check it out on its own.") : uiText("Design a piece in the studio and add it to your cart. You can fill the cart from several furniture shops, and each one receives its own order.")}</p>
            <Link href="/customize-furniture" className="btn btn-primary btn-sm mt-5">{uiText("Open the studio")}</Link>
          </section>
        ) : null}
      </div>

      {/* The send bar rides the bottom of the screen rather than sitting at the
          end of the page.

          It is not only a button in a convenient place: it is the only thing on
          the page that knows the state of every lane at once. Collapsed lanes
          each say whether they are ready, but the question the customer is
          actually asking is "can I send yet, and if not, who is holding it up",
          and that answer belongs somewhere always visible. */}
      {lines.length > 0 && !justSent ? (
        <div className="fc-bottom-action-bar sticky bottom-0 z-30 border-t border-[var(--fc-border)] bg-[var(--fc-panel)] px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-8px_24px_rgba(20,12,6,0.10)] lg:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm font-bold tabular-nums text-[var(--fc-text)]">
                {unassigned.length > 0 ? uiText("{0} {1} a furniture shop", { 0: unassigned.length, 1: unassigned.length === 1 ? "piece needs" : "pieces need" }) : uiText("{0} of {1} ready", { 0: readyLanes.length, 1: groups.length })}
              </p>
              <p className="m-0 truncate text-xs text-[var(--fc-muted)]">
                {unassigned.length > 0 ? uiText("Choose one above to carry on.") : pausedLane ? uiText("{0} isn't taking new orders", { 0: nameOf(pausedLane) }) : firstUnreadyLane ? stockIssuesFor(firstUnreadyLane).length ? uiText("{0} needs material confirmation", { 0: nameOf(firstUnreadyLane) }) : uiText("{0} still needs a budget", { 0: nameOf(firstUnreadyLane) }) : uiText("Sent as {0} separate {1}, quoted separately", { 0: groups.length, 1: orderWord })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsConfirmOpen(true)}
              disabled={isSubmitting || !canSend}
              className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-full bg-[var(--fc-btn)] px-6 text-sm font-bold text-[var(--fc-btn-fg)] transition-transform duration-150 ease-fc active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? uiText("Sending…") : groups.length <= 1 ? uiText("Send it") : uiText("Send {0}", { 0: groups.length })}
            </button>
          </div>
        </div>
      ) : null}

      {/* Pops up the moment a budget misses its shop's range (on leaving the
          field, or on Send), so it is never found only after scrolling. */}
      {(() => {
        const group = rangeNotice ? groups.find((entry) => entry.shopId === rangeNotice) : null;
        const range = rangeNotice ? priceRanges[rangeNotice] : null;
        if (!group || !range) return null;
        const draft = draftOf(group.shopId);
        return (
          <Modal
            open
            onClose={() => setRangeNotice(null)}
            ariaLabel={uiText("Adjust your budget")}
            eyebrow={uiText("Budget")}
            title={uiText("Adjust your budget")}
            className="sm:max-w-md"
          >
            <p className="text-sm leading-relaxed text-[var(--fc-text)]">
              {uiText("Your budget doesn't match {0}'s price range of {1}. Adjust your budget range so it reaches into it.", {
                0: nameOf(group),
                1: formatRange(range),
              })}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border border-[var(--fc-border)] p-2.5">
                <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]">{uiText("Your budget")}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-fc-danger">
                  {formatRange({ min: Number(draft.budgetMin), max: Number(draft.budgetMax) })}
                </dd>
              </div>
              <div className="rounded-xl border border-[var(--fc-border)] p-2.5">
                <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]">{uiText("Shop's range")}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-[var(--fc-ink-accent)]">{formatRange(range)}</dd>
              </div>
            </dl>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setRangeNotice(null);
                  setOpenLaneId(group.shopId);
                  window.setTimeout(() => document.getElementById(`budget-min-${group.shopId}`)?.focus(), 50);
                }}
              >
                {uiText("Adjust budget")}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* The picker is a browsing surface, not a dropdown. Whoever is chosen
          here is the furniture shop that will build the piece, so it shows what the
          dashboard's shop rail shows and lets the customer search it the same
          way. p-0 because the heading and the search box stay put while only
          the list of furniture shops scrolls. */}
      <Modal
        open={assigning !== null}
        onClose={closePicker}
        ariaLabel={uiText("Choose a furniture shop")}
        className="sm:max-w-lg"
        bodyClassName="flex min-h-0 flex-col overflow-hidden p-0 sm:p-0"
      >
        <div className="shrink-0 border-b border-[var(--fc-border)] p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold tracking-[-0.02em]">
            {assigning === "all" ? uiText("Send all of these to one furniture shop") : assigning?.startsWith("lane:") ? uiText("Move these to another furniture shop") : uiText("Which furniture shop builds this?")}
          </h2>
          <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Your design stays exactly as it is. Only the furniture shop it goes to changes.")}</p>
          {/* Kept in place while the query is in flight, so the heading does
              not shunt downward the moment the furniture shops arrive. It only
              disappears for good once we know there are none to search. */}
          {!hasLoadedShops || shops.length > 0 ? (
            <>
              <label htmlFor="furniture-shop-search" className="sr-only">{uiText("Search furniture shops")}</label>
              <input
                id="furniture-shop-search"
                type="search"
                value={shopQuery}
                onChange={(event) => setShopQuery(event.target.value)}
                disabled={!hasLoadedShops}
                placeholder={uiText("Search by name, craft or town")}
                className="mt-3.5 min-h-[44px] w-full rounded-full border border-[var(--fc-border)] bg-[var(--fc-bg)] px-4 py-2 text-sm text-[var(--fc-text)] outline-none transition-colors duration-150 placeholder:text-[var(--fc-muted)] focus:border-[var(--fc-accent)]"
              />
            </>
          ) : null}
        </div>

        <ul className="m-0 min-h-0 flex-1 list-none space-y-2 overflow-y-auto p-4">
          {!hasLoadedShops ? (
            /* Shaped like the rows it is waiting for, so the list does not
               jump when they land. */
            <>
              {[0, 1, 2].map((index) => (
                <li key={index} aria-hidden className="flex items-center gap-3 rounded-2xl p-2.5">
                  <span className="h-14 w-14 shrink-0 animate-pulse rounded-xl bg-[var(--fc-cane-soft)]" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="h-3.5 w-2/5 animate-pulse rounded-full bg-[var(--fc-cane-soft)]" />
                    <span className="h-3 w-3/5 animate-pulse rounded-full bg-[var(--fc-cane-soft)]" />
                  </span>
                </li>
              ))}
              <li className="sr-only">{uiText("Loading furniture shops")}</li>
            </>
          ) : shops.length === 0 ? (
            <li className="px-2 py-8 text-center text-sm text-[var(--fc-muted)]">{uiText("No approved shops yet. Once a furniture shop is approved it will appear here.")}</li>
          ) : visibleShops.length === 0 ? (
            <li className="px-2 py-8 text-center text-sm text-[var(--fc-muted)]">{uiText("No furniture shop matches “")}{shopQuery.trim()}{uiText("”. Try a craft, like rattan, or a town.")}</li>
          ) : (
            visibleShops.map((shop) => (
              <li key={shop.id}>
                <ShopPickerRow
                  shop={shop}
                  isCurrent={
                    assigning?.startsWith("lane:")
                      ? assigning.slice("lane:".length) === shop.id
                      : assigning !== null &&
                        assigning !== "all" &&
                        lines.find((line) => line.id === assigning)?.shopId === shop.id
                  }
                  rating={shopRatings[shop.id] ?? null}
                  pieces={shopPieceCounts[shop.id] ?? 0}
                  online={Boolean(shop.ownerUserId && onlineUserIds.has(shop.ownerUserId))}
                  onChoose={() => handleAssign(shop)}
                />
              </li>
            ))
          )}
        </ul>
      </Modal>

      {/* Removing is the one action here that destroys work, and it now sits on
          a 44px button beside Edit rather than on a 16px text link, so it is
          also far easier to hit by accident than it used to be. */}
      <ConfirmModal
        open={removingLine !== null}
        title={uiText("Remove {0}?", { 0: removingLine?.item.name || removingLine?.modelName || uiText("this piece") })}
        body="The design goes out of your cart. Anything you saved in the studio stays where it is."
        confirmLabel={uiText("Remove it")}
        onConfirm={() => {
          if (removingLine) setLines(removeFromCart(removingLine.id));
          setRemovingLine(null);
        }}
        onCancel={() => setRemovingLine(null)}
      />

      <ConfirmModal
        open={isDiscardOpen}
        title={isBuyNow ? uiText("Cancel buy now?") : uiText("Empty your cart?")}
        body={
          isBuyNow
            ? "This piece is not sent, and the budget and notes written for it are dropped. Your cart and your saved designs stay as they are."
            : `${cartPieceCount(lines)} ${cartPieceCount(lines) === 1 ? "piece goes" : "pieces go"} out of the cart, along with the budgets and notes written for them. Designs you saved in the studio stay where they are.`
        }
        confirmLabel={isBuyNow ? uiText("Cancel it") : uiText("Empty it")}
        onConfirm={handleDiscardPending}
        onCancel={() => setIsDiscardOpen(false)}
      />

      <ConfirmModal
        open={isConfirmOpen}
        title={
          groups.length === 1 ? uiText("Send this to {0}?", { 0: nameOf(groups[0]) }) : uiText("Send {0} separate orders?", { 0: groups.length })
        }
        body={
          groups.length === 1
            ? "The shop receives your design and its measurements, and will reply with a quote. You can still decline the quote when it arrives."
            : `${groups
                .map((group) => nameOf(group))
                .join(", ")} each receive their own order and quote separately. You can decline any of them when the quotes arrive.`
        }
        confirmLabel={groups.length === 1 ? uiText("Send order") : uiText("Send {0} {1}", { 0: groups.length, 1: orderWord })}
        busy={isSubmitting}
        onConfirm={() => {
          setIsConfirmOpen(false);
          void handleConfirmOrder();
        }}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </main>
  );
}

/**
 * One furniture shop in the picker.
 *
 * Module scope rather than inside the page body, for the same reason the
 * dashboard's shop rail card is: written inline it would be a new function
 * value on every render, and React would tear down and rebuild every row on
 * every keystroke in the search box above it.
 *
 * The cover photo falls back to the shop's initials rather than to the shared
 * storefront illustration, matching what the dashboard's ShopIdentity does and
 * for the same reason: a furniture shop that has not uploaded a photo should still
 * be distinguishable from every other furniture shop that has not. The illustration
 * is only the last resort for a cover URL that fails to load.
 */
function ShopPickerRow({
  shop,
  isCurrent,
  rating,
  pieces,
  online,
  onChoose,
}: {
  shop: Shop;
  isCurrent: boolean;
  rating: { average: number; count: number } | null;
  pieces: number;
  online: boolean;
  onChoose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const paused = !shop.acceptingOrders;
  const shownMaterials = shop.materials.slice(0, 3);
  const moreMaterials = shop.materials.length - shownMaterials.length;

  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={isCurrent || paused}
      className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-[background-color,border-color,transform] duration-150 enabled:active:scale-[0.99] disabled:cursor-default ${
        isCurrent
          ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)]"
          : paused
            ? "border-dashed border-[var(--fc-border)] opacity-60"
            : "border-[var(--fc-border)] hover:bg-[var(--fc-cane-soft)]"
      }`}
    >
      <span className="relative shrink-0">
        <ShopLogo logoUrl={shop.logoUrl} name={shop.name} size={56} />
        {online ? (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--fc-panel)] bg-fc-online"
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 min-w-0 font-semibold leading-snug text-[var(--fc-text)]">{shop.name}</span>
          {isCurrent ? (
            <span className="shrink-0 pt-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-ink-accent)]">{uiText("Current")}</span>
          ) : paused ? (
            <span className="shrink-0 rounded-full border border-[var(--fc-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--fc-muted)]">{uiText("Paused")}</span>
          ) : null}
        </span>

        {/* What a customer weighs first: how others found them, and whether
            anyone is there to answer right now. */}
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <RatingLine average={rating?.average ?? null} count={rating?.count ?? 0} />
          {online ? <span className="text-xs font-semibold text-fc-online">{uiText("Online now")}</span> : null}
        </span>

        <span className="mt-1 block truncate text-xs text-[var(--fc-muted)]">{shop.specialty}</span>

        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--fc-muted)]">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <IconLocation aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{shop.location}</span>
          </span>
          {shop.hours ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <IconClock aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{shop.hours}</span>
            </span>
          ) : null}
          <span className="whitespace-nowrap">
            {pieces > 0 ? uiText("{0} {1} to start from", { 0: pieces, 1: pieces === 1 ? "piece" : "pieces" }) : uiText("No pieces published")}
          </span>
        </span>

        <span className="mt-2 flex flex-wrap gap-1">
          {shownMaterials.length > 0 ? (
            <>
              {shownMaterials.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-[var(--fc-border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--fc-text)]"
                >
                  {uiText(label)}
                </span>
              ))}
              {moreMaterials > 0 ? (
                <span className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-[var(--fc-muted)]">
                  +{moreMaterials}{uiText(" more")}</span>
              ) : null}
            </>
          ) : (
            <span className="text-[11px] text-[var(--fc-muted)]">{uiText("Works in any material")}</span>
          )}
        </span>

        {paused ? (
          <span className="mt-2 block text-xs font-semibold text-[var(--fc-text)]">{uiText("Not taking new orders right now")}</span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * One piece, in whichever lane it currently sits.
 *
 * Extracted because the unassigned lane and every furniture shop lane show exactly
 * the same row, and two copies of a quantity stepper would drift.
 */
function LineRow({
  line,
  onQuantity,
  onEdit,
  onRemove,
}: {
  line: CartLine;
  onQuantity: (next: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const name = line.item.name || line.modelName;
  const count = quantityOf(line.item);
  const finish = finishesOf(line);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {line.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={line.previewUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] object-contain"
        />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-xl border border-dashed border-[var(--fc-border)]" />
      )}

      <div className="min-w-0 flex-1">
        <p className="m-0 truncate font-semibold text-[var(--fc-text)]">{name}</p>
        {/* The model it started from, and what it is being built out of. The
            finishes came out of the design and are the thing most likely to be
            wrong on a piece the customer configured a week ago, so they belong
            on the row rather than three taps down inside the full spec. */}
        <p className="m-0 truncate text-sm text-[var(--fc-muted)]">
          {line.sizeLabel ? `${line.modelName} · ${line.sizeLabel}` : line.modelName}
        </p>
        {/* Finishes on their own line now that the size shares the one above.
            Only lines added since the studio began recording a size have one;
            older ones simply show one line less. */}
        {finish ? <p className="m-0 truncate text-sm text-[var(--fc-muted)]">{finish}</p> : null}
      </div>

      {/* Every control takes the second row rather than crowding the first.
          How many is a decision about the order and this is where the order is
          being reviewed, so it is changed here rather than by a trip back to
          the studio. But at 44px a stepper plus two actions beside the
          thumbnail left the piece's own name about 97px on a 375px phone,
          which is not a name, it is an ellipsis. */}
      <div className="flex w-full items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fc-muted)]">{uiText("Qty")}</span>
        <button
          type="button"
          aria-label={uiText("One fewer {0}", { 0: name })}
          disabled={count <= MIN_QUANTITY}
          onClick={() => onQuantity(count - 1)}
          className="h-11 w-11 shrink-0 rounded-full border border-[var(--fc-border)] text-base font-bold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span
          aria-live="polite"
          className="w-8 text-center text-base font-bold tabular-nums text-[var(--fc-text)]"
        >
          {count}
        </span>
        <button
          type="button"
          aria-label={uiText("One more {0}", { 0: name })}
          disabled={count >= MAX_QUANTITY}
          onClick={() => onQuantity(count + 1)}
          className="h-11 w-11 shrink-0 rounded-full border border-[var(--fc-border)] text-base font-bold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            aria-label={uiText("Edit {0}", { 0: name })}
            className="grid h-11 w-11 place-items-center rounded-full border border-[var(--fc-border)] text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.94]"
          >
            <IconEdit aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={uiText("Remove {0}", { 0: name })}
            className="grid h-11 w-11 place-items-center rounded-full border border-[var(--fc-border)] text-[var(--fc-muted)] transition-[background-color,color,transform] duration-150 hover:border-fc-danger hover:text-fc-danger active:scale-[0.94]"
          >
            <IconTrash aria-hidden className="h-4 w-4" />
          </button>
        </span>
      </div>
    </div>
  );
}
