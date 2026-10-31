"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { notifySaved } from "@/lib/saved-notice";
import { formatPeso } from "@/components/orders/order-status";
import {
  FALLBACK_COST_GROUP,
  costTotal,
  emptyLine,
  isMeaningful,
  lineTotal,
  marginOf,
  parseLines,
  type CostLine,
} from "@/components/orders/costing";
import {
  DEFAULT_COST_GROUPS,
  DEFAULT_FORMULA,
  describeFormula,
  groupsOf,
  parseFormula,
  priceSheet,
  quoteLinesFromSheet,
  type PricingFormula,
} from "@/components/orders/pricing";
import { PricingFormulaEditor } from "@/components/orders/pricing-formula-editor";
import { useShopPricing } from "@/components/orders/use-shop-pricing";
import type { QuoteLine } from "@/components/orders/quote-lines";

/**
 * A shop's working-out of what one order costs it, kept with that order.
 *
 * Shop owners were quoting from a calculator app and a notebook, and the
 * figures behind a price stayed there -- so a month later, with a customer
 * asking why the same piece now costs more, there was nothing to look at. This
 * keeps the sum next to the job it belongs to.
 *
 * Costs sit in groups -- Materials, Labour, Miscellaneous, or the shop's own --
 * because that is how shops price: Sir Mark adds the three up and doubles it,
 * another doubles materials and charges labour at cost. The shop's formula
 * (shop_pricing, see pricing.ts) turns the groups into a price, and can be
 * changed for one order without changing the shop's.
 *
 * Private to the shop. It reads and writes order_costings and shop_pricing,
 * whose only policies are the owning shop's; the customer's own view of the
 * order cannot reach either. See 20260921000300_order_costings.sql.
 *
 * Saved on a button, not as you type. Autosave here would write a row on every
 * keystroke of a figure the owner is still working out, and "did that save?"
 * is exactly the question a cost sheet must not raise -- so there is a dirty
 * marker and an explicit Save.
 */
