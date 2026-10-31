"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { timeAgo } from "@/lib/time-ago";

/**
 * Accounts on the 30-day deletion clock, and shops the admin can take down.
 *
 * Two tools on one screen because they are the same job -- deciding who stays
 * on the platform -- and because both were previously only reachable by
 * hand-written SQL.
 *
 * ---------------------------------------------------------------------------
 * Closing accounts
 *
 * A customer asks to delete their account in Settings, which sets
 * `deletion_requested_at` and starts a 30-day countdown. Signing back in
 * before it elapses clears the request. After 30 days the scheduled edge
 * function (supabase/functions/process-account-deletions) scrubs their
 * personal fields, deactivates their shop, and soft-deletes the auth user.
 *
 * Nothing in the admin showed any of this. Three things follow from that,
 * and all three are what this view is for:
 *
 *  - nobody could see who was leaving;
 *  - a request made by mistake could not be undone by anyone but the account
 *    holder, who by then may be unable to sign in;
 *  - and, worst, nobody could tell whether the job was running at all. It is
 *    driven by a schedule and guarded by CRON_SECRET. If that secret was never
 *    set, every request past its date is simply sitting there, unprocessed,
 *    and the platform is quietly failing a promise with a clock on it. So this
 *    counts overdue requests and says so outright.
 *
 * ---------------------------------------------------------------------------
 * Deactivating shops
 *
 * `shops.is_active` already exists and `shops_public` already filters on it --
 * the column was there, with no way to reach it. A shop taking deposits and
 * not delivering could be reported into the ticket queue and the ticket
 * resolved, and the shop carried on trading. The admin could restrict a
 * reviewer but not a shop.
 *
 * Deactivating hides the shop from the customer-facing directory. It does NOT
 * touch its orders: work already paid for is still owed, and deleting the
 * record of it would take the customer's evidence with it.
 *
 * ---------------------------------------------------------------------------
 * The database
 *
 * No migration. An admin can already read and update both tables --
 * `user_profiles_update_own` and `shop_owner_requests_update_own` (which
 * survived the rename to `shops`) both carry `or public.is_admin()`. The
 * writes here are deliberately narrower than the policy allows: clearing a
 * deletion request, and flipping is_active. In particular `deleted_at` is
 * never written from here -- that belongs to the scheduled job, which is the
 * only thing that knows the scrub actually happened.
 */

type Closing = {
  id: string;
  full_name: string | null;
  deletion_requested_at: string;
  deleted_at: string | null;
  shop_owner: boolean | null;
};

type Shop = {
  id: string;
  user_id: string;
  shop_name: string | null;
  status: string;
  is_active: boolean;
};

/** Matches the window in process-account-deletions. Changing one means changing both. */
const DELETION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(requestedAt: string): number {
  const elapsed = Date.now() - new Date(requestedAt).getTime();
  return Math.ceil(DELETION_WINDOW_DAYS - elapsed / DAY_MS);
}

