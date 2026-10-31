"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import BottomSheet from "@/components/ui/bottom-sheet";
import { LogoutButton } from "@/components/dashboard/logout-button";
import { IconCart,
  IconChevronDown,
  IconDocument,
  IconEdit,
  IconFurniture,
  IconOverview,
  IconPhone,
  IconSeller,
  IconSettings,
  IconStar,
  IconTemplates,
} from "@/components/solihiya/icons";
import type { HomeDraft } from "@/components/dashboard/home/customer-home";

const ROW =
  "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left transition-[background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--fc-accent)_5%,transparent)] active:bg-[color-mix(in_srgb,var(--fc-accent)_9%,transparent)]";
const ROW_ICON =
  "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] text-[var(--fc-ink-accent)]";
const PRIMARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--fc-btn)] px-4 font-semibold text-[var(--fc-btn-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-btn-hover)] active:scale-[0.98]";
/** Same shape as PRIMARY, outlined: used when a draft already owns the filled button. */
const SECONDARY =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-[var(--fc-border)] px-4 font-semibold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[var(--fc-cane-soft)] active:scale-[0.98]";

function Chevron() {
  return <IconChevronDown aria-hidden className="h-4 w-4 shrink-0 -rotate-90 text-[var(--fc-muted)]" />;
}

/**
 * What the Design tab opens: carry on with the last draft, or start a piece.
 * It used to be "Customize Furniture", the last of nine items in a hidden
 * drawer, plus a separate My templates section.
 */