export default function OrderCosting({
  orderId,
  shopId,
  quotedTotal,
  onUseAsQuote,
  defaultOpen = false,
}: {
  orderId: string;
  /**
   * The shop this order belongs to. Sent on insert because the column is not
   * nullable; the table's trigger then overwrites it with the order's real
   * shop, so a wrong value here cannot attach the sheet to somebody else.
   */
  shopId: string;
  /** What the customer was quoted, if anything yet. Read-only here. */
  quotedTotal: number | null;
  /**
   * Fills the quote form: the suggested total, and the sheet priced into the
   * customer-facing breakdown -- one line per group or per cost line, as the
   * shop chose. Never the costs themselves; see quote-lines.ts.
   */
  onUseAsQuote?: (total: number, lines: QuoteLine[]) => void;
  /** Start expanded, for where the sheet has a tab of its own rather than sharing a column. */
  defaultOpen?: boolean;
}) {
  const { t: uiText, locale: uiLocale } = useUiLanguage();
  const [lines, setLines] = useState<CostLine[]>([]);
  /** This order's own formula; null means the shop's. */
  const [orderFormula, setOrderFormula] = useState<PricingFormula | null>(null);
  const [isEditingFormula, setIsEditingFormula] = useState(false);
  /** Groups added on this sheet that have no lines yet. */
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const shopPricing = useShopPricing(shopId);
  /**
   * What is actually typed in the number boxes, while it is being typed.
   *
   * The boxes used to show `String(line.qty)`, re-derived from the parsed
   * number on every keystroke. That makes half-finished input impossible:
   * "1250." parses to 1250 and renders back as "1250", so the decimal point
   * is swallowed and ₱1,250.50 cannot be entered at all -- and clearing a box
   * snaps it to "0" mid-edit. So the text lives here until the field is left,
   * and the parsed number goes on the line.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /**
   * Suppresses the dirty flag while the load is populating state.
   * Without it a sheet reads as unsaved the moment it opens, and the owner
   * learns to ignore the marker that is meant to mean something.
   */
  const isHydrating = useRef(true);

  useEffect(() => {
    let cancelled = false;
    isHydrating.current = true;

    (async () => {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("order_costings")
        .select("lines, markup_percent, formula, notes, updated_at")
        .eq("order_id", orderId)
        .maybeSingle();

      if (cancelled) return;

      if (loadError) {
        // A missing table is the un-run migration, which is worth saying
        // plainly rather than showing an empty sheet that will not save.
        console.error("Failed to load the cost sheet:", loadError);
        setError(
          (loadError as { code?: string }).code === "42P01"
            ? "The cost sheet needs the 20260921000300_order_costings migration run in Supabase."
            : "Could not load this order's cost sheet."
        );
        setIsLoading(false);
        isHydrating.current = false;
        return;
      }

      const row = data as {
        lines: unknown;
        markup_percent: number | string | null;
        formula: unknown;
        notes: string | null;
        updated_at: string | null;
      } | null;

      const loaded = parseLines(row?.lines);
      setLines(loaded);
      // A sheet saved before formulas existed kept a markup percentage; it
      // goes on pricing exactly as it did.
      const legacyPercent = row?.markup_percent == null ? null : Number(row.markup_percent);
      setOrderFormula(
        parseFormula(row?.formula) ??
          (legacyPercent != null && Number.isFinite(legacyPercent) ? { method: "markup", percent: legacyPercent } : null)
      );
      setNotes(row?.notes ?? "");
      setSavedAt(row?.updated_at ?? null);
      // A sheet with something in it opens open: it is a record to read, not
      // a form to fill, once it exists.
      setIsOpen(loaded.length > 0);
      setIsLoading(false);
      setIsDirty(false);
      // One frame later, so the state writes above do not mark it dirty.
      window.setTimeout(() => {
        isHydrating.current = false;
      }, 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const touch = useCallback(() => {
    if (!isHydrating.current) setIsDirty(true);
  }, []);

  const updateLine = useCallback(
    (id: string, patch: Partial<CostLine>) => {
      setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
      touch();
    },
    [touch]
  );

  const removeLine = useCallback(
    (id: string) => {
      setLines((current) => current.filter((line) => line.id !== id));
      touch();
    },
    [touch]
  );

  const addLine = useCallback(
    (group: string) => {
      setLines((current) => [...current, emptyLine("", group)]);
      touch();
      setIsOpen(true);
    },
    [touch]
  );

  /**
   * Accepts the keystroke as text, and stores the number it parses to.
   *
   * Both happen: the line always carries a usable number, so the totals below
   * stay live as you type, while the box keeps showing exactly what you typed
   * -- trailing dot and all -- until focus leaves.
   */
  const editNumber = useCallback(
    (id: string, field: "qty" | "unitCost", raw: string) => {
      const cleaned = raw.replace(/[^0-9.]/g, "");
      setDrafts((current) => ({ ...current, [`${id}:${field}`]: cleaned }));
      const parsed = Number(cleaned);
      updateLine(id, { [field]: Number.isFinite(parsed) ? parsed : 0 } as Partial<CostLine>);
    },
    [updateLine]
  );

  /** On blur the box goes back to showing the number that was actually kept. */
  const settleNumber = useCallback((id: string, field: "qty" | "unitCost") => {
    setDrafts((current) => {
      const next = { ...current };
      delete next[`${id}:${field}`];
      return next;
    });
  }, []);

  const numberValue = useCallback(
    (line: CostLine, field: "qty" | "unitCost") => drafts[`${line.id}:${field}`] ?? String(line[field]),
    [drafts]
  );

  const groups = useMemo(() => {
    const all = groupsOf(lines);
    for (const group of extraGroups) if (!all.includes(group)) all.push(group);
    return all;
  }, [lines, extraGroups]);

  const total = useMemo(() => costTotal(lines), [lines]);
  const margin = useMemo(() => marginOf(quotedTotal, total), [quotedTotal, total]);
  const effectiveFormula = orderFormula ?? shopPricing.formula;
  const priced = useMemo(() => (effectiveFormula ? priceSheet(lines, effectiveFormula) : null), [lines, effectiveFormula]);
  // No formula anywhere yet: the editor opens on a sensible default to start from.
  const formulaInEditor = orderFormula ?? shopPricing.formula ?? DEFAULT_FORMULA;
  const showEditor = isEditingFormula || (shopPricing.loaded && !shopPricing.formula && !orderFormula);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);

    // Rows the owner tabbed past are not costs; keeping them would refill the
    // sheet with blanks on every reopen.
    const keep = lines.filter(isMeaningful);
    const supabase = createClient();

    const { error: saveError } = await supabase.from("order_costings").upsert(
      {
        order_id: orderId,
        shop_id: shopId,
        lines: keep,
        formula: orderFormula,
        // Kept in step for anything still reading the old column.
        markup_percent: orderFormula?.method === "markup" ? orderFormula.percent : null,
        notes: notes.trim() || null,
      },
      { onConflict: "order_id" }
    );

    setIsSaving(false);
    if (saveError) {
      console.error("Failed to save the cost sheet:", saveError);
      setError("Could not save. Your figures are still on screen — try again.");
      return;
    }

    setLines(keep);
    setSavedAt(new Date().toISOString());
    setIsDirty(false);
    notifySaved("Cost sheet saved");
  }, [lines, orderFormula, notes, orderId, shopId]);

  if (isLoading) {
    return (
      <div
        aria-hidden
        className="h-12 animate-pulse rounded-2xl bg-[color-mix(in_srgb,var(--fc-accent)_8%,transparent)]"
      />
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--fc-border)] bg-[var(--fc-panel)]">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-[background-color] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--fc-accent)_6%,transparent)]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold text-[var(--fc-text)]">{uiText("Cost sheet")}{isDirty ? (
              <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wider text-[var(--fc-ink-accent)]">{uiText("Unsaved")}</span>
            ) : null}
          </span>
          <span className="block text-xs text-[var(--fc-muted)]">
            {lines.length === 0 ? uiText("Work out what this job costs you. Only you can see it.") : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${formatPeso(total)}`}
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-xs font-bold text-[var(--fc-ink-accent)]">
          {isOpen ? uiText("Hide") : uiText("Open")}
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-[var(--fc-border)] p-4">
          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-xl border border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--fc-text)]"
            >
              {uiText(error)}
            </p>
          ) : null}

          {lines.length === 0 ? (
            <p className="mb-3 text-sm text-[var(--fc-muted)]">{uiText("Add what this piece costs you to build — timber, the days of work, varnish and the rest — and this stays with the order.")}</p>
          ) : null}

          {/* ---- the costs, by group ----
              The three usual groups are always offered, empty or not, so the
              sheet starts as Materials / Labour / Miscellaneous rather than a
              blank list. A group the shop made up shows once it has a line. */}
          <div className="space-y-3">
            {groups.map((group) => {
              const members = lines.filter((line) => (line.group || FALLBACK_COST_GROUP) === group);
              const subtotal = costTotal(members);
              const isDefault = (DEFAULT_COST_GROUPS as readonly string[]).includes(group);
              if (!members.length && !isDefault && !extraGroups.includes(group)) return null;
              return (
                <div key={group} className="rounded-xl border border-[var(--fc-border)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fc-ink-accent)]">{group}</h4>
                    <span className="text-xs font-semibold tabular-nums text-[var(--fc-muted)]">
                      {members.length ? formatPeso(subtotal) : "—"}
                    </span>
                  </div>

                  {members.length ? (
                    <div className="mt-2 space-y-2">
                      {members.map((line) => (
                        <div key={line.id} className="flex flex-wrap items-end gap-2">
                          <label className="grid min-w-0 flex-1 basis-40 gap-1">
                            <span className="sr-only">{uiText("Cost item")}</span>
                            <input
                              value={line.label}
                              onChange={(event) => updateLine(line.id, { label: event.target.value })}
                              placeholder={group === "Labour" ? uiText("e.g. 3 days, 2 carpenters") : uiText("e.g. Narra, 4 board feet")}
                              className="w-full rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-base text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none sm:text-sm"
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Qty")}</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={numberValue(line, "qty")}
                              onChange={(event) => editNumber(line.id, "qty", event.target.value)}
                              onBlur={() => settleNumber(line.id, "qty")}
                              className="w-14 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2 py-2 text-right text-base tabular-nums text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none sm:text-sm"
                            />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Unit ₱")}</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={numberValue(line, "unitCost")}
                              onChange={(event) => editNumber(line.id, "unitCost", event.target.value)}
                              onBlur={() => settleNumber(line.id, "unitCost")}
                              className="w-24 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2 py-2 text-right text-base tabular-nums text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none sm:text-sm"
                            />
                          </label>
                          <span className="w-20 shrink-0 pb-2 text-right text-sm font-semibold tabular-nums text-[var(--fc-text)]">
                            {formatPeso(lineTotal(line))}
                          </span>
                          {/* Moving a line is rare, so it is a small select rather
                              than a drag: the group a cost was typed under is
                              usually the right one. */}
                          <label className="grid gap-1">
                            <span className="sr-only">{uiText("Group for ")}{line.label || uiText("this line")}</span>
                            <select
                              value={line.group || FALLBACK_COST_GROUP}
                              onChange={(event) => updateLine(line.id, { group: event.target.value })}
                              className="max-w-[8.5rem] rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2 py-2 text-xs text-[var(--fc-muted)] focus:border-[var(--fc-ink-accent)] focus:outline-none [@media(pointer:coarse)]:min-h-11"
                            >
                              {groups.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            aria-label={uiText("Remove {0}", { 0: line.label || uiText("this line") })}
                            className="mb-1 shrink-0 rounded-full px-2 py-1.5 text-sm text-[var(--fc-muted)] transition-[color,transform] duration-150 ease-out hover:text-fc-danger active:scale-[0.97] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => addLine(group)}
                    className="mt-2 rounded-full border border-dashed border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-[background-color,border-color,transform] duration-150 ease-out hover:border-fc-ink-accent hover:text-[var(--fc-ink-accent)] active:scale-[0.97] [@media(pointer:coarse)]:min-h-11"
                  >{uiText("+ Add to ")}{group}
                  </button>
                </div>
              );
            })}

            {/* A group of the shop's own -- Delivery, Hardware, whatever its
                price is built from. */}
            {newGroup === null ? (
              <button
                type="button"
                onClick={() => setNewGroup("")}
                className="rounded-full border border-dashed border-[var(--fc-border)] px-3 py-1.5 text-xs font-semibold text-[var(--fc-muted)] transition-[background-color,border-color,transform] duration-150 ease-out hover:border-fc-ink-accent active:scale-[0.97] [@media(pointer:coarse)]:min-h-11"
              >{uiText("+ New group")}</button>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = newGroup.trim().slice(0, 40);
                  if (!name) return;
                  if (!groups.includes(name)) setExtraGroups((current) => [...current, name]);
                  addLine(name);
                  setNewGroup(null);
                }}
              >
                <input
                  autoFocus
                  value={newGroup}
                  onChange={(event) => setNewGroup(event.target.value)}
                  placeholder={uiText("e.g. Delivery")}
                  aria-label={uiText("New group name")}
                  className="min-w-0 flex-1 rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-base text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none sm:text-sm"
                />
                <button type="submit" className="btn btn-secondary btn-sm active:scale-[0.97]">{uiText("Add group")}</button>
                <button type="button" onClick={() => setNewGroup(null)} className="btn btn-secondary btn-sm active:scale-[0.97]">{uiText("Cancel")}</button>
              </form>
            )}
          </div>

          {/* ---- the totals ----
              Worked out here every render rather than stored, so nothing in
              this block can disagree with the lines above it. */}
          <dl className="mt-4 space-y-1.5 border-t border-[var(--fc-border)] pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="font-semibold text-[var(--fc-text)]">{uiText("What it costs you")}</dt>
              <dd className="font-bold tabular-nums text-[var(--fc-text)]">{formatPeso(total)}</dd>
            </div>

            {margin ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-[var(--fc-muted)]">{uiText("Quoted to the customer")}</dt>
                  <dd className="tabular-nums text-[var(--fc-text)]">{formatPeso(quotedTotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="font-semibold text-[var(--fc-text)]">
                    {margin.profit < 0 ? uiText("You would lose") : uiText("You keep")}
                  </dt>
                  <dd
                    className={`font-bold tabular-nums ${
                      margin.profit < 0 ? "text-fc-danger" : "text-[var(--fc-ink-accent)]"
                    }`}
                  >
                    {formatPeso(Math.abs(margin.profit))}
                    {margin.marginPercent == null ? null : (
                      <span className="ml-1.5 text-xs font-semibold text-[var(--fc-muted)]">
                        {margin.marginPercent.toFixed(1)}{uiText("% margin")}</span>
                    )}
                  </dd>
                </div>
                {margin.profit < 0 ? (
                  <p className="rounded-xl border border-fc-danger bg-[color-mix(in_srgb,var(--fc-danger)_8%,transparent)] px-3 py-2 text-xs leading-snug text-[var(--fc-text)]">{uiText("This job costs more than you quoted for it. The quote has already been sent, so changing it is a conversation with the customer, not an edit.")}</p>
                ) : null}
              </>
            ) : null}
          </dl>

          {/* ---- pricing ----
              The shop's own formula by default, said in its own terms; this
              order can be priced differently without touching the shop's. */}
          <div className="mt-3 rounded-xl border border-dashed border-[var(--fc-border)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("How you price")}</p>
                <p className="text-sm font-semibold text-[var(--fc-text)]">
                  {effectiveFormula ? describeFormula(effectiveFormula) : uiText("Not set yet")}
                  {effectiveFormula ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--fc-muted)]">
                      {orderFormula ? uiText("· this order only") : uiText("· your shop's formula")}
                    </span>
                  ) : null}
                </p>
              </div>
              {effectiveFormula && !showEditor ? (
                <button
                  type="button"
                  onClick={() => setIsEditingFormula(true)}
                  className="text-xs font-semibold text-[var(--fc-ink-accent)] hover:underline [@media(pointer:coarse)]:min-h-11"
                >
                  {shopPricing.formula ? uiText("Change for this order") : uiText("Change")}
                </button>
              ) : null}
            </div>

            {showEditor ? (
              <div className="mt-3">
                <PricingFormulaEditor
                  name={`formula-${orderId}`}
                  groups={groups}
                  value={formulaInEditor}
                  onChange={(next) => {
                    setOrderFormula(next);
                    // Stays open while it is being worked in: without this the
                    // first choice on a shop with no formula yet closed the
                    // editor before its multiplier could be typed.
                    setIsEditingFormula(true);
                    touch();
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {/* Setting it once for the shop is the point; this order is
                      just where the shop happened to be when it did. */}
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await shopPricing.save(formulaInEditor, shopPricing.view);
                      if (ok) {
                        setOrderFormula(null);
                        setIsEditingFormula(false);
                        touch();
                      }
                    }}
                    className="btn btn-secondary btn-sm active:scale-[0.97]"
                  >{uiText("Use for every order")}</button>
                  {shopPricing.formula ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOrderFormula(null);
                        setIsEditingFormula(false);
                        touch();
                      }}
                      className="btn btn-secondary btn-sm active:scale-[0.97]"
                    >{uiText("Back to shop formula")}</button>
                  ) : null}
                  {isEditingFormula && orderFormula ? (
                    <button
                      type="button"
                      onClick={() => setIsEditingFormula(false)}
                      className="btn btn-secondary btn-sm active:scale-[0.97]"
                    >{uiText("Done")}</button>
                  ) : null}
                </div>
                {shopPricing.error ? <p className="mt-2 text-xs text-fc-danger">{uiText(shopPricing.error)}</p> : null}
              </div>
            ) : null}

            {priced ? (
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-[var(--fc-border)] pt-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Suggested price")}</div>
                  <div className="text-lg font-bold tabular-nums text-[var(--fc-text)]">{formatPeso(priced.price)}</div>
                  {/* The sum the way it would be written on paper. */}
                  <div className="mt-0.5 break-words text-xs tabular-nums text-[var(--fc-muted)]">{priced.workingOut}</div>
                </div>
                {onUseAsQuote ? (
                  <button
                    type="button"
                    onClick={() => onUseAsQuote(priced.price, quoteLinesFromSheet(lines, priced, shopPricing.view))}
                    title={uiText("Fills the quote total and its breakdown. You can edit every line before sending.")}
                    className="rounded-full border border-fc-ink-accent px-4 py-2 text-xs font-bold text-[var(--fc-ink-accent)] transition-[background-color,transform] duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--fc-accent)_10%,transparent)] active:scale-[0.97] [@media(pointer:coarse)]:min-h-11"
                  >{uiText("Use as quote")}</button>
                ) : null}
              </div>
            ) : effectiveFormula ? (
              <p className="mt-2 text-xs text-[var(--fc-muted)]">{uiText("Add your costs above and the price works itself out.")}</p>
            ) : null}
          </div>

          <label className="mt-3 grid gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--fc-muted)]">{uiText("Notes to yourself")}</span>
            <textarea
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                touch();
              }}
              rows={2}
              placeholder={uiText("Supplier, offcuts left over, anything you want to remember next time.")}
              className="w-full resize-y rounded-xl border border-[var(--fc-border)] bg-[var(--fc-bg)] px-3 py-2 text-base text-[var(--fc-text)] focus:border-[var(--fc-ink-accent)] focus:outline-none sm:text-sm"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--fc-muted)]">
              {savedAt ? uiText("Saved {0}", { 0: new Date(savedAt).toLocaleString(uiLocale) }) : uiText("Not saved yet — this stays with the order once you do.")}
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !isDirty}
              className="rounded-full bg-fc-btn px-5 py-2 [@media(pointer:coarse)]:min-h-11 text-sm font-bold text-fc-btn-fg transition-[background-color,transform] duration-150 ease-out hover:bg-fc-btn-hover active:scale-[0.97] disabled:opacity-40"
            >
              {isSaving ? uiText("Saving…") : isDirty ? uiText("Save cost sheet") : uiText("Saved")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
