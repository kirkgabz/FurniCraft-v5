"use client";
import { AdaptiveText } from "@/components/language/adaptive-text";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { removeReportPhoto, uploadReportPhoto } from "@/lib/report-photos";
import { USER_NAMES_TABLE } from "@/components/shops/shop-types";
import { StarPicker, Stars, formatRating } from "@/components/reviews/stars";
import { initialsOf, timeAgo } from "@/lib/time-ago";

/**
 * Ratings and written feedback for one shop.
 *
 * Who may write one is decided by the database, not by this component: the
 * INSERT policy on shop_reviews requires a completed order with the shop (see
 * supabase/migrations/20260825000700_shop_reviews.sql). The eligibility check
 * below runs the same question so the form can be hidden rather than offered
 * and then refused -- but the form is not the enforcement, and a rejection from
 * the database is shown rather than swallowed.
 *
 * One review per customer per shop, enforced by a unique constraint. Writing
 * again edits the existing one, which is why the submit path is an upsert.
 */

/** A tap-to-answer prompt's value: unanswered, or one of three fixed replies. */
type QuickAnswer = "yes" | "no" | "unsure" | null;

type Review = {
  id: string;
  customer_user_id: string;
  rating: number;
  comment: string | null;
  is_anonymous: boolean;
  as_described: QuickAnswer;
  communication_clear: QuickAnswer;
  would_recommend: QuickAnswer;
  created_at: string;
  updated_at: string;
};

const MAX_COMMENT = 1000;

/** The three "Tell us more" prompts, in display order. `short` labels the read-only badge; `label` is the full question asked while writing a review. */
const QUICK_QUESTIONS: Array<{
  key: "as_described" | "communication_clear" | "would_recommend";
  label: string;
  short: string;
}> = [
  { key: "as_described", label: "Was the finished piece as described?", short: "As described" },
  { key: "communication_clear", label: "Was communication with the shop clear?", short: "Communication" },
  { key: "would_recommend", label: "Would you recommend this shop to others?", short: "Recommends" },
];

/**
 * One optional yes/no/unsure prompt, answered by tapping a chip. Tapping the
 * already-selected chip clears it, the same as Google Play's "Clear" does --
 * these stay genuinely optional at every point, not just before the first tap.
 */
