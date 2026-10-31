"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { IconClose } from "@/components/solihiya/icons";

export type DashboardNavItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  badge?: number;
  /** Divider label rendered immediately before this item. */
  divider?: string;
  onClick: () => void;
  /**
   * Present only for items that must stay real links (e.g. the customer
   * dashboard's sections, which restore `activeSection` from
   * `window.location.hash` on load/back-button -- see the `hashchange`
   * listener in furnicraft-dashboard.tsx). Omit for items that are pure
   * in-app actions (opening a modal, navigating via next/navigation).
   */
  href?: string;
  /**
   * Hidden below `lg`, where the same destination is already a tab in the
   * BottomTabBar. On a phone the drawer then carries only what the bar does
   * not: saved designs, support, the business entry, settings.
   */
  hideBelowLg?: boolean;
};

/**
 * The nav shell both dashboards render through.
 *
 * Before this, the customer dashboard used a drawer that stayed hidden
 * behind a hamburger at every viewport width, including desktop, while the
 * shop dashboard used its own hand-built sidebar that stayed pinned open on
 * large screens and only collapsed to a drawer on mobile. Same concept,
 * two different implementations, and the customer one made a wide desktop
 * screen hide its own navigation for no reason. This adopts the shop
 * dashboard's responsive behavior -- pinned on `lg` and up, a drawer with a
 * scrim below it -- as the one shared pattern, and callers supply their own
 * nav items (with whatever onClick/href/badge/lock state they need) rather
 * than this component knowing anything about what either dashboard does.
 */
export function DashboardSidebar({
  open,
  onClose,
  label,
  subtitle,
  items,
  headerExtra,
  footer,
  footerClassName,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Names the landmark, and must differ from the phone tab bar's name.
   * Below lg this sidebar is the slide-out drawer, so the two are on the
   * page together and a screen reader lists both: two landmarks called the
   * same thing tell you nothing about which one you have moved to.
   */
  label: string;
  subtitle?: string;
  items: DashboardNavItem[];
  /** Rendered between the header and the nav list, e.g. a quick-action button. */
  headerExtra?: React.ReactNode;
  /** Rendered pinned to the bottom, below a divider, e.g. secondary links. */
  footer?: React.ReactNode;
  /** Extra classes for the footer band, e.g. `lg:hidden` for a phone-only footer. */
  footerClassName?: string;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-[var(--fc-scrim)] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          // Always fixed, even at desktop widths -- pinning it in flow (e.g.
          // position: sticky) would require its parent to be a flex row,
          // which the two pages hosting this don't share. The caller adds
          // lg:ml-64 to its main content when `open` is true instead, so
          // nothing here depends on a particular parent layout.
          //
          // `open` genuinely controls visibility at every width, including
          // desktop -- an earlier version forced it visible on lg+ regardless
          // of `open`, which meant the close button and hamburger did nothing
          // there. A persistent-by-default, still-collapsible sidebar is the
          // pattern that survived: it starts open (unchanged default) but the
          // toggle keeps working at any viewport size.
          // fc-dashboard-sidebar: starts below the mode bar when one is
          // on the page (globals.css), rather than sliding in over it.
          "fc-dashboard-sidebar fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto border-r border-fc-border bg-fc-panel p-4 shadow-fc-lg transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="dashboard-logo">{uiText("FurniCraft")}</h1>
            {subtitle ? <p className="truncate text-xs text-fc-muted">{uiText(subtitle)}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={uiText("Close navigation")}
            title={uiText("Hide the menu")}
            className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-fc-muted transition-colors hover:text-fc-text"
          >
            <IconClose aria-hidden className="h-4 w-4" />
          </button>
        </div>

        {headerExtra}

        <nav aria-label={uiText(label)} className="flex-1 space-y-1">
          {items.map((item) => {
            const className = cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition [@media(pointer:coarse)]:min-h-11",
              item.active
                ? "bg-[rgba(178,106,56,0.14)] text-fc-ink-accent"
                : "text-fc-text hover:bg-[rgba(178,106,56,0.07)]",
              item.disabled && "cursor-not-allowed opacity-40",
              item.hideBelowLg && "max-lg:hidden"
            );
            const content = (
              <>
                {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                <span className="flex-1 text-left">{uiText(item.label)}</span>
                {item.badge ? (
                  <span className="rounded-full bg-fc-danger px-1.5 py-0.5 text-[10px] font-bold text-fc-danger-fg">
                    {item.badge}
                  </span>
                ) : null}
              </>
            );

            return (
              <Fragment key={item.key}>
                {item.divider ? (
                  <div className={cn("sidebar-divider", item.hideBelowLg && "max-lg:hidden")}>{item.divider}</div>
                ) : null}
                {item.href ? (
                  <a
                    href={item.href}
                    onClick={item.onClick}
                    aria-current={item.active ? "page" : undefined}
                    title={item.disabledReason}
                    className={className}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={item.disabled}
                    onClick={item.onClick}
                    aria-current={item.active ? "page" : undefined}
                    title={item.disabledReason}
                    className={className}
                  >
                    {content}
                  </button>
                )}
              </Fragment>
            );
          })}
        </nav>

        {footer ? (
          <div className={cn("mt-auto space-y-1 border-t border-fc-border pt-4", footerClassName)}>{footer}</div>
        ) : null}
      </aside>
    </>
  );
}
