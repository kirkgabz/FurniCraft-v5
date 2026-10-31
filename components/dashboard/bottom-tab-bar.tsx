"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { cn } from "@/lib/utils";

export type TabBarItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  /** Count drawn on the icon. Zero or absent draws nothing. */
  badge?: number;
  /** Read out after the label when there is a badge, e.g. "1 needs you". */
  badgeLabel?: string;
  /**
   * The one tab that starts something rather than going somewhere (Design,
   * which opens the studio). Drawn filled so it reads as the action.
   */
  primary?: boolean;
  /**
   * Present for tabs that are sections of the page, so the URL hash and the
   * back button keep working the way the sidebar's links do. See onTabLink.
   */
  href?: string;
  /** Shown but not usable, e.g. a shop section that opens on approval. */
  disabled?: boolean;
  /** Said on hover and to assistive tech when disabled. */
  disabledReason?: string;
  onClick: () => void;
};

/**
 * The phone navigation for a dashboard: a fixed bar of five tabs under the
 * thumb, shown below `lg` only. From `lg` up the sidebar is pinned open and
 * already does this job, so the bar hides itself there (in CSS, `.fc-tabbar`).
 *
 * The customer dashboard used to put every destination in a drawer behind
 * the menu button on a phone, with "Customize Furniture" last of nine. The bar
 * carries the four places people go most and the one thing they come to do;
 * the drawer is left with account things.
 *
 * Switching tabs is deliberately not animated. It happens dozens of times a
 * visit, and motion on something that frequent only makes it feel slow. The
 * press scale on each tab is the acknowledgement.
 */
export function BottomTabBar({ items, label }: { items: TabBarItem[]; label: string }) {
  const { t: uiText } = useUiLanguage();
  return (
    <nav aria-label={uiText(label)} className="fc-tabbar">
      <ul className="fc-tabbar-list" style={{ ["--fc-tabbar-count" as string]: items.length }}>
        {items.map((item) => {
          const className = cn("fc-tab", item.primary && "fc-tab-primary");
          const content = (
            <>
              <span className="fc-tab-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="fc-tab-label">{uiText(item.label)}</span>
              {item.badge ? (
                <>
                  <span className="fc-tab-badge" aria-hidden="true">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                  {item.badgeLabel ? <span className="sr-only">, {uiText(item.badgeLabel)}</span> : null}
                </>
              ) : null}
            </>
          );

          return (
            <li key={item.key}>
              {item.disabled ? (
                <button type="button" className={className} disabled title={item.disabledReason}>
                  {content}
                </button>
              ) : item.href ? (
                <a
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={className}
                  onClick={(event) => onTabLink(event, item)}
                >
                  {content}
                </a>
              ) : (
                <button type="button" className={className} onClick={item.onClick}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A tab is a real link so it can be opened in a new tab and its hash restores
 * the section on load and on Back. But letting the browser follow it also
 * jumps the page to whichever element carries that id (the section's title,
 * half under the sticky header), so the hash is pushed by hand and the page
 * goes to its top instead -- which is also what tapping the tab you are
 * already on should do.
 */
function onTabLink(event: React.MouseEvent<HTMLAnchorElement>, item: TabBarItem) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  if (item.href && window.location.hash !== item.href) {
    window.history.pushState(null, "", item.href);
  }
  item.onClick();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: item.active && !reduceMotion ? "smooth" : "auto" });
}
