/**
 * "2m ago" formatting.
 *
 * The same ladder was already written inline inside a useEffect in
 * furnicraft-dashboard.tsx for the message toast; this is that logic, exported,
 * so the notification list and anything after it read the same way.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function timeAgo(value: string | number | Date, now: Date = new Date(), language: "en" = "en"): string {
  const then = value instanceof Date ? value : new Date(value);
  const elapsed = now.getTime() - then.getTime();

  if (Number.isNaN(elapsed)) return "";
  // A clock skew between the browser and Postgres can put a fresh row slightly
  // in the future; "in 3 seconds" would be nonsense for a notification.
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;

  return then.toLocaleDateString(`${language}-PH`);
}

/** Two-letter initials for an avatar bubble, falling back to a neutral mark. */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
