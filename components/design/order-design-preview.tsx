"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wrench, ZoomIn, Armchair, Ruler } from "lucide-react";
import ImageLightbox from "@/components/design/image-lightbox";
import BlueprintDrawing from "@/components/design/blueprint-drawing";
import {
  resolveDesignItems,
  openItemInDesigner,
  canOpenInDesigner,
  type CadStateItem,
} from "@/components/design/design-state-utils";
import { quantityOf } from "@/components/design/studio/studio-design-state";
import { generateStudioBlueprintSvg } from "@/components/design/studio/studio-blueprint-svg";
import type { StudioDesignItem } from "@/components/design/studio/studio-design-state";
import LengthUnitPicker, { usePreferredLengthUnit } from "@/components/design/length-unit-picker";
import { formatLength, formatLengthValue, lengthUnitLabel } from "@/components/design/length-units";


type Props = {
  previewUrl?: string | null;
  cadState?: unknown;
  /** When provided, shows a button that loads this exact design into the live 3D designer. */
  openInDesigner?: { sourceId: string; displayName: string } | null;
};

function durabilityColor(value: number) {
  if (value > 88) return "#2ecc71";
  if (value > 70) return "#f1c40f";
  return "#e74c3c";
}

function qualityColor(value: number) {
  if (value > 88) return "#9b59b6";
  if (value > 70) return "#3498db";
  return "#95a5a6";
}