export function DesignSheet({
  open,
  onClose,
  latestDraft,
  onContinueDraft,
  onOpenStudio,
  onOpenMyTemplates,
}: {
  open: boolean;
  onClose: () => void;
  latestDraft: HomeDraft | null;
  onContinueDraft: () => void;
  onOpenStudio: () => void;
  onOpenMyTemplates: () => void;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  return (
    <BottomSheet open={open} onClose={onClose} title={uiText("Design")}>
      <div className="space-y-6">
        {latestDraft ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {latestDraft.preview_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={latestDraft.preview_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl border border-[var(--fc-border)] bg-white object-cover"
                />
              ) : (
                <span className={ROW_ICON + " h-14 w-14"}>
                  <IconFurniture aria-hidden className="h-6 w-6" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold">{latestDraft.name}</p>
                <p className="text-sm text-[var(--fc-muted)]">{uiText("Draft, edited")}{" "}
                  {new Date(latestDraft.updated_at).toLocaleDateString(uiLocale, { month: "short", day: "numeric" })}
                </p>
              </div>
            </div>
            <button type="button" onClick={onContinueDraft} className={PRIMARY}>{uiText("Continue this draft")}</button>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-[var(--fc-border)]">
          <button type="button" onClick={onOpenMyTemplates} className={ROW}>
            <span className={ROW_ICON}>
              <IconTemplates aria-hidden className="h-5 w-5" />
            </span>
            {/* No count under it. It read "80 designs" while the section it
                opens lists saved designs and the shop's room concepts -- the
                number counted every autosaved draft as well, so it matched
                nothing the reader found on the other side of the tap. */}
            <span className="min-w-0 flex-1 font-semibold">{uiText("My templates")}</span>
            <Chevron />
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenStudio}
          className={latestDraft ? SECONDARY : PRIMARY}
        >
          {latestDraft ? uiText("Start something new") : uiText("Open the studio")}
        </button>
      </div>
    </BottomSheet>
  );
}

/**
 * What the avatar opens on a phone. It replaced the drawer there: everything
 * about the customer and their account in one place, with Sign out set apart
 * at the bottom instead of one tap from the notification bell.
 */
export function AccountSheet({
  open,
  onClose,
  name,
  email,
  avatarUrl,
  initial,
  cartPieces,
  businessLabel,
  onEditProfile,
  onMyTemplates,
  onCart,
  onBusiness,
  onSettings,
  onSupport,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  initial: string;
  /** Pieces waiting in the studio cart; the row only shows when there are some. */
  cartPieces: number;
  /** The business entry: "Become a Seller" on the customer dashboard. */
  businessLabel: string;
  onEditProfile: () => void;
  onMyTemplates: () => void;
  onCart: () => void;
  onBusiness: () => void;
  onSettings: () => void;
  onSupport: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <BottomSheet open={open} onClose={onClose} title={uiText("Account")}>
      <div className="space-y-5">
        <button
          type="button"
          onClick={onEditProfile}
          className="flex w-full items-center gap-3 rounded-2xl text-left transition-transform duration-150 active:scale-[0.99]"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-xl font-bold text-[var(--fc-ink-accent)]">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{name}</span>
            {email && email !== name ? <span className="block truncate text-sm text-[var(--fc-muted)]">{email}</span> : null}
            <span className="block text-sm font-semibold text-[var(--fc-ink-accent)]">{uiText("Edit profile")}</span>
          </span>
        </button>

        <div className="divide-y divide-[var(--fc-border)] overflow-hidden rounded-2xl border border-[var(--fc-border)]">
          <button type="button" onClick={onMyTemplates} className={ROW}>
            <span className={ROW_ICON}>
              <IconTemplates aria-hidden className="h-5 w-5" />
            </span>
            <span className="flex-1 font-semibold">{uiText("My templates")}</span>
            <Chevron />
          </button>
          {cartPieces > 0 ? (
            <button type="button" onClick={onCart} className={ROW}>
              <span className={ROW_ICON}>
                <IconCart aria-hidden className="h-5 w-5" />
              </span>
              <span className="flex-1 font-semibold">{uiText("Cart")}</span>
              <span className="rounded-full bg-fc-danger px-2 py-0.5 text-xs font-bold text-fc-danger-fg">{cartPieces}</span>
              <Chevron />
            </button>
          ) : null}
          <button type="button" onClick={onBusiness} className={ROW}>
            <span className={ROW_ICON}>
              <IconSeller aria-hidden className="h-5 w-5" />
            </span>
            <span className="flex-1 font-semibold">{businessLabel}</span>
            <Chevron />
          </button>
          <button type="button" onClick={onSettings} className={ROW}>
            <span className={ROW_ICON}>
              <IconSettings aria-hidden className="h-5 w-5" />
            </span>
            <span className="flex-1 font-semibold">{uiText("Settings")}</span>
            <Chevron />
          </button>
          <button type="button" onClick={onSupport} className={ROW}>
            <span className={ROW_ICON}>
              <IconPhone aria-hidden className="h-5 w-5" />
            </span>
            <span className="flex-1 font-semibold">{uiText("Support")}</span>
            <Chevron />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--fc-border)] p-1">
          <LogoutButton variant="row" />
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * What the avatar opens in the shop dashboard on a phone: the shop's
 * once-in-a-while sections (Reviews, Subscription, Settings), the 3D
 * designer, the way back to the customer side, and Sign out. The things a shop
 * does every day are the tab bar.
 */
export function ShopAccountSheet({
  open,
  onClose,
  name,
  email,
  avatarUrl,
  initial,
  locked,
  onEditProfile,
  onReviews,
  onSubscription,
  onSupport,
  onSettings,
  onDesigner,
  onCustomerDashboard,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  initial: string;
  /** Before approval, Reviews has nothing to show. */
  locked: boolean;
  onEditProfile: () => void;
  onReviews: () => void;
  onSubscription: () => void;
  onSupport: () => void;
  onSettings: () => void;
  onDesigner: () => void;
  onCustomerDashboard: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const rows: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }> = [
    { key: "reviews", label: "Reviews", icon: <IconStar aria-hidden className="h-5 w-5" />, onClick: onReviews, disabled: locked },
    { key: "subscription", label: "Subscription", icon: <IconDocument aria-hidden className="h-5 w-5" />, onClick: onSubscription },
    { key: "support", label: "Support", icon: <IconPhone aria-hidden className="h-5 w-5" />, onClick: onSupport },
    { key: "settings", label: "Settings", icon: <IconSettings aria-hidden className="h-5 w-5" />, onClick: onSettings },
  ];
  return (
    <BottomSheet open={open} onClose={onClose} title={uiText("Account")}>
      <div className="space-y-5">
        <button
          type="button"
          onClick={onEditProfile}
          className="flex w-full items-center gap-3 rounded-2xl text-left transition-transform duration-150 active:scale-[0.99]"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-[var(--fc-border)] bg-[color-mix(in_srgb,var(--fc-accent)_14%,transparent)] text-xl font-bold text-[var(--fc-ink-accent)]">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{name}</span>
            {email && email !== name ? <span className="block truncate text-sm text-[var(--fc-muted)]">{email}</span> : null}
            <span className="block text-sm font-semibold text-[var(--fc-ink-accent)]">{uiText("Edit profile")}</span>
          </span>
        </button>

        <div className="divide-y divide-[var(--fc-border)] overflow-hidden rounded-2xl border border-[var(--fc-border)]">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={row.onClick}
              disabled={row.disabled}
              title={row.disabled ? uiText("Available once your shop is approved") : undefined}
              className={ROW + " disabled:cursor-not-allowed disabled:opacity-40"}
            >
              <span className={ROW_ICON}>{row.icon}</span>
              <span className="flex-1 font-semibold">{uiText(row.label)}</span>
              <Chevron />
            </button>
          ))}
        </div>

        <div className="divide-y divide-[var(--fc-border)] overflow-hidden rounded-2xl border border-[var(--fc-border)]">
          <button type="button" onClick={onDesigner} className={ROW}>
            <span className={ROW_ICON}>
              <IconEdit aria-hidden className="h-5 w-5" />
            </span>
            <span className="flex-1 font-semibold">{uiText("Open 3D designer")}</span>
            <Chevron />
          </button>
          <button type="button" onClick={onCustomerDashboard} className={ROW}>
            <span className={ROW_ICON}>
              <IconOverview aria-hidden className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{uiText("Customer dashboard")}</span>
              <span className="block text-sm text-[var(--fc-muted)]">{uiText("Order furniture as a customer")}</span>
            </span>
            <Chevron />
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--fc-border)] p-1">
          <LogoutButton variant="row" />
        </div>
      </div>
    </BottomSheet>
  );
}