export default function AdminAccountClosures() {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [closing, setClosing] = useState<Closing[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /**
   * The shop the admin has asked to delete, and what typing they have done to
   * confirm it.
   *
   * A typed confirmation rather than a yes/no dialog, because this is the one
   * irreversible action in the whole panel: deleting a shop cascades through
   * its orders, reviews, templates and conversations. A customer's order is
   * their receipt, and none of those customers asked for their own history to
   * be erased -- so the admin has to write the shop's name out, which is hard
   * to do by accident and impossible to do by reflex.
   */
  const [deleting, setDeleting] = useState<Shop | null>(null);
  const [typed, setTyped] = useState("");
  const [damage, setDamage] = useState<{ orders: number; reviews: number; templates: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [profileResult, shopResult] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("id, full_name, deletion_requested_at, deleted_at, shop_owner")
        .not("deletion_requested_at", "is", null)
        .order("deletion_requested_at", { ascending: true }),
      supabase
        .from("shops")
        .select("id, user_id, shop_name, status, is_active")
        .eq("status", "approved")
        .order("shop_name", { ascending: true }),
    ]);

    if (profileResult.error) console.error("Closing accounts failed to load:", profileResult.error);
    if (shopResult.error) console.error("Shops failed to load:", shopResult.error);

    setClosing((profileResult.data ?? []) as unknown as Closing[]);
    setShops((shopResult.data ?? []) as unknown as Shop[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Still counting down: requested, not yet scrubbed. */
  const pending = useMemo(() => closing.filter((row) => row.deleted_at === null), [closing]);
  /** Past 30 days and still not scrubbed -- the job has not run on these. */
  const overdue = useMemo(() => pending.filter((row) => daysLeft(row.deletion_requested_at) <= 0), [pending]);
  /** Already processed; kept visible so an admin can see the job IS working. */
  const closed = useMemo(() => closing.filter((row) => row.deleted_at !== null), [closing]);

  const visibleShops = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return shops;
    return shops.filter((shop) => (shop.shop_name ?? "").toLowerCase().includes(needle));
  }, [shops, search]);

  /**
   * What a delete would take with it, counted before anything is offered.
   *
   * Head-only counts, so this asks the database "how many" rather than
   * downloading every order to measure the pile.
   */
  const openDelete = async (shop: Shop) => {
    setDeleting(shop);
    setTyped("");
    setDamage(null);

    const supabase = createClient();
    const [orders, reviews, templates] = await Promise.all([
      supabase.from("design_orders").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("shop_reviews").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("design_templates").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
    ]);

    setDamage({
      orders: orders.count ?? 0,
      reviews: reviews.count ?? 0,
      templates: templates.count ?? 0,
    });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    setNotice(null);

    const supabase = createClient();
    const { error } = await supabase.from("shops").delete().eq("id", deleting.id);

    setBusyId(null);
    if (error) {
      setNotice(`Could not delete ${deleting.shop_name ?? "that shop"}: ${error.message}`);
      return;
    }
    setNotice(
      `${deleting.shop_name ?? "That shop"} and everything attached to it has been deleted. This cannot be undone.`
    );
    setDeleting(null);
    notifySuccess("Shop deleted");
    void load();
  };

  const cancelRequest = async (userId: string, name: string) => {
    setBusyId(userId);
    setNotice(null);
    const supabase = createClient();
    // Only the request. `deleted_at` is the scheduled job's to set, and is
    // never cleared from here: an account already scrubbed cannot be brought
    // back by blanking a timestamp.
    const { error } = await supabase
      .from("user_profiles")
      .update({ deletion_requested_at: null })
      .eq("id", userId)
      .is("deleted_at", null);

    setBusyId(null);
    if (error) {
      setNotice(`Could not cancel: ${error.message}`);
      return;
    }
    setNotice(`${name}'s deletion request was cancelled. Their account stays open.`);
    notifySuccess("Deletion request cancelled");
    void load();
  };

  const setShopActive = async (shopId: string, name: string, active: boolean) => {
    setBusyId(shopId);
    setNotice(null);
    const supabase = createClient();
    const { error } = await supabase.from("shops").update({ is_active: active }).eq("id", shopId);

    setBusyId(null);
    if (error) {
      setNotice(`Could not update ${name}: ${error.message}`);
      return;
    }
    setNotice(
      active
        ? `${name} is back in the shop directory.`
        : `${name} is hidden from the directory. Its existing orders are untouched.`
    );
    notifySuccess(active ? "Shop shown in the directory" : "Shop hidden from the directory");
    void load();
  };

  if (loading) return <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading…")}</p>;

  return (
    <div className="grid gap-6">
      {notice ? (
        <p className="rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] px-4 py-3 text-sm">
          {uiText(notice)}
        </p>
      ) : null}

      {/* ---------------------------------------------------- closing accounts */}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--fc-text)]">{uiText("Account deletion requests")}</h3>
          <p className="text-xs text-[var(--fc-muted)]">
            {pending.length}{uiText(" counting down · ")}{closed.length}{uiText(" already closed")}</p>
        </div>

        {overdue.length > 0 ? (
          <div className="rounded-2xl border border-[var(--fc-danger)] bg-[rgba(192,57,43,0.06)] p-4 text-sm">
            <p className="font-semibold text-[var(--fc-danger)]">
              {overdue.length}{uiText(" request")}{overdue.length === 1 ? uiText(" is") : uiText("s are")}{uiText(" past ")}{DELETION_WINDOW_DAYS}{uiText(" days and still not processed.")}</p>
            <p className="mt-1 text-[var(--fc-muted)]">{uiText("A daily pg_cron job calls the")}{" "}
              <span className="font-semibold">{uiText("process-account-deletions")}</span>{uiText(" function, which refuses anything without the right secret. If nothing here ever clears, the two ends of that secret do not match: check the Vault entry")}{" "}
              <code className="mx-0.5 rounded bg-[rgba(122,105,96,0.14)] px-1.5 py-0.5 text-xs">{uiText("cron_secret_for_account_deletion")}</code>{" "}{uiText("against the")}{" "}
              <code className="mx-0.5 rounded bg-[rgba(122,105,96,0.14)] px-1.5 py-0.5 text-xs">{uiText("CRON_SECRET")}</code>{" "}{uiText("set on the function.")}</p>
          </div>
        ) : null}

        {/* Says what the feature IS, not just that it is empty. An empty list
            under a bare heading reads as a feature that was never built,
            which is exactly how this one was first reported. */}
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--fc-border)] p-6 text-center text-sm">
            <p className="font-semibold text-[var(--fc-text)]">{uiText("No deletion requests right now")}</p>
            <p className="mt-1 text-[var(--fc-muted)]">{uiText("When somebody asks to delete their account in Settings, they appear here with ")}{DELETION_WINDOW_DAYS}{" "}{uiText("days to change their mind — and you can cancel the request for them.")}</p>
          </div>
        ) : null}

        <div className="grid gap-2">
          {pending.map((row) => {
            const left = daysLeft(row.deletion_requested_at);
            const late = left <= 0;
            return (
              <article
                key={row.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
                  late ? "border-[var(--fc-danger)]" : "border-[var(--fc-border)]"
                } bg-[var(--fc-panel)]`}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--fc-text)]">
                    {row.full_name || uiText("Customer")}
                    {row.shop_owner ? (
                      <span className="ml-2 rounded-full bg-[rgba(178,106,56,0.14)] px-2 py-0.5 text-[10px] font-bold text-[var(--fc-ink-accent)]">{uiText("shop owner")}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--fc-muted)]">{uiText("asked ")}{timeAgo(row.deletion_requested_at, undefined, uiLanguage)} ·{" "}
                    {late ? (
                      <span className="font-semibold text-[var(--fc-danger)]">{uiText("overdue by ")}{Math.abs(left)}{uiText(Math.abs(left) === 1 ? " day" : " days")}
                      </span>
                    ) : (
                      `${left} day${left === 1 ? "" : "s"} left`
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void cancelRequest(row.id, row.full_name || uiText("That account"))}
                  className="rounded-full border border-[var(--fc-border)] px-4 py-2 text-xs font-semibold transition hover:bg-[rgba(178,106,56,0.08)] disabled:opacity-50"
                >
                  {busyId === row.id ? uiText("Cancelling…") : uiText("Cancel request")}
                </button>
              </article>
            );
          })}
        </div>

        {closed.length > 0 ? (
          <details className="rounded-2xl border border-[var(--fc-border)] p-4">
            <summary className="cursor-pointer text-sm font-semibold">
              {closed.length}{uiText(closed.length === 1 ? " account" : " accounts")}{uiText(" already closed")}</summary>
            {/* Kept on screen rather than filtered away: seeing the job HAS
                processed something is the only evidence available that it is
                wired up at all. */}
            <ul className="mt-3 grid gap-1.5 text-xs text-[var(--fc-muted)]">
              {closed.map((row) => (
                <li key={row.id}>
                  {row.full_name || uiText("Deleted user")}{uiText(" · scrubbed ")}{row.deleted_at ? timeAgo(row.deleted_at, undefined, uiLanguage) : "—"}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* ------------------------------------------------------- shop takedown */}
      <section className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--fc-text)]">{uiText("Shops in the directory")}</h3>
          <p className="text-xs text-[var(--fc-muted)]">
            {shops.filter((shop) => shop.is_active).length}{uiText(" listed ·")}{" "}
            {shops.filter((shop) => !shop.is_active).length}{uiText(" hidden")}</p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={uiText("Search shops")}
          aria-label={uiText("Search shops")}
          className="rounded-full border border-[var(--fc-border)] bg-transparent px-4 py-2 text-sm outline-none"
        />

        <div className="grid gap-2">
          {visibleShops.map((shop) => (
            <article
              key={shop.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-[var(--fc-text)]">{shop.shop_name || uiText("Shop")}</p>
                <p className="mt-0.5 text-xs text-[var(--fc-muted)]">
                  {shop.is_active ? uiText("Listed for customers") : uiText("Hidden from the directory")}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {/* The reversible one first, and it is the one a shop behaving
                    badly should get: everything it did stays on record. */}
                <button
                  type="button"
                  disabled={busyId === shop.id}
                  onClick={() => void setShopActive(shop.id, shop.shop_name || uiText("That shop"), !shop.is_active)}
                  className="rounded-full border border-[var(--fc-border)] px-4 py-2 text-xs font-semibold transition hover:bg-[rgba(178,106,56,0.08)] disabled:opacity-50"
                >
                  {busyId === shop.id ? uiText("Saving…") : shop.is_active ? uiText("Hide from directory") : uiText("List again")}
                </button>

                <button
                  type="button"
                  disabled={busyId === shop.id}
                  onClick={() => void openDelete(shop)}
                  className="rounded-full border border-[var(--fc-danger)] px-4 py-2 text-xs font-semibold text-[var(--fc-danger)] transition hover:bg-[rgba(192,57,43,0.08)] disabled:opacity-50"
                >{uiText("Delete shop")}</button>
              </div>
            </article>
          ))}
        </div>

        <p className="text-[11px] leading-snug text-[var(--fc-muted)]">
          <span className="font-semibold">{uiText("Hiding")}</span>{uiText(" takes a shop out of the directory customers browse and leaves everything it did on record — that is the one to use for a shop behaving badly, and it can be undone. ")}<span className="font-semibold">{uiText("Deleting")}</span>{uiText(" removes the shop and cascades through its orders, reviews, templates and conversations; it is for a shop that should never have existed, and it cannot be undone.")}</p>
      </section>

      {deleting ? (
        <Modal
          open
          onClose={() => setDeleting(null)}
          ariaLabel={uiText("Delete {0}", { 0: deleting.shop_name ?? uiText("shop") })}
          eyebrow={uiText("Permanent")}
          title={uiText("Delete {0}?", { 0: deleting.shop_name || uiText("this shop") })}
          className="sm:max-w-md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="ml-auto inline-grid min-h-11 place-items-center rounded-full border border-[var(--fc-border)] px-4 text-sm font-semibold transition-transform active:scale-[0.98]"
              >{uiText("Cancel")}</button>
              <button
                type="button"
                disabled={typed.trim() !== (deleting.shop_name ?? "").trim() || busyId === deleting.id}
                onClick={() => void confirmDelete()}
                className="inline-grid min-h-11 place-items-center rounded-full bg-[var(--fc-danger)] px-4 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {busyId === deleting.id ? uiText("Deleting…") : uiText("Delete permanently")}
              </button>
            </>
          }
        >
            {damage === null ? (
              <p className="mt-3 text-sm text-[var(--fc-muted)]">{uiText("Counting what would be deleted…")}</p>
            ) : (
              <>
                <p className="mt-3 text-sm text-[var(--fc-text)]">{uiText("This also permanently deletes:")}</p>
                <ul className="mt-2 grid gap-1 text-sm">
                  <li className="flex justify-between border-b border-[var(--fc-border)] pb-1">
                    <span>{uiText("Customer orders")}</span>
                    <span className="font-bold tabular-nums">{damage.orders}</span>
                  </li>
                  <li className="flex justify-between border-b border-[var(--fc-border)] pb-1">
                    <span>{uiText("Reviews")}</span>
                    <span className="font-bold tabular-nums">{damage.reviews}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>{uiText("Templates")}</span>
                    <span className="font-bold tabular-nums">{damage.templates}</span>
                  </li>
                </ul>
                {damage.orders > 0 ? (
                  <p className="mt-3 rounded-xl border border-[var(--fc-danger)] bg-[rgba(192,57,43,0.06)] p-3 text-xs leading-snug text-[var(--fc-text)]">{uiText("Those ")}{damage.orders}{uiText(damage.orders === 1 ? " order" : " orders")}{uiText(" belong to customers, not to the shop. Each one is somebody's record of what they paid and what was agreed, and none of them asked for it to be erased. If the shop is simply behaving badly,")}{" "}
                    <span className="font-semibold">{uiText("hide it instead")}</span>.
                  </p>
                ) : null}
              </>
            )}

            <label className="mt-4 block text-xs font-semibold" htmlFor="confirm-shop-name">{uiText("Type ")}<span className="font-mono">{deleting.shop_name || uiText("the shop name")}</span>{uiText(" to confirm")}</label>
            <input
              id="confirm-shop-name"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--fc-border)] bg-transparent px-3 text-[16px] outline-none sm:text-sm"
            />

        </Modal>
      ) : null}
    </div>
  );
}
