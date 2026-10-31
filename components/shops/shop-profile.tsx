"use client";
import { PhotoTemplatePolicyButton } from "@/components/shops/photo-template-policy-button";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveShopPolicies, markPoliciesSeen } from "./shop-policies";
import { IconCheck } from "@/components/solihiya/icons";
import { Modal } from "@/components/ui/modal";
import { ShopLogo } from "@/components/shops/shop-logo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifySaved, notifySuccess } from "@/lib/saved-notice";
import { formatRange } from "@/lib/shops/price-range";
import { templateMaterialsForEdit, templateMaterialsForSave, templateSaveErrorMessage } from "@/lib/shops/template-materials";
import { validateTemplateDetails } from "@/lib/shops/template-details";
import ImageLightbox from "@/components/design/image-lightbox";
import CommissionPath from "@/components/solihiya/commission-path";
import { pushStep } from "@/lib/commission-path";
import { SocialLinkRow } from "@/components/shops/social-links-editor";
import { resolveDesignItem, openItemInDesigner } from "@/components/design/design-state-utils";
import { combineAllowedMaterials } from "@/components/design/studio/materials-db";
import ShopReviews from "@/components/reviews/shop-reviews";
import { Stars, formatRating } from "@/components/reviews/stars";
import { useOnlineUsers } from "@/lib/presence";
import StorefrontEditor from "@/components/shops/storefront-editor";
import ConfirmModal from "@/components/ui/confirm-modal";
import {
  GALLERY_IMAGE_OPTIONS,
  fileToDownscaledDataUrl,
} from "@/lib/image-utils";
import {
  MAX_GALLERY_PHOTOS,
  type Shop,
  type ShopPhoto,
  type ShopTemplate,
} from "@/components/shops/shop-types";
import {
  ClockIcon,
  DashboardIcon,
  EditIcon,
  MapPinIcon,
  MessageIcon,
  PlusIcon,
  TrashIcon,
  EyeIcon,
  EyeOffIcon,
} from "@/components/shops/shop-icons";
import AllowedFinishesPicker from "@/components/shops/allowed-finishes-picker";
import { ShopVisitSection } from "@/components/shops/shop-map";
import { ProBadge } from "@/components/shops/pro-badge";
import { parsePhAddress } from "@/lib/ph-address";
import { MaterialTagChips } from "@/components/design/material-tag-chips";
import { materialTagsForDesign } from "@/components/design/studio/material-tags";
import { CopyLinkButton } from "./share-template-button";

/**
 * The public face of a shop.
 *
 * Every value here arrives from shops_public via the page above, which is the
 * same view the shop browser reads -- there is no second copy of a shop's
 * details to keep in step. Design templates and reviews are real rows too
 * (design_templates, shop_reviews) rather than anything invented for this
 * page: a shop with neither simply does not show those sections.
 *
 * The stage is the instrument-panel language the studio picker uses -- a dark,
 * depth-lit backdrop with a faint measuring grid -- and the shop's own cover
 * photo sits on top of it as the masthead, because the first thing a customer
 * wants from a furniture shop is to see the furniture. The photo is treated as
 * a lit surface rather than a full-bleed banner: inset, framed, and grading
 * into the stage at its lower edge, so a shop with no photo of its own loses a
 * band of colour rather than the whole design.
 *
 * ---
 * Profile Banner Layout (Facebook-style)
 *
 * The header now uses a social-profile banner: full-width cover photo, circular
 * avatar badge overlapping the bottom-left, and owner action buttons (Dashboard
 * / Edit) in the header area. Social links are relocated here from the old
 * bottom contact card, which has been removed.
 */

