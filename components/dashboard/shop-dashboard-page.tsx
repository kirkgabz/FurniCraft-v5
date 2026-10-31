"use client";
import { PhotoTemplatePolicyButton } from "@/components/shops/photo-template-policy-button";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { ShopName } from "@/components/shops/shop-name";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { validateTemplateDetails } from "@/lib/shops/template-details";
import { sendOrderReadyEmail } from "@/lib/order-ready-email";
import {
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconClose,
  IconDocument,
  IconEdit,
  IconFurniture,
  IconMessages,
  IconOrders,
  IconOverview,
  IconPhone,
  IconProfile,
  IconSeller,
  IconSettings,
  IconStar,
  IconTemplates,
  IconTrash,
  type SolihiyaIcon,
} from "@/components/solihiya/icons";
import { useDeepLink } from "@/lib/deep-link";
import ConfirmModal from "@/components/ui/confirm-modal";
import { BACK_BUTTON_CLASS } from "@/components/ui/back-button-style";
import { Modal, useModalA11y } from "@/components/ui/modal";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import SupportSection from "@/components/dashboard/sections/support-section";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import OrderDetailModal from "@/components/orders/order-detail-modal";
import { useOnlineUsers } from "@/lib/presence";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { ThemeSwitcher } from "@/components/dashboard/theme-switcher";
import { BottomTabBar } from "@/components/dashboard/bottom-tab-bar";
import { ModeBar } from "@/components/dashboard/mode-bar";
import { EyeIcon, EyeOffIcon } from "@/components/shops/shop-icons";
import { ShopAccountSheet } from "@/components/dashboard/phone-sheets";
import ShopHome from "@/components/dashboard/home/shop-home";
import OrderDesignPreview from "@/components/design/order-design-preview";
import ImageLightbox from "@/components/design/image-lightbox";
import { resolveDesignItem, openItemInDesigner } from "@/components/design/design-state-utils";
import { generatedModelPath } from "@/components/design/studio/studio-design-state";
import { taskIdFromModelPath } from "@/lib/meshy/stored-model";
import { RefundPanel, RefundTag, needsRefundAnswer } from "@/components/orders/refund-panel";
import NotificationBell from "@/components/notifications/notification-bell";
import OrderPreviewCard, { asOrderEventPayload } from "@/components/orders/order-preview-card";
import MessengerThread, { orderEntryId, scrollToThreadEntry } from "@/components/messages/messenger-thread";
import { SendOrderModal } from "@/components/orders/send-order-modal";
import ConversationOrders from "@/components/messages/conversation-orders";
import { CHAT_PHOTO_TEXT, uploadChatPhoto } from "@/lib/chat-photos";
import ReportDialog from "@/components/reports/report-dialog";
import { signedUrlFor, RECEIPT_BUCKET, QR_BUCKET } from "@/components/orders/payment-proof";
import StorefrontEditor, { type StorefrontTab as StorefrontEditorTab } from "@/components/shops/storefront-editor";
import ShopProfile from "@/components/shops/shop-profile";
import { loadShopProfile, type ShopProfileData } from "@/components/shops/shop-profile-data";
import ShopReviews from "@/components/reviews/shop-reviews";
import SocialLinksEditor from "@/components/shops/social-links-editor";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import { orderSuccessMessage } from "@/components/orders/order-success";
import { touchShopActivity, SHOP_INACTIVE_DEACTIVATE_DAYS } from "@/lib/shop-activity";
import { setDashboardMode } from "@/lib/dashboard-mode";
import OrderStepper from "@/components/orders/order-stepper";
import AllowedFinishesPicker from "@/components/shops/allowed-finishes-picker";
import { STOCK_MATERIALS, stockColorLabel } from "@/lib/shops/material-stock";
import { MaterialSkin } from "@/components/design/material-skin";
import { MaterialTagChips } from "@/components/design/material-tag-chips";
import { materialTagsForDesign } from "@/components/design/studio/material-tags";
import ProSubscriptionCard from "@/components/shops/pro-subscription-card";
import { CopyField, OrderDesignColumn, OrderPartyCard, SideCard } from "@/components/orders/order-workspace";
import ProductionSchedule from "@/components/orders/production-schedule";
import { templateMaterialsForEdit, templateMaterialsForSave, templateSaveErrorMessage } from "@/lib/shops/template-materials";
import OrderCosting from "@/components/orders/order-costing";
import ShopPricingSettings from "@/components/orders/shop-pricing-settings";
import { QuoteBreakdownList, QuoteLinesEditor } from "@/components/orders/quote-breakdown";
import {
  draftTotal,
  draftsFromLines,
  parseQuoteLines,
  quoteFormUnchanged,
  resolveQuote,
  type QuoteLineDraft,
} from "@/components/orders/quote-lines";
import { timeAgo } from "@/lib/time-ago";
import { CopyLinkButton } from "@/components/shops/share-template-button";
import {
  parseGallery,
  USER_NAMES_TABLE,
  type ShopPhoto,
} from "@/components/shops/shop-types";
import {
  CUSTOMER_ACTIONABLE,
  DOWNPAYMENT_MIN_PERCENT,
  ORDER_STATUSES,
  SHOP_ACTIONABLE,
  downpaymentOf,
  formatPeso,
  orderStatusMeta,
  shopCanMove,
  type OrderStatus,
} from "@/components/orders/order-status";

type Props = {
  /** The account's real email, for display only -- never a name fallback. */
  userEmail?: string | null;
  /** Auth's own display name, used only to seed full_name before a profile row exists. */
  fallbackName?: string | null;
};

type Message = {
  id: string;
  sender: "user" | "shop";
  senderRole: "customer" | "shop_owner";
  text: string;
  time: string;
  shopId?: string;
  senderUserId?: string | null;
  targetUserId?: string | null;
  created_at?: string;
  /** 'text' for something a person typed, 'order_event' for a system card. */
  kind?: string;
  payload?: unknown;
};

const PERSON_IDENTITY_SIZES = {
  sm: { box: "h-8 w-8 rounded-lg", text: "text-[11px]", dot: "h-2 w-2" },
  lg: { box: "h-11 w-11 rounded-xl", text: "text-sm", dot: "h-2.5 w-2.5" },
} as const;

/**
 * A customer's face in the rooms list and the message gutter.
 *
 * A monogram rather than a photo, and not by preference: `user_profiles`
 * is readable only by its owner, and `user_display_names` -- the definer view
 * the app uses to show other people -- exposes id and full_name and nothing
 * else. A shop cannot read a customer's avatar_url at all, so initials are
 * the whole of what there is to draw with. The customer side of this pairs a
 * shop's cover photo with the same fallback; see ShopIdentity there.
 */
