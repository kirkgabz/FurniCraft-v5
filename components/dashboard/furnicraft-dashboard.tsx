"use client";
import { timeAgo } from "@/lib/time-ago";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { loadShopProIds } from "@/lib/shops/pro-status";

import { type ShopPaymentInfo } from "@/components/orders/order-workspace";
import { useOnlineUsers } from "@/lib/presence";

import { LogoutButton } from "@/components/dashboard/logout-button";

import ImageLightbox from "@/components/design/image-lightbox";
import { resolveDesignItem, openItemInDesigner } from "@/components/design/design-state-utils";
import { combineAllowedMaterials } from "@/components/design/studio/materials-db";
import { MATERIAL_TAGS, materialTagsForDesign, type MaterialTagId } from "@/components/design/studio/material-tags";

import NotificationBell from "@/components/notifications/notification-bell";

import CallSheet from "@/components/messages/call-sheet";
import OrderDetailModal from "@/components/orders/order-detail-modal";
import ConfirmModal from "@/components/ui/confirm-modal";

import { normaliseLinkInput, parseSocialLinks } from "@/components/shops/social-links";
import {
  SHOP_LIST_COLUMNS,
  SHOPS_PUBLIC_TABLE,
  USER_NAMES_TABLE,
  type Shop as ShopRecord,
} from "@/components/shops/shop-types";
import {
  QUICK_ANSWER_FAILED,
  QUICK_ANSWER_MISSING,
  parseQuickAnswers,
  type AssistantLanguage,
  type QuickAnswers,
} from "@/lib/shop-assistant";
import {
  CUSTOMER_ACTIONABLE,
  type OrderStatus,
} from "@/components/orders/order-status";
import { signedUrlFor, uploadReceipt, QR_BUCKET } from "@/components/orders/payment-proof";
import { IconCart,
  IconOverview,
  IconOrders,
  IconTemplates,
  IconMessages,
  IconSeller,
  IconSettings,
  IconFurniture,
  IconEdit,
  IconMenu,
  IconClose,
  IconProfile,
  IconPhone,
} from "@/components/solihiya/icons";
import { useLanguage } from "@/components/language/language-context";
import { ShopPoliciesDialog } from "@/components/shops/shop-policies-dialog";
import { hasSeenPolicies, markPoliciesSeen } from "@/components/shops/shop-policies";
import { cartPieceCount, cartLineCount } from "@/components/design/studio/design-cart";

import ReportDialog from "@/components/reports/report-dialog";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import { applicationErrorMessage, submitSellerApplication } from "@/lib/shops/submit-application";
import { orderSuccessMessage } from "@/components/orders/order-success";
import { setDashboardMode } from "@/lib/dashboard-mode";
import { CHAT_PHOTO_TEXT, uploadChatPhoto } from "@/lib/chat-photos";

import EditShopModal from "@/components/dashboard/modals/edit-shop-modal";
import ProfileModal from "@/components/dashboard/modals/profile-modal";
import SellerModal from "@/components/dashboard/modals/seller-modal";
import ShopProfileModal from "@/components/dashboard/modals/shop-profile-modal";
import MessagesSection from "@/components/dashboard/sections/messages-section";
import { useUnreadOrderActions } from "@/components/orders/use-unread-order-actions";
import OrdersSection from "@/components/dashboard/sections/orders-section";
import SettingsSection from "@/components/dashboard/sections/settings-section";
import SupportSection from "@/components/dashboard/sections/support-section";
import TemplatesSection from "@/components/dashboard/sections/templates-section";

/** Per-tab store for assistant answers; see the state that uses it. */
const ASSISTANT_STORAGE_KEY = "furnicraft_quick_answers";
import { type ReportCategory } from "@/lib/report-topics";
import { DashboardSidebar, type DashboardNavItem } from "@/components/dashboard/dashboard-sidebar";
import { BottomTabBar, type TabBarItem } from "@/components/dashboard/bottom-tab-bar";
import type { CustomerDesign, CustomerOrder, DesignTemplate, Message } from "@/components/dashboard/customer-dashboard-types";
import { CustomerOrderRow } from "@/components/dashboard/customer-order-parts";
import CustomerHome from "@/components/dashboard/home/customer-home";
import ShopsTab from "@/components/dashboard/shops-tab";
import { AccountSheet, DesignSheet } from "@/components/dashboard/phone-sheets";
import { ModeBar } from "@/components/dashboard/mode-bar";

import { pushStep } from "@/lib/commission-path";
import { useDeepLink } from "@/lib/deep-link";
import { AVATAR_MAX_UPLOAD_BYTES, isImageFile } from "@/lib/avatar";
import { ImageCropper } from "@/components/ui/image-cropper";

type Props = {
  /** The account's real email, for display only -- never a name fallback. */
  userEmail?: string | null;
  /** Auth's own display name, used only to seed full_name before a profile row exists. */
  fallbackName?: string | null;
};

type Shop = ShopRecord;

/**
 * A row from the `shops_public` view. It deliberately carries no `email` and no
 * `status`: the view exposes approved shops only, and the applicant's email
 * lives on the restricted base table.
 */
/** Sections a ?section= link may open. Anything else is ignored. */
const SECTION_KEYS = [
  "overview",
  "shops",
  "templates",
  "messages",
  "orders",
  "support",
  "settings",
];

/**
 * What a dashboard section is called when it is the way back -- on the studio's
 * and the shop page's Back. Every section has one, so none falls through to a
 * wrong name: Home, Shops and Settings all used to come back as "Browse shops".
 */
const SECTION_STEP_LABELS: Record<string, string> = {
  overview: "Home",
  shops: "Shops",
  orders: "Orders",
  templates: "My templates",
  messages: "Messages",
  support: "Support",
  settings: "Settings",
  seller: "Become a seller",
};
function sectionStep(section: string) {
  const key = SECTION_STEP_LABELS[section] ? section : "overview";
  return { href: `/protected#${key}`, label: SECTION_STEP_LABELS[key] };
}

type ShopOwnerRecord = {
  id: string;
  user_id: string;
  shop_name: string | null;
  description: string | null;
  address: string | null;
  tagline?: string | null;
  cover_image_url?: string | null;
  logo_url?: string | null;
  phone?: string | null;
  hours?: string | null;
  policies?: string | null;
  social_links?: unknown;
  map_url?: string | null;
  allowed_materials?: string[] | null;
};

/** A customer's own work-in-progress or explicitly-kept design; see customer_designs. */
const SECTION_META: Record<string, { title: string; subtitle: string }> = {
  shops: { title: "Shops", subtitle: "Browse the makers on FurniCraft, or start from a piece they publish." },
  orders: { title: "Your Orders", subtitle: "Designs you've sent to shops, and their status." },
  templates: { title: "My templates", subtitle: "" },
  messages: { title: "Messages", subtitle: "Talk directly with the shops building your furniture." },
  support: { title: "Support", subtitle: "Have a question or ran into a problem? FurniCraft support replies here." },
  settings: { title: "Settings", subtitle: "Manage your preferences and appearance." },
  seller: { title: "Become a Seller", subtitle: "Apply to open your own shop on FurniCraft." },
};