/** Splits a tagline like "Rattan, Wood" into the chips the shop browser already shows. */
function specialtyTags(specialty: string): string[] {
  return specialty
    .split(/[,/|·]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Reveals a section once it scrolls into view.
 *
 * IntersectionObserver rather than a scroll handler: the browser does the work
 * off the main thread and it fires once per element rather than on every frame
 * of a scroll.
 *
 * The starting state is *visible*, and the hidden state is applied by a layout
 * effect before the browser paints. That ordering matters: content that starts
 * hidden in the markup and waits for JavaScript to reveal it is content that
 * never appears if the script fails, is blocked, or has not run yet. Here the
 * server-rendered page reads normally on its own, and the animation is added
 * only once something is present to run it -- with no flash, because a layout
 * effect lands before paint rather than after.
 */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Visible until the client says otherwise; see the note above.
  const [shown, setShown] = useState(true);
  const [armed, setArmed] = useState(false);

  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setShown(false);
    setArmed(true);
  }, []);

  useEffect(() => {
    if (!armed) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [armed]);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function GlassPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-6 shadow-[0_18px_50px_rgba(20,12,6,0.18)] backdrop-blur-md sm:p-8 ${className}`}
    >
      {/* A light catching the top edge, which is what sells the glass. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,255,255,0.5)] to-transparent"
      />
      {children}
    </section>
  );
}

/** One design template, in the same framed-thumbnail language the studio picker uses. */
function TemplateCard({
  template,
  onLoad,
  isOwnShop,
  onEdit,
  onDelete,
  onToggleHidden,
  isToggling = false,
}: {
  template: ShopTemplate;
  onLoad: (template: ShopTemplate) => void;
  isOwnShop: boolean;
  onEdit?: (template: ShopTemplate) => void;
  onDelete?: (template: ShopTemplate) => void;
  /** Owner only: hide from customers, or show again. */
  onToggleHidden?: (template: ShopTemplate) => void;
  isToggling?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const canOpen = Boolean(template.cadState);
  const hidden = Boolean(template.isHidden);
  return (
    <article className={`shop-template${hidden ? " is-hidden" : ""}`}>
      <div className="shop-template-shot">
        {/* Said in words on the picture, not only by fading it: a faded card
            could be a loading state. Only the owner ever receives a hidden
            template, so only the owner ever sees this. */}
        {hidden ? (
          <span className="shop-template-hidden-badge">
            <EyeOffIcon size={13} />{uiText("Hidden from customers")}</span>
        ) : null}
        {template.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={template.previewUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          // No render yet: say so in words rather than with a puzzle emoji
          // pretending to be a picture of a chair.
          <span className="shop-template-empty">{uiText("No render yet")}</span>
        )}
      </div>
      {/* Compact: two to a row on a phone. The full card ran to about 405px
          one per row, so a shop with five pieces was five screens of
          scrolling. The title gets two lines, the description shows from sm
          up, and the button is a small full-width one at the bottom. */}
      <div className="shop-template-body">
        <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug sm:text-base">
          {template.title}
        </h3>
        {template.tag ? (
          <span className="shop-template-tag">{template.tag}</span>
        ) : null}
        <MaterialTagChips tags={materialTagsForDesign(template.cadState)} className="mt-1.5" />
        {/* The owner's controls sit in the card, under the title, rather
            than over the photo: on a phone three 44px buttons covered most
            of a 160px picture of the piece they were for. */}
          {/* Share for anyone who can see it; a hidden one's link would open to "not found". */}
          {(isOwnShop && (onEdit || onDelete || onToggleHidden)) || !hidden ? (
            <div className="shop-template-actions">
              {hidden ? null : (
                <CopyLinkButton templateId={template.id} title={template.title} className="shop-template-action-btn" compact />
              )}
              {isOwnShop && onToggleHidden ? (
                <button
                  type="button"
                  className="shop-template-action-btn"
                  onClick={(e) => { e.stopPropagation(); onToggleHidden(template); }}
                  disabled={isToggling}
                  title={hidden ? uiText("Show to customers") : uiText("Hide from customers")}
                  aria-label={hidden ? uiText("Show {0} to customers", { 0: template.title }) : uiText("Hide {0} from customers", { 0: template.title })}
                  aria-pressed={hidden}
                >
                  {hidden ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
                  <span aria-hidden className="shop-template-action-label">{hidden ? uiText("Show") : uiText("Hide")}</span>
                </button>
              ) : null}
              {onEdit ? (
                <button
                  type="button"
                  className="shop-template-action-btn"
                  onClick={(e) => { e.stopPropagation(); onEdit(template); }}
                  title={uiText("Edit template")}
                >
                  <EditIcon size={13} />
                  <span aria-hidden className="shop-template-action-label">{uiText("Edit")}</span>
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  className="shop-template-action-btn danger"
                  onClick={(e) => { e.stopPropagation(); onDelete(template); }}
                  title={uiText("Delete template")}
                >
                  <TrashIcon size={13} />
                  <span aria-hidden className="shop-template-action-label">{uiText("Delete")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        {template.description ? (
          <p className="mt-1.5 hidden text-sm leading-relaxed text-[var(--fc-muted)] sm:block"><AdaptiveText text={template.description} textClassName="line-clamp-2" automatic /></p>
        ) : null}
        {canOpen ? (
          <button
            type="button"
            className="btn btn-primary btn-sm mt-auto w-full transition-transform duration-150 active:scale-[0.97]"
            onClick={() => onLoad(template)}
          >{uiText("Customize")}</button>
        ) : (
          <p className="mt-auto text-xs text-[var(--fc-muted)]">{uiText("Preview only. Not ready to customise yet.")}</p>
        )}
      </div>
    </article>
  );
}

// ─────────────────────────────── Template Modal ───────────────────────────────

function TemplateModal({
  open,
  editingTemplate,
  onClose,
  onSaved,
}: {
  open: boolean;
  editingTemplate: ShopTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tag, setTag] = useState("");
  const [materials, setMaterials] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingTemplate) {
      setTitle(editingTemplate.title);
      setDescription(editingTemplate.description ?? "");
      setTag(editingTemplate.tag ?? "");
      setMaterials(templateMaterialsForEdit(editingTemplate.allowedMaterials));
    } else {
      setTitle("");
      setDescription("");
      setTag("");
      setMaterials([]);
    }
    setError(null);
  }, [open, editingTemplate]);

  const { required, missing } = validateTemplateDetails({ title, tag, description }, editingTemplate);

  const handleSave = async () => {
    if (missing.length) return;
    setIsSaving(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in.");

      // Edit only. A template is made from a 3D design -- a photo turned into
      // a model, or a piece published from the studio -- never from a blank
      // form, which produced listings customers could not open.
      if (!editingTemplate) return;
      const { error: err } = await supabase
        .from("design_templates")
        .update({
          title: title.trim(),
          description: description.trim() || null,
          tag: tag.trim() || null,
          allowed_materials: templateMaterialsForSave(materials),
        })
        .eq("id", editingTemplate.id);
      if (err) throw err;

      onSaved();
      notifySaved("Template saved");
      onClose();
    } catch (e) {
      console.error("Template save failed:", e);
      setError(templateSaveErrorMessage((e as { message?: string } | null)?.message, "Could not save template."));
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) return null;

  const field =
    "min-h-11 w-full rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-[16px] text-[var(--fc-text)] outline-none placeholder:text-[var(--fc-muted)] focus:border-[#8b5a2b] sm:text-sm";
  const label = "text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]";

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={editingTemplate ? uiText("Update this design template") : uiText("Create a new template")}
      eyebrow={editingTemplate ? uiText("Edit template") : uiText("Add template")}
      title={editingTemplate ? uiText("Update this design template") : uiText("Create a new template")}
      className="sm:max-w-md"
      footer={
        <>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || missing.length > 0}
            className="btn btn-primary"
          >
            {isSaving ? uiText("Saving…") : editingTemplate ? uiText("Update template") : uiText("Create template")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-grid min-h-11 place-items-center rounded-full border border-[var(--fc-border)] px-5 text-sm font-semibold text-[var(--fc-text)] transition-transform active:scale-[0.98]"
          >{uiText("Cancel")}</button>
        </>
      }
    >
      <div>
        {error ? (
          <p className="mt-4 rounded-2xl border border-[#c0392b]/30 bg-[#c0392b]/10 px-3 py-2 text-sm text-[#a8452c]">
            {uiText(error)}
          </p>
        ) : null}

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className={label}>{uiText("Title *")}</span>
            <input
              required
              aria-required="true"
              className={`${field} mt-1`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={uiText("e.g. Classic Rattan Chair")}
            />
          </label>
          <label className="block">
            <span className={label}>{uiText("Tag ")}{required.tag ? "*" : uiText("(optional)")}</span>
            <input
              required={required.tag}
              aria-required={required.tag}
              className={`${field} mt-1`}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={uiText("e.g. Chair, Table, Shelf")}
            />
          </label>
          <label className="block">
            <span className={label}>{uiText("Description ")}{required.description ? "*" : uiText("(optional)")}</span>
            <textarea
              required={required.description}
              aria-required={required.description}
              className={`${field} mt-1 resize-y`}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={uiText("What makes this piece special…")}
            />
          </label>
          <AllowedFinishesPicker value={materials} onChange={setMaterials} />
        </div>

        {missing.length ? (
          <p aria-live="polite" className="mt-4 text-xs text-[var(--fc-muted)]">{uiText("Fill in ")}{missing.join(", ")}{uiText(" to save this template.")}</p>
        ) : null}

      </div>
    </Modal>
  );
}

// ──────────────────────────────── Main Component ─────────────────────────────

export default function ShopProfile({
  shop,
  ownerName,
  viewerUserId,
  averageRating,
  reviewCount,
  templates: initialTemplates,
  embedded = false,
  onEditStorefront,
  onRefresh,
  viewerSelectedShopId = null,
}: {
  shop: Shop;
  ownerName: string | null;
  viewerUserId: string | null;
  /**
   * The shop the viewer's next order goes to (user_profiles.selected_shop_id).
   * This page is where a customer chooses it: the dashboard's Shops list is
   * one row per shop that opens here, rather than four buttons on every card.
   */
  viewerSelectedShopId?: string | null;
  averageRating: number | null;
  reviewCount: number;
  templates: ShopTemplate[];
  /**
   * Rendered inside another page rather than as the route's own document --
   * the owner dashboard's Storefront section.
   *
   * It changes three things and nothing else, so what the owner sees really is
   * the customer's page: the outer <main> becomes a <div> (a page may only
   * have one main), the "Browse shops" breadcrumb and the "Dashboard" button
   * are dropped because both already point at where the reader is standing,
   * and the full-height padding shrinks to fit a panel. Every section below --
   * cover, gallery, templates, reviews, policies -- is untouched.
   */
  embedded?: boolean;
  /**
   * Who opens the storefront editor. Embedded, the host owns that modal, so
   * the same dialog serves this Edit button and the host's own payment-details
   * block instead of two copies of it existing at once.
   */
  onEditStorefront?: () => void;
  /** Embedded, `router.refresh()` cannot reach client-loaded data; this can. */
  onRefresh?: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  /**
   * Skipped when embedded: the dashboard hosting this already joins the
   * presence channel, and two subscriptions to the same topic on one page is
   * one more socket for a dot that tells the owner they are online -- which
   * they can see, because they are the one looking.
   */
  const onlineUserIds = useOnlineUsers(embedded ? null : viewerUserId);

  const isOnline = Boolean(shop.ownerUserId && onlineUserIds.has(shop.ownerUserId));
  const isOwnShop = Boolean(shop.ownerUserId && shop.ownerUserId === viewerUserId);
  /**
   * A shop that has paused new commissions. Undefined reads as open, so a
   * caller that has not been updated to select the column cannot accidentally
   * close every shop on the page.
   */
  const isAcceptingOrders = shop.acceptingOrders !== false;
  // Something to pin: an address picked in the storefront editor, or the
  // owner's own Google Maps link. A free-typed address is not looked up.
  const hasMap = Boolean(shop.mapUrl || parsePhAddress(shop.location));
  const tags = specialtyTags(shop.specialty);

  const [selectedShopId, setSelectedShopId] = useState<string | null>(viewerSelectedShopId);
  const [isChoosingShop, setIsChoosingShop] = useState(false);
  const [chooseShopError, setChooseShopError] = useState<string | null>(null);
  /** Set once this visit's "Choose this shop" succeeds; see chooseThisShop. */
  const [justChose, setJustChose] = useState(false);
  /** The About text and the terms are clamped until the reader asks for more. */
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const templatesSectionRef = useRef<HTMLDivElement | null>(null);
  const isChosenShop = selectedShopId === shop.id;
  /**
   * Makes this the shop the viewer's next order goes to -- the same column the
   * studio reads when an order is placed, and asks for when it is empty. The
   * terms are on this page (Policies, below), so they are marked seen here the
   * way the dashboard marks them when it shows its own terms dialog.
   */
  const chooseThisShop = async () => {
    if (!viewerUserId) return;
    setIsChoosingShop(true);
    setChooseShopError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("user_profiles")
      .update({ selected_shop_id: shop.id })
      .eq("id", viewerUserId);
    setIsChoosingShop(false);
    if (error) {
      setChooseShopError("Couldn't choose this shop. Please try again.");
      return;
    }
    markPoliciesSeen(shop.id);
    setSelectedShopId(shop.id);
    // Straight on to what the customer chose the shop for: its pieces. The
    // section is on this page, so it is a scroll rather than a navigation,
    // and it carries a line confirming where the next order goes.
    setJustChose(true);
    window.requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      templatesSectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  };

  // ── Owner-editable gallery state ──
  const [gallery, setGallery] = useState<ShopPhoto[]>(shop.gallery ?? []);
  const [isGalleryBusy, setIsGalleryBusy] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Only a photo the shop actually uploaded earns the masthead; the shared
  // placeholder illustration would say nothing about this shop in particular.
  const cover = shop.coverImageUrl || gallery[0]?.url || null;

  // ── StorefrontEditor state ──
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // ── Template CRUD state ──
  const [templates, setTemplates] = useState<ShopTemplate[]>(initialTemplates);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ShopTemplate | null>(null);
  const [templatePendingDelete, setTemplatePendingDelete] = useState<ShopTemplate | null>(null);
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false);

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("design_templates")
      .select("id, title, description, tag, cad_state, preview_url, allowed_materials, is_hidden")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false });
    if (data) {
      setTemplates(
        (data as Array<{
          id: string;
          title: string;
          description: string | null;
          tag: string | null;
          cad_state: unknown;
          preview_url: string | null;
          allowed_materials: string[] | null;
          is_hidden: boolean | null;
        }>).map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          tag: row.tag,
          cadState: row.cad_state,
          previewUrl: row.preview_url,
          allowedMaterials: row.allowed_materials,
          isHidden: Boolean(row.is_hidden),
        }))
      );
    }
  }, [shop.id]);

  /**
   * Hides a template from customers, or shows it again, without deleting it.
   * Applied to the card at once and put back if the database refuses, so the
   * owner never sees a state that is not true.
   */
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [togglingTemplateId, setTogglingTemplateId] = useState<string | null>(null);
  const handleToggleHidden = async (template: ShopTemplate) => {
    const next = !template.isHidden;
    setTemplateError(null);
    setTogglingTemplateId(template.id);
    setTemplates((list) => list.map((t) => (t.id === template.id ? { ...t, isHidden: next } : t)));
    const { error } = await createClient().from("design_templates").update({ is_hidden: next }).eq("id", template.id);
    setTogglingTemplateId(null);
    if (error) {
      setTemplates((list) => list.map((t) => (t.id === template.id ? { ...t, isHidden: !next } : t)));
      setTemplateError(uiText(next ? "Couldn't hide “{0}”. Please try again." : "Couldn't show “{0}”. Please try again.", { 0: template.title }));
      return;
    }
    notifySuccess(next ? "Template hidden" : "Template shown");
    onRefresh?.();
  };

  const handleDeleteTemplate = async (template: ShopTemplate) => {
    setIsDeletingTemplate(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("design_templates").delete().eq("id", template.id);
      if (error) {
        console.error("Failed to delete template:", error);
        return;
      }
      await fetchTemplates();
      notifySuccess("Template deleted");
    } finally {
      setIsDeletingTemplate(false);
      setTemplatePendingDelete(null);
    }
  };

  const handleLoadTemplate = (template: ShopTemplate) => {
    const item = resolveDesignItem(template.cadState);
    if (!item) return;
    // Opened from this shop's own storefront, so the piece is theirs to
    // build: it reaches the cart addressed to them and cannot be moved.
    if (
      !openItemInDesigner(
        item,
        `🧩 Template: ${template.title}`,
        // The shop's own list as well as the template's -- a design vetted in
        // stock the furniture shop no longer carries must not still offer it.
        combineAllowedMaterials(template.allowedMaterials, shop.allowedMaterials),
        null,
        null,
        {
        id: shop.id,
        name: shop.name || "Shop",
      })
    )
      return;
    pushStep({ href: `/shops/${shop.id}`, label: shop.name || "Shop" });
    router.push("/customize-furniture");
  };

  // ── Gallery add/remove (owner only) ──

  const saveGallery = useCallback(async (nextGallery: ShopPhoto[]) => {
    setGallery(nextGallery);
    // Embedded, the host is holding its own copy of this shop row; without
    // this the photo appears here and nowhere else until a reload.
    onRefresh?.();
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("shops")
        .update({ gallery: nextGallery })
        .eq("id", shop.id);
      if (error) throw error;
      notifySaved("Gallery saved");
    } catch (e) {
      console.error("Gallery save failed:", e);
    }
  }, [shop.id, onRefresh]);

  const handleGalleryAdd = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;

      const room = MAX_GALLERY_PHOTOS - gallery.length;
      if (room <= 0) return;

      setIsGalleryBusy(true);
      try {
        const added: ShopPhoto[] = [];
        for (const file of files.slice(0, room)) {
          added.push({ url: await fileToDownscaledDataUrl(file, GALLERY_IMAGE_OPTIONS) });
        }
        const nextGallery = [...gallery, ...added].slice(0, MAX_GALLERY_PHOTOS);
        await saveGallery(nextGallery);
      } catch (e) {
        console.error("Gallery add failed:", e);
      } finally {
        setIsGalleryBusy(false);
      }
    },
    [gallery, saveGallery]
  );

  const handleGalleryRemove = useCallback(
    async (index: number) => {
      const nextGallery = gallery.filter((_, i) => i !== index);
      await saveGallery(nextGallery);
    },
    [gallery, saveGallery]
  );

  const Wrapper = embedded ? "div" : "main";

  return (
    <Wrapper className={embedded ? "shop-page" : "shop-page min-h-screen"}>
      {/* ───────────────────────── Content Area ──────────────────────── */}
      {/* No cover-photo banner behind the header and no avatar overlapping
          it: a customer opens a furniture shop to see furniture, so the
          identity chrome stays to one quiet column here and the shop's own
          photos carry the page below, starting with the lead photo. */}
      <div
        className={
          embedded
            ? "relative w-full"
            : "relative mx-auto w-full max-w-5xl px-5 pb-16 pt-10 sm:px-8"
        }
      >
        {/* Breadcrumb. Not embedded: it would offer to take the owner back to
            a shop list they did not arrive from. */}
        {embedded ? null : (
          <Reveal>
            <CommissionPath
              current={{ href: `/shops/${shop.id}`, label: shop.name || uiText("Shop") }}
              fallback={{ href: "/protected", label: "Browse shops" }}
            />
          </Reveal>
        )}

        {/* ─────────── Header: cover, logo, identity ───────────
            A short cover banner with the shop's logo set over its edge, then
            the name and one line of the facts a customer weighs first:
            rating, where, and whether anyone is there. It used to be a
            column of four stacked rows above a full-height lead photo, and
            on a phone the first thing a customer could act on sat a screen
            and a half down. */}
        <Reveal delay={80} className={embedded ? "" : "mt-5"}>
          {/* With no cover photo and no gallery there is nothing to put in a
              banner, and an empty tinted box only pushed the shop down the
              screen, so the logo stands on its own. */}
          {cover ? (
            <div className="relative">
              <div className="h-28 overflow-hidden rounded-3xl border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_10%,var(--fc-panel))] sm:h-44">
                <button
                  type="button"
                  onClick={() => setLightbox({ src: cover, alt: shop.name })}
                  className="block h-full w-full"
                  aria-label={uiText("View {0}'s cover photo", { 0: shop.name })}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                </button>
              </div>
              <div className="absolute -bottom-9 left-4 sm:left-6">
                <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={76} ring />
              </div>
            </div>
          ) : (
            <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={76} ring />
          )}

          <div className={`${cover ? "mt-11" : "mt-4"} flex flex-wrap items-start justify-between gap-x-6 gap-y-4`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[1.75rem] font-bold leading-tight [overflow-wrap:anywhere] sm:text-4xl">
                  {shop.name}
                </h1>
                {shop.isPro ? <ProBadge /> : null}
                {isOwnShop ? <span className="stamp-chip">{uiText("Your shop · preview")}</span> : null}
              </div>
              {tags.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="stamp-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--fc-muted)]">
                {reviewCount ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--fc-text)]">
                    <Stars value={averageRating ?? 0} />
                    {formatRating(averageRating ?? 0)}
                    <span className="font-normal text-[var(--fc-muted)]">({reviewCount})</span>
                  </span>
                ) : (
                  <span>{uiText("No reviews yet")}</span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <MapPinIcon size={14} />
                  {shop.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {/* Real presence, not decoration: the owner is signed in. */}
                  <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-fc-online" : "bg-[var(--fc-border)]"}`} />
                  {isOnline ? uiText("Online now") : uiText("Away")}
                </span>
              </p>
              {shop.socialLinks?.length ? (
                <div className="mt-2.5">
                  <SocialLinkRow links={shop.socialLinks} />
                </div>
              ) : null}
            </div>

            {/* ─── Actions ─── Full width on a phone, where they are the
                page's main controls; a row at the side from sm up. */}
            <div className="grid w-full grid-cols-[1fr_1fr] gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap">
              {isOwnShop ? (
                <>
                  {/* Embedded, this button is a link to the page it is on. */}
                  {embedded ? null : (
                    <Link href="/protected/shop" className="btn btn-secondary inline-flex items-center justify-center gap-2">
                      <DashboardIcon size={16} />{uiText("Dashboard")}</Link>
                  )}
                  <button
                    type="button"
                    onClick={() => (onEditStorefront ? onEditStorefront() : setIsEditorOpen(true))}
                    className={`btn btn-primary inline-flex items-center justify-center gap-2${embedded ? " col-span-2" : ""}`}
                  >
                    <EditIcon size={16} />{uiText("Edit shop details")}</button>
                </>
              ) : (
                <>
                  {/* The one primary action for a customer: whether the next
                      order goes here. Once it does, it is a statement, not a
                      button, so it cannot be pressed again for nothing. */}
                  {viewerUserId ? (
                    isChosenShop ? (
                      <span className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] px-4 text-sm font-semibold text-[var(--fc-ink-accent)]">
                        <IconCheck aria-hidden className="h-4 w-4" />{uiText("Your orders go here")}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void chooseThisShop()}
                        disabled={isChoosingShop || !isAcceptingOrders}
                        title={isAcceptingOrders ? undefined : uiText("This shop has paused new orders")}
                        className="btn btn-primary col-span-2 inline-flex items-center justify-center gap-2 transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isChoosingShop ? uiText("Choosing…") : isAcceptingOrders ? uiText("Choose this shop") : uiText("Not taking orders right now")}
                      </button>
                    )
                  ) : null}
                  <button
                    type="button"
                    onClick={() => router.push("/protected?section=messages&shop=" + shop.id)}
                    className={`btn btn-secondary inline-flex items-center justify-center gap-2${hasMap ? "" : " col-span-2"}`}
                  >
                    <MessageIcon size={16} />{uiText("Message")}</button>
                  {hasMap ? (
                    <a href="#shop-visit" className="btn btn-secondary inline-flex items-center justify-center gap-2">
                      <MapPinIcon size={16} />{uiText("Map")}</a>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {chooseShopError ? (
            <p role="alert" className="mt-3 text-sm font-semibold text-fc-danger">
              {uiText(chooseShopError)}
            </p>
          ) : null}
        </Reveal>

        <div className="mt-8 space-y-10">
          {/* ─────────────────── At a glance ───────────────────
              The facts a customer decides on, as four tiles in two columns on
              a phone: where, when, how other customers rated it, and how many
              pieces there are to start from. They used to sit below every
              template, in a panel titled with the owner's email address. */}
          <Reveal>
            <section aria-labelledby="shop-glance-title">
              <h2 id="shop-glance-title" className="sr-only">{uiText("At a glance")}</h2>
              <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {(() => {
                  const tiles: Array<{ label: string; value: string; detail?: string; icon: React.ReactNode; href?: string }> = [
                    {
                      label: "Based in",
                      value: shop.location,
                      detail: hasMap ? "See on map" : undefined,
                      icon: <MapPinIcon size={13} />,
                      href: hasMap ? "#shop-visit" : undefined,
                    },
                    // "Hours", not "Opening hours": the longer label broke over
                    // two lines in a 160px tile on a phone.
                    { label: "Hours", value: shop.hours || "Not listed", icon: <ClockIcon size={13} /> },
                    {
                      label: "Rating",
                      value: reviewCount ? `${formatRating(averageRating ?? 0)} of 5` : "No reviews yet",
                      detail: reviewCount ? `${reviewCount} review${reviewCount === 1 ? "" : "s"}` : "Be the first after an order",
                      icon: <span aria-hidden className="text-[13px] leading-none">★</span>,
                      href: "#shop-reviews",
                    },
                    {
                      label: "Orders",
                      value: isAcceptingOrders ? "Open for orders" : "Not taking orders",
                      // The shop's own price range, when it has set one, is
                      // what a customer needs before choosing a budget.
                      detail: isAcceptingOrders
                        ? shop.priceRange
                          ? uiText("Builds for {0}", { 0: formatRange(shop.priceRange) })
                          : "Send them a design"
                        : "You can still message them",
                      icon: <ClockIcon size={13} />,
                    },
                  ];
                  return tiles.map((tile) => {
                    const body = (
                      <>
                        <dt className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]">
                          {tile.icon}
                          {uiText(tile.label)}
                        </dt>
                        <dd className="mt-1 text-sm font-semibold leading-snug text-[var(--fc-text)] [overflow-wrap:anywhere]">
                          {tile.value}
                        </dd>
                        {tile.detail ? (
                          <dd className={`mt-0.5 text-xs ${tile.href ? "font-semibold text-[var(--fc-ink-accent)]" : "text-[var(--fc-muted)]"}`}>
                            {tile.detail}
                          </dd>
                        ) : null}
                      </>
                    );
                    const tileClass =
                      "block h-full min-w-0 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3.5";
                    return tile.href ? (
                      <div key={tile.label} className="min-w-0">
                        <a
                          href={tile.href}
                          target={tile.href.startsWith("#") ? undefined : "_blank"}
                          rel={tile.href.startsWith("#") ? undefined : "noopener noreferrer"}
                          className={`${tileClass} transition-[border-color,transform] duration-150 hover:border-[var(--fc-accent)] active:scale-[0.98]`}
                        >
                          {body}
                        </a>
                      </div>
                    ) : (
                      <div key={tile.label} className={tileClass}>
                        {body}
                      </div>
                    );
                  });
                })()}
              </dl>

              {/* About, three lines until asked for more: on a phone the full
                  text pushed the pieces a screen further down. */}
              <div className="mt-4">
                {shop.description ? (
                  <>
                    <p
                      className="whitespace-pre-line text-[0.95rem] leading-relaxed text-[var(--fc-muted)]"
                    >
                      <AdaptiveText text={shop.description} automatic textClassName={isAboutOpen ? "" : "line-clamp-3"} />
                    </p>
                    {shop.description.length > 160 || shop.description.includes("\n") ? (
                      <button
                        type="button"
                        onClick={() => setIsAboutOpen((open) => !open)}
                        aria-expanded={isAboutOpen}
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline"
                      >
                        {isAboutOpen ? uiText("Less") : uiText("More")}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-[var(--fc-muted)]">{uiText("This shop has not written an introduction yet.")}</p>
                )}
                {ownerName && !ownerName.includes("@") ? (
                  <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Run by ")}{ownerName}.</p>
                ) : null}
              </div>
            </section>
          </Reveal>

          {/* ─────────────────── Templates ─────────────────── */}
          {templates.length || isOwnShop || justChose ? (
            <Reveal>
              <div id="shop-templates" ref={templatesSectionRef} className="scroll-mt-6">
                {justChose && !isOwnShop ? (
                  <div
                    role="status"
                    className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] p-4"
                  >
                    <IconCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-[var(--fc-ink-accent)]" />
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--fc-text)]">{uiText("Your next order goes to ")}{shop.name}.</p>
                      <p className="mt-0.5 text-sm text-[var(--fc-muted)]">
                        {templates.length ? uiText("Pick one of their pieces below to start from, and change it to fit your room.") : uiText("{0} hasn't published any pieces yet. Start from a model in the studio, or message them about what you have in mind.", { 0: shop.name })}
                      </p>
                      {templates.length ? null : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href="/customize-furniture" className="btn btn-primary inline-flex items-center gap-2">{uiText("Open the studio")}</Link>
                          <button
                            type="button"
                            onClick={() => router.push("/protected?section=messages&shop=" + shop.id)}
                            className="btn btn-secondary inline-flex items-center gap-2"
                          >
                            <MessageIcon size={16} />{uiText("Message shop")}</button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                {/* Not over an empty list: a customer who just chose a shop
                    with no pieces gets the note above instead. */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-3${
                    templates.length || isOwnShop ? "" : " hidden"
                  }`}
                >
                  <div>
                    <h2 className="font-display text-xl font-bold sm:text-2xl">
                      {isOwnShop ? uiText("Your templates") : uiText("Start from one of their pieces")}
                    </h2>
                    {!isOwnShop ? (
                      <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText("Open any of these in the studio and change the parts you want.")}</p>
                    ) : null}
                  </div>
                  {isOwnShop ? (
                    <PhotoTemplatePolicyButton className="btn btn-primary inline-flex items-center gap-1.5">
                      <PlusIcon size={14} />{uiText("From a photo")}</PhotoTemplatePolicyButton>
                  ) : null}
                </div>

                {templateError ? (
                  <p role="alert" className="mt-4 text-sm font-semibold text-fc-danger">
                    {uiText(templateError)}
                  </p>
                ) : null}
                {isOwnShop && templates.some((t) => t.isHidden) ? (
                  <p className="mt-2 text-sm text-[var(--fc-muted)]">
                    {templates.filter((t) => t.isHidden).length}{uiText(" hidden. Customers can't see or open those; tap the eye to show one again.")}</p>
                ) : null}
                {templates.length ? (
                  <ul className="shop-template-grid mt-5">
                    {templates.map((template) => (
                      <li key={template.id}>
                        <TemplateCard
                          template={template}
                          onLoad={handleLoadTemplate}
                          isOwnShop={isOwnShop}
                          onEdit={isOwnShop ? (t) => { setEditingTemplate(t); setIsTemplateModalOpen(true); } : undefined}
                          onDelete={isOwnShop ? (t) => setTemplatePendingDelete(t) : undefined}
                          onToggleHidden={isOwnShop ? (t) => void handleToggleHidden(t) : undefined}
                          isToggling={togglingTemplateId === template.id}
                        />
                      </li>
                    ))}
                  </ul>
                ) : isOwnShop ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-[var(--fc-border)] p-6 text-center text-sm text-[var(--fc-muted)]">{uiText("You don't have any templates yet. Make one from a photo of a piece you build, so customers can open it in the studio.")}</p>
                ) : null}
              </div>
            </Reveal>
          ) : null}

          {/* ─────────────────── Gallery ───────────────────
              A strip you swipe sideways rather than a grid of large squares:
              the photos are worth a look, not two screens of scrolling. */}
          {gallery.length || isOwnShop ? (
            <Reveal>
              <section aria-labelledby="shop-gallery-title">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 id="shop-gallery-title" className="font-display text-xl font-bold">
                    {isOwnShop ? uiText("Gallery ({0}/{1})", { 0: gallery.length, 1: MAX_GALLERY_PHOTOS }) : uiText("Their work")}
                  </h2>
                  {isOwnShop ? (
                    <>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={gallery.length >= MAX_GALLERY_PHOTOS || isGalleryBusy}
                        className="btn btn-secondary inline-flex items-center gap-1.5 text-sm"
                      >
                        <PlusIcon size={14} />
                        {isGalleryBusy ? uiText("Adding…") : uiText("Add photo")}
                      </button>
                      <input
                        ref={galleryInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleGalleryAdd}
                        className="hidden"
                      />
                    </>
                  ) : null}
                </div>

                {gallery.length ? (
                  <ul className="-mx-5 flex snap-x scroll-px-5 gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
                    {gallery.map((photo, index) => (
                      <li key={photo.url + index} className="shop-gallery-photo relative w-32 shrink-0 snap-start sm:w-40">
                        <button
                          type="button"
                          onClick={() => setLightbox({ src: photo.url, alt: photo.caption || shop.name })}
                          className="group relative block aspect-square w-full overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={photo.caption || ""}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 motion-safe:[@media(hover:hover)]:group-hover:scale-105"
                          />
                        </button>
                        {isOwnShop && gallery.length > 1 ? (
                          <button
                            type="button"
                            className="shop-gallery-remove"
                            onClick={(e) => { e.stopPropagation(); handleGalleryRemove(index); }}
                            title={uiText("Remove photo")}
                            aria-label={uiText("Remove photo")}
                          >
                            ✕
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-2xl border border-dashed border-[var(--fc-border)] p-4 text-center text-sm text-[var(--fc-muted)]">{uiText("Add photos of finished pieces or your furniture shop to show customers what you make.")}</p>
                )}
              </section>
            </Reveal>
          ) : null}

          {/* ─────────────────── Visit ─────────────────── */}
          <Reveal>
            <div id="shop-visit" className="scroll-mt-6">
              <ShopVisitSection
                shopName={shop.name}
                address={shop.location === "Location pending" ? null : shop.location}
                hours={shop.hours ?? null}
                mapUrl={shop.mapUrl}
                isOwnShop={isOwnShop}
                onEdit={() => (onEditStorefront ? onEditStorefront() : setIsEditorOpen(true))}
              />
            </div>
          </Reveal>

          {/* ─────────────────── Reviews ─────────────────── */}
          <Reveal>
            <div id="shop-reviews" className="scroll-mt-6">
              <ShopReviews shopId={shop.id} shopName={shop.name} readOnly={isOwnShop} />
            </div>
          </Reveal>

          {/* ─────────────────── Policies ─────────────────── */}
          {/* Always shown. A shop with no published terms used to render no
              section at all, which read as "there are no conditions" to the one
              customer who most needed telling otherwise. The fallback is
              FurniCraft's, and says so -- it is never presented as this
              furniture shop's commitment. Six lines until opened, so the terms are
              there to read without being a wall at the end of the page. */}
          <Reveal>
            <GlassPanel>
              {(() => {
                const { text, isShopAuthored } = resolveShopPolicies(shop.policies);
                const long = text.length > 320 || text.split("\n").length > 6;
                return (
                  <>
                    <h2 className="font-display text-2xl font-bold">{uiText("Before you order")}</h2>
                    {!isShopAuthored ? (
                      <p className="mt-2 text-sm font-semibold text-[var(--fc-muted)]">{uiText("This shop hasn't published its own terms. These are FurniCraft's standard terms. Confirm the details with the shop before you pay.")}</p>
                    ) : null}
                    <p
                      className={`mt-3 whitespace-pre-wrap leading-relaxed text-[var(--fc-muted)] ${
                        long && !isTermsOpen ? "line-clamp-6" : ""
                      }`}
                    >
                      {text}
                    </p>
                    {long ? (
                      <button
                        type="button"
                        onClick={() => setIsTermsOpen((open) => !open)}
                        aria-expanded={isTermsOpen}
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--fc-ink-accent)] hover:underline"
                      >
                        {isTermsOpen ? uiText("Show less") : uiText("Read all terms")}
                      </button>
                    ) : null}
                  </>
                );
              })()}
            </GlassPanel>
          </Reveal>
        </div>
      </div>

      {/* ─────────────────── Lightbox ─────────────────── */}
      {lightbox ? (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}

      {/* ─────────────────── StorefrontEditor (owner) ─────────────────── */}
      {/* Embedded, the host renders the editor so its own Payment details
          block opens the same one. Two mounted copies would each hold their
          own draft of the same row. */}
      {isOwnShop && !embedded ? (
        <StorefrontEditor
          shopId={shop.id}
          open={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onSaved={() => {
            setIsEditorOpen(false);
            // The page is server-rendered; refreshing re-fetches the shop data.
            router.refresh();
          }}
        />
      ) : null}

      {/* ─────────────────── Template Modal (owner) ─────────────────── */}
      {isOwnShop ? (
        <TemplateModal
          open={isTemplateModalOpen}
          editingTemplate={editingTemplate}
          onClose={() => { setIsTemplateModalOpen(false); setEditingTemplate(null); }}
          onSaved={fetchTemplates}
        />
      ) : null}

      {/* ─────────────────── Delete Template Confirmation ─────────────────── */}
      <ConfirmModal
        open={Boolean(templatePendingDelete)}
        title={uiText("Delete \"{0}\"?", { 0: templatePendingDelete?.title })}
        body="This template will be permanently removed. Customers who have loaded it into the studio won't lose their work, but it won't appear on your shop page anymore."
        confirmLabel={uiText("Delete template")}
        tone="danger"
        busy={isDeletingTemplate}
        onConfirm={() => {
          if (templatePendingDelete) handleDeleteTemplate(templatePendingDelete);
        }}
        onCancel={() => setTemplatePendingDelete(null)}
      />
    </Wrapper>
  );
}