function PersonIdentity({
  name,
  size,
  online,
}: {
  name: string;
  size: keyof typeof PERSON_IDENTITY_SIZES;
  online?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const scale = PERSON_IDENTITY_SIZES[size];
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "C";

  return (
    <span className="relative shrink-0">
      <span
        className={`${scale.box} ${scale.text} grid place-items-center bg-[var(--fc-ink-accent)] font-bold text-[var(--fc-panel)]`}
      >
        {initials}
      </span>
      {online !== undefined ? (
        <>
          <span
            aria-hidden
            className={`absolute -bottom-0.5 -right-0.5 ${scale.dot} rounded-full border-2 border-[var(--fc-panel)] ${
              online ? "bg-fc-online" : "bg-[var(--fc-muted)]"
            }`}
          />
          <span className="sr-only">{online ? uiText("Online") : uiText("Away")}</span>
        </>
      ) : null}
    </span>
  );
}

type DesignTemplate = {
  id: string;
  shop_id: string;
  title: string;
  description: string | null;
  tag: string | null;
  cad_state: unknown;
  preview_url: string | null;
  /** The finishes the shop will build this in; null means any. */
  allowed_materials: string[] | null;
  created_at: string;
  /** Hidden from customers (RLS); only this shop still reads it. */
  is_hidden?: boolean | null;
};

type PendingTemplateDesign = {
  shopId: string;
  projectName: string;
  previewUrl?: string;
  cadState: string;
  savedAt: string;
};

type ReferenceImage = {
  name: string;
  dataUrl: string;
};

type DesignOrder = {
  id: string;
  shop_id: string;
  customer_user_id: string;
  project_name: string;
  furniture_type: string | null;
  /** Written by orders sent before budgets replaced it. Read, never written. */
  estimated_price: number | null;
  /**
   * What the customer said they were willing to spend.
   *
   * Optional because migration 20260903000100 has not been applied to this
   * project yet, so the order queries do not select these and they arrive
   * undefined. Every reader below already falls back to estimated_price, so
   * the shop keeps seeing the figure it saw before until the columns exist.
   */
  budget_min?: number | null;
  budget_max?: number | null;
  cad_state: unknown;
  preview_url: string | null;
  notes: string | null;
  reference_images: ReferenceImage[] | null;
  status: string;
  created_at: string;
  quoted_total: number | null;
  downpayment_percent: number | null;
  downpayment_amount: number | null;
  customer_response: string | null;
  customer_responded_at?: string | null;
  /** The breakdown sent with quoted_total; see quote-lines.ts. */
  quote_lines?: unknown;
  payment_receipt_url: string | null;
  payment_reference: string | null;
  refund_status?: string | null;
  refund_reason?: string | null;
  refund_requested_at?: string | null;
  refund_declined_reason?: string | null;
  refund_decided_at?: string | null;
  refund_reference?: string | null;
  refund_amount?: number | null;
  payment_rejected_reason?: string | null;
  decline_reason?: string | null;
};



function OrderStatusBadge({ status }: { status: string }) {
  const { t: uiText } = useUiLanguage();
  const meta = orderStatusMeta(status);
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${meta.tone}`}>
      {uiText(meta.label)}
    </span>
  );
}

/**
 * One row in the incoming-orders queue.
 *
 * The thumbnail is not decoration: a shop that names four orders "Custom Chair
 * Design 1" gets four identical rows without it, and every order already
 * carries the preview it was sent with. `dimmed` is for closed orders, which
 * are history rather than work.
 */
function OrderRow({
  order,
  customerName,
  onOpen,
  dimmed = false,
}: {
  order: DesignOrder;
  customerName: string;
  onOpen: () => void;
  dimmed?: boolean;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const meta = orderStatusMeta(order.status);
  // A refund request usually arrives on a completed order, so asking the
  // status alone would leave the one row with someone waiting on it looking
  // like settled history -- greyed, unhighlighted, no hint.
  const awaitingRefund = needsRefundAnswer(order);
  const needsResponse = SHOP_ACTIONABLE.includes(order.status as OrderStatus) || awaitingRefund;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-[background-color,border-color,opacity,transform] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.99] ${
        needsResponse
          ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.06)] shadow-[inset_3px_0_0_0_#8b5a2b]"
          : "border-[var(--fc-border)] bg-[var(--fc-panel)]"
      } ${dimmed && !awaitingRefund ? "opacity-70 hover:opacity-100" : ""}`}
    >
      {order.preview_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={order.preview_url}
          alt=""
          className="h-14 w-14 shrink-0 rounded-xl border border-[var(--fc-border)] bg-white object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-dashed border-[var(--fc-border)] text-xl"
        >
          <IconFurniture aria-hidden className="h-6 w-6 opacity-60" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-[var(--fc-text)]">{order.project_name}</span>
          <OrderStatusBadge status={order.status} />
          {/* Beside the status, not instead of it: the piece can be finished
              and the money still in dispute. */}
          <RefundTag order={order} />
        </span>
        <span className="mt-0.5 block text-xs text-[var(--fc-muted)]">
          {customerName} · {new Date(order.created_at).toLocaleDateString(uiLocale)}
        </span>
        {/* What to do next, from the same table the buttons come from. */}
        {awaitingRefund ? (
          <span className="mt-1 block truncate text-xs font-semibold text-[var(--fc-ink-accent)]">
            {order.refund_reason ? uiText("Refund asked for: {0}", { 0: order.refund_reason }) : uiText("Refund requested — open the order to answer")}
          </span>
        ) : needsResponse ? (
          <span className="mt-1 block text-xs font-semibold text-[var(--fc-ink-accent)]">{uiText(meta.shopHint)}</span>
        ) : null}
      </span>

      {/* The customer's budget, not a price: it is what they hope to spend,
          and it is the shop that decides what the work costs. Orders sent
          before budgets existed fall back to the estimate they carry. */}
      {order.budget_min != null && order.budget_max != null ? (
        <span className="shrink-0 text-right text-xs font-semibold text-[var(--fc-ink-accent)]">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Budget")}</span>
          <span className="tabular-nums">
            ₱{Number(order.budget_min).toLocaleString(uiLocale)}–
            {Number(order.budget_max).toLocaleString(uiLocale)}
          </span>
        </span>
      ) : order.estimated_price != null ? (
        <span className="shrink-0 font-semibold tabular-nums text-[var(--fc-ink-accent)]">
          ₱{Number(order.estimated_price).toLocaleString(uiLocale)}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The dashboard is split into sections rather than stacked in one column: a shop
 * with a busy order queue and an open chat panel produced a page several screens
 * long, where the storefront settings sat below a scrolling conversation.
 */
/** Storefront's tabs: the shop as customers see it first, then the two settings behind it. */
const STOREFRONT_TABS = [
  { id: "page", label: "Shop page" },
  { id: "payment", label: "Payment details" },
  { id: "materials", label: "Materials" },
  { id: "links", label: "Links" },
] as const;
type StorefrontTab = (typeof STOREFRONT_TABS)[number]["id"];

/**
 * The order dialog's tabs, under the stepper. The design, the quote, the cost
 * sheet and the customer used to stack in one long scroll; each is one tab now.
 */
const ORDER_TABS = [
  { id: "design", label: "Design" },
  { id: "quote", label: "Quote" },
  { id: "costing", label: "Cost sheet" },
  { id: "customer", label: "Message customer" },
] as const;
type OrderTab = (typeof ORDER_TABS)[number]["id"];

type ShopSection =
  | "home"
  | "orders"
  | "templates"
  | "messages"
  | "reviews"
  | "storefront"
  | "subscription"
  | "support"
  | "settings";

/**
 * The same drawn set the customer dashboard uses. These were emoji, which the
 * OS renders in its own artwork at its own weight -- so the two dashboards did
 * not look like one product, and the shop side looked like a different app.
 */
const SHOP_NAV: Array<{
  id: ShopSection;
  label: string;
  icon: SolihiyaIcon;
}> = [
  /**
   * Home leads, and is where the dashboard opens: what is waiting on the shop
   * (see home/shop-home.tsx). It replaced opening on Storefront, which put the
   * answer to "is a customer waiting on me?" in one line above the materials
   * picker, the payment details and a full copy of the public page.
   *
   * Storefront is still where the owner checks what a customer actually gets,
   * rendered from the same rows the customer page reads; it is one tap away.
   */
  { id: "home", label: "Dashboard", icon: IconOverview },
  { id: "storefront", label: "Storefront", icon: IconSeller },
  { id: "orders", label: "Orders", icon: IconOrders },
  { id: "templates", label: "Templates", icon: IconTemplates },
  { id: "messages", label: "Messages", icon: IconMessages },
  { id: "reviews", label: "Reviews", icon: IconStar },
  { id: "subscription", label: "Subscription", icon: IconDocument },
  { id: "support", label: "Support", icon: IconPhone },
  { id: "settings", label: "Settings", icon: IconSettings },
];

const SECTION_META: Record<ShopSection, { title: string; subtitle: string }> = {
  home: { title: "Home", subtitle: "What is waiting on your shop." },
  orders: { title: "Incoming Orders", subtitle: "Designs customers have sent you to build." },
  templates: { title: "Shop Templates", subtitle: "3D pieces customers can open in the studio and make their own." },
  messages: { title: "Messages", subtitle: "Conversations with your buyers." },
  reviews: { title: "Ratings & Feedback", subtitle: "What customers said after you completed their orders." },
  storefront: {
    title: "Storefront",
    subtitle: "Your shop exactly as a customer sees it — edit it here, including how you get paid.",
  },
  subscription: { title: "Subscription", subtitle: "Your plan, photo generations left, and paying for Pro." },
  support: { title: "Support", subtitle: "Have a question or ran into a problem? FurniCraft support replies here." },
  settings: { title: "Settings", subtitle: "Manage your account preferences." },
};

export default function ShopDashboardPage({ userEmail, fallbackName }: Props) {
  const { t: uiText, locale: uiLocale, language: uiLanguage } = useUiLanguage();
  const router = useRouter();
  // This tab is now working as the shop: the studio may offer shop tools such
  // as Publish as Template (it still checks the shop is approved).
  useEffect(() => setDashboardMode("shop"), []);
  const [isEditShopModalOpen, setIsEditShopModalOpen] = useState(false);
  /**
   * Which tab the storefront editor opens on. Five buttons open that one
   * dialog, and two of them name payment specifically; landing those on
   * Profile asked the shop to go and find what the button had just said.
   */
  const [storefrontEditorTab, setStorefrontEditorTab] = useState<StorefrontEditorTab>("profile");
  const openStorefront = useCallback((tab: StorefrontEditorTab = "profile") => {
    setStorefrontEditorTab(tab);
    setIsEditShopModalOpen(true);
  }, []);
  const [isAddTemplateModalOpen, setIsAddTemplateModalOpen] = useState(false);
  // The drawer only applies below `lg`; the sidebar is always visible above it,
  // so it starts closed rather than covering the page on first paint on mobile.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<ShopSection>("home");
  // The phone's Account sheet (avatar), and which of Storefront's tabs is open.
  // The tabs replaced two fold-away blocks: one long page of the shop preview,
  // the payment card and the materials list ran to thousands of pixels.
  const [isAccountSheetOpen, setIsAccountSheetOpen] = useState(false);
  const [storefrontTab, setStorefrontTab] = useState<StorefrontTab>("page");

  /**
   * Sections are hash-addressed (#orders, #messages ...) like the customer
   * dashboard's, so the phone's tab bar links are real links and Back steps
   * back through the sections the owner visited. It used to be state only,
   * and Back left the dashboard.
   */
  const goToSection = useCallback((section: ShopSection) => {
    if (window.location.hash !== `#${section}`) window.history.pushState(null, "", `#${section}`);
    setActiveSection(section);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onHashChange = (event?: Event) => {
      const hash = window.location.hash.replace("#", "");
      if (!hash && event) {
        setActiveSection("home");
        setIsOrderDetailModalOpen(false);
      }
      // Links moved into Storefront; an old #links address still lands there.
      if (hash === "links") {
        setActiveSection("storefront");
        setStorefrontTab("links");
        setIsOrderDetailModalOpen(false);
      }
      if (SHOP_NAV.some((item) => item.id === hash)) {
        setActiveSection(hash as ShopSection);
        // An open order stayed on screen over whichever section came next
        // (a notification link, Back). Leaving the section closes it.
        setIsOrderDetailModalOpen(false);
      }
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);
  const [orderFilter, setOrderFilter] = useState<"all" | OrderStatus>("all");
  const [showClosedOrders, setShowClosedOrders] = useState(false);
  // Quote form, per selected order.
  const [quoteTotal, setQuoteTotal] = useState("");
  const [quotePercent, setQuotePercent] = useState("30");
  const [quoteLineDrafts, setQuoteLineDrafts] = useState<QuoteLineDraft[]>([]);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [shopOwnerName, setShopOwnerName] = useState("");
  /**
   * The owner's own picture, not the shop's storefront photo -- read from the
   * same user_profiles row the customer dashboard's profile editor writes to.
   * Editing it happens there; this only displays it and links across, rather
   * than duplicating a whole second name/phone/address/avatar form for a
   * personal profile that isn't otherwise this page's concern.
   */
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState<string | null>(null);
  const [shopOwnerStatus, setShopOwnerStatus] = useState<"pending" | "approved" | "rejected" | "none">("none");
  const [myShopId, setMyShopId] = useState<string | null>(null);
  // The storefront row is editable while the application is still pending, so
  // this is tracked separately from myShopId (which gates messaging on approval).
  const [shopRequestId, setShopRequestId] = useState<string | null>(null);
  const [shopIsActive, setShopIsActive] = useState(true);
  const [isTogglingShopActive, setIsTogglingShopActive] = useState(false);
  /** The soft switch: listed and messageable, but not taking new commissions. */
  const [shopAcceptingOrders, setShopAcceptingOrders] = useState(true);
  const [isTogglingAccepting, setIsTogglingAccepting] = useState(false);
  /**
   * The shop as a customer sees it, read through the same loader the public
   * `/shops/[id]` page uses so the two cannot disagree.
   *
   * Null while loading, and also for a shop that is not approved yet --
   * shops_public carries approved shops only, so there is genuinely no
   * customer-facing page to show until an admin says so.
   */
  const [shopProfile, setShopProfile] = useState<ShopProfileData | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  /**
   * Where the shop asks customers to send money. One set of fields, because
   * one is what a shop actually hands over: a name, a number, and a QR for
   * whichever app or bank it belongs to.
   */
  const [payment, setPayment] = useState<{
    qrUrl: string;
    instructions: string;
    accountName: string;
    accountNumber: string;
  }>({ qrUrl: "", instructions: "", accountName: "", accountNumber: "" });
  /** Catalog material/color IDs the shop chose in Edit storefront; listed here, edited there. */
  const [savedShopMaterials, setSavedShopMaterials] = useState<string[]>([]);
  /** The QR lives in a private bucket, so it is shown through a signed link. */
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const [storefront, setStorefront] = useState<{
    tagline: string;
    description: string;
    phone: string;
    hours: string;
    coverImageUrl: string;
    gallery: ShopPhoto[];
  }>({ tagline: "", description: "", phone: "", hours: "", coverImageUrl: "", gallery: [] });
  const [messageDraft, setMessageDraft] = useState("");
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [shopThreads, setShopThreads] = useState<Record<string, Message[]>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedCustomerRoomId, setSelectedCustomerRoomId] = useState<string | null>(null);
  const [isSendOrderOpen, setIsSendOrderOpen] = useState(false);
  /**
   * Whether the phone-sized thread is covering the rooms list. Kept apart from
   * selectedCustomerRoomId so backing out of a thread returns the list without
   * dropping the room the composer and read-marking still point at. Ignored
   * from lg up, where list and thread are both on screen.
   */
  const [isMobileThreadOpen, setIsMobileThreadOpen] = useState(false);
  /** Phone only: whether the filters that would return nothing are revealed. */
  const [showEmptyOrderFilters, setShowEmptyOrderFilters] = useState(false);
  const [conversationPeerNames, setConversationPeerNames] = useState<Record<string, string>>({});
  const [customerUnreadIds, setCustomerUnreadIds] = useState<Record<string, boolean>>({});
  const [shopTemplates, setShopTemplates] = useState<DesignTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [newTemplateTitle, setNewTemplateTitle] = useState("");
  const [newTemplateTag, setNewTemplateTag] = useState("");
  /**
   * Finishes this template may be built in. Empty means unrestricted, which
   * is stored as NULL -- an empty array would read as "nothing allowed", and
   * the column refuses it for exactly that reason.
   */
  const [templateMaterials, setTemplateMaterials] = useState<string[]>([]);
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [pendingTemplateDesign, setPendingTemplateDesign] = useState<PendingTemplateDesign | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [hidingTemplateId, setHidingTemplateId] = useState<string | null>(null);
  const [templateHideError, setTemplateHideError] = useState<string | null>(null);
  /** The template the shop owner has asked to delete, pending confirmation. */
  const [templatePendingDelete, setTemplatePendingDelete] = useState<DesignTemplate | null>(null);
  /** The order the shop owner has asked to decline, pending a reason. */
  const [orderPendingDecline, setOrderPendingDecline] = useState<string | null>(null);
  /** The order whose receipt is being rejected, pending a reason for the customer. */
  const [orderPendingReceiptReject, setOrderPendingReceiptReject] = useState<string | null>(null);
  /** The order a chat card asked to open, shown over the conversation. */
  const [chatOrderId, setChatOrderId] = useState<string | null>(null);
  /** The customer message being reported, quoted back into the dialog. */
  const [reportedMessage, setReportedMessage] = useState<{ id: string; text: string } | null>(null);
  const [orders, setOrders] = useState<DesignOrder[]>([]);
  // An accepted-but-unpaid order is cancelled, not declined: the dialog says so.
  const pendingDeclineIsUnpaid =
    orders.find((order) => order.id === orderPendingDecline)?.status === "confirmed";
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [orderCustomerNames, setOrderCustomerNames] = useState<Record<string, string>>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isUpdatingOrderStatus, setIsUpdatingOrderStatus] = useState(false);
  /**
   * What went wrong with the last thing this shop owner tried to do.
   *
   * Every write on this screen used to fail into console.error and return, so
   * a rejected update looked identical to one that never fired: the button
   * un-pressed and nothing moved. "Receipt does not match" has been failing
   * against a database guard this whole time with no way for the shop to know.
   * A refusal the database took the trouble to explain should reach the person
   * it was explained to.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);
  const [orderTab, setOrderTab] = useState<OrderTab>("design");
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const conversationReadStateAvailableRef = useRef<boolean | null>(null);
  const lastManualRoomSelectionRef = useRef<number>(0);
  const lastQuotedOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedOrderId !== lastQuotedOrderIdRef.current) {
      lastQuotedOrderIdRef.current = selectedOrderId;
      // A different order opens on its design, not on whichever tab the last one was left on.
      setOrderTab("design");
      if (!selectedOrderId) {
        setQuoteTotal("");
        setQuoteLineDrafts([]);
        setQuotePercent("30");
        setQuoteError(null);
        return;
      }
      const order = orders.find((o) => o.id === selectedOrderId);
      if (order) {
        // Starts empty for anything not already quoted. It used to be seeded
        // from estimated_price, so the shop was nudged into confirming the
        // app's arithmetic rather than pricing the work itself.
        setQuoteTotal(order.quoted_total != null ? String(order.quoted_total) : "");
        setQuoteLineDrafts(draftsFromLines(parseQuoteLines(order.quote_lines)));
        setQuotePercent(
          order.downpayment_percent != null
            ? String(order.downpayment_percent)
            : "30"
        );
        setQuoteError(null);
      }
    }
  }, [selectedOrderId, orders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isSidebarOpen]);

  // Load shop owner data
  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | undefined;

    const loadShopData = async (attempt = 0) => {
      if (cancelled) return;
      const supabase = createClient();

      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          throw userError ?? new Error("No authenticated user found.");
        }
        const user = userData.user;

        // Load user profile
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("full_name, address, shop_owner, role, avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        // Load shop owner request (approved or pending). The storefront columns
        // come from a hand-applied migration, so fall back if it hasn't run.
        // A user can hold more than one shop row -- an application left
        // pending after a later one was approved, for one. `.maybeSingle()`
        // over "approved or pending" then matched two rows, which PostgREST
        // answers with an error instead of a row, and an approved shop owner
        // was told "You don't have an active shop yet". So read them all and
        // choose: an approved shop outranks a pending application, and the
        // newest wins within each.
        const selectShopRequest = async (columns: string) => {
          const result = await supabase
            .from("shops")
            .select(columns)
            .eq("user_id", user.id)
            .in("status", ["approved", "pending"])
            .order("created_at", { ascending: false });
          if (result.error) return { data: null, error: result.error };
          const rows = (result.data ?? []) as unknown as Array<{ status: string }>;
          return { data: rows.find((row) => row.status === "approved") ?? rows[0] ?? null, error: null };
        };

        let shopRequestResult = await selectShopRequest(
          "id, status, is_active, accepting_orders, shop_name, description, address, tagline, cover_image_url, gallery, phone, hours"
        );
        if (shopRequestResult.error) {
          shopRequestResult = await selectShopRequest("id, status, shop_name, description, address");
        }
        const shopRequest = shopRequestResult.data as
          | (Record<string, unknown> & { id: string; status: string })
          | null;

        if (cancelled) return;
        setCurrentUserId(user.id);
        // Only load conversations if approved (pending shops can't receive messages yet)
        setMyShopId(shopRequest?.status === "approved" ? shopRequest.id : null);
        setShopRequestId(shopRequest?.id ?? null);
        setShopOwnerStatus(shopRequest?.status === "approved" ? "approved" : shopRequest?.status === "pending" ? "pending" : "none");
        setShopIsActive(shopRequest?.is_active !== false);
        setShopAcceptingOrders(shopRequest?.accepting_orders !== false);
        const text = (value: unknown) => (typeof value === "string" ? value : "");
        setShopOwnerName(text(shopRequest?.shop_name) || profile?.full_name || user.email || "My Shop");
        setOwnerAvatarUrl(profile?.avatar_url ?? null);
        setStorefront({
          tagline: text(shopRequest?.tagline),
          description: text(shopRequest?.description),
          phone: text(shopRequest?.phone),
          hours: text(shopRequest?.hours),
          coverImageUrl: text(shopRequest?.cover_image_url),
          gallery: parseGallery(shopRequest?.gallery),
        });
      } catch (error) {
        // A stale invocation (superseded by React re-running this effect,
        // e.g. under StrictMode's dev double-invoke) must not touch shared
        // state or log -- only the active invocation gets a say.
        if (cancelled) return;

        // Right after a fresh page load, getUser() can throw
        // AuthSessionMissingError before the browser's Supabase client has
        // finished reading the just-set session cookies into memory -- the
        // proxy (middleware) already guarantees a valid session existed at
        // request time for this route, so that's a hydration race, not a
        // real signed-out state. AuthRetryableFetchError is a transient
        // network blip. Retry a couple times with backoff for both.
        if ((isAuthRetryableFetchError(error) || isAuthSessionMissingError(error)) && attempt < 2) {
          retryTimeout = window.setTimeout(() => loadShopData(attempt + 1), 1500 * (attempt + 1));
          return;
        }
        console.error("Failed to load shop owner data:", error);
      }
    };

    loadShopData();

    return () => {
      cancelled = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, []);

  /**
   * Loads the storefront as customers get it, plus the payment details.
   *
   * Deliberately two reads rather than one: the customer-facing half comes
   * from shops_public through the shared loader, so this screen cannot show
   * the owner a field customers never see; the payment half is read straight
   * off the shop row, because it is exactly the part shops_public withholds --
   * a shop's collecting account is not directory information.
   */
  const refreshStorefrontView = useCallback(async () => {
    if (!shopRequestId) {
      setShopProfile(null);
      setPayment({ qrUrl: "", instructions: "", accountName: "", accountNumber: "" });
      return;
    }

    setIsLoadingProfile(true);
    const supabase = createClient();
    try {
      const [profile, paymentRow] = await Promise.all([
        loadShopProfile(supabase, shopRequestId),
        supabase
          .from("shops")
          .select(
            "payment_qr_url, payment_instructions, payment_account_name, payment_account_number, " +
              "allowed_materials"
          )
          .eq("id", shopRequestId)
          .maybeSingle(),
      ]);

      setShopProfile(profile);

      // A schema without the payment columns is not an error worth shouting
      // about here -- the editor already explains the migration.
      const row = (paymentRow.data ?? {}) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === "string" ? value : "");
      setPayment({
        qrUrl: text(row.payment_qr_url),
        instructions: text(row.payment_instructions),
        accountName: text(row.payment_account_name),
        accountNumber: text(row.payment_account_number),
      });

      // Older shops may not have declared stock. Keep that state visible so
      // the owner can choose materials and colors before the next save.
      const stocked = Array.isArray(row.allowed_materials)
        ? (row.allowed_materials as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      setSavedShopMaterials(stocked);
    } catch (error) {
      console.error("Failed to load the storefront view:", error);
    } finally {
      setIsLoadingProfile(false);
    }
  }, [shopRequestId]);

  useEffect(() => {
    void refreshStorefrontView();
  }, [refreshStorefrontView]);

  /**
   * The QR is in a private bucket, so what is stored is a path, not a URL.
   * Signed links expire, which is why this re-runs off the path rather than
   * being resolved once at load.
   */
  useEffect(() => {
    if (!payment.qrUrl) {
      setQrPreview(null);
      return;
    }
    let cancelled = false;
    void signedUrlFor(QR_BUCKET, payment.qrUrl).then((url) => {
      if (!cancelled) setQrPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [payment.qrUrl]);

  const fetchShopTemplates = useCallback(async (shopId: string) => {
    setIsLoadingTemplates(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_templates")
        .select("id, shop_id, title, description, tag, cad_state, preview_url, allowed_materials, created_at, is_hidden, model_path")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load shop templates:", error);
        setShopTemplates([]);
      } else {
        setShopTemplates((data ?? []) as DesignTemplate[]);
      }
    } catch (thrown) {
      // See fetchShopOrders: the throw, not the error, is what used to strand
      // this tab on its spinner.
      console.error("Failed to load shop templates:", thrown);
      setShopTemplates([]);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, []);

  useEffect(() => {
    if (!myShopId) {
      setShopTemplates([]);
      return;
    }
    fetchShopTemplates(myShopId);
  }, [myShopId, fetchShopTemplates]);

  // A design staged from the 3D designer's "Upload to Templates" button --
  // pick it up, pre-fill the title, and open the modal so the shop owner
  // just adds a tag/description before publishing.
  useEffect(() => {
    if (!myShopId) return;
    try {
      const raw = window.localStorage.getItem("pending-template-design");
      if (!raw) return;
      const staged = JSON.parse(raw) as PendingTemplateDesign;
      if (staged.shopId !== myShopId) return;

      setPendingTemplateDesign(staged);
      setNewTemplateTitle(staged.projectName || "Custom Chair Design");
      setIsAddTemplateModalOpen(true);
    } catch (error) {
      console.error("Failed to load staged template design:", error);
    }
  }, [myShopId]);

  const editingTemplate = shopTemplates.find((template) => template.id === editingTemplateId) ?? null;

  const closeTemplateModal = () => {
    window.localStorage.removeItem("pending-template-design");
    setPendingTemplateDesign(null);
    setEditingTemplateId(null);
    setNewTemplateTitle("");
    setNewTemplateTag("");
    setNewTemplateDescription("");
    // Cleared with everything else, or the finishes ticked for one template
    // carry over silently into the next one published or edited.
    setTemplateMaterials([]);
    setIsAddTemplateModalOpen(false);
  };

  /**
   * Hides a template from customers, or shows it again, without deleting it
   * (design_templates.is_hidden; RLS keeps hidden rows from customers). The
   * card changes at once and changes back if the database refuses.
   */
  const toggleTemplateHidden = async (template: DesignTemplate) => {
    const next = !template.is_hidden;
    setTemplateHideError(null);
    setHidingTemplateId(template.id);
    setShopTemplates((list) => list.map((t) => (t.id === template.id ? { ...t, is_hidden: next } : t)));
    const { error } = await createClient().from("design_templates").update({ is_hidden: next }).eq("id", template.id);
    setHidingTemplateId(null);
    if (error) {
      setShopTemplates((list) => list.map((t) => (t.id === template.id ? { ...t, is_hidden: !next } : t)));
      setTemplateHideError(uiText(next ? "Couldn't hide “{0}”. Please try again." : "Couldn't show “{0}”. Please try again.", { 0: template.title }));
      return;
    }
    notifySuccess(next ? "Template hidden from customers" : "Template visible to customers again");
    // The Storefront section's "what customers see" copy is read separately.
    void refreshStorefrontView();
  };

  const handleEditTemplateClick = (template: DesignTemplate) => {
    setEditingTemplateId(template.id);
    setNewTemplateTitle(template.title);
    setNewTemplateTag(template.tag || "");
    setNewTemplateDescription(template.description || "");
    // Loaded rather than left as whatever the form last held. Saving writes
    // this field back, so an edit that opened with nothing ticked used to
    // erase the shop's choice and quietly allow every finish.
    setTemplateMaterials(templateMaterialsForEdit(template.allowed_materials));
    setIsAddTemplateModalOpen(true);
  };

  const { required: requiredTemplateDetails, missing: missingTemplateDetails } = validateTemplateDetails(
    { title: newTemplateTitle, tag: newTemplateTag, description: newTemplateDescription },
    editingTemplate
  );

  const handleSaveTemplate = async () => {
    if (!myShopId || missingTemplateDetails.length || !currentUserId) return;

    setIsSavingTemplate(true);
    try {
      const supabase = createClient();

      if (editingTemplateId) {
        const { error } = await supabase
          .from("design_templates")
          .update({
            title: newTemplateTitle.trim(),
            description: newTemplateDescription.trim() || null,
            tag: newTemplateTag.trim() || null,
            allowed_materials: templateMaterialsForSave(templateMaterials),
          })
          .eq("id", editingTemplateId);

        if (error) {
          console.error("Failed to update template:", error);
          setNotice(templateSaveErrorMessage(error.message, "Could not save that template."));
          return;
        }
      } else {
        // A template is made from a 3D design -- a photo turned into a model,
        // or a piece published from the studio -- never from a blank form.
        // Blank ones were listings a customer could not open in the studio,
        // so the form no longer offers that; this refuses it outright too.
        if (!pendingTemplateDesign) {
          setNotice("A template needs a 3D design. Make one from a photo, or design a piece in the studio and choose “Publish as Template”.");
          return;
        }
        const templateCadState = JSON.parse(pendingTemplateDesign.cadState);
        const { error } = await supabase.from("design_templates").insert({
          shop_id: myShopId,
          title: newTemplateTitle.trim(),
          description: newTemplateDescription.trim() || null,
          tag: newTemplateTag.trim() || null,
          allowed_materials: templateMaterialsForSave(templateMaterials),
          cad_state: templateCadState,
          // Denormalised out of cad_state so the storage policy can find it.
          // Without it a customer is refused the model behind a generated
          // template; see generatedModelPath.
          model_path: generatedModelPath(templateCadState),
          preview_url: pendingTemplateDesign?.previewUrl || null,
          created_by: currentUserId,
        });

        if (error) {
          console.error("Failed to create template:", error);
          setNotice(templateSaveErrorMessage(error.message, "Could not publish that template."));
          return;
        }

        // A generated piece becoming a template is the outcome its generation
        // was waiting for; it also closes the generation to further relabels.
        // Best-effort: the template is published either way, and one left
        // 'pending' only goes on showing as unfinished on the photo page.
        const generationTaskId = taskIdFromModelPath(generatedModelPath(templateCadState));
        if (generationTaskId) {
          await supabase.rpc("set_generation_outcome", { p_task_id: generationTaskId, p_outcome: "accepted" });
        }
      }

      notifySaved(editingTemplateId ? "Template saved" : "Template published");
      closeTemplateModal();
      await fetchShopTemplates(myShopId);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  /** Asked through the app's own dialog; `templatePendingDelete` holds the answer. */
  const handleDeleteTemplate = async (template: DesignTemplate) => {
    if (!myShopId) return;

    setDeletingTemplateId(template.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("design_templates").delete().eq("id", template.id);

      if (error) {
        console.error("Failed to delete template:", error);
        setNotice(error.message || "Could not delete that template.");
        return;
      }

      if (editingTemplateId === template.id) closeTemplateModal();
      await fetchShopTemplates(myShopId);
      notifySuccess("Template deleted");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  /**
   * The shop's incoming queue.
   *
   * Wrapped, for the reason spelled out on the customer side's
   * fetchCustomerOrders: Supabase returns an error for a query the server
   * refused and throws for one that never got there, and a token it cannot
   * refresh is the second kind. Unguarded, the throw skipped
   * `setIsLoadingOrders(false)` and the queue sat on "Loading orders…" until
   * the tab was closed.
   */
  const fetchShopOrders = useCallback(async (shopId: string) => {
    setIsLoadingOrders(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_orders")
        .select("id, shop_id, customer_user_id, project_name, furniture_type, estimated_price, budget_min, budget_max, cad_state, preview_url, notes, reference_images, status, created_at, quoted_total, downpayment_percent, downpayment_amount, quote_lines, customer_response, customer_responded_at, payment_receipt_url, payment_reference, payment_rejected_reason, decline_reason, refund_status, refund_reason, refund_requested_at, refund_declined_reason, refund_decided_at, refund_reference, refund_amount")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load orders:", error);
        setOrders([]);
        return;
      }

      const nextOrders = (data ?? []) as DesignOrder[];
      setOrders(nextOrders);

      const customerIds = Array.from(new Set(nextOrders.map((order) => order.customer_user_id)));
      if (customerIds.length > 0) {
        // Customer names come from the display-name view; the profile table
        // itself only ever returns the signed-in user's own row.
        const { data: customers } = await supabase
          .from(USER_NAMES_TABLE)
          .select("id, full_name")
          .in("id", customerIds);

        const names: Record<string, string> = {};
        (customers ?? []).forEach((customer) => {
          names[customer.id] = customer.full_name || "Customer";
        });
        setOrderCustomerNames(names);
      }
    } catch (thrown) {
      console.error("Failed to load orders:", thrown);
      setOrders([]);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    if (!myShopId) {
      setOrders([]);
      return;
    }
    fetchShopOrders(myShopId);
  }, [myShopId, fetchShopOrders]);

  /**
   * Keeps orders current while the customer acts on the other side.
   *
   * The fetch above ran once per session: a customer accepting a quote or
   * submitting a receipt never updated this list until the page was reloaded.
   * Refetching on any change is simpler and safer than patching the changed
   * row from the payload by hand, and the table is small per shop.
   */
  useEffect(() => {
    if (!myShopId) return;
    const supabase = createClient();
    const channel = supabase.channel(`shop-orders-${myShopId}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "design_orders", filter: `shop_id=eq.${myShopId}` },
      () => fetchShopOrders(myShopId)
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myShopId, fetchShopOrders]);

  // The shop's rating used to be fetched here as well, for a stat tile on the
  // Overview section. It is read by loadShopProfile now, the same way the
  // customer page reads it, and shown in the storefront below -- so this was a
  // second query for a number already on screen.

  // Joining also publishes this shop as online to every customer browsing.
  const onlineUserIds = useOnlineUsers(currentUserId);

  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;
  // Escape, focus and the scroll lock for the two dialogs drawn in this file.
  const templatePanelRef = useModalA11y(isAddTemplateModalOpen, closeTemplateModal);

  const [isRefundBusy, setIsRefundBusy] = useState(false);

  /**
   * Answers a refund request: refused with a reason, or paid with a reference.
   *
   * Recording a refund is not making one. The transfer leaves the shop's own
   * account -- FurniCraft never held the money -- so this writes down what the
   * shop says it sent, which is what the customer will check their statement
   * against. Marking it here without sending it is a lie the customer will
   * discover, not a way to close the request.
   */
  const answerRefund = useCallback(
    async (
      orderId: string,
      answer: { kind: "declined"; reason: string } | { kind: "refunded"; amount: number; reference: string }
    ) => {
      setIsRefundBusy(true);
      try {
        const supabase = createClient();
        const patch: Record<string, unknown> =
          answer.kind === "declined"
            ? {
                refund_status: "declined",
                refund_declined_reason: answer.reason,
                refund_decided_at: new Date().toISOString(),
                refund_decided_by: currentUserId,
              }
            : {
                refund_status: "refunded",
                refund_amount: answer.amount,
                refund_reference: answer.reference,
                refund_decided_at: new Date().toISOString(),
                refund_decided_by: currentUserId,
              };

        const { error } = await supabase.from("design_orders").update(patch).eq("id", orderId);
        if (error) {
          setNotice(error.message || "That refund update was refused. Refresh and try again.");
          return;
        }
        setOrders((current) =>
          current.map((order) => (order.id === orderId ? { ...order, ...patch } : order))
        );
        notifySuccess(
          answer.kind === "declined"
            ? "The customer has been told you cannot refund this."
            : "Refund recorded. The customer can now check it against their own account."
        );
      } finally {
        setIsRefundBusy(false);
      }
    },
    [currentUserId]
  );
  const isApproved = shopOwnerStatus === "approved";

  // Opening this dashboard is what keeps a shop active (see lib/shop-activity).
  // A shop the 90-day rule deactivated comes back on this visit, and the owner
  // is told so rather than left to notice it in Settings.
  useEffect(() => {
    if (!isApproved) return;
    let cancelled = false;
    void touchShopActivity().then(({ reactivated }) => {
      if (cancelled || !reactivated) return;
      setShopIsActive(true);
      notifySuccess("Welcome back! Your shop is active again and visible to customers.");
    });
    return () => {
      cancelled = true;
    };
  }, [isApproved]);
  // The sidebar badge and the "Needs your response" heading must agree, so
  // both count the same predicate: an actionable status, or a refund the shop
  // has not answered.
  const shopOwesAnAnswer = (order: DesignOrder) =>
    SHOP_ACTIONABLE.includes(order.status as OrderStatus) || needsRefundAnswer(order);
  const pendingOrdersCount = orders.filter(shopOwesAnAnswer).length;
  const totalUnreadConversations = Object.values(customerUnreadIds).filter(Boolean).length;
  const visibleOrders = orderFilter === "all" ? orders : orders.filter((order) => order.status === orderFilter);

  /**
   * The filter chips and how many of them lead nowhere.
   *
   * Eight chips wrap to three rows on a phone, and on a typical day three of
   * them are empty -- a tap target whose only answer is "no orders right now".
   * The empty ones fold behind a toggle below sm; from sm up they all fit on
   * one or two rows and a count of zero is worth seeing at a glance.
   */
  const orderFilterChips = (["all", ...ORDER_STATUSES] as const).map((status) => ({
    status,
    count: status === "all" ? orders.length : orders.filter((o) => o.status === status).length,
  }));
  const emptyOrderFilterCount = orderFilterChips.filter(
    (chip) => chip.count === 0 && chip.status !== orderFilter
  ).length;

  // SHOP_ACTIONABLE and CUSTOMER_ACTIONABLE already partition the live
  // statuses between the two sides, so the groups below reuse them rather than
  // inventing a second opinion -- which also keeps the sidebar badge and the
  // "Needs your response" heading counting the same thing.
  const byNewest = (a: DesignOrder, b: DesignOrder) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

  const needsResponse = orders.filter(shopOwesAnAnswer).sort(byNewest);
  // An order can only sit in one group, and an unanswered refund outranks
  // whatever else the order was doing -- otherwise it appears twice, once as
  // work and once as history.
  const waitingOnCustomer = orders
    .filter((o) => CUSTOMER_ACTIONABLE.includes(o.status as OrderStatus) && !needsRefundAnswer(o))
    .sort(byNewest);
  const orderValue = (o: DesignOrder) =>
    Number(o.quoted_total ?? o.estimated_price ?? 0);
  const sumOf = (list: DesignOrder[]) => list.reduce((total, o) => total + orderValue(o), 0);

  const inProductionOrders = orders.filter((o) => o.status === "in_production");
  const awaitingPayment = orders.filter(
    (o) => o.status === "quoted" || o.status === "confirmed" || o.status === "payment_submitted"
  );
  const completedOrders = orders.filter((o) => o.status === "completed");

  /**
   * Whether this shop can actually be paid.
   *
   * A QR on its own counts: plenty of shops hand over nothing but the QR
   * image. A name with no number does not -- there is nothing for the
   * customer to send to.
   */
  const hasPaymentDetails = Boolean(payment.qrUrl || payment.accountNumber.trim());

  const closedOrders = orders
    .filter((o) => (o.status === "completed" || o.status === "declined") && !needsRefundAnswer(o))
    .sort(byNewest);

  /**
   * Sends a price to the customer. The 5% floor is also a CHECK constraint on
   * the table, so a hand-crafted request cannot get under it -- this is the
   * friendly half of the same rule.
   */
  const handleSendQuote = async (orderId: string) => {
    setQuoteError(null);
    const resolved = resolveQuote(quoteTotal, quoteLineDrafts);
    const percent = Number(quotePercent.replace(/[^0-9.]/g, ""));

    if ("error" in resolved) {
      setQuoteError(resolved.error);
      return;
    }
    const { total, lines } = resolved;
    if (!Number.isFinite(percent) || percent < DOWNPAYMENT_MIN_PERCENT || percent > 100) {
      setQuoteError(`Downpayment must be between ${DOWNPAYMENT_MIN_PERCENT}% and 100%.`);
      return;
    }

    setIsUpdatingOrderStatus(true);
    const previousStatus = orders.find((order) => order.id === orderId)?.status ?? null;
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("design_orders")
        .update({
          status: "quoted",
          quoted_total: total,
          // With the total every time: null clears an emptied breakdown.
          quote_lines: lines,
          downpayment_percent: percent,
          quoted_at: new Date().toISOString(),
          quoted_by: userData.user?.id ?? null,
        })
        .eq("id", orderId);

      if (error) {
        setQuoteError(error.message);
        return;
      }

      setQuoteTotal('');
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: "quoted",
                quoted_total: total,
                quote_lines: lines,
                downpayment_percent: percent,
                downpayment_amount: Math.round(total * percent) / 100,
              }
            : order
        )
      );
      notifySuccess(orderSuccessMessage({ status: "quoted" }, previousStatus) ?? "Quote sent");
    } finally {
      setIsUpdatingOrderStatus(false);
    }
  };

  const handleToggleShopActive = async (nextActive: boolean) => {
    if (!shopRequestId || isTogglingShopActive) return;
    setIsTogglingShopActive(true);
    // Optimistic: this only ever hides/shows the shop in shops_public and
    // gates new orders, neither of which the shop owner needs to wait on a
    // round trip to see reflected in their own settings toggle.
    setShopIsActive(nextActive);
    const supabase = createClient();
    const { error } = await supabase
      .from("shops")
      .update({ is_active: nextActive })
      .eq("id", shopRequestId);
    if (error) setShopIsActive(!nextActive);
    else notifySaved("Setting saved");
    setIsTogglingShopActive(false);
  };

  /**
   * Pauses or resumes new commissions without unlisting the shop.
   *
   * Optimistic for the same reason handleToggleShopActive is: the switch is
   * the owner's own view of their own setting, and making them watch a
   * round trip to see it move is worse than reverting the rare failure.
   */
  const handleToggleAcceptingOrders = async (nextAccepting: boolean) => {
    if (!shopRequestId || isTogglingAccepting) return;
    setIsTogglingAccepting(true);
    setShopAcceptingOrders(nextAccepting);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("shops")
        .update({ accepting_orders: nextAccepting })
        .eq("id", shopRequestId);
      if (error) {
        console.error("Failed to change whether the shop takes orders:", error);
        setShopAcceptingOrders(!nextAccepting);
      } else {
        notifySaved("Setting saved");
      }
    } catch (thrown) {
      console.error("Failed to change whether the shop takes orders:", thrown);
      setShopAcceptingOrders(!nextAccepting);
    } finally {
      setIsTogglingAccepting(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: string, declineReason?: string) => {
    setIsUpdatingOrderStatus(true);
    const previousStatus = orders.find((order) => order.id === orderId)?.status ?? null;
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const now = new Date().toISOString();

      // Approving a receipt is the shop asserting it saw the money in its own
      // GCash or bank app. FurniCraft records who said so and when; it cannot
      // and does not verify the transfer itself.
      const patch: Record<string, unknown> = { status };
      if (status === "in_production") {
        patch.payment_approved_at = now;
        patch.payment_approved_by = userData.user?.id ?? null;
        patch.production_started_at = now;
      }
      if (status === "completed") patch.completed_at = now;
      if (status === "confirmed") {
        // Receipt rejected: send them back to pay, and clear the old proof.
        // The reference goes too -- leaving it would let the same receipt be
        // re-submitted unchanged, which is what the database guard now checks.
        patch.payment_receipt_url = null;
        patch.payment_submitted_at = null;
        patch.payment_reference = null;
        if (declineReason) patch.payment_rejected_reason = declineReason;
      }
      if (status === "declined" && declineReason) patch.decline_reason = declineReason;

      const { error } = await supabase.from("design_orders").update(patch).eq("id", orderId);
      if (error) {
        console.error("Failed to update order status:", error);
        setNotice(error.message || "That order update was refused. Refresh and try again.");
        return;
      }
      if (status === "completed") sendOrderReadyEmail(orderId);
      const done = orderSuccessMessage(patch, previousStatus);
      if (done) notifySuccess(done);
      setOrders((current) =>
        current.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status,
                ...(status === "confirmed"
                  ? {
                      payment_receipt_url: null,
                      payment_submitted_at: null,
                      payment_reference: null,
                      payment_rejected_reason: declineReason ?? null,
                    }
                  : {}),
                ...(status === "declined" ? { decline_reason: declineReason ?? null } : {}),
              }
            : order
        )
      );
    } finally {
      setIsUpdatingOrderStatus(false);
    }
  };

  // Shared helper to build threads + peer names from raw messages
  const buildThreadsFromMessages = useCallback(async (
    supabase: ReturnType<typeof createClient>,
    messages: Array<{
      id: string;
      shop_id: string;
      sender_user_id: string | null;
      target_user_id: string | null;
      sender_role: string;
      text: string;
      created_at: string;
    }>
  ) => {
    const threads: Record<string, Message[]> = {};
    const customerIds = new Set<string>();

    for (const msg of messages) {
      const customerId = msg.sender_role === "customer" ? msg.sender_user_id : msg.target_user_id;
      if (!customerId) continue;
      customerIds.add(customerId);
      if (!threads[customerId]) threads[customerId] = [];
      threads[customerId].push({
        id: msg.id,
        sender: msg.sender_role === "shop_owner" ? "shop" : "user",
        senderRole: msg.sender_role as "customer" | "shop_owner",
        text: msg.text,
        time: new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        shopId: msg.shop_id,
        senderUserId: msg.sender_user_id,
        targetUserId: msg.target_user_id,
        created_at: msg.created_at,
        kind: (msg as { kind?: string }).kind ?? "text",
        payload: (msg as { payload?: unknown }).payload ?? null,
      });
    }

    // Fetch peer names for all customer IDs
    const peerNames: Record<string, string> = {};
    if (customerIds.size > 0) {
      const { data: customers } = await supabase
        .from(USER_NAMES_TABLE)
        .select("id, full_name")
        .in("id", Array.from(customerIds));

      if (customers) {
        for (const customer of customers) {
          peerNames[customer.id] = customer.full_name || "Customer";
        }
      }
      for (const customerId of customerIds) {
        if (!peerNames[customerId]) peerNames[customerId] = "Customer";
      }
    }

    return { threads, peerNames };
  }, []);

  // Load customer conversations
  useEffect(() => {
    if (!myShopId || !currentUserId) return;

    const supabase = createClient();

    const fetchConversations = async () => {
      const { data: messages } = await supabase
        .from("shop_messages")
        .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
        .eq("shop_id", myShopId)
        .order("created_at", { ascending: true });

      if (!messages) return;

      const { threads, peerNames } = await buildThreadsFromMessages(supabase, messages);

      setShopThreads(threads);
      setConversationPeerNames(peerNames);

      // No room is opened for them. Auto-selecting the first thread marked
      // someone's conversation as read before the shop had looked at it, and
      // on every poll the "first" thread is whichever sorted first, not
      // whichever needs an answer. A deep link or a click opens a thread; the
      // list on its own does not.
    };

    // Initial load
    fetchConversations();

    // Poll every 1500ms for new messages (realtime replacement)
    const interval = window.setInterval(fetchConversations, 1500);
    return () => window.clearInterval(interval);
  }, [myShopId, currentUserId, buildThreadsFromMessages]);

  const currentThread = selectedCustomerRoomId ? shopThreads[selectedCustomerRoomId] || [] : [];
  const customerName = selectedCustomerRoomId ? conversationPeerNames[selectedCustomerRoomId] || "Customer" : "";
  const customerRoomEntries = Object.entries(shopThreads).sort((a, b) => {
    const lastA = a[1][a[1].length - 1]?.created_at || "";
    const lastB = b[1][b[1].length - 1]?.created_at || "";
    return new Date(lastB).getTime() - new Date(lastA).getTime();
  });

  // Pinning the thread to its newest message belongs to MessengerThread now,
  // which owns that scroll container and does it in a layout effect.

  // Mark conversation as read
  const markConversationRead = useCallback(
    async (shopId: string, customerId: string) => {
      if (!currentUserId || !customerId) return;
      if (conversationReadStateAvailableRef.current === false) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversation_read_state")
        .upsert(
          {
            user_id: currentUserId,
            shop_id: shopId,
            peer_user_id: customerId,
            last_read_at: new Date().toISOString(),
          },
          { onConflict: "user_id,shop_id,peer_user_id" }
        );

      if (error) {
        const isMissingTable = error.code === "PGRST205" || error.code === "42P01" || /does not exist/i.test(error.message || "");
        const isPermissionDenied = /permission denied|row level security|policy/i.test(error.message || "");
        if (isMissingTable || isPermissionDenied) {
          conversationReadStateAvailableRef.current = false;
        } else {
          console.error("Failed to mark conversation as read:", error);
        }
      } else {
        conversationReadStateAvailableRef.current = true;
      }
    },
    [currentUserId]
  );

  // Send message
  /**
   * Jumps to the conversation with one customer, optionally with a message
   * already typed. The draft is prefilled rather than sent: pick up usually
   * comes with hours or an address, and the shop should add that before it
   * goes out.
   */
  /**
   * Apply `?section=` / `?customer=`, on arrival and on a same-page deep link.
   *
   * Still read from the URL rather than `useSearchParams`, for the prerendering
   * reason above. It is no longer mount-only: a message notification opened
   * while the shop is already on this page performs no remount, so it arrives
   * as an event instead and is handled through the same path.
   */
  const applyDeepLink = useCallback((params: URLSearchParams) => {
    const section = params.get("section");
    const customer = params.get("customer");
    const deletionCancelled = params.get("deletion_cancelled");

    if (section && SHOP_NAV.some((item) => item.id === section)) {
      setActiveSection(section as ShopSection);
    }
    if (customer) {
      lastManualRoomSelectionRef.current = Date.now();
      setSelectedCustomerRoomId(customer);
      // On a phone the thread is its own screen over the list; without this
      // the link landed on the list with the customer merely selected.
      if (section === "messages") {
        setIsMobileThreadOpen(true);
        setIsOrderDetailModalOpen(false);
      }
    }
    if (deletionCancelled) setNotice("Account deletion cancelled — welcome back.");

    if (section || customer || deletionCancelled) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useDeepLink(applyDeepLink);

  const messageCustomer = useCallback((customerUserId: string, prefill?: string) => {
    lastManualRoomSelectionRef.current = Date.now();
    setSelectedCustomerRoomId(customerUserId);
    if (prefill) setMessageDraft(prefill);
    setIsOrderDetailModalOpen(false);
    goToSection("messages");
  }, [goToSection]);

  const handleSendMessage = useCallback(async () => {
    if (!messageDraft.trim() || !selectedCustomerRoomId || !myShopId || !currentUserId) return;

    const supabase = createClient();
    const { error } = await supabase.from("shop_messages").insert({
      shop_id: myShopId,
      sender_user_id: currentUserId,
      target_user_id: selectedCustomerRoomId,
      sender_role: "shop_owner",
      text: messageDraft,
    });

    if (error) {
      console.error("Failed to send message:", error.message, error.code, error.details, error.hint);
      setNotice(error.message || "Your message was not sent.");
      return;
    }

    setMessageDraft("");

    // Reload conversations after sending (poll will also catch it, but this gives instant feedback)
    const { data: messages } = await supabase
      .from("shop_messages")
      .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
      .eq("shop_id", myShopId)
      .order("created_at", { ascending: true });

    if (!messages) return;

    const { threads, peerNames } = await buildThreadsFromMessages(supabase, messages);
    setShopThreads(threads);
    setConversationPeerNames(peerNames);
  }, [messageDraft, selectedCustomerRoomId, myShopId, currentUserId, buildThreadsFromMessages]);

  /**
   * Sends a photo to the customer whose room is open.
   *
   * The shop needs this at least as much as the customer does: "is this the
   * grain you meant" is a photograph, not a paragraph. Uploaded before the
   * message row is written, so a failed upload leaves no message pointing at a
   * file that is not there.
   */
  const handlePhotoChosen = async (file: File | null | undefined) => {
    if (!file || !selectedCustomerRoomId || !myShopId || !currentUserId) return;

    setIsSendingPhoto(true);
    try {
      // The customer's id, not the sender's: the pair (shop, customer) is the
      // conversation, and the storage policies read it out of the path.
      const uploaded = await uploadChatPhoto(myShopId, selectedCustomerRoomId, file);
      if ("error" in uploaded) {
        setNotice(uploaded.error);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.from("shop_messages").insert({
        shop_id: myShopId,
        sender_user_id: currentUserId,
        target_user_id: selectedCustomerRoomId,
        sender_role: "shop_owner",
        text: CHAT_PHOTO_TEXT,
        kind: "image",
        payload: uploaded.photo,
      });

      if (error) {
        setNotice(error.message || "That photo was not sent.");
        return;
      }

      const { data: messages } = await supabase
        .from("shop_messages")
        .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
        .eq("shop_id", myShopId)
        .order("created_at", { ascending: true });
      if (!messages) return;

      const { threads, peerNames } = await buildThreadsFromMessages(supabase, messages);
      setShopThreads(threads);
      setConversationPeerNames(peerNames);
    } finally {
      setIsSendingPhoto(false);
    }
  };

  return (
    <>
    {/* The app frame's top edge, above the sidebar as well as the content:
        says "Shop mode" on every screen of this dashboard, in walnut, so an
        owner never mistakes it for their customer side. */}
    <ModeBar mode="shop" shopName={shopProfile?.shop.name} shopIsPro={shopProfile?.shop.isPro} />
    <div className="flex min-h-screen bg-[var(--fc-bg)]">
      {/* Drawer scrim -- mobile only; above `lg` the sidebar is always in flow. */}
      {isSidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-[#2b1b14]/60 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 transition-transform duration-300 lg:sticky lg:top-[var(--fc-modebar-h,0px)] lg:z-auto lg:h-[calc(100vh-var(--fc-modebar-h,0px))] lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="dashboard-logo">{uiText("FurniCraft")}</h1>
            <p className="truncate text-xs text-[var(--fc-muted)]">{uiText("Shop dashboard")}</p>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            aria-label={uiText("Close navigation")}
            className="text-[var(--fc-muted)] transition hover:text-[var(--fc-text)] lg:hidden"
          >
            <IconClose aria-hidden className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label={uiText("All sections")} className="space-y-1">
          {SHOP_NAV.map((item) => {
            const isActive = activeSection === item.id;
            const badge =
              item.id === "orders" ? pendingOrdersCount : item.id === "messages" ? totalUnreadConversations : 0;
            // Owners can edit their storefront and get support while awaiting approval.
            const locked = !isApproved && item.id !== "storefront" && item.id !== "support";
            return (
              <button
                key={item.id}
                type="button"
                disabled={locked}
                onClick={() => {
                  goToSection(item.id);
                  setIsSidebarOpen(false);
                }}
                aria-current={isActive ? "page" : undefined}
                title={locked ? uiText("Available once your shop is approved") : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                    : "text-[var(--fc-text)] hover:bg-[rgba(178,106,56,0.07)]"
                } ${locked ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <item.icon aria-hidden className="h-4 w-4" />
                <span className="flex-1 text-left">{uiText(item.label)}</span>
                {badge > 0 ? (
                  <span className="rounded-full bg-fc-danger px-1.5 py-0.5 text-[10px] font-bold text-fc-danger-fg">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-1 border-t border-[var(--fc-border)] pt-4">
          <button
            type="button"
            onClick={() => router.push("/customize-furniture")}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.07)]"
          >
            <IconEdit aria-hidden className="h-4 w-4" /> <span>{uiText("Open 3D Designer")}</span>
          </button>
          <a
            href="/protected"
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--fc-text)] transition hover:bg-[rgba(178,106,56,0.07)]"
          >
            <IconOverview aria-hidden className="h-4 w-4" /> <span>{uiText("Customer dashboard")}</span>
          </a>
          <div className="px-3 pt-2">
            <ThemeSwitcher />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="fc-shop-header sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-3 shadow-sm sm:px-6">
          {/* Phone header: the wordmark, the bell and the avatar. Which side
              this is is the mode bar's job, above. The menu button is gone with
              the drawer (the tab bar and the Account sheet replace it), and
              Back, the name and Sign out are desktop-only, as on the customer
              dashboard. */}
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <span className="dashboard-logo">{uiText("FurniCraft")}</span>
          </div>
          <div className="hidden min-w-0 items-center gap-3 lg:flex">
            <button
              type="button"
              onClick={() => router.push("/protected?profile=1")}
              aria-label={uiText("Edit your profile")}
              title={uiText("Edit your profile")}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--fc-avatar-bg,#3a3530)] text-[var(--fc-avatar-fg,#7a6e66)] transition hover:brightness-110"
            >
              {ownerAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ownerAvatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconProfile aria-hidden className="h-7 w-7 translate-y-1" />
              )}
            </button>
            <div className="min-w-0">
              <div className="truncate font-bold text-[var(--fc-text)]"><ShopName shop={{ name: shopOwnerName || fallbackName || uiText("Your shop"), isPro: shopProfile?.shop.isPro }} /></div>
              <p className="truncate text-xs text-[var(--fc-muted)]">{storefront.tagline || userEmail}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 lg:gap-3">
            <NotificationBell />
            <span className="hidden rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)] lg:inline-block">
              {isApproved ? uiText("Shop Owner") : shopOwnerStatus === "pending" ? uiText("Pending") : uiText("No shop")}
            </span>
            <div className="hidden lg:block">
              <LogoutButton />
            </div>
            <button
              type="button"
              className="dashboard-avatar-btn"
              aria-label={uiText("Your account")}
              aria-haspopup="dialog"
              aria-expanded={isAccountSheetOpen}
              onClick={() => setIsAccountSheetOpen(true)}
            >
              <span className="dashboard-avatar-face">
                {ownerAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ownerAvatarUrl} alt="" />
                ) : (
                  (shopOwnerName || fallbackName || "S").trim().charAt(0).toUpperCase()
                )}
              </span>
            </button>
          </div>
        </header>

        <main className="dashboard-main min-w-0 flex-1">
          <section className="space-y-4 p-4 sm:p-6">
            {notice ? (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-2xl border border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_10%,transparent)] px-4 py-3 text-sm text-[var(--fc-text)]"
              >
                <span className="min-w-0">{uiText(notice)}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label={uiText("Dismiss")}
                  className="shrink-0 rounded-full px-1.5 text-[var(--fc-muted)] transition-colors hover:text-[var(--fc-text)]"
                >
                  <IconClose aria-hidden className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <div className={`flex flex-wrap items-end justify-between gap-3${activeSection === "home" ? " hidden" : ""}`}>
              <div>
                <h2 className="text-2xl font-bold text-[var(--fc-text)]">{uiText(SECTION_META[activeSection].title)}</h2>
                <p className="text-sm text-[var(--fc-muted)]">{uiText(SECTION_META[activeSection].subtitle)}</p>
              </div>
              {isApproved && activeSection === "templates" ? (
                <PhotoTemplatePolicyButton className="btn btn-primary">{uiText("+ From a Photo")}</PhotoTemplatePolicyButton>
              ) : null}
              {activeSection === "storefront" && shopRequestId ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openStorefront()}
                    className="btn btn-primary"
                  >
                    <span className="inline-flex items-center gap-2"><IconEdit aria-hidden className="h-4 w-4" />{uiText(" Edit storefront")}</span>
                  </button>
                  {isApproved ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/shops/${shopRequestId}`)}
                      className="btn btn-secondary"
                    >
                      <span className="inline-flex items-center gap-2"><IconProfile aria-hidden className="h-4 w-4" />{uiText(" View Shop Page")}</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!isApproved ? (
              <div className={`status-banner ${shopOwnerStatus === "pending" ? "pending" : "none"}`}>
                <h3 className="text-lg font-semibold text-[var(--fc-text)]">
                  <span className="inline-flex items-center gap-2">{shopOwnerStatus === "pending" ? <IconClock aria-hidden className="h-5 w-5" /> : <IconSeller aria-hidden className="h-5 w-5" />}{shopOwnerStatus === "pending" ? uiText("Your shop application is under review") : uiText("You don't have an active shop yet")}</span>
                </h3>
                <p className="mt-1 text-sm text-[var(--fc-muted)]">
                  {shopOwnerStatus === "pending" ? uiText("Once an admin approves your seller application, orders, templates, and customer conversations will unlock here.") : uiText("Apply to become a shop owner from your customer dashboard to start publishing templates and receiving orders.")}
                </p>
                <a href="/protected" className={`${BACK_BUTTON_CLASS} mt-3`}>
                  <IconArrowLeft aria-hidden className="h-4 w-4" />{uiText("Back to dashboard")}</a>
              </div>
            ) : null}

            {activeSection === "home" ? (
              <ShopHome
                shopName={shopProfile?.shop.name ?? ""}
                shopIsPro={shopProfile?.shop.isPro}
                isApproved={isApproved}
                ordersCount={orders.length}
                // Decisions only (a price, a receipt, a refund): building is
                // the bench below, not something the owner has to answer.
                needsYou={needsResponse.filter((o) => o.status !== "in_production" || needsRefundAnswer(o))}
                onBench={inProductionOrders.filter((o) => !needsRefundAnswer(o))}
                customerNameFor={(id) => orderCustomerNames[id] || uiText("A customer")}
                isRefundRequest={(o) => needsRefundAnswer(o as DesignOrder)}
                renderOrderRow={(o) => (
                  <OrderRow
                    order={o as DesignOrder}
                    customerName={orderCustomerNames[o.customer_user_id] || uiText("Customer")}
                    onOpen={() => {
                      setSelectedOrderId(o.id);
                      setIsOrderDetailModalOpen(true);
                    }}
                  />
                )}
                money={{
                  awaitingPayment: sumOf(awaitingPayment),
                  onBench: sumOf(inProductionOrders),
                  completed: sumOf(completedOrders),
                }}
                latestMessage={(() => {
                  const [entry] = customerRoomEntries;
                  if (!entry) return null;
                  const [customerId, roomMessages] = entry;
                  const last = roomMessages[roomMessages.length - 1];
                  if (!last) return null;
                  return {
                    customerId,
                    customerName: conversationPeerNames[customerId] || "Customer",
                    text: `${last.senderRole === "shop_owner" ? "You: " : ""}${last.text}`,
                    time: last.time,
                    online: onlineUserIds.has(customerId),
                    unread: Boolean(customerUnreadIds[customerId]),
                  };
                })()}
                hasPaymentDetails={hasPaymentDetails}
                templatesCount={shopTemplates.length}
                setupReady={Boolean(shopProfile) && Boolean(myShopId) && !isLoadingTemplates}
                onOpenOrder={(orderId) => {
                  setSelectedOrderId(orderId);
                  setIsOrderDetailModalOpen(true);
                }}
                onOpenOrders={() => goToSection("orders")}
                onOpenMessage={(customerId) => {
                  messageCustomer(customerId);
                  setIsMobileThreadOpen(true);
                }}
                onAddPaymentDetails={() => openStorefront("payment")}
                onOpenTemplates={() => goToSection("templates")}
                onOpenStorefront={() => goToSection("storefront")}
              />
            ) : null}

            {/* Incoming Orders Card */}
            {isApproved && activeSection === "orders" ? (
            <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
              {/* Filter chips carry their own counts, so the queue can be triaged
                  without reading every row. */}
              <div className="flex flex-wrap gap-2">
                {orderFilterChips.map(({ status, count }) => {
                  const isActive = orderFilter === status;
                  const isEmpty = count === 0 && !isActive;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setOrderFilter(status)}
                      className={`rounded-full border px-3 py-1.5 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
                        isActive
                          ? "border-fc-ink-accent bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                          : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
                      } ${isEmpty ? `opacity-45 ${showEmptyOrderFilters ? "" : "hidden sm:block"}` : ""}`}
                    >
                      {status === "all" ? uiText("All") : orderStatusMeta(status).label}{" "}
                      <span className="tabular-nums opacity-70">{count}</span>
                    </button>
                  );
                })}

                {emptyOrderFilterCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowEmptyOrderFilters((open) => !open)}
                    aria-expanded={showEmptyOrderFilters}
                    className="rounded-full border border-dashed border-[var(--fc-border)] px-3 py-1.5 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold text-[var(--fc-muted)] transition-[color,border-color,transform] duration-150 ease-out hover:text-[var(--fc-text)] active:scale-[0.97] sm:hidden"
                  >
                    {showEmptyOrderFilters ? uiText("Hide empty") : uiText("+{0} empty", { 0: emptyOrderFilterCount })}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {isLoadingOrders ? (
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading orders…")}</p>
                ) : orders.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">{uiText("No orders yet — orders customers send from the 3D designer will show up here.")}</div>
                ) : orderFilter !== "all" ? (
                  /* An explicit filter is a question already asked; answer it flat. */
                  visibleOrders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">{uiText("No ")}{uiText(orderStatusMeta(orderFilter).label.toLowerCase())}{uiText(" orders right now.")}</div>
                  ) : (
                    visibleOrders.map((order) => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        customerName={orderCustomerNames[order.customer_user_id] || uiText("Customer")}
                        onOpen={() => {
                          setSelectedOrderId(order.id);
                          setIsOrderDetailModalOpen(true);
                        }}
                      />
                    ))
                  )
                ) : (
                  <>
                    {needsResponse.length ? (
                      <section>
                        <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--fc-ink-accent)]">{uiText("Needs your response · ")}{needsResponse.length}
                        </h4>
                        <div className="mt-2 space-y-2">
                          {needsResponse.map((order) => (
                            <OrderRow
                              key={order.id}
                              order={order}
                              customerName={orderCustomerNames[order.customer_user_id] || uiText("Customer")}
                              onOpen={() => {
                                setSelectedOrderId(order.id);
                                setIsOrderDetailModalOpen(true);
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">{uiText("Nothing needs your response right now.")}</div>
                    )}

                    {waitingOnCustomer.length ? (
                      <section className="pt-1">
                        <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Waiting on the customer · ")}{waitingOnCustomer.length}
                        </h4>
                        <div className="mt-2 space-y-2">
                          {waitingOnCustomer.map((order) => (
                            <OrderRow
                              key={order.id}
                              order={order}
                              customerName={orderCustomerNames[order.customer_user_id] || uiText("Customer")}
                              onOpen={() => {
                                setSelectedOrderId(order.id);
                                setIsOrderDetailModalOpen(true);
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {/* Completed and declined are history. They stay reachable,
                        but they do not get to bury the live queue -- nine of them
                        against three live orders was the original complaint. */}
                    {closedOrders.length ? (
                      <section className="pt-1">
                        <button
                          type="button"
                          onClick={() => setShowClosedOrders((open) => !open)}
                          aria-expanded={showClosedOrders}
                          className="flex w-full items-center gap-2 rounded-xl px-1 py-1 text-xs font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)] transition hover:text-[var(--fc-text)]"
                        >
                          <span aria-hidden className={showClosedOrders ? "rotate-90" : ""}>
                            ▸
                          </span>{uiText("Completed & declined · ")}{closedOrders.length}
                        </button>
                        {showClosedOrders ? (
                          <div className="mt-2 space-y-2">
                            {closedOrders.map((order) => (
                              <OrderRow
                                key={order.id}
                                order={order}
                                customerName={orderCustomerNames[order.customer_user_id] || uiText("Customer")}
                                dimmed
                                onOpen={() => {
                                  setSelectedOrderId(order.id);
                                  setIsOrderDetailModalOpen(true);
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            ) : null}

            {/* Shop Templates Card */}
            {isApproved && activeSection === "templates" ? (
            <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
              {templateHideError ? (
                <p role="alert" className="mb-3 text-sm font-semibold text-fc-danger">
                  {uiText(templateHideError)}
                </p>
              ) : null}
              {shopTemplates.some((t) => t.is_hidden) ? (
                <p className="mb-3 text-sm text-[var(--fc-muted)]">
                  {shopTemplates.filter((t) => t.is_hidden).length}{uiText(" hidden. Customers can't see or open those; tap the eye to show one again.")}</p>
              ) : null}
              {/* Two to a row on a phone, like the shop page's pieces; the
                  "From a photo" tile spans the row there. */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <PhotoTemplatePolicyButton
                  className="col-span-2 rounded-2xl border-2 md:col-span-1 border-dashed border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-4 transition-[border-color,background-color,transform] duration-150 ease-out hover:border-[#8b5a2b] hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.98]"
                >
                  <div className="flex h-full flex-col items-center justify-center py-4 text-center">
                    <svg aria-hidden viewBox="0 0 24 24" className="h-8 w-8 text-[var(--fc-ink-accent)]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                    <p className="mt-2 font-semibold text-[var(--fc-text)]">{uiText("From a Photo")}</p>
                    <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("Turn a photo of your piece into a 3D template")}</p>
                  </div>
                </PhotoTemplatePolicyButton>
                {isLoadingTemplates ? (
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading templates…")}</p>
                ) : (
                  shopTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={`relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--fc-panel)] ${
                        template.is_hidden ? "border-dashed border-[var(--fc-border)]" : "border-[var(--fc-border)]"
                      }`}
                    >
                      {/* Said in words, not only by fading: customers cannot
                          see or open a hidden template. */}
                      {template.is_hidden ? (
                        <span className="absolute left-2 top-2 z-10 inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-[rgba(20,12,6,0.72)] px-2.5 py-1 text-[11px] font-bold text-white">
                          <EyeOffIcon size={13} />{uiText("Hidden from customers")}</span>
                      ) : null}
                      {template.preview_url ? (
                        // 4:3, the shape the studio's product shot is taken in, so
                        // nothing is cropped off the top or bottom of the piece.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={template.preview_url}
                          alt={template.title}
                          className={`aspect-[4/3] w-full object-cover transition-[opacity,filter] duration-200 ${
                            template.is_hidden ? "opacity-40 grayscale" : ""
                          }`}
                        />
                      ) : null}
                      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
                        {template.tag ? (
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--fc-ink-accent)]">{template.tag}</div>
                        ) : null}
                        <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--fc-text)] sm:text-base">{template.title}</h4>
                        <MaterialTagChips tags={materialTagsForDesign(template.cad_state)} className="mt-0.5" />
                        {template.description ? (
                          <p className="mt-1 hidden text-sm text-[var(--fc-muted)] sm:block"><AdaptiveText text={template.description} automatic textClassName="line-clamp-2" /></p>
                        ) : null}
                        {/* Hide, edit, delete: a row under the title rather
                            than squeezed beside it, where on a 160px card the
                            title was left a word wide. */}
                          <div className="shop-template-actions">
                            {/* No link for a hidden one: it would open to "not found". */}
                            {template.is_hidden ? null : (
                              <CopyLinkButton
                                templateId={template.id}
                                title={template.title}
                                className="shop-template-action-btn"
                                compact
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => void toggleTemplateHidden(template)}
                              disabled={hidingTemplateId === template.id}
                              aria-pressed={Boolean(template.is_hidden)}
                              aria-label={
                                template.is_hidden ? uiText("Show {0} to customers", { 0: template.title }) : uiText("Hide {0} from customers", { 0: template.title })
                              }
                              title={template.is_hidden ? uiText("Show to customers") : uiText("Hide from customers")}
                              className="shop-template-action-btn"
                            >
                              {template.is_hidden ? <EyeIcon size={15} /> : <EyeOffIcon size={15} />}
                              <span aria-hidden className="shop-template-action-label">{template.is_hidden ? uiText("Show") : uiText("Hide")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditTemplateClick(template)}
                              aria-label={uiText("Edit {0}", { 0: template.title })}
                              className="shop-template-action-btn"
                            >
                              <IconEdit aria-hidden className="h-3.5 w-3.5" />
                              <span aria-hidden className="shop-template-action-label">{uiText("Edit")}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setTemplatePendingDelete(template)}
                              disabled={deletingTemplateId === template.id}
                              aria-label={uiText("Delete {0}", { 0: template.title })}
                              className="shop-template-action-btn danger"
                            >
                              {deletingTemplateId === template.id ? "…" : <IconTrash aria-hidden className="h-4 w-4" />}
                              <span aria-hidden className="shop-template-action-label">{uiText("Delete")}</span>
                            </button>
                          </div>
                        {template.cad_state ? (
                          <button
                            type="button"
                            onClick={() => {
                              const item = resolveDesignItem(template.cad_state);
                              if (!item) return;
                              if (!openItemInDesigner(item, `Template: ${template.title}`, template.allowed_materials)) return;
                              router.push("/customize-furniture");
                            }}
                            className="mt-auto w-full rounded-full border border-dashed border-[#8b5a2b] px-3 py-1.5 [@media(pointer:coarse)]:min-h-11 text-xs font-semibold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.97]"
                          >
                            <span className="inline-flex items-center gap-1.5"><IconEdit aria-hidden className="h-4 w-4" />{uiText(" Open in 3D")}</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            ) : null}

            {/* Customer Conversations Card */}
            {isApproved && activeSection === "messages" ? (
            <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                {/* Rooms List */}
                {/* min-w-0: a grid item defaults to min-width:auto, so this
                    column would refuse to shrink below its longest customer
                    name and push the rows out past the card on a phone. */}
                <aside className="min-w-0 space-y-3 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--fc-ink-accent)]">{uiText("Rooms")}</div>
                    <div className="text-sm text-[var(--fc-muted)]">{customerRoomEntries.length}{uiText(customerRoomEntries.length === 1 ? " active session" : " active sessions")}</div>
                  </div>

                  <div className="space-y-2.5">
                    {customerRoomEntries.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[var(--fc-border)] px-3 py-4 text-sm text-[var(--fc-muted)]">{uiText("No customer messages yet.")}</div>
                    ) : (
                      customerRoomEntries.map(([customerId, roomMessages]) => {
                        const lastMessage = roomMessages[roomMessages.length - 1];
                        const isSelected = selectedCustomerRoomId === customerId;
                        const isUnread = Boolean(customerUnreadIds[customerId]);

                        return (
                          <button
                            key={customerId}
                            type="button"
                            onClick={async () => {
                              lastManualRoomSelectionRef.current = Date.now();
                              setSelectedCustomerRoomId(customerId);
                              setIsMobileThreadOpen(true);
                              if (myShopId) {
                                await markConversationRead(myShopId, customerId);
                              }
                              setCustomerUnreadIds((current) => ({ ...current, [customerId]: false }));
                            }}
                            className={`relative w-full rounded-2xl border px-3.5 py-3 text-left transition ${
                              isSelected
                                ? "border-fc-ink-accent bg-[color-mix(in_srgb,var(--fc-accent)_12%,transparent)]"
                                : "border-transparent bg-[var(--fc-panel)] hover:bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)]"
                            }`}
                          >
                            {isUnread ? (
                              <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-fc-danger ring-2 ring-[var(--fc-panel)]" />
                            ) : null}
                            <div className="flex items-center gap-3">
                              <PersonIdentity
                                name={conversationPeerNames[customerId] || "Customer"}
                                size="lg"
                                online={onlineUserIds.has(customerId)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate pr-4 font-semibold text-[var(--fc-text)]">
                                  {conversationPeerNames[customerId] || uiText("Customer")}
                                </div>
                                <div className="truncate text-xs text-[var(--fc-muted)]">{lastMessage?.text || uiText("No messages")}</div>
                              </div>
                              <div className="shrink-0 text-right text-xs text-[var(--fc-muted)]">{lastMessage?.time}</div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </aside>

                {/* Chat Area. From lg up this is the right-hand pane; on a
                    phone the thread covers the screen and the rooms list waits
                    behind it, reached again by the header's back arrow. */}
                <div className={isMobileThreadOpen ? "min-w-0" : "hidden min-w-0 lg:block"}>
                  {selectedCustomerRoomId ? (
                    <MessengerThread
                      notificationConversation={currentUserId ? { audience: "shop", customerUserId: selectedCustomerRoomId } : undefined}
                      isMobileThreadOpen={isMobileThreadOpen}
                      title={customerName}
                      subtitle={uiText("Customer")}
                      avatar={<PersonIdentity name={customerName} size="sm" />}
                      headerAvatar={<PersonIdentity name={customerName} size="sm" />}
                      isOnline={onlineUserIds.has(selectedCustomerRoomId)}
                      entries={currentThread}
                      currentUserId={currentUserId}
                      draft={messageDraft}
                      onDraftChange={setMessageDraft}
                      onSend={handleSendMessage}
                      onBack={() => setIsMobileThreadOpen(false)}
                      onPickPhoto={() => photoInputRef.current?.click()}
                      isSendingPhoto={isSendingPhoto}
                      /* No call button on this side: a customer's phone number
                         is on their profile, which a shop cannot read, so the
                         button would have nothing to dial. */
                      /* The same action the customer has on the shop's
                         messages. A conversation only one side can report is
                         a conversation the other side can say anything in. */
                      onReportMessage={(entry) =>
                        setReportedMessage({ id: entry.id, text: entry.text })
                      }
                      /* Writing an order belongs to the conversation that
                         agreed it: the customer is already chosen, and the
                         database will only accept an order for someone who
                         has messaged this shop anyway. It sits in the plus
                         menu beside Photo rather than in the header, which is
                         where someone reaches for something to send. */
                      extraActions={
                        shopRequestId && currentUserId
                          ? [
                              {
                                id: "order",
                                label: "Order",
                                icon: <IconOrders aria-hidden className="h-5 w-5" />,
                                run: () => setIsSendOrderOpen(true),
                              },
                            ]
                          : undefined
                      }
                      // This customer's orders, pinned so they do not scroll
                      // away under the messages about them. "Needs you" is
                      // a decision only the shop can make: a price, a
                      // receipt, a refund. Building is "In progress".
                      pinned={
                        <ConversationOrders
                          orders={orders
                            .filter((order) => order.customer_user_id === selectedCustomerRoomId)
                            .map((order) => {
                              const refund = needsRefundAnswer(order);
                              return {
                                id: order.id,
                                project_name: order.project_name,
                                status: order.status,
                                preview_url: order.preview_url,
                                price: order.quoted_total ?? order.estimated_price,
                                created_at: order.created_at,
                                label: refund ? "Refund requested" : undefined,
                                group:
                                  refund || order.status === "pending_quote" || order.status === "payment_submitted"
                                    ? ("needs" as const)
                                    : order.status === "completed" || order.status === "declined"
                                      ? ("done" as const)
                                      : ("active" as const),
                              };
                            })}
                          onOpenOrder={(orderId) => setChatOrderId(orderId)}
                          onShowInChat={(orderId) => {
                            const entryId = orderEntryId(currentThread, orderId);
                            return entryId ? () => void scrollToThreadEntry(entryId) : null;
                          }}
                        />
                      }
                      renderEventCard={(entry) => {
                        const payload = asOrderEventPayload(entry.payload);
                        return payload ? (
                          <OrderPreviewCard payload={payload} onViewOrderDetails={setChatOrderId} />
                        ) : null;
                      }}
                    />
                  ) : (
                    /* Desktop only: on a phone the rooms list is the screen
                       until one is picked, so an empty pane under it would be
                       telling you to choose from a list you are already on. */
                    <div className="hidden min-h-[380px] flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 text-center text-[var(--fc-muted)] lg:flex">
                      <IconMessages aria-hidden className="h-7 w-7 opacity-50" />
                      <p className="text-sm">{uiText("Choose a customer on the left to read and reply.")}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            ) : null}

            {/* Shop Info Card */}
            {isApproved && activeSection === "reviews" && shopRequestId ? (
              <ShopReviews shopId={shopRequestId} shopName={shopOwnerName || uiText("your shop")} readOnly />
            ) : null}

            {activeSection === "storefront" ? (
              <div>
                {/* What needs the shop today, and the money, moved to Home
                    (home/shop-home.tsx). Storefront is about the shop itself:
                    how it gets paid, what it builds in, and what customers see
                    -- one tab each. A dot marks a tab that needs the owner:
                    no payment details yet, or no materials chosen yet. */}
                <div
                  role="tablist"
                  aria-label={uiText("Storefront")}
                  className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:none]"
                >
                  {STOREFRONT_TABS.map((item) => {
                    const selected = storefrontTab === item.id;
                    const needsAttention =
                      (item.id === "payment" && !hasPaymentDetails) || (item.id === "materials" && savedShopMaterials.length === 0);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        id={`storefront-tab-${item.id}`}
                        aria-selected={selected}
                        aria-controls={`storefront-panel-${item.id}`}
                        onClick={() => setStorefrontTab(item.id)}
                        className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold transition-colors ${
                          selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                        }`}
                      >
                        {uiText(item.label)}
                        {needsAttention ? (
                          <span aria-label={uiText("needs attention")} className="h-1.5 w-1.5 rounded-full bg-fc-danger" />
                        ) : null}
                        {selected ? (
                          <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                {/* Panels stay mounted and are only hidden, so ticked-but-unsaved
                    materials and the loaded shop page survive a tab switch. */}
                <div
                  role="tabpanel"
                  id="storefront-panel-payment"
                  aria-labelledby="storefront-tab-payment"
                  hidden={storefrontTab !== "payment"}
                >
                {/* ---- how you get paid ----
                    Out in the open rather than three scrolls down inside the
                    edit dialog. A shop with no payment details set cannot be
                    paid a downpayment at all, and until now the only way to
                    discover that was for a customer to reach the payment step
                    and find nothing there. */}
                <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="section-eyebrow">
                        <IconDocument aria-hidden className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />{uiText("Payment details")}</span>
                      <h3 className="mt-2 text-xl font-semibold text-[var(--fc-text)]">{uiText("Where customers send your downpayment")}</h3>
                      <p className="mt-1 max-w-prose text-sm text-[var(--fc-muted)]">{uiText("An e-wallet or a bank account — GCash, Maya, BPI, BDO, whichever you actually collect into. Only a customer who already has an order with you can see these.")}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openStorefront("payment")}
                      className="btn btn-secondary shrink-0"
                    >
                      {hasPaymentDetails ? uiText("Edit payment details") : uiText("Add payment details")}
                    </button>
                  </div>

                  {hasPaymentDetails ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-[auto,1fr]">
                      {qrPreview ? (
                        <button
                          type="button"
                          onClick={() => setLightboxImage({ src: qrPreview, alt: "Your payment QR code" })}
                          className="h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-white p-1.5"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrPreview} alt={uiText("Your payment QR code")} className="h-full w-full object-contain" />
                        </button>
                      ) : payment.qrUrl ? (
                        <div className="grid h-32 w-32 shrink-0 place-items-center rounded-2xl border border-dashed border-[var(--fc-border)] text-xs text-[var(--fc-muted)]">{uiText("Loading QR…")}</div>
                      ) : (
                        <div className="grid h-32 w-32 shrink-0 place-items-center rounded-2xl border border-dashed border-[var(--fc-border)] px-2 text-center text-xs text-[var(--fc-muted)]">{uiText("No QR uploaded")}</div>
                      )}

                      <div className="min-w-0 flex-1 space-y-2">
                        {payment.accountName ? (
                          <CopyField label="Account name" value={payment.accountName} />
                        ) : (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Account name")}</div>
                            <div className="mt-0.5 font-semibold text-[var(--fc-text)]">{uiText("Not set")}</div>
                          </div>
                        )}
                        {payment.accountNumber ? (
                          <CopyField label="Account or mobile number" value={payment.accountNumber} mono accent />
                        ) : (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Account or mobile number")}</div>
                            <div className="mt-0.5 font-semibold text-[var(--fc-text)]">{uiText("Not set")}</div>
                          </div>
                        )}
                        {payment.instructions ? (
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("What you tell customers")}</div>
                            <p className="mt-0.5 whitespace-pre-line text-sm text-[var(--fc-muted)]">
                              {payment.instructions}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-2xl border border-dashed border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_6%,transparent)] p-4 text-sm text-[var(--fc-text)]">{uiText("You haven't set these up yet. Until you do, a customer who accepts your quote has nowhere to send the downpayment, and the order stops there.")}</p>
                  )}
                </div>
                </div>

                <div
                  role="tabpanel"
                  id="storefront-panel-materials"
                  aria-labelledby="storefront-tab-materials"
                  hidden={storefrontTab !== "materials"}
                >
                {/* ---- what you actually work in ----
                    Asked once for the whole shop rather than on every
                    template. A furniture shop that does not cut stone should not
                    have to remember to untick stone each time it publishes,
                    and the answer changes when a supplier does, not when a
                    design does. */}
                <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] shadow-sm">
                  <div className="flex min-h-16 items-center gap-3 px-5 py-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] text-[var(--fc-ink-accent)]">
                      <IconEdit aria-hidden className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[var(--fc-text)]">{uiText("Available materials and colors")}</span>
                      <span className="block text-sm text-[var(--fc-muted)]">
                        {savedShopMaterials.length === 0 ? uiText("Materials and colors required") : uiText("{0} material colors available", { 0: savedShopMaterials.length })}
                      </span>
                    </span>
                  </div>
                  <div className="border-t border-[var(--fc-border)] px-5 pb-5 pt-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 max-w-prose flex-1 text-sm text-[var(--fc-muted)]">{uiText("These are the materials and colors you chose in Edit storefront. Customers can order only these options in the design studio.")}</p>
                    <button
                      type="button"
                      onClick={() => openStorefront("materials")}
                      className="btn btn-primary shrink-0"
                    >
                      {uiText("Edit materials")}
                    </button>
                  </div>

                  {savedShopMaterials.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-[var(--fc-border)] p-4 text-center text-sm text-[var(--fc-muted)]">{uiText("No materials and colors selected yet. Choose them in Edit storefront.")}</p>
                  ) : (
                    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                      {STOCK_MATERIALS.map((group) => {
                        const colors = group.colors.filter((color) => savedShopMaterials.includes(color.id));
                        if (!colors.length) return null;
                        return (
                          <li key={group.id} className="rounded-2xl border border-[var(--fc-border)] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2">
                                <MaterialSkin material={group.colors.find((color) => !color.baseMaterialId) ?? group.colors[0]} className="h-7 w-7" />
                                <span className="text-sm font-semibold text-[var(--fc-text)]">{uiText(group.label)}</span>
                              </span>
                              <span className="text-xs text-[var(--fc-muted)]">{colors.length}{uiText(" colors")}</span>
                            </div>
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                              {colors.map((color) => (
                                <li key={color.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--fc-border)] py-1 pl-1 pr-2.5 text-xs text-[var(--fc-text)]">
                                  <MaterialSkin material={color} className="h-5 w-5" />
                                  {uiText(stockColorLabel(color))}
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* A template can narrow this further but never widen it, and
                      a shop that has just unticked something it used to offer
                      should be told what that means rather than finding out
                      from a customer. */}
                  {savedShopMaterials.length > 0 ? (
                    <p className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] px-3 py-2 text-xs leading-snug text-[var(--fc-muted)]">{uiText("Your templates can offer fewer finishes than this, never more — so anything unticked here disappears from every design in your shop, including ones you published earlier.")}</p>
                  ) : null}
                  </div>
                </div>
                </div>

                <div
                  role="tabpanel"
                  id="storefront-panel-links"
                  aria-labelledby="storefront-tab-links"
                  hidden={storefrontTab !== "links"}
                >
                  {shopRequestId ? (
                    <SocialLinksEditor shopId={shopRequestId} />
                  ) : null}
                </div>

                <div
                  role="tabpanel"
                  id="storefront-panel-page"
                  aria-labelledby="storefront-tab-page"
                  hidden={storefrontTab !== "page"}
                >
                {/* ---- the shop, as customers get it ----
                    Not a mock-up of the page: the page. Same component, same
                    rows, read through the same loader /shops/[id] uses, so
                    there is nothing here that can quietly differ from what a
                    customer opens. */}
                {isLoadingProfile && !shopProfile ? (
                  <div
                    aria-hidden
                    className="h-64 animate-pulse rounded-3xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]"
                  />
                ) : shopProfile ? (
                  <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 shadow-sm sm:p-6">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--fc-border)] pb-3">
                      <span className="inline-flex min-h-11 items-center gap-2 font-semibold text-[var(--fc-text)]">
                        <IconProfile aria-hidden className="h-4 w-4 text-[var(--fc-ink-accent)]" />{uiText("What customers see")}</span>
                      {shopRequestId ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/shops/${shopRequestId}`)}
                          className="tap-target text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline"
                        >{uiText("Open the real page")}</button>
                      ) : null}
                    </div>
                    <ShopProfile
                      shop={shopProfile.shop}
                      ownerName={shopProfile.ownerName}
                      viewerUserId={currentUserId}
                      averageRating={shopProfile.averageRating}
                      reviewCount={shopProfile.reviewCount}
                      templates={shopProfile.templates}
                      embedded
                      onEditStorefront={() => openStorefront()}
                      onRefresh={() => void refreshStorefrontView()}
                    />
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-[var(--fc-border)] bg-[var(--fc-panel)] p-8 text-center">
                    <p className="font-semibold text-[var(--fc-text)]">
                      {shopOwnerStatus === "pending" ? uiText("Your shop page goes live when your application is approved") : uiText("You don't have a shop page yet")}
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-[var(--fc-muted)]">
                      {shopOwnerStatus === "pending" ? uiText("Everything you fill in now is kept and appears the moment an admin approves you. Use Edit shop details to get it ready.") : uiText("Apply to become a shop owner from your customer dashboard to get one.")}
                    </p>
                    {shopRequestId ? (
                      <button
                        type="button"
                        onClick={() => openStorefront()}
                        className="btn btn-secondary mt-4"
                      >{uiText("Edit shop details")}</button>
                    ) : null}
                  </div>
                )}
                </div>
              </div>
            ) : null}

            {activeSection === "subscription" ? (
              isApproved && myShopId ? (
                <ProSubscriptionCard shopId={myShopId} />
              ) : (
                <div className="rounded-3xl border border-dashed border-[var(--fc-border)] bg-[var(--fc-panel)] p-8 text-center">
                  <p className="font-semibold text-[var(--fc-text)]">{uiText("Pro opens once your shop is approved")}</p>
                  <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("You’ll be able to upgrade here as soon as FurniCraft approves your application.")}</p>
                </div>
              )
            ) : null}

            {activeSection === "support" ? <SupportSection currentUserId={currentUserId} audience="shop" userName={shopOwnerName} /> : null}

            {activeSection === "settings" ? (
            <div className="space-y-4">
              <div className="rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-[12rem] flex-1">
                    <h4 className="font-semibold text-[var(--fc-text)]">{uiText("Appearance")}</h4>
                    <p className="muted-small">{uiText("Choose the theme for your dashboard.")}</p>
                  </div>
                  <ThemeSwitcher />
                </div>
                {shopRequestId ? (
                  <div className="mt-3 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[12rem] flex-1">
                        <h4 className="font-semibold text-[var(--fc-text)]">{uiText("Accepting orders")}</h4>
                        <p className="muted-small">
                          {shopAcceptingOrders ? uiText("Customers can send you new designs. Turn this off when you’re booked out: your shop stays listed and reachable, it just stops taking new orders.") : uiText("Your shop is still listed and customers can still message you — they just can’t send a new order until you turn this back on. Orders already in progress carry on.")}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={shopAcceptingOrders}
                        onChange={(next) => void handleToggleAcceptingOrders(next)}
                        label={shopAcceptingOrders ? uiText("Stop accepting orders") : uiText("Start accepting orders")}
                      />
                    </div>
                  </div>
                ) : null}
                {shopRequestId ? (
                  <div className="mt-3 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-[12rem] flex-1">
                        <h4 className="font-semibold text-[var(--fc-text)]">{uiText("Deactivate shop")}</h4>
                        <p className="muted-small">
                          {shopIsActive ? uiText("Hides your shop from the customer directory and blocks new orders. Existing orders, templates, and reviews are unaffected. Reactivate anytime.") : uiText("Your shop is hidden from customers and can't receive new orders. Existing conversations and orders still work.")}
                        </p>
                        <p className="muted-small mt-1">
                          {uiText("A shop with no activity for {0} days is deactivated automatically, with warnings at 30 and 60 days. Opening this dashboard keeps your shop active.", { 0: SHOP_INACTIVE_DEACTIVATE_DAYS })}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={shopIsActive}
                        onChange={(next) => void handleToggleShopActive(next)}
                        label={shopIsActive ? uiText("Deactivate shop") : uiText("Reactivate shop")}
                      />
                    </div>
                  </div>
                ) : null}
                {shopRequestId ? <ShopPricingSettings shopId={shopRequestId} /> : null}
                {currentUserId ? <DeleteAccountSection userId={currentUserId} /> : null}
              </div>
            </div>
            ) : null}
          </section>
        </main>
      </div>

      {shopRequestId && currentUserId && selectedCustomerRoomId ? (
        <SendOrderModal
          open={isSendOrderOpen}
          onClose={() => setIsSendOrderOpen(false)}
          shopId={shopRequestId}
          shopOwnerUserId={currentUserId}
          customerUserId={selectedCustomerRoomId}
          customerName={customerName}
          templates={shopTemplates}
          onSent={(orderId) => {
            // Straight into the order it just made: the shop almost always
            // wants to see what the customer will see.
            setChatOrderId(orderId);
            if (shopRequestId) void fetchShopOrders(shopRequestId);
          }}
        />
      ) : null}

      {/* Storefront editor -- shop details, cover photo and gallery */}
      {shopRequestId ? (
        <StorefrontEditor
          shopId={shopRequestId}
          open={isEditShopModalOpen}
          initialTab={storefrontEditorTab}
          onClose={() => setIsEditShopModalOpen(false)}
          onSaved={(saved) => {
            if (saved.shopName) setShopOwnerName(saved.shopName);
            // The storefront section is showing the customer's page and the
            // payment block behind this dialog. Re-read both, or a save
            // appears to have done nothing until the next reload.
            void refreshStorefrontView();
            setStorefront({
              tagline: saved.tagline,
              description: saved.description,
              phone: saved.phone,
              hours: saved.hours,
              coverImageUrl: saved.coverImageUrl,
              gallery: saved.gallery,
            });
            // The Materials tab lists what this dialog saved.
            setSavedShopMaterials(saved.allowedMaterials);
          }}
        />
      ) : null}

      {/* Add / Edit Template Modal */}
      {isAddTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b1b14]/60 p-3 sm:p-4">
          <div
            ref={templatePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingTemplateId ? uiText("Edit template") : uiText("Publish template")}
            tabIndex={-1}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-5 shadow-2xl outline-none sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.25em] text-[var(--fc-ink-accent)]">
                  {editingTemplateId ? uiText("Edit Template") : uiText("Publish Template")}
                </div>
                <h3 className="text-xl font-semibold text-[var(--fc-text)]">
                  {editingTemplateId ? uiText("Update this template") : uiText("Publish this design as a template")}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeTemplateModal}
                aria-label={uiText("Close")}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--fc-border)] text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)] active:scale-[0.95]"
              >
                <IconClose aria-hidden className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-[var(--fc-text)]">
              {pendingTemplateDesign ? (
                <div className="rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-3">
                  <OrderDesignPreview previewUrl={pendingTemplateDesign.previewUrl} cadState={pendingTemplateDesign.cadState} />
                </div>
              ) : editingTemplate?.cad_state ? (
                <div className="rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-3">
                  <OrderDesignPreview previewUrl={editingTemplate.preview_url} cadState={editingTemplate.cad_state} />
                </div>
              ) : null}
              <div>
                <label htmlFor="template-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Title ")}<span aria-hidden className="text-fc-danger">*</span>
                </label>
                <input
                  id="template-title"
                  required
                  aria-required="true"
                  className="mt-1 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)]"
                  placeholder={uiText("Modern Oak Lounge")}
                  value={newTemplateTitle}
                  onChange={(event) => setNewTemplateTitle(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="template-tag" className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Room / tag ")}{requiredTemplateDetails.tag ? <span aria-hidden className="text-fc-danger">*</span> : uiText("(optional)")}
                </label>
                <input
                  id="template-tag"
                  required={requiredTemplateDetails.tag}
                  aria-required={requiredTemplateDetails.tag}
                  className="mt-1 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)]"
                  placeholder={uiText("Living room")}
                  value={newTemplateTag}
                  onChange={(event) => setNewTemplateTag(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="template-description" className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fc-ink-accent)]">{uiText("Description ")}{requiredTemplateDetails.description ? <span aria-hidden className="text-fc-danger">*</span> : uiText("(optional)")}
                </label>
                <textarea
                  id="template-description"
                  required={requiredTemplateDetails.description}
                  aria-required={requiredTemplateDetails.description}
                  className="mt-1 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-[var(--fc-text)] placeholder:text-[var(--fc-muted)]"
                  rows={3}
                  placeholder={uiText("A warm neutral layout with sculptural seating.")}
                  value={newTemplateDescription}
                  onChange={(event) => setNewTemplateDescription(event.target.value)}
                />
              </div>

              {/* Restricting is opt-in: a shop that says nothing offers
                  everything, which is what every template did before this
                  existed and what most shops will still want. */}
              <AllowedFinishesPicker value={templateMaterials} onChange={setTemplateMaterials} />
              {missingTemplateDetails.length ? (
                <p aria-live="polite" className="text-xs text-[var(--fc-muted)]">{uiText("Fill in ")}{missingTemplateDetails.join(", ")}{uiText(" to save this template.")}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={missingTemplateDetails.length > 0 || isSavingTemplate}
                  className="btn btn-primary flex-1"
                >
                  {isSavingTemplate ? uiText("Saving…") : editingTemplateId ? uiText("Save changes") : uiText("Save template")}
                </button>
                {editingTemplate ? (
                  <button
                    type="button"
                    onClick={() => setTemplatePendingDelete(editingTemplate)}
                    disabled={deletingTemplateId === editingTemplate.id}
                    className="rounded-full border border-fc-danger/40 px-4 py-2 font-semibold text-fc-danger transition hover:bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingTemplateId === editingTemplate.id ? uiText("Deleting…") : uiText("Delete")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {isOrderDetailModalOpen && selectedOrder && (
        <Modal
          open
          onClose={() => setIsOrderDetailModalOpen(false)}
          ariaLabel={uiText("Order: {0}", { 0: selectedOrder.project_name })}
          eyebrow={uiText("Order")}
          title={selectedOrder.project_name}
          className="sm:max-w-5xl"
        >
            <p className="text-sm text-[var(--fc-muted)]">{uiText("From ")}{orderCustomerNames[selectedOrder.customer_user_id] || uiText("Customer")} · {new Date(selectedOrder.created_at).toLocaleString(uiLocale)}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <OrderStatusBadge status={selectedOrder.status} />
              {selectedOrder.budget_min != null && selectedOrder.budget_max != null ? (
                <span className="font-semibold text-[var(--fc-ink-accent)]">{uiText("Budget")}{" "}
                  <span className="tabular-nums">
                    ₱{Number(selectedOrder.budget_min).toLocaleString(uiLocale)}–
                    {Number(selectedOrder.budget_max).toLocaleString(uiLocale)}
                  </span>
                </span>
              ) : selectedOrder.estimated_price != null ? (
                <span className="font-semibold tabular-nums text-[var(--fc-ink-accent)]">₱{Number(selectedOrder.estimated_price).toLocaleString(uiLocale)}</span>
              ) : null}
            </div>

            <OrderStepper status={selectedOrder.status} className="mt-5" />

            {/* One tab per part of the order instead of one long scroll. A dot
                on Quote marks an order waiting on the shop: a quote to send, a
                receipt to check, or a refund to answer. */}
            <div
              role="tablist"
              aria-label={uiText("Order")}
              className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--fc-border)] [scrollbar-width:none]"
            >
              {ORDER_TABS.filter((item) => item.id !== "costing" || selectedOrder.shop_id).map((item) => {
                const selected = orderTab === item.id;
                const needsAttention =
                  item.id === "quote" &&
                  (selectedOrder.status === "pending_quote" ||
                    selectedOrder.status === "payment_submitted" ||
                    selectedOrder.refund_status === "requested");
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`order-tab-${item.id}`}
                    aria-selected={selected}
                    aria-controls={`order-panel-${item.id}`}
                    onClick={() => setOrderTab(item.id)}
                    className={`relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-semibold transition-colors ${
                      selected ? "text-[var(--fc-text)]" : "text-[var(--fc-muted)] hover:text-[var(--fc-text)]"
                    }`}
                  >
                    {uiText(item.label)}
                    {needsAttention ? (
                      <span aria-label={uiText("needs attention")} className="h-1.5 w-1.5 rounded-full bg-fc-danger" />
                    ) : null}
                    {selected ? (
                      <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--fc-accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Panels stay mounted and are only hidden, so an unsaved cost sheet
                or a half-typed quote survives a tab switch. */}
            <div className="mt-5">
              <div role="tabpanel" id="order-panel-design" aria-labelledby="order-tab-design" hidden={orderTab !== "design"}>
                <OrderDesignColumn
                  previewUrl={selectedOrder.preview_url}
                  cadState={selectedOrder.cad_state}
                  notes={selectedOrder.notes}
                  referenceImages={selectedOrder.reference_images}
                  onOpenStudio={() => {
                    const item = resolveDesignItem(selectedOrder.cad_state);
                    if (!item) return;
                    if (!openItemInDesigner(item, `Order: ${selectedOrder.project_name}`)) return;
                    router.push("/customize-furniture");
                  }}
                />
              </div>

              {/* What this job costs the shop, kept with the order. Private
                  to the shop -- see 20260921000300_order_costings.sql. */}
              {selectedOrder.shop_id ? (
                <div role="tabpanel" id="order-panel-costing" aria-labelledby="order-tab-costing" hidden={orderTab !== "costing"}>
                  <OrderCosting
                    orderId={selectedOrder.id}
                    shopId={selectedOrder.shop_id}
                    defaultOpen
                    quotedTotal={
                      selectedOrder.quoted_total == null ? null : Number(selectedOrder.quoted_total)
                    }
                    onUseAsQuote={
                      shopCanMove(selectedOrder.status, "quoted")
                        ? (suggested, lines) => {
                            setQuoteTotal(String(suggested));
                            setQuoteLineDrafts(draftsFromLines(lines));
                            // The filled-in quote is on the other tab; go to it.
                            setOrderTab("quote");
                          }
                        : undefined
                    }
                  />
                </div>
              ) : null}

              <div role="tabpanel" id="order-panel-quote" aria-labelledby="order-tab-quote" hidden={orderTab !== "quote"}>
                <SideCard title={uiText("Quote")}>
            <p className="mt-6 text-sm text-[var(--fc-muted)]">{uiText(orderStatusMeta(selectedOrder.status).shopHint)}</p>

            {/* Only renders once a customer has asked, so an ordinary order
                carries no refund furniture at all. */}
            <div className="mt-5">
              <RefundPanel
                order={selectedOrder}
                viewer="shop"
                busy={isRefundBusy}
                onDecline={(reason) => void answerRefund(selectedOrder.id, { kind: "declined", reason })}
                onRefund={(amount, reference) =>
                  void answerRefund(selectedOrder.id, { kind: "refunded", amount, reference })
                }
              />
            </div>

            {selectedOrder.quoted_total != null ? (
              <dl className="mt-3 grid gap-1 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-3 text-sm sm:grid-cols-3">
                <div><dt className="text-[var(--fc-muted)]">{uiText("Quoted total")}</dt><dd className="font-bold">{formatPeso(Number(selectedOrder.quoted_total))}</dd></div>
                <div><dt className="text-[var(--fc-muted)]">{uiText("Downpayment")}</dt><dd className="font-bold">{selectedOrder.downpayment_percent}%</dd></div>
                <div><dt className="text-[var(--fc-muted)]">{uiText("Due now")}</dt><dd className="font-bold">{formatPeso(downpaymentOf(Number(selectedOrder.quoted_total), Number(selectedOrder.downpayment_percent)))}</dd></div>
                <QuoteBreakdownList
                  lines={parseQuoteLines(selectedOrder.quote_lines)}
                  className="mt-2 border-t border-[var(--fc-border)] pt-2 sm:col-span-3"
                />
              </dl>
            ) : null}

            {shopCanMove(selectedOrder.status, "quoted") ? (
              <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_4%,transparent)] p-4">
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-ink-accent)]">
                  {selectedOrder.status === "quoted" ? uiText("Revise Quote") : uiText("Send a quote")}
                </h4>
                {/* Optional, but open: one figure gives the customer nothing to
                    weigh it against, and "what is that for?" is where quotes stall. */}
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Breakdown ")}<span className="normal-case tracking-normal">{uiText("(optional)")}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--fc-muted)]">{uiText("The customer sees each line and its price. Your cost sheet stays private.")}</p>
                  <div className="mt-2 max-w-xl">
                    <QuoteLinesEditor drafts={quoteLineDrafts} onChange={setQuoteLineDrafts} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {quoteLineDrafts.length ? (
                    <div className="grid gap-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Total")}</span>
                      <strong className="font-display py-1.5 text-lg tabular-nums">
                        {formatPeso(draftTotal(quoteTotal, quoteLineDrafts))}
                      </strong>
                    </div>
                  ) : (
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Total price (₱)")}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="e.g. 15000"
                        value={quoteTotal}
                        onChange={(event) => setQuoteTotal(event.target.value)}
                        className="w-40 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none"
                      />
                    </label>
                  )}
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Downpayment (%)")}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="30"
                      value={quotePercent}
                      onChange={(event) => setQuotePercent(event.target.value)}
                      className="w-32 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none"
                    />
                  </label>
                  <span className="pb-2 text-sm text-[var(--fc-muted)]">{uiText("Due now: ")}<strong className="text-[var(--fc-ink-accent)]">{formatPeso(downpaymentOf(draftTotal(quoteTotal, quoteLineDrafts), Number(quotePercent.replace(/[^0-9.]/g, "")) || null))}</strong>
                  </span>
                </div>
                {quoteError ? <p className="mt-2 text-sm text-[#a8452c]">{uiText(quoteError)}</p> : null}
                {(() => {
                  // A sent quote with nothing changed since: the button stays
                  // pressed until the total, a line or the downpayment changes.
                  const unchanged =
                    selectedOrder.status === "quoted" &&
                    quoteFormUnchanged(
                      { typedTotal: quoteTotal, drafts: quoteLineDrafts, percentText: quotePercent },
                      {
                        quotedTotal: selectedOrder.quoted_total == null ? null : Number(selectedOrder.quoted_total),
                        quoteLines: selectedOrder.quote_lines,
                        downpaymentPercent: selectedOrder.downpayment_percent == null ? null : Number(selectedOrder.downpayment_percent),
                      }
                    );
                  return (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={isUpdatingOrderStatus || unchanged}
                        onClick={() => handleSendQuote(selectedOrder.id)}
                        className={`btn btn-primary ${unchanged ? "btn-pressed" : ""}`}
                      >
                        {selectedOrder.status === "quoted" ? uiText("Update quote") : uiText("Send quote")}
                      </button>
                      {unchanged ? (
                        <span className="text-xs text-[var(--fc-muted)]">{uiText("Sent. Change a price, a line or the downpayment to update it.")}</span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            ) : null}

            {/* Accepted, not paid. Says how long, so the shop can decide whether
                to keep waiting or let the slot go (Cancel order, below). */}
            {selectedOrder.status === "confirmed" ? (
              <div className="mt-4 rounded-2xl border border-[var(--fc-border)] p-3">
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Waiting for the downpayment")}</h4>
                <p className="mt-1 text-sm text-[var(--fc-text)]">
                  {selectedOrder.customer_responded_at ? uiText("Quote accepted {0}. No receipt yet.", { 0: timeAgo(selectedOrder.customer_responded_at, undefined, uiLanguage).toLowerCase() }) : uiText("Quote accepted. No receipt yet.")}
                </p>
                <p className="mt-1 text-xs text-[var(--fc-muted)]">{uiText("If they don't pay, you can cancel the order. Nothing has been paid, so there is nothing to refund.")}</p>
              </div>
            ) : null}

            {selectedOrder.status === "payment_submitted" ? (
              <div className="mt-4 rounded-2xl border border-[var(--fc-border)] p-3">
                <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("Downpayment receipt")}</h4>
                <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("FurniCraft does not process this payment. Check your own GCash or bank app for the amount above before approving.")}</p>
                {selectedOrder.payment_receipt_url ? (
                  <button
                    type="button"
                    onClick={async () => {
                      const url = await signedUrlFor(RECEIPT_BUCKET, selectedOrder.payment_receipt_url);
                      if (url) window.open(url, "_blank", "noreferrer");
                    }}
                    className="btn btn-secondary btn-sm mt-2"
                  >{uiText("View receipt")}</button>
                ) : null}
                {selectedOrder.payment_reference ? (
                  <CopyField label="Reference number given" value={selectedOrder.payment_reference} mono className="mt-2" />
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {shopCanMove(selectedOrder.status, "in_production") ? (
                <button type="button" disabled={isUpdatingOrderStatus}
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, "in_production")}
                  className="btn btn-primary">
                  <span className="inline-flex items-center gap-2"><IconCheck aria-hidden className="h-4 w-4" />{uiText(" Payment received — start production")}</span>
                </button>
              ) : null}
              {selectedOrder.status === "payment_submitted" ? (
                <button type="button" disabled={isUpdatingOrderStatus}
                  onClick={() => setOrderPendingReceiptReject(selectedOrder.id)}
                  className="btn btn-secondary">{uiText("Receipt does not match")}</button>
              ) : null}
              {shopCanMove(selectedOrder.status, "completed") ? (
                <button type="button" disabled={isUpdatingOrderStatus}
                  onClick={() => handleUpdateOrderStatus(selectedOrder.id, "completed")}
                  className="btn btn-primary">{uiText("Mark completed")}</button>
              ) : null}
              {shopCanMove(selectedOrder.status, "declined") ? (
                <button type="button" disabled={isUpdatingOrderStatus}
                  onClick={() => setOrderPendingDecline(selectedOrder.id)}
                  className="btn btn-secondary">
                  {selectedOrder.status === "confirmed" ? uiText("Cancel order") : uiText("Decline")}
                </button>
              ) : null}

              {/* Reaching the customer about this order, without having to go
                  find them in Messages by name. */}
              {selectedOrder.status === "in_production" || selectedOrder.status === "completed" ? (
                <button
                  type="button"
                  onClick={() =>
                    messageCustomer(
                      selectedOrder.customer_user_id,
                      `Good news — your ${selectedOrder.project_name} is ready for pick up. `
                    )
                  }
                  className="btn btn-primary"
                >
                  <span className="inline-flex items-center gap-2"><IconOrders aria-hidden className="h-4 w-4" />{uiText(" Tell them it's ready for pick up")}</span>
                </button>
              ) : null}
                  </div>
                </SideCard>
                <ProductionSchedule
                  orderId={selectedOrder.id}
                  status={selectedOrder.status}
                  viewerIsShop
                  className="mt-4"
                />
              </div>

              <div role="tabpanel" id="order-panel-customer" aria-labelledby="order-tab-customer" hidden={orderTab !== "customer"}>
                <SideCard title={uiText("Customer")} className="max-w-md">
                  <OrderPartyCard
                    name={orderCustomerNames[selectedOrder.customer_user_id] || "Customer"}
                    subtitle={uiText(orderStatusMeta(selectedOrder.status).label)}
                    onMessage={() => messageCustomer(selectedOrder.customer_user_id)}
                    messageLabel="Message customer"
                  />
                </SideCard>
              </div>
            </div>
        </Modal>
      )}

      {lightboxImage ? (
        <ImageLightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      ) : null}

      <OrderDetailModal orderId={chatOrderId} onClose={() => setChatOrderId(null)} />
      <ConfirmModal
        open={Boolean(templatePendingDelete)}
        title={templatePendingDelete ? uiText("Delete “{0}”?", { 0: templatePendingDelete.title }) : uiText("Delete template?")}
        body="Customers browsing your shop will no longer see it. Designs already ordered from it are unaffected."
        confirmLabel={uiText("Delete template")}
        tone="danger"
        busy={Boolean(templatePendingDelete && deletingTemplateId === templatePendingDelete.id)}
        onConfirm={() => {
          const target = templatePendingDelete;
          setTemplatePendingDelete(null);
          if (target) void handleDeleteTemplate(target);
        }}
        onCancel={() => setTemplatePendingDelete(null)}
      />

      <ConfirmModal
        open={Boolean(orderPendingDecline)}
        title={pendingDeclineIsUnpaid ? uiText("Cancel this unpaid order?") : uiText("Decline this order?")}
        body={
          pendingDeclineIsUnpaid
            ? "The customer accepted your quote but hasn't paid the downpayment. They are told the order was cancelled and see the reason you give. This cannot be undone."
            : "The customer is told it was declined, and sees the reason you give here. This cannot be undone."
        }
        confirmLabel={pendingDeclineIsUnpaid ? uiText("Cancel order") : uiText("Decline order")}
        cancelLabel={pendingDeclineIsUnpaid ? uiText("Keep order") : uiText("Cancel")}
        tone="danger"
        busy={isUpdatingOrderStatus}
        reason={{
          label: "Reason",
          placeholder: pendingDeclineIsUnpaid
            ? "e.g. No downpayment after a week, so I've given the slot to another order."
            : "e.g. The timber for this finish is out of stock until March.",
          required: true,
        }}
        onConfirm={(declineReason) => {
          const target = orderPendingDecline;
          setOrderPendingDecline(null);
          if (target) void handleUpdateOrderStatus(target, "declined", declineReason);
        }}
        onCancel={() => setOrderPendingDecline(null)}
      />

      <ConfirmModal
        open={Boolean(orderPendingReceiptReject)}
        title={uiText("Receipt does not match?")}
        body="Tell the customer why this payment could not be verified. The order will return to 'Downpayment due' with your note so they can send the correct payment or receipt."
        confirmLabel={uiText("Reject receipt")}
        tone="danger"
        busy={isUpdatingOrderStatus}
        reason={{
          label: "Reason for rejection",
          placeholder: "e.g. Reference number not found in GCash records, or downpayment amount was incomplete.",
          required: true,
        }}
        onConfirm={(rejectionReason) => {
          const target = orderPendingReceiptReject;
          setOrderPendingReceiptReject(null);
          if (target) void handleUpdateOrderStatus(target, "confirmed", rejectionReason);
        }}
        onCancel={() => setOrderPendingReceiptReject(null)}
      />

      {/* Outside the thread, so re-rendering it never resets a picker the shop
          has already opened. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void handlePhotoChosen(file);
        }}
      />

      {reportedMessage ? (
        <ReportDialog
          open
          onClose={() => setReportedMessage(null)}
          topics={["chat"]}
          targetId={reportedMessage.id}
          title={uiText("Report this message")}
          context={reportedMessage.text}
        />
      ) : null}

      {/* The phone's navigation: the five things a shop does every day.
          Hidden while a conversation covers the screen, where the bar would
          sit on the composer; from lg up the sidebar does this job. */}
      {activeSection === "messages" && isMobileThreadOpen ? null : (
        <BottomTabBar
          label={uiText("Shop")}
          items={(
            [
              { id: "home", label: "Home", icon: IconOverview },
              { id: "orders", label: "Orders", icon: IconOrders, badge: pendingOrdersCount, badgeLabel: `${pendingOrdersCount} need your response` },
              { id: "messages", label: "Messages", icon: IconMessages, badge: totalUnreadConversations, badgeLabel: `${totalUnreadConversations} unread` },
              { id: "templates", label: "Templates", icon: IconTemplates },
              // "Storefront", not "Shop": the customer side has a "Shops"
              // tab for browsing, and the two read as the same thing.
              { id: "storefront", label: "Storefront", icon: IconSeller },
            ] as Array<{ id: ShopSection; label: string; icon: SolihiyaIcon; badge?: number; badgeLabel?: string }>
          ).map((tab) => ({
            key: tab.id,
            label: tab.label,
            icon: <tab.icon className="h-5 w-5" />,
            active: activeSection === tab.id,
            badge: tab.badge,
            badgeLabel: tab.badgeLabel,
            href: `#${tab.id}`,
            // Orders, Messages and Templates exist once the shop is approved.
            disabled: !isApproved && tab.id !== "home" && tab.id !== "storefront",
            disabledReason: "Available once your shop is approved",
            onClick: () => setActiveSection(tab.id),
          }))}
        />
      )}

      <ShopAccountSheet
        open={isAccountSheetOpen}
        onClose={() => setIsAccountSheetOpen(false)}
        name={shopOwnerName || fallbackName || "Your account"}
        email={userEmail ?? null}
        avatarUrl={ownerAvatarUrl}
        initial={(shopOwnerName || fallbackName || "S").trim().charAt(0).toUpperCase()}
        locked={!isApproved}
        onEditProfile={() => {
          setIsAccountSheetOpen(false);
          router.push("/protected?profile=1");
        }}
        onReviews={() => {
          setIsAccountSheetOpen(false);
          goToSection("reviews");
        }}
        onSubscription={() => {
          setIsAccountSheetOpen(false);
          goToSection("subscription");
        }}
        onSupport={() => {
          setIsAccountSheetOpen(false);
          goToSection("support");
        }}
        onSettings={() => {
          setIsAccountSheetOpen(false);
          goToSection("settings");
        }}
        onDesigner={() => {
          setIsAccountSheetOpen(false);
          router.push("/customize-furniture");
        }}
        onCustomerDashboard={() => {
          setIsAccountSheetOpen(false);
          router.push("/protected");
        }}
      />
    </div>
    </>
  );
}