function formatStyleName(style: string) {
  return style
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type ItemPanelProps = {
  previewUrl?: string | null;
  item: CadStateItem | null;
  openInDesigner?: { sourceId: string; displayName: string } | null;
  /** Shown only when the design holds more than one piece. */
  heading?: string;
};

/**
 * One piece of a design: its render, its drawing and its specification.
 *
 * Extracted from the component below so an order holding a chair and a stool
 * prints two of these rather than silently showing only the chair. It takes a
 * resolved item rather than the raw cadState precisely so it cannot re-derive
 * "the first one" and undo that.
 */
function DesignItemPanel({ previewUrl, item, openInDesigner, heading }: ItemPanelProps) {
  const { t: uiText } = useUiLanguage();
  const router = useRouter();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  // Display only: cadState keeps every size in cm whatever is picked here. The
  // same choice drives the table below and the drawing, so the two can never
  // be read in different units side by side. See length-units.ts.
  const [unit, setUnit] = usePreferredLengthUnit();
  const unitLabel = lengthUnitLabel(unit);
  const cell = (cm: number | undefined) => (cm === undefined ? "-" : formatLengthValue(cm, unit));
  // Studio designs carry measured part boxes and get the dimensioned shop
  // drawing; legacy parametric designs keep the generator that can rebuild
  // their silhouette from shape names.
  const isStudioDesign = canOpenInDesigner(item);
  const studioBlueprint = useMemo(
    () => (isStudioDesign && item ? generateStudioBlueprintSvg(item as unknown as StudioDesignItem, { unit }) : ""),
    [isStudioDesign, item, unit]
  );

  if (!item && !previewUrl) {
    return <p className="text-sm text-[var(--fc-muted)]">{uiText("No design details available for this item.")}</p>;
  }

  // How many to build. This is the one number on the page a furniture shop cannot
  // afford to miss -- reading it as one chair when the order is six is the
  // difference between a delivery and a dispute -- so it is stated on its own
  // rather than folded into a price.
  const quantity = quantityOf(item);
  const dims = item?.dims ?? {};
  const parts = Object.keys(dims);
  const canShowBlueprint = Boolean(item && parts.length > 0);
  const materialNames = item?.materialNames ?? {};
  // Only the parts the customer actually had rebuilt appear here; a design
  // left as the model was drawn carries none, which is every order placed
  // before the studio could substitute shapes.
  const shapeNames = item?.shapeNames ?? {};
  const score = item?.score ?? null;
  const globalScale = item?.globalScale;

  const styleName = item?.shapes?.Seat ?? item?.config?.style;
  const leftArm = item?.isLeftArmVisible ?? item?.config?.leftArm;
  const rightArm = item?.isRightArmVisible ?? item?.config?.rightArm;
  const isRocking = item?.type === "rocking_chair" || item?.config?.isRocking;
  const hasFeatureInfo = styleName !== undefined || leftArm !== undefined || rightArm !== undefined;

  const seat = dims.Seat;
  const stackedHeight = (dims.Legs?.h ?? 0) + (dims.Seat?.h ?? 0) + (dims.Back?.h ?? 0) + (dims.Headrest?.h ?? 0);
  // A studio design carries the size the studio measured, and that is the only
  // height and width this page may quote for it. Summing part heights is how
  // the old chair designer estimated one; on a studio piece it adds a leg to a
  // back that the leg does not reach, and disagrees with the blueprint beside it.
  const overall = (item as unknown as Partial<StudioDesignItem> | null)?.studio?.measurement?.overall;

  // Only studio designs can be reopened; legacy ones stay read-only.
  const showOpenInDesigner = Boolean(openInDesigner && item && isStudioDesign);

  // The three numbers someone checks first, pulled from the same measured
  // boxes the table below prints in full. Height is the stack rather than any
  // one part, because that is what has to clear a table or a doorway.
  const quickSpecs = [
    overall
      ? { label: "Height", value: formatLength(overall.h, unit) }
      : stackedHeight > 0
        ? { label: "Height", value: formatLength(stackedHeight, unit) }
        : null,
    overall
      ? { label: "Width", value: formatLength(overall.w, unit) }
      : seat?.w !== undefined
        ? { label: "Seat width", value: formatLength(seat.w, unit) }
        : null,
    {
      label: "Finish",
      value: materialNames["Seat"] ?? materialNames[parts[0]] ?? "Custom finish",
    },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="space-y-4">
      {heading ? (
        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">
          {heading}
        </h3>
      ) : null}
      {/* Render and drawing together rather than behind a toggle. They answer
          different questions -- what it looks like, and what it measures -- and
          a customer checking a quote wants both at once, not one at a time. */}
      <div className={`grid gap-3 ${canShowBlueprint ? "lg:grid-cols-2" : ""}`}>
        <figure className="m-0">
          <figcaption className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">{uiText("3D render")}</figcaption>
          <div className="overflow-hidden rounded-2xl border border-[var(--fc-border)] bg-[rgba(0,0,0,0.04)]">
            {previewUrl ? (
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="group relative block w-full cursor-zoom-in"
                aria-label={uiText("Open design preview")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt={uiText("Design preview")} className="block h-56 w-full object-contain" />
                <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
                  <ZoomIn aria-hidden className="h-3.5 w-3.5" />{uiText(" View larger")}</span>
              </button>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 text-[var(--fc-muted)]">
                <Armchair aria-hidden className="h-8 w-8" />
                <span className="text-sm">{uiText("No preview image")}</span>
              </div>
            )}
          </div>
        </figure>

        {canShowBlueprint && item ? (
          <figure className="m-0">
            <figcaption className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--fc-muted)]">
              <Ruler aria-hidden className="h-3.5 w-3.5" />{uiText("Dimensioned drawing")}</figcaption>
            {isStudioDesign ? (
              <div
                className="h-56 w-full overflow-auto rounded-2xl border border-[var(--fc-border)] bg-white p-3 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: studioBlueprint }}
              />
            ) : (
              <div className="h-56 overflow-auto rounded-2xl border border-[var(--fc-border)] bg-white p-3">
                <BlueprintDrawing item={item} title={item.name} />
              </div>
            )}
          </figure>
        ) : null}
      </div>

      {/* Columns follow the count. A legacy design with no measured boxes has
          only a finish to report, and one chip stranded in a three-wide grid
          reads as two that failed to load. */}
      {quickSpecs.length ? (
        <dl
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${quickSpecs.length}, minmax(0, 1fr))` }}
        >
          {quickSpecs.map((spec) => (
            <div
              key={spec.label}
              className="rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.05)] px-3 py-2"
            >
              <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
                {uiText(spec.label)}
              </dt>
              <dd className="mt-0.5 truncate text-sm font-bold text-[var(--fc-text)]">{spec.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {isLightboxOpen && previewUrl ? (
        <ImageLightbox src={previewUrl} alt={uiText("Design preview")} onClose={() => setIsLightboxOpen(false)} />
      ) : null}

      {showOpenInDesigner ? (
        <button
          type="button"
          onClick={() => {
            if (!item || !openInDesigner) return;
            if (!openItemInDesigner(item, openInDesigner.displayName)) return;
            router.push("/customize-furniture");
          }}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-fc-ink-accent bg-[rgba(178,106,56,0.06)] px-4 py-2.5 text-sm font-semibold text-[var(--fc-ink-accent)] transition hover:bg-[rgba(178,106,56,0.12)]"
        >
          <Wrench aria-hidden className="h-4 w-4" />{uiText(" Open this design in the 3D Designer")}</button>
      ) : null}

      {score ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">
              <span>{uiText("Durability")}</span>
              <span className="text-[var(--fc-text)]">{score.durability}%</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-[rgba(0,0,0,0.08)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${score.durability}%`, background: durabilityColor(score.durability) }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.15em] text-[var(--fc-muted)]">
              <span>{uiText("Material Quality")}</span>
              <span className="text-[var(--fc-text)]">{score.quality}%</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-[rgba(0,0,0,0.08)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${score.quality}%`, background: qualityColor(score.quality) }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {parts.length > 0 ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-[var(--fc-text)]">{uiText("Dimension & Material Specifications")}{quantity > 1 ? (
                <span className="ml-2 rounded-full bg-[rgba(178,106,56,0.14)] px-2 py-0.5 text-xs font-bold text-[var(--fc-ink-accent)]">{uiText("Build ")}{quantity}{uiText(" identical")}</span>
              ) : null}
            </h4>
            <div className="flex items-center gap-3">
              {globalScale ? (
                <span className="text-xs text-[var(--fc-muted)]">{uiText("Scale: ")}{Math.round((globalScale.x ?? 1) * 100)}% / {Math.round((globalScale.y ?? 1) * 100)}% / {Math.round((globalScale.z ?? 1) * 100)}%
                </span>
              ) : null}
              <LengthUnitPicker value={unit} onChange={setUnit} variant="select" />
            </div>
          </div>

          <div className="mt-2 overflow-x-auto rounded-2xl border border-[var(--fc-border)]">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="bg-[rgba(178,106,56,0.06)] text-left text-xs uppercase tracking-[0.1em] text-[var(--fc-muted)]">
                  <th className="px-3 py-2.5 font-semibold">{uiText("Component Part")}</th>
                  <th className="px-3 py-2.5 font-semibold">{uiText("Material Used")}</th>
                  <th className="px-3 py-2.5 font-semibold">{uiText("Width (")}{unitLabel})</th>
                  <th className="px-3 py-2.5 font-semibold">{uiText("Height (")}{unitLabel})</th>
                  <th className="px-3 py-2.5 font-semibold">{uiText("Depth (")}{unitLabel})</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part, index) => {
                  const dim = dims[part] ?? {};
                  return (
                    <tr
                      key={part}
                      className={`border-t border-[var(--fc-border)] transition-colors hover:bg-[rgba(178,106,56,0.04)] ${index % 2 === 1 ? "bg-[rgba(178,106,56,0.02)]" : ""}`}
                    >
                      <td className="px-3 py-2.5 font-semibold text-[var(--fc-text)]">{part}</td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-full border border-[var(--fc-border)] bg-[rgba(178,106,56,0.08)] px-2 py-0.5 text-xs font-semibold text-[var(--fc-ink-accent)]">
                          {materialNames[part] ?? uiText("Custom Finish")}
                        </span>
                        {/* Under the finish rather than beside it: the shape is
                            a second fact about the same part, and a furniture shop
                            reading down this column wants the stock first. */}
                        {shapeNames[part] ? (
                          <span className="mt-1 block text-[11px] leading-snug text-[var(--fc-muted)]">
                            {shapeNames[part]}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--fc-text)]">{cell(dim.w)}</td>
                      <td className="px-3 py-2.5 text-[var(--fc-text)]">{cell(dim.h)}</td>
                      <td className="px-3 py-2.5 text-[var(--fc-text)]">{cell(dim.d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {overall ? (
        <p className="text-xs text-[var(--fc-muted)]">{uiText("Overall size, as measured in the studio: ")}{formatLength(overall.w, unit)} (W) × {formatLength(overall.h, unit)} (H) ×{" "}
          {formatLength(overall.d, unit)} (D).
        </p>
      ) : seat?.w !== undefined && seat.d !== undefined ? (
        <p className="text-xs text-[var(--fc-muted)]">{uiText("Overall footprint estimate: ")}{formatLength(seat.w, unit)} (W) x {formatLength(seat.d, unit)}{uiText(" (D), stacked height approx")}{" "}
          {formatLength(stackedHeight, unit)}.
        </p>
      ) : null}

      {hasFeatureInfo ? (
        <p className="text-xs text-[var(--fc-muted)]">{uiText("Design Features: Style: ")}{styleName ? formatStyleName(styleName) : uiText("Standard")}
          {leftArm !== undefined ? uiText(" | Left Arm: {0}", { 0: leftArm ? "Visible" : "Hidden" }) : ""}
          {rightArm !== undefined ? uiText(" | Right Arm: {0}", { 0: rightArm ? "Visible" : "Hidden" }) : ""}
          {isRocking ? uiText(" | Rocking Base") : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Everything a design describes.
 *
 * cad_state has always held an array; this is the component that stops taking
 * only its first entry. With one piece it renders exactly as it always did,
 * which is the point of landing it before anything can create a second.
 */
export default function OrderDesignPreview({ previewUrl, cadState, openInDesigner }: Props) {
  const items = useMemo(() => resolveDesignItems(cadState), [cadState]);

  // No parsable design, but possibly still a stored render to show.
  if (items.length === 0) {
    return <DesignItemPanel previewUrl={previewUrl} item={null} openInDesigner={openInDesigner} />;
  }

  return (
    <div className="space-y-8">
      {items.map((item, index) => (
        <DesignItemPanel
          key={item.id ?? index}
          // The stored render is a single image of the design as a whole, so it
          // sits with the first piece instead of being repeated under each one
          // as though every piece had been photographed.
          previewUrl={index === 0 ? previewUrl : null}
          item={item}
          // The studio opens one piece at a time, so a second button would be a
          // second control that did the same thing.
          openInDesigner={index === 0 ? openInDesigner : null}
          heading={
            items.length > 1
              ? `Piece ${index + 1} of ${items.length}${item.name ? ` — ${item.name}` : ""}`
              : undefined
          }
        />
      ))}
    </div>
  );
}
