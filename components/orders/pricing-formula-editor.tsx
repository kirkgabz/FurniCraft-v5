"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { DEFAULT_COST_GROUPS, type BreakdownView, type PricingFormula } from "@/components/orders/pricing";

/**
 * A number box that lets "1." and "" exist while being typed, and hands the
 * parent a number only when it is one. The cost sheet learned this the hard
 * way -- see its `drafts` note -- and a multiplier of "1.5" has the same
 * half-typed state on the way.
 */
function NumberBox({
  value,
  onCommit,
  label,
  prefix,
  suffix,
  min = 0,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
  prefix?: string;
  suffix?: string;
  min?: number;
}) {
  const { t: uiText } = useUiLanguage();
  const [text, setText] = useState(String(value));
  // An outside change (switching method, "back to shop formula") shows up here.
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="inline-flex items-center gap-1 rounded-lg border border-[var(--fc-border)] bg-[var(--fc-bg)] px-2 transition-colors focus-within:border-[var(--fc-accent)]">
      <span className="sr-only">{uiText(label)}</span>
      {prefix ? <span aria-hidden className="text-sm font-semibold text-[var(--fc-muted)]">{prefix}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9.]/g, "");
          setText(next);
          const number = Number(next);
          if (next !== "" && Number.isFinite(number) && number > min) onCommit(number);
        }}
        onBlur={() => setText(String(value))}
        className="w-14 bg-transparent py-1.5 text-right text-base font-bold tabular-nums text-[var(--fc-text)] outline-none sm:text-sm"
      />
      {suffix ? <span aria-hidden className="text-sm font-semibold text-[var(--fc-muted)]">{suffix}</span> : null}
    </label>
  );
}

const OPTION =
  "flex cursor-pointer gap-3 rounded-xl border p-3 transition-[border-color,background-color] duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--fc-accent)]";

/**
 * The three ways a shop can price, as a choice with its numbers inline.
 * `groups` is the sheet's groups (or the defaults, in settings): per-group
 * pricing lists one multiplier for each, and one for anything else.
 */
export function PricingFormulaEditor({
  value,
  onChange,
  groups = [...DEFAULT_COST_GROUPS],
  name,
}: {
  value: PricingFormula;
  onChange: (next: PricingFormula) => void;
  groups?: string[];
  /** Radio group name; unique per editor on the page. */
  name: string;
}) {
  const { t: uiText } = useUiLanguage();
  const percent = value.method === "markup" ? value.percent : value.method === "multiply" ? Math.round((value.factor - 1) * 10000) / 100 : 35;
  const factor = value.method === "multiply" ? value.factor : value.method === "markup" ? Math.round((1 + value.percent / 100) * 100) / 100 : 2;
  const factors = value.method === "per_group" ? value.factors : Object.fromEntries(groups.map((group) => [group, factor]));
  const otherFactor = value.method === "per_group" ? value.otherFactor : 1;
  const tone = (on: boolean) =>
    on ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_7%,transparent)]" : "border-[var(--fc-border)] hover:bg-[var(--fc-cane-soft)]";

  return (
    <div role="radiogroup" aria-label={uiText("How you price")} className="grid gap-2">
      <label className={`${OPTION} ${tone(value.method === "multiply")}`}>
        <input
          type="radio"
          name={name}
          checked={value.method === "multiply"}
          onChange={() => onChange({ method: "multiply", factor })}
          className="mt-1 accent-[var(--fc-accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{uiText("Multiply the cost")}</span>
          <span className="block text-xs text-[var(--fc-muted)]">{uiText("Add up materials, labour and the rest, then multiply. × 2 doubles it.")}</span>
          {value.method === "multiply" ? (
            <span className="mt-2 block">
              <NumberBox label={uiText("Multiplier")} prefix="×" value={value.factor} min={0} onCommit={(next) => onChange({ method: "multiply", factor: next })} />
            </span>
          ) : null}
        </span>
      </label>

      <label className={`${OPTION} ${tone(value.method === "markup")}`}>
        <input
          type="radio"
          name={name}
          checked={value.method === "markup"}
          onChange={() => onChange({ method: "markup", percent: Math.max(0, percent) })}
          className="mt-1 accent-[var(--fc-accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{uiText("Add a markup")}</span>
          <span className="block text-xs text-[var(--fc-muted)]">{uiText("A percentage on top of the whole cost.")}</span>
          {value.method === "markup" ? (
            <span className="mt-2 block">
              <NumberBox label={uiText("Markup percent")} suffix="%" value={value.percent} min={-1} onCommit={(next) => onChange({ method: "markup", percent: next })} />
            </span>
          ) : null}
        </span>
      </label>

      <label className={`${OPTION} ${tone(value.method === "per_group")}`}>
        <input
          type="radio"
          name={name}
          checked={value.method === "per_group"}
          onChange={() => onChange({ method: "per_group", factors, otherFactor })}
          className="mt-1 accent-[var(--fc-accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{uiText("Different per group")}</span>
          <span className="block text-xs text-[var(--fc-muted)]">{uiText("Each group at its own rate, like materials × 2 and labour at cost.")}</span>
          {value.method === "per_group" ? (
            <span className="mt-2 grid gap-1.5">
              {groups.map((group) => (
                <span key={group} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{group}</span>
                  <NumberBox
                    label={uiText("{0} multiplier", { 0: group })}
                    prefix="×"
                    value={value.factors[group] ?? value.otherFactor}
                    onCommit={(next) => onChange({ ...value, factors: { ...value.factors, [group]: next } })}
                  />
                </span>
              ))}
              <span className="flex items-center justify-between gap-2 text-sm text-[var(--fc-muted)]">
                <span>{uiText("Any other group")}</span>
                <NumberBox label={uiText("Other groups multiplier")} prefix="×" value={value.otherFactor} onCommit={(next) => onChange({ ...value, otherFactor: next })} />
              </span>
            </span>
          ) : null}
        </span>
      </label>
    </div>
  );
}

/** What the customer's breakdown lists when a quote is filled from the cost sheet. */
export function BreakdownViewPicker({
  value,
  onChange,
  name,
}: {
  value: BreakdownView;
  onChange: (next: BreakdownView) => void;
  name: string;
}) {
  const { t: uiText } = useUiLanguage();
  const option = (view: BreakdownView, title: string, hint: string) => (
    <label
      className={`${OPTION} ${
        value === view ? "border-[var(--fc-accent)] bg-[color-mix(in_srgb,var(--fc-accent)_7%,transparent)]" : "border-[var(--fc-border)] hover:bg-[var(--fc-cane-soft)]"
      }`}
    >
      <input type="radio" name={name} checked={value === view} onChange={() => onChange(view)} className="mt-1 accent-[var(--fc-accent)]" />
      <span>
        <span className="block text-sm font-semibold">{uiText(title)}</span>
        <span className="block text-xs text-[var(--fc-muted)]">{uiText(hint)}</span>
      </span>
    </label>
  );
  return (
    <div role="radiogroup" aria-label={uiText("What the customer sees")} className="grid gap-2 sm:grid-cols-2">
      {option("groups", "Each group's total", "Materials ₱8,000 · Labour ₱4,200 · Miscellaneous ₱800")}
      {option("lines", "Every line", "Narra board × 4 ₱6,800 · Cane webbing ₱1,200 · …")}
    </div>
  );
}
