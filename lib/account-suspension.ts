/**
 * Account suspensions (supabase/migrations/20261027120000_account_suspensions).
 *
 * One row per suspended account; suspended_until null means permanent. Only an
 * admin can write the table; an account can read its own row.
 */

export const SUSPENSIONS_TABLE = "account_suspensions";

/** Path of the page a suspended account is sent to. Under /auth so it is reachable whatever the session. */
export const SUSPENDED_PATH = "/auth/suspended";

export type Suspension = {
  user_id: string;
  suspended_until: string | null;
  reason: string;
  report_id: string | null;
  created_at: string;
};

/** The lengths an admin can choose. `null` days is permanent. */
export const SUSPENSION_LENGTHS: Array<{ id: string; label: string; days: number | null }> = [
  { id: "30", label: "30 days", days: 30 },
  { id: "60", label: "60 days", days: 60 },
  { id: "90", label: "90 days", days: 90 },
  { id: "permanent", label: "Permanent", days: null },
];

export function isSuspensionActive(suspension: Pick<Suspension, "suspended_until"> | null | undefined, now = Date.now()): boolean {
  if (!suspension) return false;
  return suspension.suspended_until === null || new Date(suspension.suspended_until).getTime() > now;
}

/** When a suspension of `days` starting now ends, as an ISO string; null for permanent. */
export function suspensionEnd(days: number | null, now = Date.now()): string | null {
  return days === null ? null : new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

/** Whether a read failed only because the migration has not been applied. */
export function isMissingSuspensionsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /account_suspensions/i.test(error.message ?? "");
}