export default function FurniCraftDashboard({ userEmail, fallbackName }: Props) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  // This tab is now working as the customer; the studio offers no shop tools.
  useEffect(() => setDashboardMode("customer"), []);
  const router = useRouter();
  const { t } = useLanguage();
  const [isSellerModalOpen, setIsSellerModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [isShopProfileModalOpen, setIsShopProfileModalOpen] = useState(false);
  const [isEditShopModalOpen, setIsEditShopModalOpen] = useState(false);

  // Closed until the width is known, then opened on a desktop. It used to start
  // open everywhere: right for the persistent desktop sidebar, and on a phone a
  // drawer covering the whole dashboard on every single visit.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setIsSidebarOpen(true);
  }, []);
  const [activeSection, setActiveSection] = useState("overview");
  // The phone's bottom sheets (Design tab, avatar) and the FAQ panel the
  // Account sheet's "Help & FAQ" opens. See phone-sheets.tsx.
  const [isDesignSheetOpen, setIsDesignSheetOpen] = useState(false);
  const [isAccountSheetOpen, setIsAccountSheetOpen] = useState(false);
  const [customerDesigns, setCustomerDesigns] = useState<CustomerDesign[]>([]);
  const [isLoadingCustomerDesigns, setIsLoadingCustomerDesigns] = useState(false);
  const [deletingDesignId, setDeletingDesignId] = useState<string | null>(null);
  const [designPendingDelete, setDesignPendingDelete] = useState<CustomerDesign | null>(null);
  const [draftsPendingDelete, setDraftsPendingDelete] = useState<CustomerDesign[] | null>(null);
  const [isDeletingDrafts, setIsDeletingDrafts] = useState(false);

  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [isLoadingCustomerOrders, setIsLoadingCustomerOrders] = useState(false);
  // Home picks between the first-visit and returning layouts by whether any
  // orders exist, so it waits for the first fetch to finish rather than
  // showing a returning customer the first-visit screen while it loads, and
  // says so when the fetch fails rather than reading that as "no orders".
  const [hasLoadedCustomerOrders, setHasLoadedCustomerOrders] = useState(false);
  const [customerOrdersFailed, setCustomerOrdersFailed] = useState(false);
  const [selectedCustomerOrderId, setSelectedCustomerOrderId] = useState<string | null>(null);
  const [isRespondingToQuote, setIsRespondingToQuote] = useState(false);
  const [quoteResponseError, setQuoteResponseError] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [isSubmittingReceipt, setIsSubmittingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  // Signed URL for the shop's QR; the bucket is private.
  const [shopQrUrl, setShopQrUrl] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedSection = window.sessionStorage.getItem("dashboard-active-section");
    // Only a section that draws something. "customizer" was stored here when
    // Design was pressed, and coming back restored a blank page.
    if (storedSection && SECTION_STEP_LABELS[storedSection]) {
      setActiveSection(storedSection);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!SECTION_STEP_LABELS[activeSection]) return;
    window.sessionStorage.setItem("dashboard-active-section", activeSection);
    pushStep(sectionStep(activeSection));
  }, [activeSection]);

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
  const [shopName, setShopName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [birRegisteredName, setBirRegisteredName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  // Asked for at registration rather than only afterwards: a real page with a
  // back catalogue is the strongest evidence an admin has that a shop exists,
  // and it saves the owner setting up their storefront twice.
  const [shopSocialUrl, setShopSocialUrl] = useState("");
  const [birDocFile, setBirDocFile] = useState<File | null>(null);
  const [validIdFile, setValidIdFile] = useState<File | null>(null);
  const [sellerFormStep, setSellerFormStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState(fallbackName ?? "");
  const [phone, setPhone] = useState("");
  const [profileAddress, setProfileAddress] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  /** Picked, not yet cropped. The cropper is open for as long as this is set. */
  const [avatarToCrop, setAvatarToCrop] = useState<File | null>(null);
  /** Whether to email this customer when a shop marks their order ready for pick up. */
  const [emailNotifyOrderReady, setEmailNotifyOrderReady] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  /** The order a chat card asked to open, shown over the conversation. */
  const [chatOrderId, setChatOrderId] = useState<string | null>(null);
  /** The quote being declined, while the customer says why. */
  const [quoteDeclineOrderId, setQuoteDeclineOrderId] = useState<string | null>(null);
  // The same dialog cancels an accepted, unpaid order; it is worded for that.
  const cancellingUnpaidOrder =
    customerOrders.find((order) => order.id === quoteDeclineOrderId)?.status === "confirmed";
  const noticeTimeoutRef = useRef<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sellerSubmitRef = useRef(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isShopOwner, setIsShopOwner] = useState(false);
  const [, setShopOwnerStatus] = useState<"pending" | "approved" | "rejected" | "none">("none");
  const [shopOwnerName, setShopOwnerName] = useState("");
  const [shopOwnerAddress, setShopOwnerAddress] = useState("");
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string | null>(null);
  // The shop whose terms are being shown. Separate from selectedShopId so the
  // dialog survives the customer selecting elsewhere behind it.
  const [policiesShopId, setPoliciesShopId] = useState<string | null>(null);
  /**
   * What the report dialog is currently pointed at, or null when it is closed.
   *
   * One piece of state for every "Report" in the customer's half of the app --
   * a chat message, an order's payment, a refund -- because they all write the
   * same row into `reports` and differ only in what they point at and which
   * topics they offer. See lib/report-topics.ts and the admin ticket queue
   * that reads them.
   */
  /**
   * Assistant answers, per shop, for this browser tab only.
   *
   * Held here and mirrored into sessionStorage rather than written to
   * `shop_messages`, which is the whole design of the feature. The assistant
   * only ever restates what the shop has already published, so there is
   * nothing for the shop to review or disown -- and `shop_messages` is the
   * record of what two PEOPLE said to each other, which is what a dispute is
   * judged on. Machine text does not belong in it.
   *
   * sessionStorage rather than component state alone so that reloading the
   * page mid-conversation does not blank an answer the customer is reading.
   * Per tab, because that is the honest lifetime of something nobody else can
   * see.
   */
  const [assistantAnswers, setAssistantAnswers] = useState<Record<string, Message[]>>({});
  const [assistantThinkingFor, setAssistantThinkingFor] = useState<string | null>(null);

  // Restored on mount and written back on every change. Wrapped in try/catch
  // at both ends: sessionStorage throws outright in a private window in some
  // browsers, and losing an assistant answer is never worth taking the
  // dashboard down with it.
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(ASSISTANT_STORAGE_KEY);
      if (stored) setAssistantAnswers(JSON.parse(stored) as Record<string, Message[]>);
    } catch {
      /* no stored answers, or no storage at all */
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(assistantAnswers));
    } catch {
      /* a full or unavailable store is not worth a notice */
    }
  }, [assistantAnswers]);

  const [reportTarget, setReportTarget] = useState<{
    targetId: string;
    topics: ReportCategory[];
    title: string;
    context?: string;
  } | null>(null);
  // The cart lives in localStorage and is filled in the studio, which is a
  // different page. Re-read on focus so coming back here does not show a
  // count from before the last piece was added.
  const [cart, setCart] = useState({ lines: 0, pieces: 0 });
  const [myShopId, setMyShopId] = useState<string | null>(null);

  // Which shop the viewer is talking to, as opposed to which shop is open in
  // the browser above. Your own shop can be selected there -- that is how you
  // add a template -- but you are not your own customer, so it is never a
  // conversation. Your shop's inbox is /protected/shop.
  const conversationShopId = selectedShopId && selectedShopId !== myShopId ? selectedShopId : null;
  const quickAnswersRef = useRef<Record<string, QuickAnswers>>({});
  const loadQuickAnswers = useCallback(async (shopId: string): Promise<QuickAnswers | null> => {
    const { data, error } = await createClient()
      .from(SHOPS_PUBLIC_TABLE)
      .select("quick_answers")
      .eq("id", shopId)
      .maybeSingle();
    if (error) return null;
    const answers = parseQuickAnswers((data as { quick_answers?: unknown } | null)?.quick_answers);
    quickAnswersRef.current[shopId] = answers;
    return answers;
  }, []);
  useEffect(() => {
    if (conversationShopId) void loadQuickAnswers(conversationShopId);
  }, [conversationShopId, loadQuickAnswers]);
  const [messageDraft, setMessageDraft] = useState("");
  /** Open when the header's call button has been pressed; see CallSheet. */
  const [isCallSheetOpen, setIsCallSheetOpen] = useState(false);
  const [isSendingPhoto, setIsSendingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [shopThreads, setShopThreads] = useState<Record<string, Message[]>>({});
  const [messageNotice, setMessageNotice] = useState<{ shopId: string; shopName: string; text: string } | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [latestOverviewMessage, setLatestOverviewMessage] = useState<{ text: string; senderName: string; time: string; senderRole: string; shopId: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // With no user there are no orders to wait for; Home stops showing its
  // loading state once the session has been checked either way.
  const [hasResolvedSession, setHasResolvedSession] = useState(false);
  const [shopUnreadIds, setShopUnreadIds] = useState<Record<string, boolean>>({});
  const [shopRatings, setShopRatings] = useState<Record<string, { average: number; count: number }>>({});
  const selectedShopIdRef = useRef<string | null>(null);
  const conversationReadStateAvailableRef = useRef<boolean | null>(null);
  const refreshShopThreadRef = useRef<((shopId: string) => Promise<void>) | null>(null);
  const hasSyncedProfileRef = useRef(false);
  const realtimeChannelRef = useRef<unknown>(null);
  const messageNoticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    selectedShopIdRef.current = selectedShopId;
  }, [selectedShopId]);

  useEffect(() => {
    if (!shops.length) return;
    let cancelled = false;

    const loadRatings = async () => {
      const supabase = createClient();
      const { data } = await supabase.from("shop_ratings").select("shop_id, average_rating, review_count");
      if (cancelled || !data) return;

      setShopRatings(
        Object.fromEntries(
          (data as Array<{ shop_id: string; average_rating: number | string | null; review_count: number }>).map(
            (row) => [row.shop_id, { average: Number(row.average_rating ?? 0), count: row.review_count }]
          )
        )
      );
    };

    void loadRatings();
    return () => {
      cancelled = true;
    };
  }, [shops]);

  const normalizeMessage = (row: {
    id: string;
    shop_id: string;
    sender_user_id: string | null;
    target_user_id: string | null;
    sender_role: string | null;
    text: string;
    created_at: string;
    kind?: string | null;
    payload?: unknown;
  }): Message => ({
    id: row.id,
    sender: "user",
    senderRole: (row.sender_role === "shop_owner" ? "shop_owner" : "customer") as Message["senderRole"],
    text: row.text,
    time: new Date(row.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    shopId: row.shop_id,
    senderUserId: row.sender_user_id,
    targetUserId: row.target_user_id,
    created_at: row.created_at,
    kind: row.kind ?? "text",
    payload: row.payload ?? null,
  });

  const isIncomingMessageForCurrentUser = useCallback((message: Message) => {
    if (!currentUserId) return false;
    if (message.senderUserId === currentUserId) return false;
    if (message.targetUserId) return message.targetUserId === currentUserId;
    return true;
  }, [currentUserId]);

  const getLastReadAtForConversation = useCallback(async (shopId: string, peerUserId: string | null) => {
    if (!currentUserId || !peerUserId) return 0;
    if (conversationReadStateAvailableRef.current === false) return 0;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversation_read_state")
      .select("last_read_at")
      .eq("user_id", currentUserId)
      .eq("shop_id", shopId)
      .eq("peer_user_id", peerUserId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      const isMissingTable = error.code === "PGRST205" || error.code === "42P01" || /does not exist/i.test(error.message || "");
      const isPermissionDenied = /permission denied|row level security|policy/i.test(error.message || "");
      if (isMissingTable || isPermissionDenied) {
        conversationReadStateAvailableRef.current = false;
      }
      return 0;
    }

    if (data?.last_read_at) {
      conversationReadStateAvailableRef.current = true;
      return new Date(data.last_read_at).getTime();
    }

    return 0;
  }, [currentUserId]);

  const markConversationRead = useCallback(async (shopId: string, peerUserId: string | null) => {
    if (!currentUserId || !peerUserId) return;
    if (conversationReadStateAvailableRef.current === false) return;

    const supabase = createClient();
    const { error } = await supabase.from("conversation_read_state").upsert(
      {
        user_id: currentUserId,
        shop_id: shopId,
        peer_user_id: peerUserId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,shop_id,peer_user_id" },
    );

    if (error) {
      const isMissingTable = error.code === "PGRST205" || error.code === "42P01" || /does not exist/i.test(error.message || "");
      const isPermissionDenied = /permission denied|row level security|policy/i.test(error.message || "");
      if (isMissingTable || isPermissionDenied) {
        conversationReadStateAvailableRef.current = false;
      }
    } else {
      conversationReadStateAvailableRef.current = true;
    }
  }, [currentUserId]);

  // Always the customer's side of the conversation: on this dashboard the
  // viewer is the one talking to a shop, whether or not they own one
  // elsewhere. Their own shop's inbox is /protected/shop, which keeps its own
  // per-customer unread state.
  const refreshUnreadStateForConversation = useCallback(async (shopId: string, messages: Message[]) => {
    if (!currentUserId) return;

    const shop = shops.find((item) => item.id === shopId);
    if (!shop?.ownerUserId) return;

    const lastReadAt = await getLastReadAtForConversation(shopId, shop.ownerUserId);
    const hasUnread = messages.some((message) => {
      if (!isIncomingMessageForCurrentUser(message)) return false;
      const createdAt = message.created_at ? new Date(message.created_at).getTime() : 0;
      return createdAt > lastReadAt;
    });

    setShopUnreadIds((current) => ({
      ...current,
      [shopId]: selectedShopIdRef.current !== shopId && hasUnread,
    }));
  }, [currentUserId, getLastReadAtForConversation, isIncomingMessageForCurrentUser, shops]);

  const syncReadStateForCurrentThread = useCallback(async () => {
    if (!currentUserId) return;

    if (!conversationShopId) return;
    const currentSelectedShop = shops.find((shop) => shop.id === conversationShopId) ?? null;
    if (!currentSelectedShop?.ownerUserId) return;
    await markConversationRead(conversationShopId, currentSelectedShop.ownerUserId);
    setShopUnreadIds((current) => ({ ...current, [conversationShopId]: false }));
  }, [conversationShopId, currentUserId, markConversationRead, shops]);

  const refreshShopThread = useCallback(async (shopId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("shop_messages")
      .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: true });

    if (error || !data) {
      return;
    }

    const nextMessages = (data as Array<{
      id: string;
      shop_id: string;
      sender_user_id: string | null;
      target_user_id: string | null;
      sender_role: string | null;
      text: string;
      created_at: string;
    }>).map((row) => normalizeMessage(row));

    setShopThreads((current) => ({
      ...current,
      [shopId]: nextMessages,
    }));

    await refreshUnreadStateForConversation(shopId, nextMessages);
  }, [refreshUnreadStateForConversation]);

  useEffect(() => {
    refreshShopThreadRef.current = refreshShopThread;
  }, [refreshShopThread]);

  const syncProfileToAuthUser = useCallback(async () => {
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw userError ?? new Error("No authenticated user found.");
    }

    const user = userData.user;
    const { data: existingProfile, error: fetchError } = await supabase
      .from("user_profiles")
      .select("id, full_name, phone, address, role, shop_owner, selected_shop_id, avatar_url, email_notify_order_ready")
      .eq("id", user.id)
      .maybeSingle();

    if (fetchError && fetchError.code !== "PGRST116") {
      throw fetchError;
    }

    const { data: approvedShopRequest, error: approvedRequestError } = await supabase
      .from("shops")
      .select("id, user_id, status")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .maybeSingle();

    if (approvedRequestError && approvedRequestError.code !== "PGRST116") {
      throw approvedRequestError;
    }

    const canonicalFullName = existingProfile?.full_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? fallbackName ?? "User";
    const safeFullName = canonicalFullName || "User";
    const safePhone = existingProfile?.phone ?? phone ?? null;
    const safeAddress = existingProfile?.address ?? profileAddress ?? null;
    const approvedByRequest = Boolean(approvedShopRequest);
    const isApprovedShopOwner = Boolean(existingProfile?.shop_owner || existingProfile?.role === "shop_owner" || approvedByRequest);

    setIsShopOwner(isApprovedShopOwner);
    setShopOwnerStatus(isApprovedShopOwner ? "approved" : "none");
    setShopOwnerName(existingProfile?.full_name ?? safeFullName);
    setShopOwnerAddress(safeAddress || "Pending address update");

    // Only when nothing has picked a shop yet. A deep link can already have:
    // Message on a shop's page lands here with ?shop=, applied on mount, and
    // this fetch resolves several round trips later. It used to overwrite that
    // with the saved choice, so the chat opened on whichever shop the customer
    // had chosen for orders rather than the one they had just clicked Message on.
    if (existingProfile?.selected_shop_id && !selectedShopIdRef.current) {
      selectedShopIdRef.current = existingProfile.selected_shop_id;
      setSelectedShopId(existingProfile.selected_shop_id);
    }

    const payload = {
      id: user.id,
      full_name: safeFullName,
      phone: safePhone,
      address: safeAddress,
      // Preserved rather than reset: this sync runs on every load to make sure
      // a profile row exists at all, and knows nothing about the avatar or the
      // email preference below -- omitting either here would silently reset
      // it to the column default on every single page visit.
      avatar_url: existingProfile?.avatar_url ?? null,
      email_notify_order_ready: existingProfile?.email_notify_order_ready ?? true,
      role: existingProfile?.role === "shop_owner" || approvedByRequest ? "shop_owner" : existingProfile?.role ?? "customer",
      shop_owner: Boolean(existingProfile?.shop_owner || approvedByRequest),
      updated_at: new Date().toISOString(),
    };

    await syncApprovedShops(user.id, user.email ?? fallbackName ?? null, safeFullName, safeAddress);

    const { error: upsertError } = await supabase.from("user_profiles").upsert(payload, { onConflict: "id" });
    if (upsertError) throw upsertError;

    setFullName(safeFullName);
    setPhone(safePhone || "");
    setProfileAddress(safeAddress || "");
    setAvatarUrl(existingProfile?.avatar_url ?? null);
    // Unset (a profile created before this preference existed) reads as on,
    // matching the column's own default -- never silently opted out.
    setEmailNotifyOrderReady(existingProfile?.email_notify_order_ready ?? true);
    return payload;
  }, [phone, profileAddress, fallbackName]);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: number | undefined;

    const fetchProfile = async (attempt = 0) => {
      if (hasSyncedProfileRef.current || cancelled) return;

      try {
        await syncProfileToAuthUser();
        hasSyncedProfileRef.current = true;
      } catch (error) {
        // A stale invocation (superseded by React re-running this effect,
        // e.g. under StrictMode's dev double-invoke) must not touch the
        // shared ref or log -- only the active invocation gets a say.
        if (cancelled) return;

        // Transient network blips throw AuthRetryableFetchError. Right after
        // a fresh page load / sign-in redirect, getUser() can also throw
        // AuthSessionMissingError before the browser's Supabase client has
        // finished reading the just-set session cookies into memory -- the
        // proxy (middleware) already guarantees a valid session existed at
        // request time for this route, so that's a hydration race, not a
        // real signed-out state. Retry a couple times with backoff for both
        // instead of giving up on profile sync for the rest of the session.
        // Any other error fails fast, as before.
        if ((isAuthRetryableFetchError(error) || isAuthSessionMissingError(error)) && attempt < 2) {
          retryTimeout = window.setTimeout(() => fetchProfile(attempt + 1), 1500 * (attempt + 1));
          return;
        }
        hasSyncedProfileRef.current = true;
        console.error("Failed to sync profile:", error);
      }
    };

    fetchProfile();

    return () => {
      cancelled = true;
      if (retryTimeout) window.clearTimeout(retryTimeout);
    };
  }, [syncProfileToAuthUser]);

  useEffect(() => {
    /**
     * An absent hash means "no opinion", not "go to overview".
     *
     * This used to read `hash || "overview"` and set that unconditionally, on
     * mount as well as on every hashchange. Because it is declared above the
     * `?section=` handler and React runs mount effects twice in development,
     * its second pass fired after that handler had already consumed and
     * stripped the query -- so it overwrote the requested section with
     * "overview" and a link like `/protected?section=orders` silently landed on
     * the dashboard home. It also stamped over the section restored from
     * sessionStorage, which is why a section never survived a reload.
     *
     * An unrecognised hash is ignored too, rather than becoming a section that
     * renders as nothing.
     */
    const onHashChange = (event?: Event) => {
      const hash = window.location.hash.replace("#", "");
      if (!hash) {
        if (event) setActiveSection("overview");
        return;
      }
      // #customizer is not a section, it is the studio -- but trails saved
      // before this fix still point Back at it, and it drew an empty page.
      if (hash === "customizer") {
        window.history.replaceState(null, "", "#overview");
        setActiveSection("overview");
        return;
      }
      if (hash === "seller" || SECTION_KEYS.includes(hash)) {
        setActiveSection(hash);
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

  /**
   * Cropped and compressed client-side, then staged in `avatarUrl` state --
   * not written to the database until "Save Changes" is pressed, the same as
   * every other field in this modal. Picking a photo and closing without
   * saving must not silently change anything.
   */
  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarError(null);

    if (!isImageFile(file)) {
      setAvatarError("Choose an image file.");
      return;
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      setAvatarError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. Please choose one under 8MB.`);
      return;
    }

    // Straight to the cropper rather than a centre crop: see
    // components/ui/image-cropper.tsx. Nothing is written to avatarUrl until
    // the crop is confirmed, so cancelling leaves the old photo alone.
    setAvatarToCrop(file);
  };

  const handleProfileSave = async () => {
    setIsSavingProfile(true);
    setNotice(null);

    try {
      const supabase = createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        setNotice("You need to be signed in to update your profile.");
        return;
      }

      const { data: existingProfile, error: fetchError } = await supabase
        .from("user_profiles")
        .select("id, full_name, role, shop_owner")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (fetchError && fetchError.code !== "PGRST116") {
        throw fetchError;
      }

      const nextFullName = fullName.trim() || existingProfile?.full_name || userData.user.user_metadata?.full_name || userData.user.user_metadata?.name || userData.user.email || fallbackName || "User";

      const payload = {
        id: userData.user.id,
        full_name: nextFullName,
        phone: phone || null,
        address: profileAddress || null,
        avatar_url: avatarUrl,
        role: existingProfile?.role ?? "customer",
        shop_owner: existingProfile?.shop_owner ?? false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase.from("user_profiles").upsert(payload, { onConflict: "id" });
      if (upsertError) throw upsertError;

      setFullName(nextFullName);
      setNotice("Your profile has been updated successfully.");
      notifySaved("Profile saved");
      setIsProfileModalOpen(false);
    } catch (error: unknown) {
      console.error("Profile update failed:", error);
      setNotice(error instanceof Error ? error.message : "Failed to update your profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  /**
   * Saves immediately on toggle, unlike the rest of the profile form -- a
   * settings switch reads as already-applied the moment it flips, and making
   * this one preference wait for a separate "Save Changes" click on a
   * different screen would be a surprise, not a safeguard.
   */
  const handleToggleEmailNotifyOrderReady = async (next: boolean) => {
    setEmailNotifyOrderReady(next);
    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { error } = await supabase
        .from("user_profiles")
        .update({ email_notify_order_ready: next })
        .eq("id", userData.user.id);
      if (error) throw error;
      notifySaved("Preference saved");
    } catch (error) {
      console.error("Failed to update email preference:", error);
      setEmailNotifyOrderReady(!next);
      setNotice("Could not save that preference. Please try again.");
    }
  };

  const openCart = () => {
    pushStep({ href: "/protected", label: "Dashboard" });
    router.push("/order-summary");
  };

  const navItems = [
    { key: "overview", label: t("Dashboard"), icon: IconOverview },
    { key: "shops", label: t("Shops"), icon: IconSeller },
    { key: "orders", label: t("Orders"), icon: IconOrders },
    // Only while there is something in it. An empty cart permanently in the
    // nav is a control that does nothing, every visit, for most customers.
    ...(cart.lines > 0 ? [{ key: "cart", label: t("Cart"), icon: IconCart }] : []),
    { key: "templates", label: t("My templates"), icon: IconTemplates },
    { key: "messages", label: t("Messages"), icon: IconMessages },
    { key: "support", label: t("Support"), icon: IconPhone },
    // This is the customer dashboard, so its business entry is always the
    // seller application. A shop owner reaches the Storefront from the shop
    // side (Switch to shop), never from here.
    { key: "seller", label: t("Become a Seller"), icon: IconSeller },
    { key: "settings", label: t("Settings"), icon: IconSettings },
    { key: "customizer", label: t("Design"), icon: IconFurniture },
  ];

  const sidebarItems: DashboardNavItem[] = navItems.map((item) => {
    const divider =
      item.key === "seller"
        ? "Business"
        : item.key === "settings"
          ? "Account"
          : undefined;
    const active = activeSection === item.key;

    const icon = <item.icon aria-hidden className="h-4 w-4" />;

    if (item.key === "cart") {
      return {
        key: item.key,
        label: item.label,
        icon,
        active: false,
        // Pieces, not lines: a cart holding one design of six chairs is six
        // things being ordered, and six is the number worth seeing.
        badge: cart.pieces,
        onClick: () => {
          setIsSidebarOpen(false);
          openCart();
        },
      };
    }

    if (item.key === "seller") {
      return {
        key: item.key,
        label: item.label,
        icon,
        active,
        divider,
        onClick: () => {
          setActiveSection("seller");
          setIsSidebarOpen(false);
          // Asked before the form opens rather than after it has been filled
          // in: a pending applicant used to be handed a blank application,
          // file a second one, and end up with two shop rows behind one
          // account. handleSellerSubmit checks again at the point of no return.
          void (async () => {
            const supabase = createClient();
            const { data: userData } = await supabase.auth.getUser();
            if (userData.user) {
              const { data: existing } = await supabase
                .from("shops")
                .select("status")
                .eq("user_id", userData.user.id)
                .in("status", ["approved", "pending"]);
              if (existing?.some((row) => row.status === "approved")) {
                router.push("/protected/shop");
                return;
              }
              if (existing?.length) {
                setNotice("Your shop application is already with the admin for review. You'll be notified once it's decided.");
                return;
              }
            }
            setNotice(null);
            setIsSellerModalOpen(true);
          })();
        },
      };
    }

    if (item.key === "customizer") {
      return {
        key: item.key,
        label: item.label,
        icon,
        active,
        divider,
        hideBelowLg: true,
        onClick: () => {
          // The section stays as it is: Back from the studio returns to it.
          setIsSidebarOpen(false);
          pushStep(sectionStep(activeSection));
          router.push("/customize-furniture");
        },
      };
    }

    return {
      key: item.key,
      label: item.label,
      icon,
      active,
      divider,
      href: `#${item.key}`,
      // Already a tab in the phone's bottom bar, so not repeated in the drawer there.
      hideBelowLg:
        item.key === "overview" ||
        item.key === "shops" ||
        item.key === "orders" ||
        item.key === "messages" ||
        item.key === "support",
      onClick: () => {
        setActiveSection(item.key);
        setIsSidebarOpen(false);
      },
    };
  });

  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;

  /**
   * The shop a template belongs to, for pieces opened from one.
   *
   * A template is a shop's own design, published as an invitation to
   * commission that piece from them, so a design opened from one travels to
   * the cart addressed to them and cannot be redirected.
   *
   * Returns null when the shop cannot be named -- deactivated, or absent from
   * the approved list this page loaded. Failing open is deliberate: a lock the
   * customer can neither move nor see a reason for is worse than letting them
   * choose.
   */
  const templateOriginShop = (shopId: string | null | undefined) => {
    const match = shops.find((shop) => shop.id === shopId);
    return match ? { id: match.id, name: match.name } : null;
  };

  // Live presence, so a green dot means someone is actually there. The
  // green dot means someone is actually at their desk.
  const onlineUserIds = useOnlineUsers(currentUserId);
  const isShopOnline = (shop: { ownerUserId?: string | null } | null) =>
    Boolean(shop?.ownerUserId && onlineUserIds.has(shop.ownerUserId));

  const conversationShop = conversationShopId
    ? shops.find((shop) => shop.id === conversationShopId) ?? null
    : null;

  // One thread, one customer: the messages this viewer sent to the shop and
  // the ones it sent back. A shop owner browsing here is a customer of that
  // other shop and sees no more of its inbox than anyone else would.
  const currentThread = useMemo(() => {
    // Read inside the memo rather than above it: `shopThreads[id] ?? []`
    // builds a fresh array whenever that shop has no thread yet, so hoisting
    // it would change the dependency identity on every render and the memo
    // would never actually memoise anything.
    const rawCurrentThread = conversationShop ? shopThreads[conversationShop.id] ?? [] : [];
    const mine = rawCurrentThread.filter((message) => {
      if (!currentUserId) return false;
      return message.senderUserId === currentUserId || message.targetUserId === currentUserId;
    });
    const answers = conversationShop ? assistantAnswers[conversationShop.id] ?? [] : [];
    if (answers.length === 0) return mine;
    // Merged by timestamp rather than appended, so an assistant answer sits
    // directly under the question that prompted it even after the shop has
    // since replied and the thread has moved on.
    return [...mine, ...answers].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [shopThreads, currentUserId, conversationShop, assistantAnswers]);
  const conversationChannelName = currentUserId && conversationShopId ? `shop-convo:${conversationShopId}` : null;

  // Scrolling the thread to the newest message now belongs to MessengerThread,
  // which owns the scroll container and pins it in a layout effect.

  useEffect(() => {
    if (!conversationShopId || !conversationShop?.ownerUserId) {
      return;
    }

    void syncReadStateForCurrentThread();
  }, [conversationShop?.ownerUserId, conversationShopId, syncReadStateForCurrentThread]);

  useEffect(() => {
    if (!conversationShop?.id || !conversationChannelName) {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshShopThread(conversationShop.id);
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, [conversationChannelName, conversationShop?.id, refreshShopThread]);

  useEffect(() => {
    const supabase = createClient();

    const syncCurrentUser = async () => {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (!error) {
        setCurrentUserId(sessionData.session?.user?.id ?? null);
      }
      setHasResolvedSession(true);
    };

    void syncCurrentUser();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUserId(session?.user?.id ?? null);
      setHasResolvedSession(true);
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Fetch the latest message for the overview card
  useEffect(() => {
    const fetchLatestMessage = async () => {
      const supabase = createClient();

      // Get the current authenticated user directly to avoid stale state
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) return;
      const userId = authData.user.id;

      // Fetch latest message FROM someone else, targeted TO this user (any role).
      // A shop owner is also a customer here, and their own shop's inbox
      // (customers messaging *them*) uses this same target_user_id, so that
      // channel must be excluded or the overview card can surface a message
      // that only exists on /protected/shop -- one its own "View all
      // messages" link then can't open, since a customer never gets to talk
      // to themselves.
      let latestMessageQuery = supabase
        .from("shop_messages")
        .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
        .eq("target_user_id", userId)
        .neq("sender_user_id", userId);
      if (myShopId) {
        latestMessageQuery = latestMessageQuery.neq("shop_id", myShopId);
      }
      const { data, error } = await latestMessageQuery
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        setLatestOverviewMessage(null);
        return;
      }

      // Resolve sender display name from their profile
      let senderName = "Customer";
      if (data.sender_user_id) {
        const { data: profile } = await supabase
          .from(USER_NAMES_TABLE)
          .select("full_name")
          .eq("id", data.sender_user_id)
          .maybeSingle();
        if (profile?.full_name) senderName = profile.full_name;
      }

      const timeDisplay = timeAgo(data.created_at, new Date(), uiLanguage);

      setLatestOverviewMessage({
        text: data.text,
        senderName,
        time: timeDisplay,
        senderRole: data.sender_role ?? "customer",
        shopId: data.shop_id,
      });
    };

    setLatestOverviewMessage(null);
    fetchLatestMessage();
  }, [currentUserId, myShopId, uiLanguage]);

  useEffect(() => {
    if (!conversationChannelName || !currentUserId || !conversationShop?.id) {
      setIsRealtimeConnected(false);
      return;
    }

    const supabase = createClient();
    const currentShopId = conversationShop.id;
    const currentShopName = conversationShop.name;

    const loadMessages = async () => {
      if (refreshShopThreadRef.current) {
        await refreshShopThreadRef.current(currentShopId);
      }
    };

    void loadMessages();

    const channel = supabase.channel(conversationChannelName, {
      config: {
        broadcast: { self: false },
      },
    });

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "shop_messages",
        filter: `shop_id=eq.${currentShopId}`,
      },
      (payload) => {
        const incomingMessage = payload.new as {
          id: string;
          shop_id: string;
          sender_user_id: string | null;
          target_user_id: string | null;
          sender_role: string | null;
          text: string;
          created_at: string;
        };

        if (incomingMessage.shop_id !== currentShopId) return;

        if (incomingMessage.sender_user_id !== currentUserId && incomingMessage.target_user_id !== currentUserId) {
          return;
        }

        const normalizedMessage = normalizeMessage(incomingMessage);

        if (refreshShopThreadRef.current) {
          void refreshShopThreadRef.current(incomingMessage.shop_id);
        }

        // Only show toast for messages sent by someone else and targeted to the current user
        const isSelfSent = incomingMessage.sender_user_id === currentUserId;
        const isTargetedToMe = incomingMessage.target_user_id === currentUserId;
        if (isSelfSent || !isTargetedToMe) return;

        setMessageNotice({ shopId: incomingMessage.shop_id, shopName: currentShopName, text: normalizedMessage.text });

        if (messageNoticeTimeoutRef.current) {
          window.clearTimeout(messageNoticeTimeoutRef.current);
        }

        messageNoticeTimeoutRef.current = window.setTimeout(() => {
          setMessageNotice(null);
          messageNoticeTimeoutRef.current = null;
        }, 4000);
      }
    );

    channel.subscribe((status) => {
      setIsRealtimeConnected(status === "SUBSCRIBED");
    });

    realtimeChannelRef.current = channel;

    return () => {
      if (messageNoticeTimeoutRef.current) {
        window.clearTimeout(messageNoticeTimeoutRef.current);
        messageNoticeTimeoutRef.current = null;
      }

      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
      setIsRealtimeConnected(false);
    };
  }, [conversationChannelName, conversationShop?.id, conversationShop?.name, currentUserId]);

  // Escape closes the order modal, matching the notification panel and the
  // storefront editor.
  useEffect(() => {
    if (!selectedCustomerOrderId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedCustomerOrderId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedCustomerOrderId]);

  useEffect(() => {
    if (!notice || isSellerModalOpen) return;

    // A failure is worth reading twice; a confirmation is not.
    const isProblem = /couldn't|could not|failed|please enter|need to be signed in/i.test(notice);
    if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    noticeTimeoutRef.current = window.setTimeout(
      () => {
        setNotice(null);
        noticeTimeoutRef.current = null;
      },
      isProblem ? 8000 : 4000
    );

    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = null;
      }
    };
  }, [notice, isSellerModalOpen]);

  /**
   * Apply `?section=` / `?shop=`, however they arrive.
   *
   * Still read from the URL rather than `useSearchParams`, which would opt this
   * route out of static prerendering unless wrapped in Suspense. What changed is
   * that this no longer runs only on mount: a notification pointing at the page
   * the customer is already on does not remount anything, so it is delivered as
   * an event and handled here too. Before, clicking a message notification from
   * the dashboard visibly did nothing.
   */
  const applyDeepLink = useCallback((params: URLSearchParams) => {
    const section = params.get("section");
    const shopId = params.get("shop");
    // Lets the shop dashboard's own avatar link straight into editing it,
    // rather than sending a shop owner here to hunt for the button themselves.
    const openProfile = params.get("profile");
    const deletionCancelled = params.get("deletion_cancelled");

    if (section && SECTION_KEYS.includes(section)) setActiveSection(section);
    if (shopId) {
      selectedShopIdRef.current = shopId;
      setSelectedShopId(shopId);
      // Arriving at Messages for a shop means that shop's thread, as picking it
      // from the list would open it. On a phone the thread is its own screen
      // over the list, so without this the link landed on the list with the
      // shop merely highlighted and looked like it had done nothing.
      if (section === "messages") setIsMobileThreadOpen(true);
    }
    if (openProfile) setIsProfileModalOpen(true);
    if (deletionCancelled) setNotice("Account deletion cancelled — welcome back.");

    if (section || shopId || openProfile || deletionCancelled) {
      // Leave the address bar clean, so a refresh does not re-apply an
      // intent the visitor has since navigated away from.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const refresh = () => setCart({ lines: cartLineCount(), pieces: cartPieceCount() });
    refresh();
    window.addEventListener("focus", refresh);
    // Another tab checking out should empty this one's badge too.
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useDeepLink(applyDeepLink);

  const handleSelectShop = async (shopId: string) => {
    selectedShopIdRef.current = shopId;
    setSelectedShopId(shopId);

    // Terms first. Deposits and lead times change whether you want a shop at
    // all, so they belong here rather than at checkout.
    //
    // Shown per shop and suppressed for an hour afterwards, not forever: each
    // shop's terms are its own, so picking a different shop shows that shop's,
    // and coming back to one after a break shows it again. See
    // POLICIES_SEEN_TTL_MS for why an hour.
    if (!hasSeenPolicies(shopId)) {
      setPoliciesShopId(shopId);
      markPoliciesSeen(shopId);
    }

    const shop = shops.find((item) => item.id === shopId);
    if (shop?.ownerUserId) {
      await markConversationRead(shopId, shop.ownerUserId);
    }

    setShopUnreadIds((current) => ({ ...current, [shopId]: false }));

    if (currentUserId) {
      const supabase = createClient();
      const { error } = await supabase
        .from("user_profiles")
        .update({ selected_shop_id: shopId })
        .eq("id", currentUserId);
      if (error) {
        console.error("Failed to save selected shop:", error);
        setNotice("Couldn't save your shop selection. Please try again.");
        return;
      }
    }

    if (shop) {
      setNotice(`You've selected ${shop.name}.`);
    }
  };

  /**
   * The Overview marketplace feed: "Explore shops" plus the product grid
   * below it. Deliberately its own state rather than reusing selectedShopId,
   * which drives the shop the customer has
   * *committed to* for messaging and orders, while this is just a browsing
   * filter. Conflating them would mean clicking a shop card here to preview
   * its catalogue also silently switched who "Messages" points at.
   */
  const [feedShopFilter, setFeedShopFilter] = useState<string | null>(null);
  const [feedShopQuery, setFeedShopQuery] = useState("");
  /**
   * Whether the phone-sized thread is covering the conversation list.
   *
   * Separate from selectedShopId on purpose: backing out of a thread should
   * put the list back, not un-choose the shop the composer is still pointed at. From lg up this is ignored -- the list and
   * the thread are both on screen, so there is nothing to back out of.
   */
  const [isMobileThreadOpen, setIsMobileThreadOpen] = useState(false);
  const [feedTemplates, setFeedTemplates] = useState<DesignTemplate[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  // Material filter for the feed. Each template's tags are worked out once per
  // fetch from the design itself (see material-tags.ts), not on every render.
  const [feedTagFilter, setFeedTagFilter] = useState<MaterialTagId | null>(null);
  const feedTags = useMemo(
    () => new Map(feedTemplates.map((template) => [template.id, materialTagsForDesign(template.cad_state)])),
    [feedTemplates]
  );
  const feedFilterTags = useMemo(
    () => MATERIAL_TAGS.map((tag) => tag.id).filter((id) => [...feedTags.values()].some((tags) => tags.includes(id))),
    [feedTags]
  );
  const visibleFeed = feedTagFilter
    ? feedTemplates.filter((template) => feedTags.get(template.id)?.includes(feedTagFilter))
    : feedTemplates;

  const activeShopIds = useMemo(() => new Set(shops.map((shop) => shop.id)), [shops]);

  const fetchFeed = useCallback(
    async (shopId: string | null) => {
      setIsLoadingFeed(true);
      try {
        const supabase = createClient();
        let query = supabase
          .from("design_templates")
          .select("id, shop_id, title, description, tag, cad_state, preview_url, allowed_materials, created_at")
          // Also keep an owner's hidden pieces out of the
          // feed they browse as a customer; RLS covers everyone else.
          .eq("is_hidden", false)
          .order("created_at", { ascending: false });
        query = shopId ? query.eq("shop_id", shopId) : query.limit(24);

        const { data, error } = await query;
        if (error) {
          console.error("Failed to load the marketplace feed:", error);
          setFeedTemplates([]);
        } else {
          // design_templates has no RLS restriction tied to the owning shop's
          // approval/active status, so an unfiltered "Recommended for you"
          // would otherwise be able to surface a deactivated or unapproved
          // shop's row. activeShopIds is already scoped to shops_public.
          setFeedTemplates(((data ?? []) as DesignTemplate[]).filter((row) => activeShopIds.has(row.shop_id)));
        }
      } catch (thrown) {
        // Handle transport failures as well as returned database errors.
        console.error("Failed to load the marketplace feed:", thrown);
        setFeedTemplates([]);
      } finally {
        setIsLoadingFeed(false);
      }
    },
    [activeShopIds]
  );

  useEffect(() => {
    fetchFeed(feedShopFilter);
  }, [feedShopFilter, fetchFeed]);

  const feedVisibleShops = useMemo(() => {
    const needle = feedShopQuery.trim().toLowerCase();
    if (!needle) return shops;
    return shops.filter((shop) => [shop.name, shop.specialty, shop.location].some((field) => field?.toLowerCase().includes(needle)));
  }, [shops, feedShopQuery]);

  const fetchCustomerDesigns = useCallback(async (userId: string) => {
    setIsLoadingCustomerDesigns(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customer_designs")
        .select("id, name, furniture_type, cad_state, preview_url, kind, updated_at")
        .eq("customer_user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("Failed to load your designs:", error);
        setCustomerDesigns([]);
      } else {
        setCustomerDesigns((data ?? []) as CustomerDesign[]);
      }
    } catch (thrown) {
      // Same reasoning as fetchCustomerOrders: a refused query returns an
      // error, an unreachable one throws, and only `finally` catches both.
      console.error("Failed to load your designs:", thrown);
      setCustomerDesigns([]);
    } finally {
      setIsLoadingCustomerDesigns(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    fetchCustomerDesigns(currentUserId);
  }, [currentUserId, fetchCustomerDesigns]);

  // Live: a design just autosaved from the studio (in another tab, or this one
  // navigating back) should not need a manual refresh to show up here.
  useEffect(() => {
    if (!currentUserId) return;
    const supabase = createClient();
    const channel = supabase.channel(`customer-designs-${currentUserId}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "customer_designs", filter: `customer_user_id=eq.${currentUserId}` },
      () => fetchCustomerDesigns(currentUserId)
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, fetchCustomerDesigns]);

  const handleOpenCustomerDesign = useCallback(
    (design: CustomerDesign) => {
      const item = resolveDesignItem(design.cad_state);
      if (!item) return;
      if (!openItemInDesigner(item, design.name, null, { id: design.id, kind: design.kind })) return;
      pushStep({ href: "/protected#templates", label: "My templates" });
      router.push("/customize-furniture");
    },
    [router]
  );

  const handleDeleteCustomerDesign = useCallback(async (design: CustomerDesign) => {
    setDeletingDesignId(design.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("customer_designs").delete().eq("id", design.id);
      if (error) {
        console.error("Failed to delete design:", error);
        return;
      }
      setCustomerDesigns((current) => current.filter((entry) => entry.id !== design.id));
      notifySuccess("Design deleted");
    } finally {
      setDeletingDesignId(null);
    }
  }, []);

  /**
   * Deletes the drafts picked in My templates in one request. Limited to
   * kind = 'draft' as well as the ids, so a saved design can never ride along.
   */
  const handleDeleteDrafts = useCallback(async (designs: CustomerDesign[]) => {
    if (designs.length === 0) return;
    setIsDeletingDrafts(true);
    try {
      const ids = designs.map((design) => design.id);
      const supabase = createClient();
      const { error } = await supabase.from("customer_designs").delete().in("id", ids).eq("kind", "draft");
      if (error) {
        console.error("Failed to delete drafts:", error);
        return;
      }
      const deleted = new Set(ids);
      setCustomerDesigns((current) => current.filter((entry) => !deleted.has(entry.id)));
      notifySuccess(ids.length === 1 ? "Draft deleted" : `${ids.length} drafts deleted`);
    } finally {
      setIsDeletingDrafts(false);
    }
  }, []);

  const draftDesigns = customerDesigns.filter((design) => design.kind === "draft");
  const savedDesigns = customerDesigns.filter((design) => design.kind === "saved");

  /**
   * The customer's orders.
   *
   * The settle-the-flags lines live in `finally` rather than at the end of the
   * body, and that is the whole point of this shape. Supabase reports a query
   * that the server refused as a returned `error`, which the branch below
   * handles -- but a query that never reaches the server throws instead, and a
   * token it cannot refresh is exactly that case. Written as straight-line
   * code the throw escaped before `setHasLoadedCustomerOrders(true)` ever ran,
   * `ordersLoaded` stayed false, and Home sat on its pulsing skeleton for as
   * long as the tab was open: no orders, no empty state, no error, no end.
   *
   * A catch that cannot say what went wrong is still worth having, because the
   * screen it replaces says nothing at all and never stops saying it.
   */
  const fetchCustomerOrders = useCallback(async (userId: string) => {
    setIsLoadingCustomerOrders(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_orders")
        .select("id, shop_id, project_name, furniture_type, estimated_price, budget_min, budget_max, cad_state, preview_url, notes, reference_images, status, created_at, quoted_total, downpayment_percent, downpayment_amount, quote_lines, customer_response, payment_receipt_url, payment_reference, payment_rejected_reason, decline_reason, refund_status, refund_reason, refund_requested_at, refund_declined_reason, refund_decided_at, refund_reference, refund_amount")
        .eq("customer_user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load orders:", error);
        setCustomerOrders([]);
        setCustomerOrdersFailed(true);
      } else {
        setCustomerOrders((data ?? []) as CustomerOrder[]);
        setCustomerOrdersFailed(false);
      }
    } catch (thrown) {
      console.error("Failed to load orders:", thrown);
      setCustomerOrders([]);
      setCustomerOrdersFailed(true);
    } finally {
      setIsLoadingCustomerOrders(false);
      setHasLoadedCustomerOrders(true);
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    fetchCustomerOrders(currentUserId);
  }, [currentUserId, fetchCustomerOrders]);

  /**
   * Keeps customerOrders current while the shop acts on the other side.
   *
   * The fetch above only ever ran once per session: after that, the shop
   * quoting, rejecting a receipt, approving one, or declining an order left
   * this array exactly as it was until a full page reload. A rejected receipt
   * was the visible symptom -- the order sat at the old "payment_submitted"
   * status forever, so the upload form for "confirmed" never came back and the
   * customer had no way to see the reason or try again -- but the staleness
   * covers every shop-side change, not only this one.
   *
   * Refetching on any event is simpler and safer than patching the changed
   * row from the payload by hand, and the table is small per customer.
   */
  useEffect(() => {
    if (!currentUserId) return;
    const supabase = createClient();
    const channel = supabase.channel(`customer-orders-${currentUserId}`);
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "design_orders", filter: `customer_user_id=eq.${currentUserId}` },
      () => fetchCustomerOrders(currentUserId)
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, fetchCustomerOrders]);

  const selectedCustomerOrder = customerOrders.find((order) => order.id === selectedCustomerOrderId) ?? null;

  const unreadActionOrderIds = useUnreadOrderActions(
    currentUserId,
    activeSection === "orders" ? selectedCustomerOrder?.id ?? null : null
  );

  const [isRefundBusy, setIsRefundBusy] = useState(false);

  /**
   * Asks the shop to return a payment.
   *
   * Writes only the customer's half of the record. The database enforces the
   * same split -- a customer cannot mark their own refund paid, nor write the
   * reference for a transfer only the shop can make -- so this is the shape of
   * the request, not the only thing standing behind it.
   */
  const handleRequestRefund = useCallback(
    async (orderId: string, reason: string) => {
      setIsRefundBusy(true);
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("design_orders")
          .update({
            refund_status: "requested",
            refund_reason: reason,
            refund_requested_at: new Date().toISOString(),
          })
          .eq("id", orderId);
        if (error) {
          setNotice(error.message);
          return;
        }
        if (currentUserId) await fetchCustomerOrders(currentUserId);
        notifySuccess("Your refund request has been sent to the shop.");
      } finally {
        setIsRefundBusy(false);
      }
    },
    [fetchCustomerOrders, currentUserId]
  );

  // Grouped the way the shop's queue is, from the other side of the same
  // transaction: what is on you, what you are waiting for, what is finished.
  const ordersNeedingYou = customerOrders.filter((order) =>
    CUSTOMER_ACTIONABLE.includes(order.status as OrderStatus)
  );
  const ordersInProgress = customerOrders.filter(
    (order) =>
      order.status === "pending_quote" ||
      order.status === "payment_submitted" ||
      order.status === "in_production"
  );
  const ordersClosed = customerOrders.filter(
    (order) => order.status === "completed" || order.status === "declined"
  );
  const getShopNameForOrder = (shopId: string) => shops.find((shop) => shop.id === shopId)?.name ?? "Shop";
  const getShopLogoForOrder = (shopId: string) => shops.find((shop) => shop.id === shopId)?.logoUrl ?? null;
  /**
   * Confirming or declining a quote. The database restricts the customer to
   * exactly these two moves -- see guard_design_order_columns in
   * supabase/migrations/20260826000100_order_state_machine.sql -- so a failure
   * here is shown rather than swallowed.
   */
  const handleQuoteResponse = async (orderId: string, response: "confirmed" | "declined", declineReason?: string) => {
    setIsRespondingToQuote(true);
    const previousStatus = customerOrders.find((order) => order.id === orderId)?.status ?? null;
    setQuoteResponseError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("design_orders")
        .update({
          status: response,
          customer_response: response,
          customer_responded_at: new Date().toISOString(),
          // Written in the same statement as the status: the guard only lets a
          // reason be set while the order is actually moving to declined.
          ...(response === "declined" && declineReason ? { decline_reason: declineReason } : {}),
        })
        .eq("id", orderId);

      if (error) {
        setQuoteResponseError(error.message);
        return;
      }

      setCustomerOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, status: response, customer_response: response } : order
        )
      );
      notifySuccess(orderSuccessMessage({ status: response, customer_response: response }, previousStatus) ?? "Done");
    } finally {
      setIsRespondingToQuote(false);
    }
  };

  /**
   * Uploads proof of a downpayment paid directly to the shop.
   *
   * The money never passes through FurniCraft, so nothing here verifies the
   * transfer -- the shop checks its own GCash or bank app and approves. The
   * database refuses this move without a receipt attached, so the file is
   * uploaded first and the status only follows if that succeeded.
   */
  const [shopPayment, setShopPayment] = useState<ShopPaymentInfo | null>(null);

  useEffect(() => {
    const order = customerOrders.find((entry) => entry.id === selectedCustomerOrderId);
    // Only once the quote is accepted: the details are for paying the
    // downpayment, and shop_payment_details returns nothing before then.
    if (!order || order.status !== "confirmed") {
      setShopPayment(null);
      setShopQrUrl(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("shop_payment_details", { p_shop_id: order.shop_id });
      const row = Array.isArray(data) ? (data[0] as ShopPaymentInfo) : null;
      if (cancelled || !row) return;
      setShopPayment(row);
      const qr = await signedUrlFor(QR_BUCKET, row.payment_qr_url ?? null);
      if (!cancelled) setShopQrUrl(qr);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomerOrderId, customerOrders]);

  const handleSubmitReceipt = async (orderId: string) => {
    if (!receiptFile) {
      setReceiptError("Attach a photo or PDF of your payment receipt.");
      return;
    }
    if (!paymentReference.trim()) {
      setReceiptError("Enter the reference number from your GCash or bank transfer.");
      return;
    }

    setIsSubmittingReceipt(true);
    setReceiptError(null);
    try {
      const uploaded = await uploadReceipt(orderId, receiptFile);
      if ("error" in uploaded) {
        setReceiptError(uploaded.error);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase
        .from("design_orders")
        .update({
          status: "payment_submitted",
          payment_receipt_url: uploaded.path,
          payment_reference: paymentReference.trim(),
          payment_submitted_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (error) {
        setReceiptError(error.message);
        return;
      }

      setReceiptFile(null);
      setPaymentReference("");
      setCustomerOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, status: "payment_submitted" } : order
        )
      );
      notifySuccess("Receipt sent to the shop");
    } finally {
      setIsSubmittingReceipt(false);
    }
  };

  const totalUnreadMessages = Object.values(shopUnreadIds).filter(Boolean).length;

  const handleSendMessage = async () => {
    const targetShopId = conversationShopId;
    if (!targetShopId || !messageDraft.trim()) return;

    if (!currentUserId || !conversationShop?.id) {
      return;
    }

    const targetUserId = conversationShop.ownerUserId ?? null;

    const supabase = createClient();
    const payload = {
      shop_id: targetShopId,
      sender_user_id: currentUserId,
      target_user_id: targetUserId,
      sender_role: "customer",
      text: messageDraft.trim(),
    };

    const { data, error } = await supabase
      .from("shop_messages")
      .insert(payload)
      .select("id, shop_id, sender_user_id, target_user_id, sender_role, text, created_at, kind, payload, order_id")
      .single();

    if (error) {
      console.error("Failed to send message:", error);
      setNotice(error.message || "Your message was not sent. Check your connection and try again.");
      return;
    }

    if (data) {
      await refreshShopThread(targetShopId);
    }

    setMessageDraft("");
    // Nothing else happens here on purpose. A message the customer types is
    // for the shop, and an automatic machine reply to it is a surprise -- the
    // assistant now speaks only when someone taps a quick question.
  };

  /**
   * Sends a picked photo to the shop.
   *
   * Uploaded first and only then written as a message, so a failed upload
   * leaves no row pointing at a file that is not there. The reverse order
   * would put a permanently broken photo in a conversation neither side can
   * delete.
   */
  const handlePhotoChosen = async (file: File | null | undefined) => {
    const targetShopId = conversationShopId;
    if (!file || !targetShopId || !currentUserId || !conversationShop?.id) return;

    setIsSendingPhoto(true);
    try {
      // The customer's own id is the conversation's second path segment --
      // here that is the sender, because the customer is the one sending.
      const uploaded = await uploadChatPhoto(targetShopId, currentUserId, file);
      if ("error" in uploaded) {
        setNotice(uploaded.error);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.from("shop_messages").insert({
        shop_id: targetShopId,
        sender_user_id: currentUserId,
        target_user_id: conversationShop.ownerUserId ?? null,
        sender_role: "customer",
        text: CHAT_PHOTO_TEXT,
        kind: "image",
        payload: uploaded.photo,
      });

      if (error) {
        setNotice(error.message || "That photo was not sent. Check your connection and try again.");
        return;
      }

      await refreshShopThread(targetShopId);
    } finally {
      setIsSendingPhoto(false);
    }
  };

  /**
   * Answers one of the quick questions with the shop's own written answer.
   *
   * The question is shown in the thread as well as the answer, so the exchange
   * reads as a conversation rather than as an answer to nothing -- but neither
   * is sent to the shop or written to the database. That is the point of the
   * feature: "what are your opening hours" should not have to reach a person
   * at all, and a shop's inbox should not fill up with questions their own
   * storefront already answers.
   *
   * The answers come from shops.quick_answers, which the shop writes in its
   * storefront editor, and are loaded when the chat opens so a tap answers
   * at once. A question the shop has not answered says so rather than guess.
   */
  const answerQuickQuestion = async (
    shopId: string,
    questionId: string,
    message: string,
    language: AssistantLanguage
  ) => {
    const askedAt = new Date();
    setAssistantAnswers((current) => ({
      ...current,
      [shopId]: [
        ...(current[shopId] ?? []),
        {
          id: `asked-${shopId}-${askedAt.getTime()}`,
          sender: "user",
          senderRole: "customer",
          text: message,
          time: askedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          shopId,
          // Attributed to this viewer so the bubble sits on their side, but
          // with no target: it was never addressed to the shop.
          senderUserId: currentUserId,
          targetUserId: null,
          created_at: askedAt.toISOString(),
          kind: "text",
        },
      ],
    }));

    const shop = shops.find((entry) => entry.id === shopId) ?? null;
    let answers: QuickAnswers | null = quickAnswersRef.current[shopId] ?? null;
    if (!answers) {
      setAssistantThinkingFor(shopId);
      answers = await loadQuickAnswers(shopId).catch(() => null);
    }
    try {
      const text = answers
        ? answers[questionId] ?? QUICK_ANSWER_MISSING[language]
        : QUICK_ANSWER_FAILED[language];

      const now = new Date(Math.max(Date.now(), askedAt.getTime() + 1));
      const entry: Message = {
        id: `assistant-${shopId}-${now.getTime()}`,
        sender: "shop",
        senderRole: "shop_owner",
        text,
        time: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        shopId,
        // No sender: it came from nobody. Leaving these null is what keeps it
        // out of the "is this mine" test that decides which side a bubble
        // sits on, and out of the read-state sync.
        senderUserId: null,
        targetUserId: null,
        created_at: now.toISOString(),
        kind: "assistant",
        // Only "Where is your shop?" gets a map. The text still says the
        // address, so a bubble that cannot resolve a pin reads exactly as
        // it did before.
        ...(questionId === "location" && shop
          ? { map: { shopName: shop.name, address: shop.location, mapUrl: shop.mapUrl ?? null } }
          : {}),
      };
      setAssistantAnswers((current) => ({ ...current, [shopId]: [...(current[shopId] ?? []), entry] }));
    } finally {
      setAssistantThinkingFor(null);
    }
  };

  const syncApprovedShops = async (userId: string, shopNameFallback: string | null, profileName: string, profileAddressValue: string | null) => {
    const supabase = createClient();

    // Reads the `shops_public` view rather than the application table: it carries
    // approved shops only, and omits the applicant's email and their uploaded
    // BIR/ID document paths, which customers have no business seeing.
    const { data, error: requestsError } = await supabase
      .from(SHOPS_PUBLIC_TABLE)
      .select(SHOP_LIST_COLUMNS);

    if (requestsError) {
      throw requestsError;
    }

    const approvedShopRequests = (data ?? []) as unknown as ShopOwnerRecord[];
    const proShopIds = await loadShopProIds(supabase, approvedShopRequests.map((shop) => shop.id));
    const currentUserShop = approvedShopRequests.find((request) => request.user_id === userId);

    const toShop = (request: ShopOwnerRecord): Shop => ({
      id: request.id,
      name: request.shop_name || "Shop",
      isPro: proShopIds.has(request.id),
      specialty: request.tagline || request.description || "Furniture shop",
      location: request.address || "Location pending",
      ownerUserId: request.user_id,
      description: request.description,
      coverImageUrl: request.cover_image_url ?? null,
      logoUrl: request.logo_url ?? null,
      allowedMaterials: request.allowed_materials ?? null,
      phone: request.phone ?? null,
      hours: request.hours ?? null,
      policies: request.policies ?? null,
      socialLinks: parseSocialLinks(request.social_links),
      mapUrl: request.map_url ?? null,
    });

    // Everyone sees every approved shop. This used to collapse to the
    // viewer's own shop when they had one, which meant a shop owner browsing
    // as a customer could neither see other makers nor message them.
    const nextShops = approvedShopRequests.map(toShop);

    setShops(nextShops);
    setMyShopId(currentUserShop?.id ?? null);
    setShopThreads((current) => {
      const nextThreads = { ...current };
      nextShops.forEach((shop) => {
        if (!nextThreads[shop.id]) {
          nextThreads[shop.id] = [];
        }
      });
      return nextThreads;
    });
    setShopOwnerName(currentUserShop?.shop_name || profileName || shopNameFallback || "My Shop");
    setShopOwnerAddress(currentUserShop?.address || profileAddressValue || "Address pending");
    return nextShops;
  };

  const handleSellerSubmit = async () => {
    if (sellerSubmitRef.current) return;
    if (!shopName.trim() || !address.trim()) {
      setNotice("Please enter a shop name and address.");
      return;
    }
    if (!birRegisteredName.trim()) {
      setNotice("Please enter the name registered in your BIR documents.");
      return;
    }
    if (!birDocFile) {
      setNotice("Please upload your BIR Certificate of Registration (Form 2303).");
      return;
    }
    if (!validIdFile) {
      setNotice("Please upload a valid government-issued ID.");
      return;
    }

    // Optional, but if it was typed it has to be usable -- silently dropping it
    // would leave the owner thinking their page is linked when it is not.
    let socialLinks: Array<{ label: string; url: string }> = [];
    if (shopSocialUrl.trim()) {
      const result = normaliseLinkInput(shopSocialUrl, "");
      if ("error" in result) {
        setNotice(result.error);
        return;
      }
      socialLinks = [result.link];
    }

    sellerSubmitRef.current = true;
    setIsSubmitting(true);
    setNotice(null);

    try {
      await submitSellerApplication(createClient(), {
        shopName, description, address, phone: shopPhone, socialLinks,
        birRegisteredName, birDocument: birDocFile, validId: validIdFile,
      });

      setNotice("Your seller application was submitted successfully. The admin will review your documents soon.");
      notifySuccess("Application submitted");
      setShopName("");
      setDescription("");
      setAddress("");
      setShopPhone("");
      setShopSocialUrl("");
      setBirRegisteredName("");
      setBirDocFile(null);
      setValidIdFile(null);
      setSellerFormStep(1);
      setIsSellerModalOpen(false);
      setActiveSection("overview");
    } catch (error: unknown) {
      setNotice(applicationErrorMessage(error));
    } finally {
      sellerSubmitRef.current = false;
      setIsSubmitting(false);
    }
  };

  /**
   * The phone's bottom bar. The four places people go most, plus the one thing
   * they come here to do. Everything else (saved designs, support, the
   * business entry, settings, sign out) is in the drawer behind the avatar.
   */
  const tabBarItems: TabBarItem[] = [
    {
      key: "overview",
      label: t("Home"),
      icon: <IconOverview className="h-5 w-5" />,
      active: activeSection === "overview",
      href: "#overview",
      onClick: () => setActiveSection("overview"),
    },
    {
      key: "shops",
      label: t("Shops"),
      icon: <IconSeller className="h-5 w-5" />,
      active: activeSection === "shops",
      href: "#shops",
      onClick: () => setActiveSection("shops"),
    },
    {
      key: "customizer",
      label: t("Design"),
      icon: <IconFurniture className="h-5 w-5" />,
      active: false,
      primary: true,
      // Opens the Design sheet (continue a draft, or start from a model)
      // rather than going straight to the studio's picker.
      onClick: () => setIsDesignSheetOpen(true),
    },
    {
      key: "orders",
      label: t("Orders"),
      icon: <IconOrders className="h-5 w-5" />,
      active: activeSection === "orders",
      badge: ordersNeedingYou.length,
      badgeLabel: `${ordersNeedingYou.length} waiting on you`,
      href: "#orders",
      onClick: () => setActiveSection("orders"),
    },
    {
      key: "messages",
      label: t("Messages"),
      icon: <IconMessages className="h-5 w-5" />,
      // Support is a pinned conversation in Messages on a phone, so it lights
      // this tab too.
      active: activeSection === "messages" || activeSection === "support",
      badge: totalUnreadMessages,
      badgeLabel: `${totalUnreadMessages} unread`,
      href: "#messages",
      onClick: () => setActiveSection("messages"),
    },
  ];
  const accountInitial = (fullName || fallbackName || "U").trim().charAt(0).toUpperCase() || "U";
  // fallbackName can be the email address when no name was ever set, and
  // "Welcome back, ana.reyes@gmail.com" reads worse than no name at all.
  const homeFirstName = (() => {
    const name = (fullName || fallbackName || "").trim();
    return !name || name.includes("@") ? "" : name.split(/\s+/)[0];
  })();

  /**
   * Opens a section the way a tab or sidebar link would: the hash goes into
   * history, so Back returns here, and the page starts at its top.
   */
  const goToSection = (section: string) => {
    if (window.location.hash !== `#${section}`) window.history.pushState(null, "", `#${section}`);
    setActiveSection(section);
    window.scrollTo({ top: 0 });
  };
  const openCustomerOrder = (orderId: string) => {
    setSelectedCustomerOrderId(orderId);
    goToSection("orders");
  };

  return (
    <div className="dashboard-root">
      {/* Only for accounts that also own a shop: they have two dashboards and
          need to see which one this is. Everyone else has one mode. */}
      {isShopOwner ? <ModeBar mode="customer" /> : null}
      {/* The sidebar is fixed and full-height, so it sits over this bar's left
          edge as well as the content below it. Only <main> was being offset for
          it, which left the toggle underneath the sidebar -- present, but
          covered and unclickable. The header now shifts by the same width, in
          the same beat, so the two stay aligned as one edge. */}
      <header
        className={`dashboard-header transition-[margin] duration-300 ${
          isSidebarOpen ? "lg:ml-64" : ""
        }`}
      >
        <div className="dashboard-header-left">
          {!isSidebarOpen ? (
            <button
              id="menuBtn"
              className="menu-btn"
              aria-label={uiText("Show navigation")}
              onClick={() => setIsSidebarOpen(true)}
            >
              <IconMenu aria-hidden className="h-5 w-5" />
            </button>
          ) : null}
          {/* Shown only while the sidebar is closed. The sidebar carries the
              brand whenever it is open, and rendering both at once is what
              produced the doubled "FurniCraft" here before -- but removing it
              outright left the product unnamed on screen once the sidebar was
              collapsed. */}
          {!isSidebarOpen ? (
            <div className="dashboard-brand-block">
              <div className="dashboard-logo">{uiText("FurniCraft")}</div>
            </div>
          ) : null}
        </div>
        <div className="dashboard-header-right">
          {/* Always here, beside the bell, on every screen size. The cart used
              to be reachable only from the drawer or the account sheet, and
              only once something was in it, so a customer who had added a
              piece could not see where it had gone. Empty, it opens the cart
              page, which says so and points at the studio. */}
          <button
            type="button"
            onClick={openCart}
            aria-label={
              cart.pieces > 0 ? `${t("Cart")}, ${cart.pieces} ${cart.pieces === 1 ? "piece" : "pieces"}` : uiText("{0}, empty", { 0: t("Cart") })
            }
            title={t("Cart")}
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--fc-border)] bg-[var(--fc-panel)] text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.1)] active:scale-[0.95] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 lg:flex lg:w-auto lg:gap-1.5 lg:px-3 lg:[@media(pointer:coarse)]:w-auto"
          >
            <IconCart aria-hidden className="h-5 w-5" />
            <span aria-hidden className="hidden text-sm font-semibold lg:inline">{t("Cart")}</span>
            {cart.pieces > 0 ? (
              // Walnut, not the bell's red: a full cart is not an alert.
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-[var(--fc-btn)] px-1 text-[10px] font-bold leading-[18px] text-[var(--fc-btn-fg)] ring-2 ring-[var(--fc-bg)]">
                {cart.pieces > 9 ? "9+" : cart.pieces}
              </span>
            ) : null}
          </button>
          <NotificationBell />
          {/* Desktop only. On a phone the header is the wordmark, the bell and
              the avatar; the name, the role and Sign out are in the drawer the
              avatar opens, rather than one tap from the bell. */}
          <div className="dashboard-account-desktop">
            <div className="dashboard-user-pill">
              {/* No "Shop Owner" badge here any more: on the customer side it
                  read as "you are in your shop", which is the opposite of
                  where this is. The mode bar above says which side it is. */}
              <span className="dashboard-user-name">{fullName || fallbackName || uiText("User")}</span>
            </div>
            <LogoutButton />
          </div>
          <button
            type="button"
            className="dashboard-avatar-btn"
            aria-label={t("Your account")}
            aria-haspopup="dialog"
            aria-expanded={isAccountSheetOpen}
            onClick={() => setIsAccountSheetOpen(true)}
          >
            <span className="dashboard-avatar-face">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" />
              ) : (
                accountInitial
              )}
            </span>
          </button>
        </div>
      </header>

      <DashboardSidebar
        open={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        label={t("All sections")}
        subtitle={t("Customer dashboard")}
        items={sidebarItems}
        headerExtra={
          <div className="flex flex-col items-center gap-2 py-2">
            <button
              type="button"
              onClick={() => {
                setIsProfileModalOpen(true);
                setIsSidebarOpen(false);
              }}
              aria-label={uiText("Edit Profile")}
              title={uiText("Edit Profile")}
              className="group relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[var(--fc-avatar-bg,#3a3530)] text-[var(--fc-avatar-fg,#7a6e66)] transition hover:brightness-110"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconProfile aria-hidden className="h-12 w-12 translate-y-2" />
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
                <IconEdit aria-hidden className="h-4 w-4" />
              </span>
            </button>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-semibold text-[var(--fc-text)]">{fullName || uiText("User")}</p>
              {userEmail ? <p className="truncate text-xs text-[var(--fc-muted)]">{userEmail}</p> : null}
            </div>
          </div>
        }
      />

      <div className="dashboard-body dashboard-body-sidebar-hidden">
        <main className={`dashboard-main transition-[margin] duration-300 ${isSidebarOpen ? "lg:ml-64" : ""}`}>
          {/* Overview brings its own heading (CustomerHome, below the notices):
              a greeting for a returning customer, the welcome only on a first
              visit. Every other section gets its title here. */}
          {/* Overview and Shops bring their own heading: Overview a greeting,
              Shops the design file's "Find your kind of maker." Rendering the
              generic one too stacked two titles and two descriptions on top of
              each other. Every other section gets its title from here. */}
          {activeSection === "overview" ? null : activeSection === "shops" || activeSection === "support" ? (
            /* Sections that bring their own heading. CustomerHome carries
               id="overview" itself; ShopsTab and SupportSection do not, so
               their hash targets live here. */
            <span id={activeSection} className="sr-only" />
          ) : (
            <div className="page-title" id={activeSection}>
              <h1>{SECTION_META[activeSection]?.title ?? uiText("FurniCraft")}</h1>
              {SECTION_META[activeSection]?.subtitle ? <p>{SECTION_META[activeSection].subtitle}</p> : null}
            </div>
          )}

          {notice ? (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-4 py-3 text-sm text-[var(--fc-text)] shadow-sm">
              <span className="min-w-0">{uiText(notice)}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label={uiText("Dismiss")}
                className="shrink-0 rounded-full px-1.5 text-[var(--fc-muted)] transition hover:text-[var(--fc-text)]"
              >
                <IconClose aria-hidden className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {messageNotice ? (
            <div className="mb-4 rounded-2xl border border-fc-ink-accent bg-[rgba(178,106,56,0.08)] px-4 py-3 text-sm text-fc-text shadow-sm">
              <div className="font-semibold">{uiText("New message from ")}{messageNotice.shopName}</div>
              <div className="mt-1">{messageNotice.text}</div>
            </div>
          ) : null}

          {activeSection === "templates" ? (
            <TemplatesSection
              deletingDesignId={deletingDesignId}
              draftDesigns={draftDesigns}
              handleOpenCustomerDesign={handleOpenCustomerDesign}
              isDeletingDrafts={isDeletingDrafts}
              isLoadingCustomerDesigns={isLoadingCustomerDesigns}
              onDeleteDrafts={setDraftsPendingDelete}
              savedDesigns={savedDesigns}
              setDesignPendingDelete={setDesignPendingDelete}
            />
          ) : activeSection === "messages" ? (
            <MessagesSection
              answerQuickQuestion={answerQuickQuestion}
              assistantThinkingFor={assistantThinkingFor}
              conversationShop={conversationShop}
              conversationOrders={
                conversationShop
                  ? customerOrders
                      .filter((order) => order.shop_id === conversationShop.id)
                      .map((order) => ({
                        id: order.id,
                        project_name: order.project_name,
                        status: order.status,
                        preview_url: order.preview_url,
                        price: order.quoted_total ?? order.estimated_price,
                        created_at: order.created_at,
                        // Waiting on the customer: a quote to answer, a
                        // downpayment to send.
                        group: CUSTOMER_ACTIONABLE.includes(order.status as OrderStatus)
                          ? ("needs" as const)
                          : order.status === "completed" || order.status === "declined"
                            ? ("done" as const)
                            : ("active" as const),
                      }))
                  : []
              }
              currentThread={currentThread}
              currentUserId={currentUserId}
              goToSection={goToSection}
              handleSendMessage={handleSendMessage}
              isMobileThreadOpen={isMobileThreadOpen}
              isRealtimeConnected={isRealtimeConnected}
              isSendingPhoto={isSendingPhoto}
              isShopOnline={isShopOnline}
              messageDraft={messageDraft}
              myShopId={myShopId}
              photoInputRef={photoInputRef}
              selectedShopId={selectedShopId}
              setChatOrderId={setChatOrderId}
              setIsCallSheetOpen={setIsCallSheetOpen}
              setIsMobileThreadOpen={setIsMobileThreadOpen}
              setMessageDraft={setMessageDraft}
              setPoliciesShopId={setPoliciesShopId}
              setReportTarget={setReportTarget}
              setSelectedShopId={setSelectedShopId}
              shopUnreadIds={shopUnreadIds}
              shops={shops}
            />
          ) : activeSection === "orders" ? (
            <OrdersSection
              customerOrders={customerOrders}
              hasUnviewedActions={ordersNeedingYou.some((order) => unreadActionOrderIds.includes(order.id))}
              getShopNameForOrder={getShopNameForOrder}
              getShopLogoForOrder={getShopLogoForOrder}
              handleQuoteResponse={handleQuoteResponse}
              handleRequestRefund={handleRequestRefund}
              handleSelectShop={handleSelectShop}
              handleSubmitReceipt={handleSubmitReceipt}
              isLoadingCustomerOrders={isLoadingCustomerOrders}
              isRefundBusy={isRefundBusy}
              isRespondingToQuote={isRespondingToQuote}
              isSubmittingReceipt={isSubmittingReceipt}
              ordersClosed={ordersClosed}
              ordersInProgress={ordersInProgress}
              ordersNeedingYou={ordersNeedingYou}
              paymentReference={paymentReference}
              quoteResponseError={quoteResponseError}
              receiptError={receiptError}
              receiptFile={receiptFile}
              selectedCustomerOrder={selectedCustomerOrder}
              selectedCustomerOrderId={selectedCustomerOrderId}
              setActiveSection={setActiveSection}
              setPaymentReference={setPaymentReference}
              setQuoteDeclineOrderId={setQuoteDeclineOrderId}
              setReceiptFile={setReceiptFile}
              setReportTarget={setReportTarget}
              setSelectedCustomerOrderId={setSelectedCustomerOrderId}
              shopPayment={shopPayment}
              shopQrUrl={shopQrUrl}
            />
          ) : activeSection === "support" ? (
            <SupportSection
              currentUserId={currentUserId}
              userName={homeFirstName}
            />
          ) : activeSection === "settings" ? (
            <SettingsSection
              currentUserId={currentUserId}
              emailNotifyOrderReady={emailNotifyOrderReady}
              handleToggleEmailNotifyOrderReady={handleToggleEmailNotifyOrderReady}
            />
          ) : (
            <section>
              {/* Home. It replaced a welcome hero shown on every visit and an
                  "Orders & messages" panel that started folded shut on a phone;
                  see components/dashboard/home/customer-home.tsx. */}
              {activeSection === "overview" ? (
                <CustomerHome
                  firstName={homeFirstName}
                  ordersLoaded={hasLoadedCustomerOrders || (hasResolvedSession && !currentUserId)}
                  ordersFailed={customerOrdersFailed}
                  orders={customerOrders}
                  needsYou={ordersNeedingYou}
                  inProgress={ordersInProgress}
                  shopNameFor={getShopNameForOrder}
                  renderOrderRow={(order) => (
                    <CustomerOrderRow
                      order={order as CustomerOrder}
                      shopName={getShopNameForOrder(order.shop_id)}
                      selected={false}
                      compact
                      showHint
                      onOpen={() => openCustomerOrder(order.id)}
                    />
                  )}
                  latestMessage={
                    latestOverviewMessage
                      ? {
                          shopId: latestOverviewMessage.shopId,
                          shopName: getShopNameForOrder(latestOverviewMessage.shopId),
                          senderName: latestOverviewMessage.senderName,
                          text: latestOverviewMessage.text,
                          time: latestOverviewMessage.time,
                          online: isShopOnline(shops.find((shop) => shop.id === latestOverviewMessage.shopId) ?? null),
                          unread: Boolean(shopUnreadIds[latestOverviewMessage.shopId]),
                          fromYou: latestOverviewMessage.senderRole === "customer",
                        }
                      : null
                  }
                  latestDraft={draftDesigns[0] ?? null}
                  onOpenOrder={openCustomerOrder}
                  onOpenOrders={() => goToSection("orders")}
                  onOpenMessage={(shopId) => {
                    handleSelectShop(shopId);
                    setIsMobileThreadOpen(true);
                    goToSection("messages");
                  }}
                  onOpenDraft={() => {
                    if (draftDesigns[0]) handleOpenCustomerDesign(draftDesigns[0]);
                  }}
                  onStartDesigning={() => {
                    pushStep({ href: "/protected#overview", label: "Dashboard" });
                    router.push("/customize-furniture");
                  }}
                  onBrowseShops={() => goToSection("shops")}
                  cartPieces={cart.pieces}
                  chosenShop={selectedShop}
                  onOpenCart={openCart}
                  onRetryOrders={() => {
                    if (currentUserId) void fetchCustomerOrders(currentUserId);
                  }}
                />
              ) : null}

              {/* Browsing has one place now, at every width: the Shops section
                  (the phone's Shops tab, the sidebar's Shops item). Home stays
                  about the customer's own orders. See shops-tab.tsx. */}
              {activeSection === "shops" ? (
                <ShopsTab
                  shops={shops}
                  ratings={shopRatings}
                  visibleShops={feedVisibleShops}
                  query={feedShopQuery}
                  onQueryChange={setFeedShopQuery}
                  selectedShopId={selectedShopId}
                  currentUserId={currentUserId}
                  isShopOnline={isShopOnline}
                  onOpenShop={() => pushStep({ href: "/protected#shops", label: "Shops" })}
                  feedShopFilter={feedShopFilter}
                  onClearShopFilter={() => setFeedShopFilter(null)}
                  onFilterByShop={(shopId) => setFeedShopFilter(shopId)}
                  feedFilterTags={feedFilterTags}
                  feedTagFilter={feedTagFilter}
                  onTagFilterChange={setFeedTagFilter}
                  isLoadingFeed={isLoadingFeed}
                  feedTemplateCount={feedTemplates.length}
                  visibleFeed={visibleFeed}
                  tagsFor={(template) => feedTags.get(template.id) ?? []}
                  shopNameFor={(shopId) => shops.find((shop) => shop.id === shopId)?.name ?? uiText("FurniCraft shop")}
                  customizeFor={(template) => {
                    const item = template.cad_state ? resolveDesignItem(template.cad_state) : null;
                    if (!item) return null;
                    return () => {
                      if (
                        !openItemInDesigner(
                          item,
                          `Template: ${template.title}`,
                          // The shop's own list as well as the template's: a design
                          // vetted in a timber the furniture shop has since stopped
                          // stocking must not still offer it.
                          combineAllowedMaterials(
                            template.allowed_materials,
                            shops.find((shop) => shop.id === template.shop_id)?.allowedMaterials
                          ),
                          null,
                          null,
                          templateOriginShop(template.shop_id)
                        )
                      )
                        return;
                      pushStep({ href: "/protected#shops", label: "Shops" });
                      router.push("/customize-furniture");
                    };
                  }}
                />
              ) : null}

            </section>
          )}
        </main>
      </div>

      {/* Not while a conversation covers the screen on a phone: the thread has
          its own back arrow and composer, and the bar would sit over the
          composer. */}
      {activeSection === "messages" && isMobileThreadOpen ? null : (
        <BottomTabBar items={tabBarItems} label={t("Main")} />
      )}

      {/* The floating FAQ widget used to live here, following the customer
          around the dashboard while Support was a separate page holding only a
          chat box. Two places to ask a question, and no way to know which one
          would answer. Both now live on Support, which opens with the same
          answers this recited and ends with the same chat. Anything that used
          to open the widget sends the customer there instead. */}

      <DesignSheet
        open={isDesignSheetOpen}
        onClose={() => setIsDesignSheetOpen(false)}
        latestDraft={draftDesigns[0] ?? null}
        onContinueDraft={() => {
          setIsDesignSheetOpen(false);
          if (draftDesigns[0]) handleOpenCustomerDesign(draftDesigns[0]);
        }}
        onOpenStudio={() => {
          setIsDesignSheetOpen(false);
          pushStep(sectionStep(activeSection));
          router.push("/customize-furniture");
        }}
        onOpenMyTemplates={() => {
          setIsDesignSheetOpen(false);
          goToSection("templates");
        }}
      />

      <AccountSheet
        open={isAccountSheetOpen}
        onClose={() => setIsAccountSheetOpen(false)}
        name={fullName || fallbackName || "Your account"}
        email={userEmail ?? null}
        avatarUrl={avatarUrl}
        initial={accountInitial}
        cartPieces={cart.lines > 0 ? cart.pieces : 0}
        businessLabel="Become a Seller"
        onEditProfile={() => {
          setIsAccountSheetOpen(false);
          setIsProfileModalOpen(true);
        }}
        onMyTemplates={() => {
          setIsAccountSheetOpen(false);
          goToSection("templates");
        }}
        onCart={() => {
          setIsAccountSheetOpen(false);
          openCart();
        }}
        onBusiness={() => {
          setIsAccountSheetOpen(false);
          // The same handler as the sidebar's entry: it checks for an
          // existing application before opening the seller form.
          sidebarItems.find((item) => item.key === "seller")?.onClick();
        }}
        onSettings={() => {
          setIsAccountSheetOpen(false);
          goToSection("settings");
        }}
        onSupport={() => {
          // Help is the Support section now, answers and all.
          setIsAccountSheetOpen(false);
          goToSection("support");
        }}
      />

      {isProfileModalOpen && (
        <ProfileModal
          avatarError={avatarError}
          avatarUrl={avatarUrl}
          fullName={fullName}
          handleAvatarFileChange={handleAvatarFileChange}
          handleProfileSave={handleProfileSave}
          isSavingProfile={isSavingProfile}
          phone={phone}
          profileAddress={profileAddress}
          setFullName={setFullName}
          setIsProfileModalOpen={setIsProfileModalOpen}
          setPhone={setPhone}
          setProfileAddress={setProfileAddress}
          userEmail={userEmail}
        />
      )}

      <ImageCropper
        file={avatarToCrop}
        shape="circle"
        title={uiText("Position your photo")}
        hint="Drag to move, and use the slider to zoom. The circle is what people will see."
        confirmLabel="Use photo"
        output={{ side: 256, type: "image/jpeg", quality: 0.85 }}
        onCancel={() => setAvatarToCrop(null)}
        onCropped={(dataUrl) => {
          setAvatarUrl(dataUrl);
          setAvatarToCrop(null);
        }}
      />

      {isSellerModalOpen && (
        <SellerModal
          address={address}
          birDocFile={birDocFile}
          birRegisteredName={birRegisteredName}
          description={uiText(description)}
          handleSellerSubmit={handleSellerSubmit}
          isSubmitting={isSubmitting}
          notice={notice}
          sellerFormStep={sellerFormStep}
          setAddress={setAddress}
          setBirDocFile={setBirDocFile}
          setBirRegisteredName={setBirRegisteredName}
          setDescription={setDescription}
          setIsSellerModalOpen={setIsSellerModalOpen}
          setNotice={setNotice}
          setSellerFormStep={setSellerFormStep}
          setShopName={setShopName}
          setShopPhone={setShopPhone}
          setShopSocialUrl={setShopSocialUrl}
          setValidIdFile={setValidIdFile}
          shopName={shopName}
          shopPhone={shopPhone}
          shopSocialUrl={shopSocialUrl}
          validIdFile={validIdFile}
        />
      )}

      {isShopProfileModalOpen && selectedShop && (
        <ShopProfileModal
          isShopOnline={isShopOnline}
          selectedShop={selectedShop}
          setIsShopProfileModalOpen={setIsShopProfileModalOpen}
        />
      )}

      {isEditShopModalOpen && (
        <EditShopModal
          setIsEditShopModalOpen={setIsEditShopModalOpen}
          setShopOwnerAddress={setShopOwnerAddress}
          setShopOwnerName={setShopOwnerName}
          shopOwnerAddress={shopOwnerAddress}
          shopOwnerName={shopOwnerName}
        />
      )}

      {lightboxImage ? (
        <ImageLightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      ) : null}

      <OrderDetailModal orderId={chatOrderId} onClose={() => setChatOrderId(null)} />

      <ConfirmModal
        open={designPendingDelete !== null}
        title={uiText("Delete \"{0}\"?", { 0: designPendingDelete?.name ?? uiText("this design") })}
        body="This cannot be undone."
        confirmLabel={uiText("Delete")}
        tone="danger"
        busy={deletingDesignId === designPendingDelete?.id}
        onConfirm={() => {
          const target = designPendingDelete;
          setDesignPendingDelete(null);
          if (target) void handleDeleteCustomerDesign(target);
        }}
        onCancel={() => setDesignPendingDelete(null)}
      />

      <ConfirmModal
        open={draftsPendingDelete !== null}
        title={
          draftsPendingDelete?.length === 1
            ? uiText("Delete 1 draft?")
            : uiText("Delete {0} drafts?", { 0: draftsPendingDelete?.length ?? 0 })
        }
        body="This cannot be undone."
        confirmLabel={uiText("Delete")}
        tone="danger"
        busy={isDeletingDrafts}
        onConfirm={() => {
          const targets = draftsPendingDelete;
          setDraftsPendingDelete(null);
          if (targets) void handleDeleteDrafts(targets);
        }}
        onCancel={() => setDraftsPendingDelete(null)}
      />

      {/* Declining a quote leaves the shop with a dead order and no idea what to
          change; the reason is what makes a re-quote possible. */}
      <ConfirmModal
        open={quoteDeclineOrderId !== null}
        title={cancellingUnpaidOrder ? uiText("Cancel this order?") : uiText("Decline this quote?")}
        body={
          cancellingUnpaidOrder
            ? "The shop is told you've called it off and sees the reason you give. This cannot be undone."
            : "The shop is told the quote was declined and sees the reason you give. They can send a revised quote afterwards."
        }
        confirmLabel={cancellingUnpaidOrder ? uiText("Cancel order") : uiText("Decline quote")}
        cancelLabel={cancellingUnpaidOrder ? uiText("Keep order") : uiText("Cancel")}
        tone="danger"
        busy={isRespondingToQuote}
        reason={{
          label: "Reason",
          placeholder: cancellingUnpaidOrder
            ? "e.g. I found a piece closer to home."
            : "e.g. Over my budget — could you quote a simpler finish?",
          required: true,
        }}
        onConfirm={(declineReason) => {
          const target = quoteDeclineOrderId;
          setQuoteDeclineOrderId(null);
          if (target) void handleQuoteResponse(target, "declined", declineReason);
        }}
        onCancel={() => setQuoteDeclineOrderId(null)}
      />

      {/* Ordering terms, shown the first time this customer picks a shop.
          Looked up by id rather than reusing selectedShop, so the dialog keeps
          naming the shop it was opened for even if the selection moves on. */}
      <ShopPoliciesDialog
        open={policiesShopId !== null}
        onClose={() => setPoliciesShopId(null)}
        shopName={shops.find((shop) => shop.id === policiesShopId)?.name ?? uiText("This shop")}
        policies={shops.find((shop) => shop.id === policiesShopId)?.policies}
      />

      {/* One dialog for every "Report" in this dashboard. Rendered here rather
          than inside the chat thread and the order modal separately, so a
          report opened from inside the order modal is not unmounted the moment
          something closes the modal behind it. */}
      {/* Outside the thread so it survives the thread unmounting when the
          phone-sized view goes back to the conversation list. */}
      {isCallSheetOpen && conversationShop ? (
        <CallSheet
          name={conversationShop.name}
          phone={conversationShop.phone ?? null}
          onClose={() => setIsCallSheetOpen(false)}
        />
      ) : null}

      {/* The picker itself. Kept out of the composer so re-rendering the
          thread never resets a picker the customer has already opened. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared immediately so picking the same photo twice in a row still
          // fires a change event the second time.
          event.target.value = "";
          void handlePhotoChosen(file);
        }}
      />

      {reportTarget ? (
        <ReportDialog
          open
          onClose={() => setReportTarget(null)}
          topics={reportTarget.topics}
          targetId={reportTarget.targetId}
          title={reportTarget.title}
          context={reportTarget.context}
        />
      ) : null}
    </div>
  );
}
