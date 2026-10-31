"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { notifySuccess } from "@/lib/saved-notice";
import { removeReportPhoto, uploadReportPhoto } from "@/lib/report-photos";
import {
  MAX_DETAILS_LENGTH,
  MAX_REASON_LENGTH,
  REPORT_TOPICS,
  type ReportCategory,
} from "@/lib/report-topics";

/**
 * The one dialog every "Report" button in the customer's half of the app opens.
 *
 * It writes a row into `reports`, which is the same table the admin ticket
 * queue reads -- so a report is a ticket the moment it is filed, with no
 * separate submission step that could drop it on the floor.
 *
 * Three things this deliberately does:
 *
 * - offers a topic picker only when the caller has more than one to offer.
 *   Reporting a chat message is unambiguous; reporting from an order could be
 *   about the payment, the refund or the piece itself, and only the customer
 *   knows which.
 * - says plainly what happens next. "Report" with no explanation reads as a
 *   button that deletes something, and the honest answer -- a person at
 *   FurniCraft reads this, the shop is not told who reported it -- is also the
 *   answer most likely to get a useful report rather than an angry one.
 * - refuses to file the same report twice. The duplicate check is a query, not
 *   a constraint, so it is advice; a second report is not harmful, just noise
 *   in the queue.
 */
