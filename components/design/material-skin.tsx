import type { CSSProperties, ReactNode } from "react";
import type { MaterialProfile } from "./studio/materials-db";

/**
 * A material's skin: what its surface actually looks like, in a small box.
 *
 * The colour is always the finish's own hex, so a box never disagrees with
 * the order record or the blueprint. The surface on top of it comes from a
 * photograph of that material (public/textures/swatches; sources in that
 * folder's README):
 *
 * - A finish the 3D studio renders from its scan (albedo: true -- the
 *   hardwoods, bamboo, synthetic rattan, reeded cane) shows that same scan
 *   multiplied by its hex, which is what the renderer does, brightened by its
 *   gain where it has one.
 * - Every other finish shows the hex with its material's surface laid over it
 *   in a soft-light blend: the weave of a linen, the pores of a leather, the
 *   veins of a marble, the brushing on stainless. The photo is greyscale and
 *   centred on mid-grey, so the box still averages to the exact hex. A painted
 *   or stained colour on timber keeps the timber's grain, as in 3D.
 * - Polished metal and glass have no surface to photograph -- what they look
 *   like is what they reflect or let through -- so they get a reflection, and
 *   glass sits over a checker at its own opacity so how clear it is shows.
 */

type Skin = { image: string; size: number };

/** Surface photos by catalogue id. Colour variants resolve through their base. */
const DETAIL_BY_ID: Record<string, string> = {
  "cloth-abaca": "abaca",
  "cloth-canvas-natural": "canvas",
  "cloth-velvet-dove": "velvet",
  "cloth-velvet-pewter": "velvet",
  "cloth-vinyl-tan": "vinyl",
  "cloth-vinyl-black": "vinyl",
  "stone-carrara": "marble-white",
  "stone-romblon": "marble-romblon",
  "stone-black-granite": "granite",
  "stone-travertine": "travertine",
  "metal-brushed-nickel": "brushed-metal",
  "metal-stainless": "brushed-metal",
  "metal-aluminium": "brushed-metal",
  "metal-antique-brass": "antique-brass",
  "metal-matte-black": "powder-coat",
  "metal-powder-white": "powder-coat",
  "metal-powder-olive": "powder-coat",
  "metal-wrought-iron": "wrought-iron",
  "composite-carbon-twill": "carbon-twill",
  "composite-carbon-matte": "carbon-twill",
  "plastic-hdpe-marine": "plastic-smooth",
  "panel-mdf-white": "plastic-smooth",
  "panel-mdf-graphite": "plastic-smooth",
};

/** Mirror-bright finishes: their look is a reflection, not a texture. */
const POLISHED = new Set(["metal-brass", "metal-chrome", "metal-copper", "glass-mirror"]);

/** How large one tile of each surface is drawn, so a weave reads as a weave and a marble as a slab. */
const TILE_PX: Record<string, number> = {
  "fabric-weave": 48,
  canvas: 56,
  abaca: 72,
  velvet: 96,
  leather: 96,
  vinyl: 96,
  "marble-white": 160,
  "marble-romblon": 160,
  granite: 96,
  travertine: 140,
  "brushed-metal": 120,
  "antique-brass": 120,
  "powder-coat": 96,
  "wrought-iron": 120,
  "carbon-twill": 36,
  "plastic-fine": 96,
  "plastic-smooth": 120,
  "cane-weave": 56,
  "dark-wood": 120,
  bamboo: 120,
  "synthetic-rattan": 72,
  "reeded-cane": 72,
};

function surfaceOf(material: MaterialProfile): string | null {
  const id = material.baseMaterialId ?? material.id;
  if (DETAIL_BY_ID[id]) return DETAIL_BY_ID[id];
  if (material.pbr) return material.pbr;
  if (material.family === "Cane strand") return "cane-weave";
  if (material.family === "Moulded polymer") return "plastic-fine";
  if (material.family === "Outdoor polymer") return "plastic-smooth";
  if (material.type === "fabric") return "fabric-weave";
  if (material.type === "leather") return "leather";
  return null;
}

function skinOf(material: MaterialProfile): Skin | null {
  const surface = surfaceOf(material);
  if (!surface) return null;
  // The scan itself only where the 3D surface is the scan; otherwise the
  // material's surface over its own colour.
  const file = material.pbr && material.albedo && surface === material.pbr ? `${surface}.jpg` : `${surface}-detail.jpg`;
  return { image: `/textures/swatches/${file}`, size: TILE_PX[surface] ?? 96 };
}

/** The layered background that draws a material's skin. */
export function materialSkinStyle(material: MaterialProfile): CSSProperties {
  const id = material.baseMaterialId ?? material.id;
  const opacity = material.opacity ?? 1;

  if (material.type === "glass" || opacity < 1) {
    // The pane's own tint at its own opacity, over a checker, with a sheen.
    const tint = hexWithAlpha(material.hex, opacity);
    const ribs = id === "glass-reeded"
      ? "repeating-linear-gradient(90deg, rgba(255,255,255,0.35) 0 2px, rgba(0,0,0,0.08) 2px 5px, rgba(255,255,255,0) 5px 7px), "
      : "";
    if (POLISHED.has(id)) return polished(material.hex);
    return {
      backgroundImage: `${ribs}linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.25) 70%, rgba(255,255,255,0) 100%), linear-gradient(${tint}, ${tint}), repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%)`,
      backgroundSize: `${ribs ? "auto, " : ""}auto, auto, 10px 10px`,
    };
  }

  if (POLISHED.has(id)) return polished(material.hex);

  const skin = skinOf(material);
  if (!skin) return { backgroundColor: material.hex };
  const fromScan = skin.image.endsWith(`/${material.pbr}.jpg`);
  return {
    backgroundColor: material.hex,
    backgroundImage: `url(${skin.image})`,
    backgroundSize: `${skin.size}px`,
    backgroundRepeat: "repeat",
    backgroundBlendMode: fromScan ? "multiply" : "soft-light",
    // The renderer multiplies a gain over a scanned finish to lift it; the
    // swatch does the same rather than showing it darker than the piece.
    ...(fromScan && material.gain && material.gain !== 1 ? { filter: `brightness(${material.gain})` } : {}),
  };
}

function polished(hex: string): CSSProperties {
  return {
    backgroundColor: hex,
    backgroundImage:
      "linear-gradient(160deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.15) 28%, rgba(0,0,0,0.28) 52%, rgba(255,255,255,0.45) 72%, rgba(0,0,0,0.18) 100%)",
    backgroundBlendMode: "soft-light",
  };
}

function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The skin as a box, sized by the caller to match the colour boxes beside it.
 * The skin is its own layer so a gain's brightness never brightens what sits
 * on top of it, such as the selected tick.
 */
export function MaterialSkin({ material, className = "", children }: {
  material: MaterialProfile;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span aria-hidden="true" className={`relative block shrink-0 overflow-hidden rounded-lg border border-black/10 ${className}`}>
      <span className="absolute inset-0" style={materialSkinStyle(material)} />
      {children}
    </span>
  );
}