function QuickQuestionChips({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: QuickAnswer;
  onChange: (next: QuickAnswer) => void;
  disabled: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div className="rounded-xl border border-[var(--fc-border)] px-3 py-2.5">
      <p className="text-sm text-[var(--fc-text)]">{uiText(label)}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["no", "unsure", "yes"] as const).map((option) => {
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange(active ? null : option)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize transition disabled:opacity-60 ${
                active
                  ? "border-[#8b5a2b] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                  : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
              }`}
            >
              {option === "unsure" ? uiText("Not sure") : option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ShopReviews({
  shopId,
  shopName,
  /** Compact leaves out the distribution bars, for narrower columns. */
  compact = false,
  /**
   * For the shop's own view of its feedback. The owner is not a customer of
   * their own shop, so offering them a form -- or telling them they may write
   * one once an order completes -- is noise.
   */
  readOnly = false,
}: {
  shopId: string;
  shopName: string;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const { t: uiText, language: uiLanguage } = useUiLanguage();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [draftRating, setDraftRating] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [draftAnonymous, setDraftAnonymous] = useState(false);
  const [draftAsDescribed, setDraftAsDescribed] = useState<QuickAnswer>(null);
  const [draftCommunicationClear, setDraftCommunicationClear] = useState<QuickAnswer>(null);
  const [draftWouldRecommend, setDraftWouldRecommend] = useState<QuickAnswer>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which of these reviews this shop owner has already reported, and the
  // inline report form's state -- both only ever used in the readOnly view.
  const [reportedReviewIds, setReportedReviewIds] = useState<Set<string>>(new Set());
  const [reportingReviewId, setReportingReviewId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  // Proof is required on every report, this one included (20261101090000).
  const [reportPhoto, setReportPhoto] = useState<File | null>(null);
  const [reportPhotoPreview, setReportPhotoPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!reportPhoto) {
      setReportPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(reportPhoto);
    setReportPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [reportPhoto]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const myReview = currentUserId
    ? reviews.find((review) => review.customer_user_id === currentUserId) ?? null
    : null;

  // Averaged here rather than read from the shop_ratings view: this component
  // already holds every row it would aggregate, and one number that disagrees
  // with the list under it is worse than one query saved.
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, review) => sum + review.rating, 0) / count : null;

  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    setCurrentUserId(userId);

    const { data } = await supabase
      .from("shop_reviews")
      .select(
        "id, customer_user_id, rating, comment, is_anonymous, as_described, communication_clear, would_recommend, created_at, updated_at"
      )
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as Review[];
    setReviews(rows);
    setIsLoading(false);

    // Reviewers are named from the display-name view; user_profiles only ever
    // returns the signed-in user's own row.
    const ids = Array.from(new Set(rows.map((row) => row.customer_user_id)));
    if (ids.length) {
      const { data: nameRows } = await supabase.from(USER_NAMES_TABLE).select("id, full_name").in("id", ids);
      if (nameRows) {
        setNames(
          Object.fromEntries(
            (nameRows as Array<{ id: string; full_name: string | null }>).map((row) => [
              row.id,
              row.full_name || "Customer",
            ])
          )
        );
      }
    }

    if (!userId) {
      setCanReview(false);
      return;
    }

    if (readOnly) {
      // The shop owner's view: which of these reviews have they already sent
      // to the admin queue, so the button can turn into "Reported" instead of
      // offering to file a second report against the same one.
      if (rows.length) {
        const { data: ownReports } = await supabase
          .from("reports")
          .select("target_id")
          .eq("reporter_user_id", userId)
          .eq("target_type", "shop_review")
          .in("target_id", rows.map((row) => row.id));
        setReportedReviewIds(new Set((ownReports ?? []).map((row) => row.target_id as string)));
      }
      setCanReview(false);
      return;
    }

    // The same two questions the INSERT/UPDATE policies ask: a completed
    // order, and not currently banned from posting reviews.
    const [{ data: completed }, { data: profileRow }] = await Promise.all([
      supabase
        .from("design_orders")
        .select("id")
        .eq("shop_id", shopId)
        .eq("customer_user_id", userId)
        .eq("status", "completed")
        .limit(1),
      supabase.from("user_profiles").select("reviews_banned").eq("id", userId).maybeSingle(),
    ]);

    const banned = Boolean(profileRow?.reviews_banned);
    setIsBanned(banned);
    setCanReview(!banned && Boolean(completed?.length));
  }, [readOnly, shopId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  const startEditing = () => {
    setDraftRating(myReview?.rating ?? 0);
    setDraftComment(myReview?.comment ?? "");
    setDraftAnonymous(myReview?.is_anonymous ?? false);
    setDraftAsDescribed(myReview?.as_described ?? null);
    setDraftCommunicationClear(myReview?.communication_clear ?? null);
    setDraftWouldRecommend(myReview?.would_recommend ?? null);
    setError(null);
    setIsEditing(true);
  };

  const submit = async () => {
    if (!currentUserId || draftRating < 1) return;
    if (isBanned) {
      setError("Your account is restricted from posting reviews.");
      return;
    }
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: writeError } = await supabase.from("shop_reviews").upsert(
      {
        shop_id: shopId,
        customer_user_id: currentUserId,
        rating: draftRating,
        comment: draftComment.trim() ? draftComment.trim().slice(0, MAX_COMMENT) : null,
        is_anonymous: draftAnonymous,
        as_described: draftAsDescribed,
        communication_clear: draftCommunicationClear,
        would_recommend: draftWouldRecommend,
      },
      { onConflict: "shop_id,customer_user_id" }
    );

    setBusy(false);

    if (writeError) {
      // Most likely cause is the completed-order rule, so say so rather than
      // printing a policy name at someone.
      setError(
        /row-level security/i.test(writeError.message)
          ? `Only customers with a completed order from ${shopName} can leave a review.`
          : writeError.message
      );
      return;
    }

    setIsEditing(false);
    await load();
    notifySuccess("Review posted");
  };

  const remove = async () => {
    if (!myReview) return;
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: deleteError } = await supabase.from("shop_reviews").delete().eq("id", myReview.id);

    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setIsEditing(false);
    setDraftRating(0);
    setDraftComment("");
    setDraftAnonymous(false);
    setDraftAsDescribed(null);
    setDraftCommunicationClear(null);
    setDraftWouldRecommend(null);
    await load();
    notifySuccess("Review deleted");
  };

  const submitReport = async (reviewId: string) => {
    if (!currentUserId || !reportReason.trim()) return;
    if (!reportPhoto) {
      setReportError("Attach a photo or screenshot as proof.");
      return;
    }
    setReportBusy(true);
    setReportError(null);

    const uploaded = await uploadReportPhoto(currentUserId, reportPhoto);
    if ("error" in uploaded) {
      setReportBusy(false);
      setReportError(uploaded.error);
      return;
    }

    const supabase = createClient();
    const { error: reportWriteError } = await supabase.from("reports").insert({
      reporter_user_id: currentUserId,
      target_type: "shop_review",
      target_id: reviewId,
      // Categorised so it lands under "Review" in the admin ticket queue
      // alongside chat, payment and refund reports -- see lib/report-topics.ts.
      category: "review",
      reason: reportReason.trim().slice(0, 500),
      photo_path: uploaded.path,
    });

    setReportBusy(false);

    if (reportWriteError) {
      void removeReportPhoto(uploaded.path);
      setReportError(
        /proof photo|photo or screenshot as proof/i.test(reportWriteError.message)
          ? reportWriteError.message
          : "Your report could not be sent. Please try again."
      );
      return;
    }

    setReportedReviewIds((current) => new Set(current).add(reviewId));
    setReportingReviewId(null);
    notifySuccess("Report sent");
    setReportReason("");
    setReportPhoto(null);
  };

  // How many gave each score, highest first. Purely descriptive, so it is the
  // first thing dropped in the compact layout.
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    n: reviews.filter((review) => review.rating === star).length,
  }));

  return (
    <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--fc-text)]">{uiText("Ratings & feedback")}</h3>
          <p className="mt-0.5 text-sm text-[var(--fc-muted)]">
            {readOnly ? uiText("What your customers say about you") : uiText("What customers say about {0}", { 0: shopName })}
          </p>
        </div>
        {!isLoading && count > 0 ? (
          <div className="text-right">
            <div className="text-2xl font-bold leading-none text-[var(--fc-text)]">
              {formatRating(average ?? 0)}
            </div>
            <Stars value={average ?? 0} className="mt-1" />
            <div className="mt-0.5 text-xs text-[var(--fc-muted)]">
              {count}{uiText(count === 1 ? " review" : " reviews")}
            </div>
          </div>
        ) : null}
      </div>

      {!isLoading && count > 0 && !compact ? (
        <div className="mt-4 space-y-1.5">
          {/* A bare accent fill, not a filled track with a partial overlay --
              the count at the end already says the exact number; the bar is
              only there to make the shape of the distribution scannable. */}
          {distribution.map(({ star, n }) => (
            <div key={star} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs text-[var(--fc-muted)]">{star} ★</span>
              <span className="relative h-1.5 flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[#d99a2b]"
                  style={{ width: `${count ? Math.max((n / count) * 100, n > 0 ? 4 : 0) : 0}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right text-xs text-[var(--fc-muted)]">{n}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---------------------------------------------- writing or editing */}
      {isEditing ? (
        <div className="mt-4 rounded-2xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] p-4">
          <p className="text-sm font-semibold text-[var(--fc-text)]">
            {myReview ? uiText("Edit your review") : uiText("Rate {0}", { 0: shopName })}
          </p>
          <div className="mt-2">
            <StarPicker value={draftRating} onChange={setDraftRating} disabled={busy} />
          </div>
          <textarea
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value.slice(0, MAX_COMMENT))}
            placeholder={uiText("Describe your experience")}
            rows={3}
            disabled={busy}
            className="mt-3 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-panel)] px-3 py-2 text-sm"
          />
          <div className="mt-1 text-right text-[11px] text-[var(--fc-muted)]">
            {draftComment.length}/{MAX_COMMENT}
          </div>

          <p className="mt-3 text-xs font-semibold text-[var(--fc-muted)]">{uiText("Tell us more (optional)")}</p>
          <div className="mt-2 space-y-2">
            <QuickQuestionChips
              label={uiText(QUICK_QUESTIONS[0].label)}
              value={draftAsDescribed}
              onChange={setDraftAsDescribed}
              disabled={busy}
            />
            <QuickQuestionChips
              label={uiText(QUICK_QUESTIONS[1].label)}
              value={draftCommunicationClear}
              onChange={setDraftCommunicationClear}
              disabled={busy}
            />
            <QuickQuestionChips
              label={uiText(QUICK_QUESTIONS[2].label)}
              value={draftWouldRecommend}
              onChange={setDraftWouldRecommend}
              disabled={busy}
            />
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-[var(--fc-text)]">
            <input
              type="checkbox"
              checked={draftAnonymous}
              onChange={(event) => setDraftAnonymous(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-[var(--fc-border)]"
            />{uiText("Post as an anonymous reviewer")}</label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={submit} disabled={busy || draftRating < 1} className="btn btn-primary">
              {busy ? uiText("Saving…") : myReview ? uiText("Update review") : uiText("Post review")}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              disabled={busy}
              className="btn btn-secondary"
            >{uiText("Cancel")}</button>
            {myReview ? (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="text-sm font-semibold text-[#c0392b] hover:underline"
              >{uiText("Delete")}</button>
            ) : null}
          </div>
        </div>
      ) : canReview ? (
        <button type="button" onClick={startEditing} className="btn btn-primary mt-4">
          {myReview ? uiText("Edit your review") : uiText("★ Rate {0}", { 0: shopName })}
        </button>
      ) : currentUserId && !isLoading && !readOnly && isBanned ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#c0392b]/40 bg-[#c0392b]/5 px-3 py-2 text-sm text-[#c0392b]">{uiText("Your account is restricted from posting reviews.")}</p>
      ) : currentUserId && !isLoading && !readOnly ? (
        <p className="mt-4 rounded-xl border border-dashed border-[var(--fc-border)] px-3 py-2 text-sm text-[var(--fc-muted)]">{uiText("You can leave a review once an order with this shop is completed.")}</p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-[#c0392b] bg-[rgba(192,57,43,0.08)] px-3 py-2 text-sm text-[#c0392b]">
          {uiText(error)}
        </p>
      ) : null}

      {/* ------------------------------------------------------- the list */}
      {/* Two abreast once there is room. A review is a short paragraph with an
          avatar and some stars; as a single column on a wide dashboard each one
          was a 1566px band about 70px tall, so a five-word review had a line
          box wider than the screen it was written on. */}
      <div className="mt-4 space-y-3 xl:grid xl:grid-cols-2 xl:items-start xl:gap-3 xl:space-y-0">
        {isLoading ? (
          <p className="text-sm text-[var(--fc-muted)]">{uiText("Loading reviews…")}</p>
        ) : count === 0 ? (
          <p className="text-sm text-[var(--fc-muted)]">
            {readOnly ? uiText("No reviews yet. Customers can rate you once you mark an order completed.") : uiText("No reviews yet. The first one comes from a customer whose order is completed.")}
          </p>
        ) : (
          reviews.map((review) => {
            const isMine = review.customer_user_id === currentUserId;
            const name = isMine
              ? "You"
              : review.is_anonymous
                ? "Anonymous"
                : names[review.customer_user_id] ?? "Customer";
            const edited = review.updated_at !== review.created_at;

            return (
              <article
                key={review.id}
                className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)] p-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgba(178,106,56,0.14)] text-sm font-bold text-[var(--fc-ink-accent)]"
                  >
                    {initialsOf(name === "You" ? "You" : name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--fc-text)]">{name}</span>
                      {isMine && review.is_anonymous ? (
                        <span className="text-[11px] text-[var(--fc-muted)]">{uiText("(posted anonymously)")}</span>
                      ) : null}
                      <Stars value={review.rating} />
                      <span className="text-[11px] text-[var(--fc-muted)]">
                        {timeAgo(review.created_at, undefined, uiLanguage)}
                        {edited ? uiText(" · edited") : ""}
                      </span>
                    </div>
                    {review.comment ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--fc-text)]"><AdaptiveText text={review.comment} /></p>
                    ) : null}

                    {QUICK_QUESTIONS.some(({ key }) => review[key]) ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {QUICK_QUESTIONS.filter(({ key }) => review[key]).map(({ key, label, short }) => (
                          <span
                            key={key}
                            className="rounded-full border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2 py-0.5 text-[11px] text-[var(--fc-muted)]"
                            title={uiText(label)}
                          >
                            {short}:{" "}
                            <span className="font-semibold text-[var(--fc-text)] capitalize">
                              {review[key] === "unsure" ? uiText("Not sure") : review[key]}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {readOnly && reportingReviewId === review.id ? (
                      <div className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] p-3">
                        <label className="text-xs font-semibold text-[var(--fc-muted)]">{uiText("Why are you reporting this review?")}</label>
                        <textarea
                          value={reportReason}
                          onChange={(event) => setReportReason(event.target.value.slice(0, 500))}
                          placeholder={uiText("e.g. abusive language, unrelated to an order, fake review")}
                          rows={2}
                          disabled={reportBusy}
                          className="mt-1 w-full rounded-lg border border-[var(--fc-border)] bg-[var(--fc-panel)] px-2.5 py-1.5 text-sm"
                        />
                        <p className="mt-2 text-xs font-semibold text-[var(--fc-muted)]">{uiText("Photo or screenshot as proof *")}</p>
                        {reportPhoto && reportPhotoPreview ? (
                          <div className="mt-1 flex items-center gap-2.5 rounded-lg border border-[var(--fc-border)] p-1.5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={reportPhotoPreview} alt={uiText("Attached photo")} className="h-12 w-12 shrink-0 rounded-md object-cover" />
                            <span className="min-w-0 flex-1 truncate text-xs text-[var(--fc-text)]">{reportPhoto.name}</span>
                            <button
                              type="button"
                              onClick={() => setReportPhoto(null)}
                              disabled={reportBusy}
                              className="shrink-0 text-xs font-semibold text-[#c0392b] hover:underline"
                            >{uiText("Remove")}</button>
                          </div>
                        ) : (
                          <input
                            type="file"
                            accept="image/*"
                            required
                            disabled={reportBusy}
                            onChange={(event) => {
                              setReportPhoto(event.target.files?.[0] ?? null);
                              setReportError(null);
                            }}
                            className="mt-1 block w-full text-xs file:mr-2 file:rounded-lg file:border file:border-[var(--fc-border)] file:bg-[var(--fc-panel)] file:px-2.5 file:py-1 file:text-xs file:font-semibold"
                          />
                        )}
                        {reportError ? <p className="mt-1 text-xs text-[#c0392b]">{uiText(reportError)}</p> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => submitReport(review.id)}
                            disabled={reportBusy || !reportReason.trim() || !reportPhoto}
                            className="btn btn-secondary btn-sm"
                          >
                            {reportBusy ? uiText("Submitting…") : uiText("Submit report")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReportingReviewId(null);
                              setReportError(null);
                              setReportPhoto(null);
                            }}
                            disabled={reportBusy}
                            className="text-xs font-semibold text-[var(--fc-muted)] hover:underline"
                          >{uiText("Cancel")}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {isMine && !isEditing ? (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="tap-target shrink-0 text-xs font-semibold text-[var(--fc-ink-accent)] hover:underline"
                    >{uiText("Edit")}</button>
                  ) : readOnly && reportedReviewIds.has(review.id) ? (
                    <span className="shrink-0 text-xs font-semibold text-[var(--fc-muted)]">{uiText("Reported")}</span>
                  ) : readOnly && reportingReviewId !== review.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReportingReviewId(review.id);
                        setReportReason("");
                        setReportError(null);
                        setReportPhoto(null);
                      }}
                      className="shrink-0 text-xs font-semibold text-[#c0392b] hover:underline"
                    >{uiText("Report")}</button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