export default function ReportDialog({
  open,
  onClose,
  topics,
  targetId,
  title,
  context,
  onFiled,
}: {
  open: boolean;
  onClose: () => void;
  /** One topic hides the picker; several show it. Never empty. */
  topics: ReportCategory[];
  /** The row being reported: a message id, an order id, a review id, a shop id. */
  targetId: string;
  /** Heading, e.g. "Report this message". */
  title: string;
  /** What is being reported, quoted back so nobody reports the wrong thing. */
  context?: React.ReactNode;
  onFiled?: (category: ReportCategory) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [category, setCategory] = useState<ReportCategory>(topics[0]);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);

  /**
   * Reopening for a different message must not inherit the last one's answers.
   *
   * Keyed on the topics JOINED rather than on the array, which is not a
   * nicety. Callers pass a literal -- `topics={["chat"]}` -- so the array is a
   * new object on every render of the parent, and the parent here is a
   * dashboard with a live message subscription under it. With the array itself
   * in the dependency list, an incoming message re-rendered the dashboard, this
   * effect re-ran, and a half-written report lost its selected reason and
   * everything typed into the details box.
   */
  const topicsKey = topics.join(",");
  useEffect(() => {
    if (!open) return;
    setCategory(topicsKey.split(",")[0] as ReportCategory);
    setReason("");
    setDetails("");
    setPhoto(null);
    setError(null);
    setFiled(false);
    setAlreadyReported(false);
  }, [open, targetId, topicsKey]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // Has this person already reported this exact thing? The select policy on
  // `reports` lets a reporter read their own rows, so this needs no privilege
  // the customer does not already have.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;

        const { data } = await supabase
          .from("reports")
          .select("id")
          .eq("reporter_user_id", userData.user.id)
          .eq("target_id", targetId)
          .limit(1);

        if (!cancelled && data?.length) setAlreadyReported(true);
      } catch {
        // Advisory only: a failed duplicate lookup must not block reporting.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, targetId]);

  const topic = REPORT_TOPICS[category];

  const submit = async () => {
    if (!reason.trim()) {
      setError("Choose what went wrong, so this reaches the right person.");
      return;
    }
    if (!details.trim()) {
      setError("Describe what happened, so we can look into it.");
      return;
    }
    if (!photo) {
      setError("Attach a photo or screenshot of the problem.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError("Sign in again to send this report.");
        return;
      }

      const uploaded = await uploadReportPhoto(userData.user.id, photo);
      if ("error" in uploaded) {
        // A missing bucket means migration 20261026120000 is not applied yet.
        setError(
          /bucket/i.test(uploaded.error)
            ? "Reporting is not switched on yet. Please contact FurniCraft support."
            : uploaded.error
        );
        return;
      }

      const { error: writeError } = await supabase.from("reports").insert({
        reporter_user_id: userData.user.id,
        target_type: topic.targetType,
        target_id: targetId,
        category: topic.category,
        reason: reason.trim().slice(0, MAX_REASON_LENGTH),
        details: details.trim().slice(0, MAX_DETAILS_LENGTH),
        photo_path: uploaded.path,
      });

      if (writeError) {
        void removeReportPhoto(uploaded.path);
        // The failures worth translating are missing columns: `category`
        // (migration 20260914000100) and `photo_path` (20261026120000). Until
        // they are applied PostgREST rejects the insert by name, and "could
        // not find the 'category' column" is not something to show a customer.
        setError(
          // The proof-photo rule (20261101090000) explains itself.
          /proof photo|photo or screenshot as proof/i.test(writeError.message)
            ? writeError.message
            : /category|photo_path/i.test(writeError.message)
              ? "Reporting is not switched on yet. Please contact FurniCraft support."
              : "Your report could not be sent. Please check your connection and try again."
        );
        return;
      }

      setFiled(true);
      onFiled?.(topic.category);
      notifySuccess("Report sent");
    } catch {
      setError("Your report could not be sent. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel={title} className="sm:max-w-lg" bodyClassName="p-0 sm:p-0">
      <div className="p-5">
        {filed ? (
          <>
            <h2 className="text-lg font-semibold text-[var(--fc-text)]">{uiText("Report sent")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fc-muted)]">{uiText("A person at FurniCraft will read this. You'll get a notification when it has been looked at. The reported person is not told who sent the report.")}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[var(--fc-ink-accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.98]"
              >{uiText("Done")}</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[var(--fc-text)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--fc-muted)]">{uiText(topic.blurb)}</p>

            {context ? (
              <div className="mt-3 rounded-xl border border-dashed border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)]">
                {context}
              </div>
            ) : null}

            {alreadyReported ? (
              <p className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] px-3 py-2 text-sm text-[var(--fc-muted)]">{uiText("You have already reported this. Sending another won't make it looked at sooner, but add anything new if it helps.")}</p>
            ) : null}

            {topics.length > 1 ? (
              <fieldset className="mt-4">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What is this about?")}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topics.map((id) => {
                    const isActive = id === category;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={isActive}
                        onClick={() => {
                          setCategory(id);
                          // The reasons differ per topic, so a reason chosen
                          // under the old one no longer belongs to anything.
                          setReason("");
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
                          isActive
                            ? "border-[var(--fc-ink-accent)] bg-[rgba(178,106,56,0.14)] text-[var(--fc-ink-accent)]"
                            : "border-[var(--fc-border)] text-[var(--fc-muted)] hover:bg-[rgba(178,106,56,0.06)]"
                        }`}
                      >
                        {uiText(REPORT_TOPICS[id].label)}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("What went wrong?")}</legend>
              <div className="mt-2 grid gap-1.5">
                {topic.reasons.map((option) => (
                  <label
                    key={option}
                    className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--fc-border)] px-3 py-2 text-sm text-[var(--fc-text)] transition-colors hover:bg-[rgba(178,106,56,0.05)]"
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={option}
                      checked={reason === option}
                      onChange={() => setReason(option)}
                      className="mt-0.5 accent-[var(--fc-ink-accent)]"
                    />
                    <span>{uiText(option)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-4 block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Anything else? *")}</span>
              <textarea
                required
                value={details}
                onChange={(event) => setDetails(event.target.value.slice(0, MAX_DETAILS_LENGTH))}
                rows={3}
                placeholder={uiText("Dates, amounts, what was said — anything that helps us understand.")}
                className="mt-1.5 w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-sm text-[var(--fc-text)] outline-none focus:border-[var(--fc-ink-accent)]"
              />
            </label>

            <div className="mt-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fc-muted)]">{uiText("Photo or screenshot *")}</span>
              {photo && photoPreview ? (
                <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-[var(--fc-border)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoPreview} alt={uiText("Attached photo")} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--fc-text)]">{photo.name}</span>
                  <button
                    type="button"
                    onClick={() => setPhoto(null)}
                    className="shrink-0 text-xs font-semibold text-[var(--fc-danger)] hover:underline"
                  >{uiText("Remove")}</button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/*"
                  required
                  onChange={(event) => {
                    setPhoto(event.target.files?.[0] ?? null);
                    setError(null);
                  }}
                  className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-xl file:border file:border-[var(--fc-border)] file:bg-[var(--fc-bg)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--fc-text)] hover:file:bg-[rgba(178,106,56,0.1)]"
                />
              )}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[var(--fc-muted)]">{uiText("This goes privately to FurniCraft. We can remove content and restrict accounts. FurniCraft never holds your money, so we cannot move a payment or a refund ourselves — what we can do is take it up with the shop.")}</p>

            {error ? (
              <p role="alert" className="mt-3 text-sm font-medium text-[var(--fc-danger)]">
                {uiText(error)}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-[var(--fc-border)] px-4 py-2 text-sm font-semibold text-[var(--fc-muted)] transition-colors hover:bg-[rgba(178,106,56,0.06)] active:scale-[0.98]"
              >{uiText("Cancel")}</button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !reason || !details.trim() || !photo}
                className="rounded-full bg-[var(--fc-ink-accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? uiText("Sending…") : uiText("Send report")}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
