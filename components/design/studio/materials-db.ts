import type { Surface } from "./studio-config";
import { MATERIAL_COLORS, type MaterialColorCategory } from "./material-colors";

/**
 * The finishes a piece can be built in, as profiles rather than colours.
 *
 * A swatch used to be `{ name, hex }` -- enough to tint the model and nothing
 * else. Three separate features all needed the same missing facts: a shop
 * restricting a template to what it actually stocks, a customer being told
 * which finish survives a dog, and the renderer knowing that leather is glossy
 * and linen is not. So the swatch grew into a profile and those features read
 * from one table instead of three.
 *
 * `hex` stays, and stays load-bearing. It multiplies the model's own baseColor,
 * so it is what the piece looks like before any texture has downloaded, what it
 * looks like if a texture 404s, and what the blueprint and order records use.
 * A profile without `pbr` is not a lesser material -- it is a tint, which is
 * what most wood finishes on a grained model already are.
 *
 * Ids are stored in design_templates.allowed_materials and inside saved
 * designs, so they are permanent: rename a `name`, never an `id`.
 */

export type MaterialTag =
  | "pet-friendly"
  | "kid-friendly"
  | "outdoor"
  | "stain-resistant"
  | "easy-clean"
  | "waterproof"
  | "premium"
  | "budget"
  | "warm"
  | "formal"
  | "modern";

export type MaterialProfile = {
  id: string;
  name: string;
  /** A colored finish retains the stock material's identity and compatibility. */
  baseMaterialId?: string;
  colorName?: string;
  colorCategory?: MaterialColorCategory;
  /** Which swatch list it belongs to; matches PartDef.surface. */
  surface: Surface;
  type: "wood" | "rattan" | "fabric" | "leather" | "metal" | "glass" | "stone" | "plastic";
  /**
   * The heading this finish is listed under.
   *
   * Every finish has one now. It was optional while each surface carried an
   * "Original" -- an untinted "as photographed" entry that belonged to no
   * stock in particular and sorted above the groups. Those are gone: a
   * customer picks stock a furniture shop can buy, and "as shown" is not stock.
   * Fourteen finishes in one flat column is a wall; four groups of three or
   * four is a list somebody can read.
   */
  family?: string;
  /** Multiplied over the model's own baseColor. Also the pre-texture fallback. */
  hex: string;
  /** Folder under /textures. Absent means this finish is a tint only. */
  pbr?: string;
  /**
   * Whether a finish keeps the model's own photographed pattern under its
   * tint, the way a wood stain keeps the grain showing through it. A painted
   * finish can retain PBR relief while dropping the photographed color.
   *
   * True by default, which is right for wood, cane and rattan: the grain or
   * weave is the point, and a stain over it is exactly the effect wanted. A
   * named fabric or leather colour has no grain to preserve -- "Royal blue"
   * promises a flat, even colour, not a tint of whatever the scan happened to
   * look like -- and multiplying a hex over the model's own baked shading
   * only ever darkens it further, ruinously wherever the bake itself already
   * runs dark. The Victorian chair's back cushion is baked roughly half as
   * bright as its seat cushion (measured off cloth_baseColor.png), which is
   * why every fabric swatch there used to crush toward the same near-black
   * regardless of which one was picked. Fabric and leather finishes set this
   * to false and drop the scan entirely, rendering as the flat colour their
   * names promise.
   */
  keepsScanPattern?: boolean;
  /**
   * Whether to take the folder's scanned colour as well as its relief.
   *
   * Off by default, and that default is the interesting case: a pale finish
   * over a dark scan wants the grain but not the colour, because multiplying a
   * dark albedo by a pale hex gives dark wood in a pale hat. Those finishes
   * keep the model's own photographed baseColor and take only the relief.
   */
  albedo?: boolean;
  /**
   * Brightness applied on top of `hex`, for finishes paler than the scan.
   *
   * A tint multiplies, and multiplying can only darken -- which is why
   * a pale timber over a dark scan came out the same mid-brown as Original
   * however pale its hex was. Values above 1 lift the surface instead, and
   * the renderer's ACES tone mapping rolls the highlights off rather than
   * clipping them. `hex` is left alone: it is what the blueprint, the order
   * record and the swatch dot use, and those want the finish's colour, not
   * the exposure needed to fake it.
   */
  gain?: number;
  /**
   * How many times the map repeats across the piece. Grain that is too large
   * reads as a blur and too small as noise; these are per-material because a
   * leather pore and a plank of oak are nothing like the same size.
   */
  repeat?: number;
  /**
   * The repeat along the second axis, when the grain is directional. Timber is
   * not isotropic -- the figure runs the length of a rail -- and repeating it
   * as often across the width as along the length turns a plank into a
   * chequerboard. Defaults to the value of repeat.
   */
  repeatY?: number;
  /** 0-1, fed to MeshStandardMaterial.roughness when no roughness map exists. */
  roughness?: number;
  /**
   * 0-1. Almost always 0 -- timber, cane and cloth are dielectrics. It exists
   * for coated and bronzed strand finishes, where the sheen is a metal powder
   * in the lacquer and a dielectric highlight cannot imitate it.
   */
  metalness?: number;
  /**
   * 0-1, fed to MeshPhysicalMaterial.opacity; sets `.transparent` alongside
   * it whenever this is below 1. Absent for every surface except glass --
   * timber, cane and fabric are opaque by construction, so leaving this
   * unset there just means "whatever the model's own source material
   * shipped with", the same convention `pbr` and `keepsScanPattern` use.
   * A pane of glass, unlike a plank of wood, has no scanned relief to swap
   * in for "Frosted" versus "Clear" -- opacity and roughness are the whole
   * finish, which is why every glass entry below sets this explicitly.
   */
  opacity?: number;
  /**
   * Whether this stock can hold a carved relief. Absent means yes.
   *
   * A manufacturing fact, not a rendering one: carving is subtractive, so it
   * needs a dense solid to cut into. A woven panel has nothing to cut -- the
   * cut would fall between the strands -- and bamboo splits along its fibre
   * rather than holding an edge. The studio removes the carvings instead of
   * quietly rendering ones no furniture shop could produce.
   */
  carvable?: boolean;
  tags: MaterialTag[];
  /** 1-10. Resistance to daily punishment: claws, dragging, knocks. */
  durability: number;
  /** 1-10, where 10 is fussiest. Deliberately not "quality": a silk is not worse than a vinyl, it is more work. */
  maintenance: number;
  blurb: string;
};

/**
 * The second tier: what a surface is sealed with, as opposed to what it is
 * made of.
 *
 * A material and its varnish are genuinely independent choices -- the same cane
 * can be left raw or lacquered, and the same walnut waxed or sprayed -- so they
 * are two selections rather than a combinatorial list of finishes. Physically
 * they act on different things, which is why this is not just "more roughness":
 * a seal is a second surface over the first, so it gets a clearcoat lobe.
 * Without one, gloss can only be faked by making the timber itself mirror-like,
 * which reads as plastic rather than as lacquered wood.
 *
 * roughnessScale multiplies the material's own roughness rather than replacing
 * it, so a naturally coarse weave stays coarser than a planed board under the
 * same varnish.
 */
export type VarnishId = "raw" | "wax" | "satin" | "lacquer";

export type Varnish = {
  id: VarnishId;
  name: string;
  /** Short enough to sit under a swatch row. */
  blurb: string;
  roughnessScale: number;
  /** 0-1. Strength of the second, sealed reflection. */
  clearcoat: number;
  clearcoatRoughness: number;
};

export const VARNISHES: Varnish[] = [
  {
    id: "raw",
    name: "Raw / oiled",
    blurb: "No film. The grain is open and the surface is dead matte.",
    roughnessScale: 1.05,
    clearcoat: 0,
    clearcoatRoughness: 1,
  },
  {
    id: "wax",
    name: "Hand-rubbed wax",
    blurb: "A soft sheen that shows the timber rather than the finish.",
    roughnessScale: 0.92,
    clearcoat: 0.18,
    clearcoatRoughness: 0.7,
  },
  {
    id: "satin",
    name: "Satin polyurethane",
    blurb: "A sealed film with a low sheen. The usual choice for daily use.",
    roughnessScale: 0.72,
    clearcoat: 0.55,
    clearcoatRoughness: 0.32,
  },
  {
    id: "lacquer",
    name: "High-gloss lacquer",
    blurb: "A mirror coat. Shows every reflection, and every fingerprint.",
    roughnessScale: 0.42,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  },
];

/** Only timber and natural cane accept the wood finishing treatments offered here. */
export function supportsVarnish(material: MaterialProfile | null | undefined): boolean {
  return material?.type === "wood" || material?.family === "Cane strand" || material?.family === "Reeded cane";
}

/** Unsupported finishes retain their catalogue roughness and have no clearcoat. */
export function varnishForMaterial(material: MaterialProfile, varnish?: Varnish): Varnish {
  return supportsVarnish(material) ? varnish ?? varnishById(null) : {
    id: "raw", name: "Catalogue finish", blurb: "The material's supplied finish.",
    roughnessScale: 1, clearcoat: 0, clearcoatRoughness: 1,
  };
}

export const DEFAULT_VARNISH_ID: VarnishId = "raw";

const VARNISH_BY_ID = new Map(VARNISHES.map((v) => [v.id, v]));

export function varnishById(id: string | null | undefined): Varnish {
  return (id && VARNISH_BY_ID.get(id as VarnishId)) || VARNISH_BY_ID.get(DEFAULT_VARNISH_ID)!;
}

const BASE_MATERIALS: MaterialProfile[] = [
  // ------------------------------------------------------------------ wood
  //
  // Every wood finish here draws its relief from the same scan. That is not a
  // shortcut: it is one plank of real timber, and what separates walnut from
  // ebony on a real piece is the stain over that grain, not a different grain.
  // The finishes that also take `albedo` replace the model's own baseColor
  // with the scan; the pale ones deliberately do not, because tinting a dark
  // scan pale gives dark wood in a pale hat rather than pale wood.
  /* ------------------------------------------------ Philippine solid timber

   Sixteen species, and only species a shop on these islands can actually
   buy. The catalogue used to open with honey oak, walnut, ebony and a
   whitewash, which are the finishes a furniture app is expected to have
   and not the ones this one is for: a Philippine furniture shop quoting a narra
   dining table does not keep American walnut in the rack, and offering it
   invites an order nobody can fill.

   Grouped as hardwood, plantation timber and softwood, because that is the
   first question a furniture shop asks about a board -- how hard is it, and can
   it carry load -- and because the three groups are priced on completely
   different footings. The engineering numbers behind each one live in
   stock-properties.ts, which is what the design analysis reasons about. */
  {
    id: "wood-narra",
    name: "Narra",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#e0a878",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.55,
    tags: ["premium", "warm", "formal"],
    durability: 9,
    maintenance: 4,
    blurb: "The national timber: golden red, hard, and figured enough to be worth showing. Priced accordingly.",
  },
  {
    id: "wood-molave",
    name: "Molave",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#cfa45e",
    pbr: "dark-wood",
    gain: 1.5,
    repeat: 2,
    repeatY: 1,
    roughness: 0.5,
    tags: ["premium", "warm", "outdoor"],
    durability: 10,
    maintenance: 3,
    blurb: "Yellow-brown and nearly indestructible. Traditionally the timber for pieces meant to outlast their owner.",
  },
  {
    id: "wood-kamagong",
    name: "Kamagong",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#5f5854",
    pbr: "dark-wood",
    albedo: true,
    // Tight, like the ebony above and for the same reason: kamagong's figure
    // is nearly invisible, and shrinking the grain is what stops it reading
    // as a walnut standing in shadow.
    repeat: 3.2,
    repeatY: 1.6,
    roughness: 0.42,
    tags: ["premium", "formal", "modern"],
    durability: 10,
    maintenance: 6,
    blurb: "Philippine ebony, streaked near-black. Protected and scarce, so expect to be quoted per piece.",
  },
  {
    id: "wood-tanguile",
    name: "Tanguile",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#d99274",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.6,
    tags: ["warm", "formal"],
    durability: 7,
    maintenance: 4,
    blurb: "Sold as Philippine mahogany. Red-brown, straight-grained and the usual choice for good cabinetwork.",
  },
  {
    id: "wood-yakal",
    name: "Yakal",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#b07a55",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.55,
    tags: ["premium", "outdoor"],
    durability: 10,
    maintenance: 4,
    blurb: "A structural timber pressed into furniture. Very heavy, very dark, and hard on tools and hinges alike.",
  },
  {
    id: "wood-ipil",
    name: "Ipil",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#a5714a",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.55,
    tags: ["premium", "formal", "outdoor"],
    durability: 9,
    maintenance: 4,
    blurb: "Deep brown and very stable. Darkens further with age, which is either the point or a surprise.",
  },
  {
    id: "wood-lanete",
    name: "Lanete",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#e7d7b6",
    pbr: "dark-wood",
    // Pale over a dark scan, so the grain is taken and the colour is not --
    // see `albedo`. Tiled tighter than a plank because lanete's whole point
    // is that it has almost no figure to show.
    gain: 2.1,
    repeat: 2.4,
    repeatY: 1.2,
    roughness: 0.7,
    tags: ["premium", "formal"],
    durability: 6,
    maintenance: 4,
    blurb: "The carver's timber: pale, close-grained and even, so it holds fine detail where a coarser wood tears.",
  },
  {
    id: "wood-calantas",
    name: "Calantas",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#c38154",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.68,
    tags: ["warm", "formal"],
    durability: 6,
    maintenance: 4,
    blurb: "Philippine cedar — light, aromatic and insect-resistant, which is why it lines chests and drawers.",
  },
  {
    id: "wood-dao",
    name: "Dao",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#a98a6c",
    pbr: "dark-wood",
    albedo: true,
    // Wide tiling, for the reason acacia has it: dao is bought for the
    // streaked heart, and tiling it tightly hides what is being paid for.
    repeat: 1.7,
    repeatY: 0.85,
    roughness: 0.62,
    tags: ["warm", "modern"],
    durability: 7,
    maintenance: 4,
    blurb: "Grey-brown with a dark streaked heart, and cut wide — the usual answer when a top has to be one board.",
  },
  {
    id: "wood-katmon",
    name: "Katmon",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#a86a4c",
    pbr: "dark-wood",
    albedo: true,
    repeat: 2.2,
    repeatY: 1.1,
    roughness: 0.6,
    tags: ["warm", "formal"],
    durability: 8,
    maintenance: 4,
    blurb: "Red-brown and firm under the tool. Less common than lauan, and steadier once it is properly dry.",
  },
  {
    id: "wood-bayok",
    name: "Bayok",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#d6b795",
    pbr: "dark-wood",
    gain: 1.7,
    repeat: 2,
    repeatY: 1,
    roughness: 0.72,
    tags: ["budget", "warm"],
    durability: 6,
    maintenance: 4,
    blurb: "Light, pale and easy to work. A secondary timber: rails, frames, and the parts nobody sees.",
  },
  {
    id: "wood-bayanti",
    name: "Bayanti",
    family: "Hardwood",
    surface: "wood",
    type: "wood",
    hex: "#caa47f",
    pbr: "dark-wood",
    gain: 1.5,
    repeat: 2,
    repeatY: 1,
    roughness: 0.7,
    tags: ["budget", "warm"],
    durability: 6,
    maintenance: 4,
    // The blurb says "confirm it with the shop" on purpose. Bayanti is a
    // regional trade name rather than a nationally traded grade, so unlike
    // narra or yakal there is no single stock a furniture shop can be assumed to
    // have. Offering it silently would let a customer specify something their
    // shop cannot source.
    blurb: "A local secondary hardwood, mid-weight and plain. Supply is regional — confirm it with the shop before specifying it.",
  },
  {
    id: "wood-gmelina",
    name: "Gmelina",
    family: "Plantation timber",
    surface: "wood",
    type: "wood",
    hex: "#ddc290",
    pbr: "dark-wood",
    gain: 1.9,
    repeat: 2,
    repeatY: 1,
    roughness: 0.78,
    tags: ["budget", "kid-friendly"],
    durability: 5,
    maintenance: 4,
    blurb: "Pale, light and inexpensive. Fine for a bedroom piece; it dents where a dining table would not.",
  },
  {
    id: "wood-acacia",
    name: "Acacia",
    family: "Plantation timber",
    surface: "wood",
    type: "wood",
    hex: "#c99568",
    pbr: "dark-wood",
    albedo: true,
    // Wider than the others: acacia is bought for its figure, and tiling it
    // as tightly as a straight-grained lauan hides the very thing being paid
    // for.
    repeat: 1.6,
    repeatY: 0.8,
    roughness: 0.6,
    tags: ["warm", "modern"],
    durability: 8,
    maintenance: 4,
    blurb: "Wildly varied colour from board to board, which is why it is usually left wide and live-edged.",
  },
  {
    id: "wood-benguet-pine",
    name: "Benguet pine",
    family: "Softwood",
    surface: "wood",
    type: "wood",
    hex: "#ddbd8a",
    pbr: "dark-wood",
    gain: 1.85,
    repeat: 2.2,
    repeatY: 1.1,
    roughness: 0.75,
    tags: ["budget", "warm"],
    durability: 5,
    maintenance: 5,
    blurb: "The Cordillera pine: pale, knotty and resinous. Wants a sealer, or the resin bleeds through the finish.",
  },
  {
    id: "wood-almaciga",
    name: "Almaciga",
    family: "Softwood",
    surface: "wood",
    type: "wood",
    hex: "#e4d2ad",
    pbr: "dark-wood",
    gain: 2.0,
    repeat: 2.4,
    repeatY: 1.2,
    roughness: 0.74,
    tags: ["budget", "modern"],
    durability: 5,
    maintenance: 5,
    blurb: "Pale straw and very even. Soft for furniture, so it is kept to panels and to work that will be painted.",
  },
  {
    id: "panel-marine-ply",
    name: "Marine plywood",
    family: "Engineered panel",
    surface: "wood",
    type: "wood",
    hex: "#d8b98a",
    pbr: "dark-wood",
    gain: 1.6,
    repeat: 2,
    repeatY: 1,
    roughness: 0.8,
    tags: ["budget", "waterproof"],
    durability: 6,
    maintenance: 4,
    blurb: "Waterproof-glued rather than waterproof. Stable in humidity, which is why kitchens are built from it.",
    carvable: false,
  },
  {
    // The id still says oak and the name no longer does, deliberately. A
    // stored design points at the id, so renaming it would orphan every
    // design already finished in this board -- whereas the NAME was the last
    // oak left in a catalogue that is otherwise Philippine stock, and a
    // printed film is not a species in any case.
    id: "panel-laminate-oak",
    name: "Wood-grain laminate",
    family: "Engineered panel",
    surface: "wood",
    type: "wood",
    hex: "#dcb47f",
    pbr: "dark-wood",
    gain: 1.8,
    repeat: 2,
    repeatY: 1,
    // Low, because a laminate is a printed film under a sealed wear layer --
    // the sheen belongs to the coating, not to timber, and it is flatter and
    // more even than any real finish over real grain.
    roughness: 0.35,
    tags: ["budget", "easy-clean", "stain-resistant"],
    durability: 6,
    maintenance: 2,
    blurb: "A printed timber face under a hard wear layer. Wipes clean and never needs refinishing; cannot be sanded either.",
    carvable: false,
  },
  {
    id: "panel-mdf-white",
    name: "White painted MDF",
    family: "Engineered panel",
    surface: "wood",
    type: "wood",
    hex: "#eceae5",
    // No scan kept under it: a sprayed panel is a flat colour by definition,
    // and letting the timber grain show through would be showing the customer
    // a finish the furniture shop is not offering.
    keepsScanPattern: false,
    roughness: 0.6,
    tags: ["modern", "budget", "easy-clean", "kid-friendly"],
    durability: 5,
    maintenance: 3,
    blurb: "Sprayed flat with no grain at all. Chips at the corners, and a chip shows the brown board underneath.",
    carvable: false,
  },
  {
    id: "panel-mdf-graphite",
    name: "Graphite painted MDF",
    family: "Engineered panel",
    surface: "wood",
    type: "wood",
    hex: "#3a3d40",
    keepsScanPattern: false,
    roughness: 0.55,
    tags: ["modern", "easy-clean"],
    durability: 5,
    maintenance: 4,
    blurb: "The same sprayed panel in dark grey. Reads as a solid block of colour, and shows dust doing it.",
    carvable: false,
  },

  // ------------------------------------------------- bamboo and all-weather
  //
  // Two supplied scans, and only one of them is a weave.
  //
  // The set labelled as cane is not cane: it is vertical-grain bamboo, fine
  // parallel strands with no basket pattern at all. It is named for what it is,
  // because a customer who orders "natural cane" and is sent a bamboo-faced
  // panel has been misled by us, not by the supplier. It is a wood and behaves
  // like one, so its grain runs along a part the way the hardwoods' does.
  //
  // The all-weather set is a real woven polymer, and nearly black
  // (mean 0.15/0.13/0.12) because outdoor rattan is dyed dark so it will not
  // fade. Its paler colourways therefore need `gain` to lift the scan; tinting
  // could only take it further down.
  {
    id: "bamboo-natural",
    name: "Natural bamboo",
    family: "Bamboo",
    surface: "wood",
    type: "wood",
    hex: "#ffffff",
    pbr: "bamboo",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.8,
    tags: ["warm", "budget", "modern"],
    durability: 6,
    maintenance: 5,
    blurb: "Fine vertical grain, pale and warm. Light and cheap, and dents more easily than a hardwood.",
    carvable: false,
  },
  {
    id: "bamboo-honey",
    name: "Honey bamboo",
    family: "Bamboo",
    surface: "wood",
    type: "wood",
    hex: "#f0c079",
    pbr: "bamboo",
    albedo: true,
    gain: 1.35,
    repeat: 2,
    repeatY: 1,
    roughness: 0.74,
    tags: ["warm", "budget"],
    durability: 6,
    maintenance: 5,
    blurb: "Bamboo under an amber varnish. The strands read as gold rather than straw.",
    carvable: false,
  },
  {
    id: "bamboo-charcoal",
    name: "Smoked bamboo",
    family: "Bamboo",
    surface: "wood",
    type: "wood",
    hex: "#5a544c",
    pbr: "bamboo",
    albedo: true,
    repeat: 2,
    repeatY: 1,
    roughness: 0.76,
    tags: ["modern", "formal"],
    durability: 6,
    maintenance: 4,
    blurb: "Carbonised near to black. The grain survives the stain, and so do most marks.",
    carvable: false,
  },
  {
    id: "bamboo-bleached",
    name: "Bleached bamboo",
    family: "Bamboo",
    surface: "wood",
    type: "wood",
    hex: "#f4efe6",
    pbr: "bamboo",
    albedo: true,
    gain: 1.5,
    repeat: 2,
    repeatY: 1,
    roughness: 0.84,
    tags: ["modern", "kid-friendly", "budget"],
    durability: 5,
    maintenance: 6,
    blurb: "Coastal and airy. The palest finish here, and the quickest to show a scuff.",
    carvable: false,
  },
  // --------------------------------------------------------------- cane
  //
  // For weaves that exist in the mesh rather than in a texture. These carry no
  // albedo map at all, and that is the entire point: the caned armchair's seat
  // is 401 separately modelled strands, so a cross-weave image laid over it
  // prints a second weave across the first and reads as dirt. The geometry
  // already supplies every bit of pattern this surface needs, so a finish here
  // is a colour and a sheen and nothing more.
  {
    id: "cane-honey",
    name: "Natural honey",
    family: "Cane strand",
    surface: "cane",
    type: "rattan",
    hex: "#e8b96f",
    roughness: 0.62,
    tags: ["warm", "premium"],
    durability: 6,
    maintenance: 5,
    blurb: "Cane left close to its own colour. Warm, and the most traditional of these.",
    carvable: false,
  },
  {
    id: "cane-bleached",
    name: "Bleached",
    family: "Cane strand",
    surface: "cane",
    type: "rattan",
    hex: "#f2e7d4",
    gain: 1.2,
    roughness: 0.7,
    tags: ["modern", "kid-friendly"],
    durability: 5,
    maintenance: 6,
    blurb: "Pale and coastal. Shows a mark sooner than any other finish here.",
    carvable: false,
  },
  {
    id: "cane-espresso",
    name: "Espresso stain",
    family: "Cane strand",
    surface: "cane",
    type: "rattan",
    hex: "#6b4a30",
    roughness: 0.55,
    tags: ["formal", "warm", "stain-resistant"],
    durability: 6,
    maintenance: 4,
    blurb: "Dark stained cane. Hides handling marks along the strands.",
    carvable: false,
  },
  {
    id: "cane-black",
    name: "Matte black coated",
    family: "Cane strand",
    surface: "cane",
    type: "rattan",
    hex: "#3a3733",
    roughness: 0.78,
    tags: ["modern", "formal", "easy-clean"],
    durability: 7,
    maintenance: 3,
    blurb: "A sprayed coat over the weave. Flat, graphic, and wipes clean.",
    carvable: false,
  },
  {
    id: "cane-bronze",
    name: "Bronze metallic",
    family: "Cane strand",
    surface: "cane",
    type: "rattan",
    hex: "#b08341",
    roughness: 0.34,
    metalness: 0.55,
    tags: ["premium", "modern", "easy-clean"],
    durability: 7,
    maintenance: 4,
    blurb: "Metal powder in the lacquer, so each strand catches the light along its length.",
    carvable: false,
  },

  // ------------------------------------------------------------- rattan
  //
  // Its own palette, because a weave and a plank are not interchangeable: you
  // cannot build a turned leg out of woven strands, and you cannot weave a seat
  // panel out of solid timber. Parts declare which of the two they are, and
  // this list is only ever offered to the woven ones.
  //
  // The map is the patio armchair's own basket weave, so the material a
  // customer picks and the model they picked it on are the same weave. Its mean
  // luminance is 0.322, which is why these gains are far lower than they were
  // against the near-black scan this replaced -- a gain tuned for one map is
  // meaningless against another.
  {
    id: "synth-slate",
    name: "Slate",
    family: "Synthetic rattan",
    surface: "rattan",
    type: "rattan",
    hex: "#8a8d90",
    pbr: "synthetic-rattan",
    albedo: true,
    repeat: 5,
    roughness: 0.6,
    tags: ["outdoor", "waterproof", "pet-friendly", "easy-clean", "stain-resistant", "modern"],
    durability: 9,
    maintenance: 2,
    blurb: "Woven polymer over an alloy frame. Rain, chlorine and claws all leave it alone.",
    carvable: false,
  },
  {
    id: "synth-espresso",
    name: "Espresso",
    family: "Synthetic rattan",
    surface: "rattan",
    type: "rattan",
    hex: "#c99a70",
    pbr: "synthetic-rattan",
    albedo: true,
    repeat: 5,
    roughness: 0.6,
    tags: ["outdoor", "waterproof", "pet-friendly", "easy-clean", "stain-resistant", "warm"],
    durability: 9,
    maintenance: 2,
    blurb: "The same weather-proof weave in a warm brown, for a patio meant to read as timber.",
    carvable: false,
  },
  {
    id: "synth-ash",
    name: "Ash grey",
    family: "Synthetic rattan",
    surface: "rattan",
    type: "rattan",
    hex: "#e2e6ea",
    pbr: "synthetic-rattan",
    albedo: true,
    gain: 1.3,
    repeat: 5,
    roughness: 0.62,
    tags: ["outdoor", "waterproof", "pet-friendly", "easy-clean", "stain-resistant", "modern"],
    durability: 9,
    maintenance: 2,
    blurb: "Pale grey, and the coolest of the outdoor weaves. Hides dust between cleans.",
    carvable: false,
  },
  {
    id: "synth-sandstone",
    name: "Sandstone",
    family: "Synthetic rattan",
    surface: "rattan",
    type: "rattan",
    hex: "#e8c48d",
    pbr: "synthetic-rattan",
    albedo: true,
    gain: 1.3,
    repeat: 5,
    roughness: 0.62,
    tags: ["outdoor", "waterproof", "pet-friendly", "easy-clean", "stain-resistant", "warm"],
    durability: 9,
    maintenance: 2,
    blurb: "Warm sand. The closest an all-weather weave gets to looking like real cane.",
    carvable: false,
  },

  // Reeded cane: fine parallel reeds rather than basketry, which is what the
  // supplied "waved rattan" set turned out to be once its maps were opened. Its
  // diffuse was effectively black and its roughness a flat constant, so the
  // colour here is derived from its normal map by running a fixed light over
  // the relief. That keeps both maps describing one surface -- borrowing a
  // diffuse from another weave would have put one pattern's highlights on
  // another pattern's ridges.
  //
  // Planar, so it belongs to the rattan palette and not to cane: reeding is a
  // panel treatment, and laying it over geometry that is already round would
  // repeat the mistake it was introduced to avoid.
  {
    id: "reed-natural",
    name: "Natural reed",
    family: "Reeded cane",
    surface: "rattan",
    type: "rattan",
    hex: "#ffffff",
    pbr: "reeded-cane",
    albedo: true,
    carvable: false,
    repeat: 3,
    repeatY: 3,
    roughness: 0.72,
    tags: ["warm", "modern", "premium"],
    durability: 7,
    maintenance: 4,
    blurb: "Fine parallel reeds in natural cane. Reads as texture from across a room and as craft up close.",
  },
  {
    id: "reed-espresso",
    name: "Espresso reed",
    family: "Reeded cane",
    surface: "rattan",
    type: "rattan",
    hex: "#8a5c39",
    pbr: "reeded-cane",
    albedo: true,
    carvable: false,
    repeat: 3,
    repeatY: 3,
    roughness: 0.68,
    tags: ["formal", "warm", "modern"],
    durability: 7,
    maintenance: 4,
    blurb: "The same reeding stained dark. The shadow between reeds does most of the work.",
  },
  {
    id: "reed-charcoal",
    name: "Charcoal reed",
    family: "Reeded cane",
    surface: "rattan",
    type: "rattan",
    hex: "#5b5751",
    pbr: "reeded-cane",
    albedo: true,
    carvable: false,
    repeat: 3,
    repeatY: 3,
    roughness: 0.74,
    tags: ["modern", "formal", "easy-clean"],
    durability: 7,
    maintenance: 3,
    blurb: "Near-black reeding. Graphic, and the least likely of these to show a mark.",
  },

  // ---------------------------------------------------------------- fabric
  //
  // Tint-only for now. These carried procedurally generated relief, which read
  // as plausible noise rather than as a weave, and a generated map is worse
  // than none: it adds detail the eye then has to disbelieve. Every named
  // colour below drops the model's own photographed upholstery in favour of a
  // flat tint (keepsScanPattern: false) -- a stain-over-grain reading is right
  // for wood, but "Royal blue" promises a flat colour, and multiplying it over
  // whatever the scan's baked shading happens to be only darkens it, badly
  // wherever the bake itself runs dark. Only "Original" keeps the scan, since
  // showing it untinted is the point.
  /*
   * Two violets, which the catalogue had none of.
   *
   * A real upholstery colour rather than a screen one: this is the dusty,
   * slightly grey violet a dyed cotton-linen actually comes out, not the
   * saturated purple a colour picker suggests. The difference matters more
   * here than on most swatches -- a shop cutting to this will order cloth
   * against it, and a violet that only exists on a monitor is a customer
   * disappointed at delivery.
   *
   * They are a pair on purpose. A channelled back wants to be a shade deeper
   * than the arms it sits between, so the flutes read by their own shadow
   * rather than needing a second colour to separate them.
   */
  {
    id: "cloth-violet",
    name: "Violet weave",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#6d5b90",
    roughness: 0.92,
    keepsScanPattern: false,
    tags: ["formal", "modern"],
    durability: 5,
    maintenance: 6,
    blurb: "A dusty violet with a linen hand. Deep enough to hide everyday marks, and it reads grey in low light.",
  },
  {
    id: "cloth-aubergine",
    name: "Aubergine",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#4a3355",
    roughness: 0.93,
    keepsScanPattern: false,
    tags: ["formal", "premium"],
    durability: 6,
    maintenance: 5,
    blurb: "Violet taken almost to brown. Hides more than any colour here short of black, and warms under lamplight.",
  },
  {
    id: "cloth-emerald",
    name: "Emerald weave",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#356f52",
    roughness: 0.92,
    keepsScanPattern: false,
    tags: ["warm", "formal"],
    durability: 5,
    maintenance: 6,
    blurb: "A tight weave with real texture. Deep colour hides everyday marks; the pile catches hair.",
  },
  {
    id: "cloth-royal-blue",
    name: "Royal blue",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#3a5688",
    roughness: 0.92,
    keepsScanPattern: false,
    tags: ["formal"],
    durability: 5,
    maintenance: 6,
    blurb: "Flat and even. Reads as tailored rather than cosy.",
  },
  {
    id: "cloth-burgundy",
    name: "Burgundy",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#82303d",
    roughness: 0.9,
    keepsScanPattern: false,
    tags: ["formal", "warm", "stain-resistant"],
    durability: 6,
    maintenance: 5,
    blurb: "Dark enough that spills rarely leave a visible ring.",
  },
  {
    id: "cloth-ochre",
    name: "Ochre",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#c08b3e",
    roughness: 0.9,
    keepsScanPattern: false,
    tags: ["warm", "modern"],
    durability: 5,
    maintenance: 6,
    blurb: "Warm mustard. Sunlight will lighten it over years by a window.",
  },
  {
    id: "cloth-blush",
    name: "Blush",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#dda9a1",
    roughness: 0.94,
    keepsScanPattern: false,
    tags: ["modern"],
    durability: 4,
    maintenance: 8,
    blurb: "Pale and unforgiving. Beautiful in a room without small hands or paws in it.",
  },
  {
    id: "cloth-charcoal",
    name: "Charcoal",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#4d4d53",
    roughness: 0.9,
    keepsScanPattern: false,
    tags: ["modern", "stain-resistant", "kid-friendly"],
    durability: 6,
    maintenance: 4,
    blurb: "The safe answer in a busy room: dark, matte, and marks do not read from across it.",
  },
  {
    id: "cloth-abaca",
    name: "Abaca weave",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#cbb389",
    roughness: 0.95,
    keepsScanPattern: false,
    tags: ["warm", "budget"],
    durability: 6,
    maintenance: 6,
    blurb: "Local plant fibre, coarse and pale gold. Hard-wearing for its weight, and it does not like being soaked.",
  },
  {
    id: "cloth-canvas-natural",
    name: "Natural canvas",
    family: "Woven fabric",
    surface: "cloth",
    type: "fabric",
    hex: "#d9cdb4",
    roughness: 0.88,
    keepsScanPattern: false,
    tags: ["outdoor", "easy-clean", "budget"],
    durability: 7,
    maintenance: 4,
    blurb: "Heavy cotton duck, the usual cover for a lanai piece. Washable, and it fades in direct sun.",
  },

  // ------------------------------------------------------------- vinyl
  //
  // Grouped apart from the woven fabrics because it behaves like leather and
  // is bought like leather: a wipeable sheet rather than a cloth. It is the
  // ordinary answer for a dining chair in a house with children, and leaving
  // it out would have meant every easy-clean seat had to be real hide.
  {
    id: "cloth-vinyl-tan",
    name: "Tan vinyl",
    family: "Vinyl",
    surface: "cloth",
    type: "leather",
    hex: "#b98a5e",
    roughness: 0.42,
    keepsScanPattern: false,
    tags: ["easy-clean", "stain-resistant", "kid-friendly", "pet-friendly", "budget"],
    durability: 8,
    maintenance: 2,
    blurb: "Wipes clean with a cloth and shrugs off spills. Warmer to sit on than hide, and it cracks eventually.",
  },
  {
    id: "cloth-vinyl-black",
    name: "Black vinyl",
    family: "Vinyl",
    surface: "cloth",
    type: "leather",
    hex: "#2c2b2a",
    roughness: 0.38,
    keepsScanPattern: false,
    tags: ["easy-clean", "stain-resistant", "kid-friendly", "pet-friendly", "modern"],
    durability: 8,
    maintenance: 2,
    blurb: "The hardest-wearing seat here and the least precious about it. Shows dust rather than stains.",
  },

  // ---------------------------------------------------------------- velvet
  //
  // A pile rather than a weave, which is why it is not filed with the woven
  // fabrics above. The nap catches light along one direction and not the
  // other, so a velvet piece reads as two tones from across a room without
  // anybody having specified two -- and that is the reason it is the usual
  // cover for a sofa bed, where a single flat colour over two square metres
  // of cushion is a lot of one thing to look at.
  //
  // Both are grey on purpose. A tufted piece needs its deeper tone to be the
  // SAME cloth a shade down, or the tufting reads as a colour change rather
  // than as a shadow -- see the sofa bed's default finishes, which use these
  // two exactly that way.
  {
    id: "cloth-velvet-dove",
    name: "Dove velvet",
    family: "Velvet",
    surface: "cloth",
    type: "fabric",
    hex: "#8e9095",
    roughness: 0.62,
    keepsScanPattern: false,
    tags: ["modern", "stain-resistant"],
    durability: 6,
    maintenance: 5,
    blurb:
      "Short-pile grey, the cover on nearly every sofa bed sold here. Brushes clean; the nap shows where somebody has sat.",
  },
  {
    id: "cloth-velvet-pewter",
    name: "Pewter velvet",
    family: "Velvet",
    surface: "cloth",
    type: "fabric",
    hex: "#6c6e74",
    roughness: 0.6,
    keepsScanPattern: false,
    tags: ["modern", "stain-resistant", "kid-friendly"],
    durability: 6,
    maintenance: 4,
    blurb:
      "The same pile a couple of shades down. Made to sit beside Dove, so tufting on it reads as shadow rather than as trim.",
  },

  // --------------------------------------------------------------- leather
  // Tint-only, for the same reason as the fabrics above, and flat for the same
  // reason too -- a leather colour is a colour, not a stain over the scan.
  {
    id: "leather-tan",
    name: "Tan leather",
    family: "Leather",
    surface: "cloth",
    type: "leather",
    hex: "#a9713f",
    roughness: 0.45,
    keepsScanPattern: false,
    tags: ["premium", "pet-friendly", "easy-clean", "stain-resistant", "warm"],
    durability: 9,
    maintenance: 3,
    blurb: "Wipes clean and takes claws without pulling, unlike a weave. Develops a patina rather than wearing out.",
  },
  {
    id: "leather-espresso",
    name: "Espresso leather",
    family: "Leather",
    surface: "cloth",
    type: "leather",
    hex: "#4a3229",
    keepsScanPattern: false,
    roughness: 0.4,
    tags: ["premium", "pet-friendly", "easy-clean", "stain-resistant", "formal"],
    durability: 9,
    maintenance: 3,
    blurb: "The hardest-wearing finish here, and the least likely to show a spill at all.",
  },
  {
    id: "leather-black",
    name: "Black leather",
    family: "Leather",
    surface: "cloth",
    type: "leather",
    hex: "#2b2724",
    roughness: 0.35,
    keepsScanPattern: false,
    tags: ["premium", "formal", "modern"],
    durability: 8,
    maintenance: 5,
    blurb: "Full black hide with a low sheen. Wants conditioning once a year or it stiffens and cracks.",
  },

  // ----------------------------------------------------------------- glass
  // Tint-only, like fabric and leather, but for a different reason: there is
  // no scanned relief for glass the way there is a plank of real timber
  // behind every wood finish, so a "finish" here is a colour, a roughness,
  // and -- uniquely to this surface -- an opacity. `carvable: false` for the
  // same reason a woven panel is: there is nothing solid to cut a relief
  // into.
  //
  // This list used to be reachable only on a part the pipeline had already
  // identified as glass (see `genericResolveSurface` in generic-rig.ts),
  // which in practice meant no part on any shipped model: every finish here
  // was unpickable. It is now offered wherever a part is held at its edges
  // and could genuinely be glazed -- a top, a door, a shelf -- and nowhere
  // else, because a pane cannot be a leg or take a screw. See
  // `surfacesForPart` in studio-config.ts for the rule.
  {
    id: "glass-clear",
    name: "Clear",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#eef6f5",
    opacity: 0.18,
    roughness: 0.05,
    tags: ["modern"],
    durability: 6,
    maintenance: 7,
    blurb: "Near-invisible. Shows every fingerprint and whatever is underneath it.",
    carvable: false,
  },
  {
    id: "glass-frosted",
    name: "Frosted",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#f4f4f2",
    opacity: 0.55,
    roughness: 0.45,
    tags: ["modern", "easy-clean"],
    durability: 6,
    maintenance: 4,
    blurb: "Sanded rather than clear. Hides what is stored underneath and most fingerprints with it.",
    carvable: false,
  },
  {
    id: "glass-smoked",
    name: "Smoked",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#3d3f42",
    opacity: 0.4,
    roughness: 0.08,
    tags: ["modern", "formal"],
    durability: 6,
    maintenance: 6,
    blurb: "Dark-tinted glass. Reflective rather than see-through from most angles.",
    carvable: false,
  },
  {
    id: "glass-bronze",
    name: "Bronze tinted",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#6b5334",
    opacity: 0.42,
    roughness: 0.07,
    keepsScanPattern: false,
    tags: ["warm", "formal"],
    durability: 6,
    maintenance: 6,
    blurb: "Warm-tinted rather than grey. Sits better over timber than smoked glass does.",
    carvable: false,
  },
  {
    id: "glass-reeded",
    name: "Reeded",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#dfeae6",
    opacity: 0.5,
    roughness: 0.3,
    keepsScanPattern: false,
    tags: ["modern", "easy-clean"],
    durability: 6,
    maintenance: 5,
    blurb: "Vertically fluted, so it blurs what is behind it into stripes. A cabinet door front, rarely a top.",
    carvable: false,
  },
  {
    id: "glass-tempered",
    name: "Tempered",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#d9ece2",
    opacity: 0.22,
    roughness: 0.05,
    keepsScanPattern: false,
    tags: ["modern", "kid-friendly"],
    durability: 8,
    maintenance: 6,
    blurb: "Heat-treated so it crumbles instead of shearing. The only glass worth putting on a table a child uses.",
    carvable: false,
  },
  {
    id: "glass-mirror",
    name: "Mirrored",
    family: "Glass",
    surface: "glass",
    type: "glass",
    hex: "#dfe4e6",
    // Opaque and metallic rather than transparent: a mirror is a silvered
    // back, so it reflects the room instead of showing what is behind it.
    // It is the one entry in this list that is not see-through at all.
    opacity: 1,
    metalness: 0.95,
    roughness: 0.04,
    keepsScanPattern: false,
    tags: ["premium", "formal"],
    durability: 5,
    maintenance: 7,
    blurb: "Silvered on the back. Doubles a small room and shows every mark doing it.",
    carvable: false,
  },

  // ----------------------------------------------------------------- metal
  // Cabinet hardware: pulls, knobs and the hinges that show. Tint-only like
  // glass, and for the same reason -- there is no scanned relief to keep --
  // but driven by `metalness` rather than `opacity`, which is what makes the
  // difference between brass and painted steel read at all. `carvable: false`
  // because a relief is cut into timber, not into a cast pull.
  //
  // Named as stock a furniture shop can actually order rather than as colours: a
  // customer picking "Antique brass" is specifying a component, and the
  // build sheet has to say which one.
  {
    id: "metal-brass",
    name: "Polished brass",
    family: "Brass",
    surface: "metal",
    type: "metal",
    hex: "#c68b3c",
    metalness: 0.95,
    roughness: 0.22,
    keepsScanPattern: false,
    tags: ["premium", "warm", "formal"],
    durability: 8,
    maintenance: 5,
    blurb: "Bright and yellow-gold. Wants an occasional polish or it dulls to a patina.",
    carvable: false,
  },
  {
    id: "metal-antique-brass",
    name: "Antique brass",
    family: "Brass",
    surface: "metal",
    type: "metal",
    hex: "#8c6a35",
    metalness: 0.9,
    roughness: 0.45,
    keepsScanPattern: false,
    tags: ["warm", "formal", "easy-clean"],
    durability: 8,
    maintenance: 3,
    blurb: "Darkened and lacquered so it stays put. Hides handling marks the polished finish shows.",
    carvable: false,
  },
  {
    id: "metal-brushed-nickel",
    name: "Brushed nickel",
    family: "Steel",
    surface: "metal",
    type: "metal",
    hex: "#b8bcbe",
    metalness: 0.9,
    roughness: 0.4,
    keepsScanPattern: false,
    tags: ["modern", "easy-clean"],
    durability: 9,
    maintenance: 3,
    blurb: "Cool grey with a fine grain. The most forgiving of fingerprints.",
    carvable: false,
  },
  {
    id: "metal-matte-black",
    name: "Matte black",
    family: "Steel",
    surface: "metal",
    type: "metal",
    hex: "#2a2b2d",
    metalness: 0.45,
    roughness: 0.72,
    keepsScanPattern: false,
    tags: ["modern", "budget"],
    durability: 8,
    maintenance: 4,
    blurb: "Powder-coated rather than plated. Reads as a silhouette against pale timber.",
    carvable: false,
  },
  {
    id: "metal-stainless",
    name: "Brushed stainless",
    family: "Stainless steel",
    surface: "metal",
    type: "metal",
    hex: "#c3c7c9",
    metalness: 0.92,
    roughness: 0.32,
    keepsScanPattern: false,
    tags: ["modern", "easy-clean", "outdoor", "waterproof"],
    durability: 10,
    maintenance: 2,
    blurb: "The workhorse. Does not rust on a lanai, wipes clean, and shows a smear until it is buffed along the grain.",
    carvable: false,
  },
  {
    id: "metal-chrome",
    name: "Polished chrome",
    family: "Stainless steel",
    surface: "metal",
    type: "metal",
    hex: "#dfe4e7",
    metalness: 1,
    roughness: 0.06,
    keepsScanPattern: false,
    tags: ["modern", "formal"],
    durability: 9,
    maintenance: 5,
    blurb: "A mirror in metal. Reflects the whole room, which is either the effect wanted or a fingerprint museum.",
    carvable: false,
  },
  {
    id: "metal-aluminium",
    name: "Anodised aluminium",
    family: "Aluminium",
    surface: "metal",
    type: "metal",
    hex: "#b9bec1",
    metalness: 0.85,
    roughness: 0.38,
    keepsScanPattern: false,
    tags: ["modern", "outdoor", "waterproof", "budget"],
    durability: 8,
    maintenance: 2,
    blurb: "Light enough to move one-handed and it will never rust. Dents where steel would only scratch.",
    carvable: false,
  },
  {
    id: "metal-powder-white",
    name: "Powder-coated white",
    family: "Powder-coated steel",
    surface: "metal",
    type: "metal",
    hex: "#edecea",
    // Low metalness on purpose: the coating is a baked polymer, so what the
    // eye reads is paint over steel, not steel. Leaving it metallic gives a
    // white that looks like polished aluminium instead of a painted frame.
    metalness: 0.28,
    roughness: 0.65,
    keepsScanPattern: false,
    tags: ["modern", "budget", "easy-clean", "outdoor"],
    durability: 8,
    maintenance: 3,
    blurb: "Baked-on colour over steel. Tough and cheap; once it chips, the steel under it starts to rust.",
    carvable: false,
  },
  {
    id: "metal-powder-olive",
    name: "Powder-coated olive",
    family: "Powder-coated steel",
    surface: "metal",
    type: "metal",
    hex: "#5c6350",
    metalness: 0.28,
    roughness: 0.68,
    keepsScanPattern: false,
    tags: ["modern", "outdoor", "easy-clean"],
    durability: 8,
    maintenance: 3,
    blurb: "The same baked coating in a muted green. Reads softer than black against timber.",
    carvable: false,
  },
  {
    id: "metal-copper",
    name: "Copper",
    family: "Copper",
    surface: "metal",
    type: "metal",
    hex: "#b06a42",
    metalness: 0.95,
    roughness: 0.28,
    keepsScanPattern: false,
    tags: ["premium", "warm", "formal"],
    durability: 7,
    maintenance: 6,
    blurb: "Pink-orange and bright when new. Left unlacquered it goes brown and then green, which is the point or is not.",
    carvable: false,
  },
  {
    id: "metal-wrought-iron",
    name: "Blackened iron",
    family: "Wrought iron",
    surface: "metal",
    type: "metal",
    hex: "#3a3835",
    metalness: 0.6,
    roughness: 0.6,
    keepsScanPattern: false,
    tags: ["formal", "warm"],
    durability: 9,
    maintenance: 4,
    blurb: "Hand-forged and waxed rather than plated. Heavy, and the surface is meant to be uneven.",
    carvable: false,
  },

  // ----------------------------------------------------------------- stone
  //
  // Slab material, and the only family here that is neither finished on site
  // nor offered in a colour range: a marble top is quarried, cut and
  // polished, and what a customer picks is a stone rather than a stain. It
  // follows that none of these takes a varnish usefully and none can be
  // carved -- a relief in stone is a different trade from cabinetmaking.
  //
  // Tint-only, and flatly so (`keepsScanPattern: false`): there is no stone
  // scan, and letting a timber grain show through a marble would render
  // something that is not marble and is not timber either. Roughness carries
  // the whole difference between a polished and a honed slab.
  //
  // No "Original" entry, unlike wood or cane: no shipped model is authored
  // in stone, so there is no photographed stone for "as shown" to mean.
  {
    id: "stone-carrara",
    name: "Carrara marble",
    family: "Stone",
    surface: "stone",
    type: "stone",
    hex: "#ece9e4",
    roughness: 0.18,
    keepsScanPattern: false,
    tags: ["premium", "formal", "modern"],
    durability: 7,
    maintenance: 7,
    blurb: "White with grey veining, polished. Etches where anything acidic is left on it, and that mark is permanent.",
    carvable: false,
  },
  {
    id: "stone-romblon",
    name: "Romblon marble",
    family: "Stone",
    surface: "stone",
    type: "stone",
    hex: "#e6e2d6",
    roughness: 0.22,
    keepsScanPattern: false,
    tags: ["premium", "warm", "formal"],
    durability: 7,
    maintenance: 7,
    blurb: "Quarried locally and warmer than the Italian stone. The sensible marble to specify in the Philippines.",
    carvable: false,
  },
  {
    id: "stone-black-granite",
    name: "Black granite",
    family: "Stone",
    surface: "stone",
    type: "stone",
    hex: "#2f3134",
    roughness: 0.25,
    keepsScanPattern: false,
    tags: ["premium", "modern", "easy-clean", "stain-resistant"],
    durability: 9,
    maintenance: 3,
    blurb: "Far harder than marble and it does not etch. Very heavy, so the frame under it has to be built for it.",
    carvable: false,
  },
  {
    id: "stone-travertine",
    name: "Travertine",
    family: "Stone",
    surface: "stone",
    type: "stone",
    hex: "#d9c9ae",
    // High, because travertine is honed rather than polished and is pitted
    // besides: a mirror finish on it would read as a different stone.
    roughness: 0.55,
    keepsScanPattern: false,
    tags: ["warm", "premium"],
    durability: 6,
    maintenance: 8,
    blurb: "Creamy and open-pored. Wants sealing and re-sealing, and it will hold a coffee ring if it does not get it.",
    carvable: false,
  },

  // --------------------------------------------------------------- plastic
  //
  // Moulded and extruded stock: a seat shell, a chair leg, a cabinet front.
  // Bought finished like metal and glass, so no varnish and no stain, and
  // flat rather than grained for the same reason stone is -- there is no
  // polymer scan, and a wood grain showing through a polypropylene shell
  // would be neither.
  //
  // Deliberately not where the all-weather woven strand lives: that is a
  // polyethylene too, but it is a weave first and belongs with the rattans,
  // which is where a customer looks for it.
  /*
   * Carbon fibre, as a composite rather than as a colour.
   *
   * It sits with the polymers because that is what it is to a furniture shop: a
   * moulded shell bought finished, never stained, never varnished and never
   * carved -- the weave is laid up inside the resin and cutting into it cuts
   * the fibre that carries the load.
   *
   * Two, because the two finishes are genuinely different products and a shop
   * quotes them differently: a gloss lacquered twill is the one people picture,
   * and a matte is what gets specified when a piece should not look like a
   * bicycle. Expensive and strong, which the durability figures say.
   */
  {
    id: "composite-carbon-twill",
    name: "Carbon fibre, gloss",
    family: "Composite",
    surface: "plastic",
    type: "plastic",
    hex: "#2b2e33",
    roughness: 0.18,
    keepsScanPattern: false,
    tags: ["modern", "premium"],
    durability: 9,
    maintenance: 4,
    blurb:
      "A lacquered twill weave. Stiffer than steel for its weight and the most expensive thing on this list; scratches show on the gloss.",
    carvable: false,
  },
  {
    id: "composite-carbon-matte",
    name: "Carbon fibre, matte",
    family: "Composite",
    surface: "plastic",
    type: "plastic",
    hex: "#33363b",
    roughness: 0.62,
    keepsScanPattern: false,
    tags: ["modern", "premium"],
    durability: 9,
    maintenance: 3,
    blurb:
      "The same lay-up without the gloss coat. Reads as a dark grey solid until the light catches the weave, and hides marks the gloss would show.",
    carvable: false,
  },
  {
    id: "plastic-pp-white",
    name: "White polypropylene",
    family: "Moulded polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#eeece7",
    roughness: 0.45,
    keepsScanPattern: false,
    tags: ["modern", "budget", "easy-clean", "kid-friendly", "waterproof"],
    durability: 7,
    maintenance: 2,
    blurb: "The moulded stacking shell. Nothing stains it, nothing rots, and it yellows in years of direct sun.",
    carvable: false,
  },
  {
    id: "plastic-pp-black",
    name: "Black polypropylene",
    family: "Moulded polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#26282a",
    roughness: 0.45,
    keepsScanPattern: false,
    tags: ["modern", "budget", "easy-clean", "kid-friendly"],
    durability: 7,
    maintenance: 2,
    blurb: "The same shell in black, which hides scuffs far better and shows dust far worse.",
    carvable: false,
  },
  {
    id: "plastic-pp-clay",
    name: "Clay polypropylene",
    family: "Moulded polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#b5674a",
    roughness: 0.5,
    keepsScanPattern: false,
    tags: ["modern", "warm", "easy-clean", "kid-friendly"],
    durability: 7,
    maintenance: 2,
    blurb: "Terracotta through the whole thickness, so a scratch is the same colour as the surface.",
    carvable: false,
  },
  {
    id: "plastic-pp-sage",
    name: "Sage polypropylene",
    family: "Moulded polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#8a9a83",
    roughness: 0.5,
    keepsScanPattern: false,
    tags: ["modern", "easy-clean", "kid-friendly"],
    durability: 7,
    maintenance: 2,
    blurb: "A muted green that sits quietly next to timber. Same shell, same indifference to spills.",
    carvable: false,
  },
  {
    id: "plastic-hdpe-marine",
    name: "Marine HDPE",
    family: "Outdoor polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#4a5257",
    roughness: 0.62,
    keepsScanPattern: false,
    tags: ["outdoor", "waterproof", "easy-clean", "stain-resistant"],
    durability: 9,
    maintenance: 2,
    blurb: "Solid board cut like timber, for furniture left in the rain. Heavy, expensive, and effectively permanent.",
    carvable: false,
  },
  {
    id: "plastic-acrylic-clear",
    name: "Clear acrylic",
    family: "Outdoor polymer",
    surface: "plastic",
    type: "plastic",
    hex: "#f0f4f4",
    // The one polymer here that is see-through, so it carries an opacity the
    // way the glass entries do rather than reading as a colour.
    opacity: 0.25,
    roughness: 0.06,
    keepsScanPattern: false,
    tags: ["modern"],
    durability: 5,
    maintenance: 7,
    blurb: "Lighter than glass and it does not shatter. Scratches if you look at it wrongly, and every scratch stays.",
    carvable: false,
  },
];

/**
 * Add actual color choices to paintable/dyeable stock. The original entries
 * remain unchanged, including their IDs and natural finishes in older designs.
 * Factory-patterned stock (stone, glass, composites, synthetic rattan) keeps
 * its declared catalog appearance instead of receiving arbitrary paint colors.
 */
const COLORABLE_FAMILIES = new Set([
  "Bamboo", "Cane strand", "Reeded cane", "Woven fabric", "Velvet", "Leather",
  "Vinyl", "Powder-coated steel", "Wrought iron", "Moulded polymer",
]);
const colorBases = BASE_MATERIALS.filter((material) => {
  if (material.type === "wood") return material.id !== "panel-laminate-oak" && material.id !== "panel-mdf-graphite";
  if (material.id === "plastic-hdpe-marine") return true;
  if (material.id === "cloth-abaca" || material.id === "cloth-canvas-natural") return true;
  // Families with several existing colors need one palette, not one copy per color.
  return COLORABLE_FAMILIES.has(material.family ?? "")
    && BASE_MATERIALS.find((entry) => entry.family === material.family)?.id === material.id;
});

function colorMaterialName(base: MaterialProfile): string {
  if (base.type === "wood") return base.id === "panel-mdf-white" ? "Painted MDF" : base.name;
  if (["cloth-abaca", "cloth-canvas-natural", "plastic-hdpe-marine"].includes(base.id)) return base.name;
  return base.family === "Moulded polymer" ? "Polypropylene" : base.family ?? base.name;
}

const COLOR_MATERIALS: MaterialProfile[] = colorBases.flatMap((base) => MATERIAL_COLORS.map((color) => ({
  ...base,
  id: `${base.id}--${color.id}`,
  name: `${colorMaterialName(base)} · ${color.name}`,
  baseMaterialId: base.id,
  colorName: color.name,
  colorCategory: color.category,
  hex: color.hex,
  // Keep relief from the existing grain/weave, without multiplying in its
  // photographed brown color or the source model's baked shadows.
  albedo: false,
  keepsScanPattern: false,
  gain: 1,
  metalness: 0,
  blurb: `${color.name} ${base.type === "wood" || base.type === "rattan" ? "painted finish" : "color finish"} on ${colorMaterialName(base).toLowerCase()}. Offered only when the shop declares it can supply this material and color.`,
})));

export const MATERIALS: MaterialProfile[] = [...BASE_MATERIALS, ...COLOR_MATERIALS];

// ---------------------------------------------------------------- lookups

const BY_ID = new Map(MATERIALS.map((material) => [material.id, material]));

export function materialById(id: string | null | undefined): MaterialProfile | null {
  return id ? BY_ID.get(id) ?? null : null;
}

export function materialsForSurface(surface: Surface): MaterialProfile[] {
  return MATERIALS.filter((material) => material.surface === surface);
}

/**
 * The catalogue for a part that may be built in more than one family.
 *
 * Surface by surface rather than one filter over MATERIALS, because the ORDER
 * matters and the catalogue's own order is not it: `surfacesForPart` puts the
 * part's own stock first, and that is what should head the panel. A single
 * pass over MATERIALS would instead return catalogue order, which would bury a
 * chair's own timbers under whichever family happens to be declared first.
 *
 * This used to drop the family-less entries from every surface after the
 * first, so that a timber top offered one "Original" rather than one per
 * family it could also be built in -- six identical "as shown" swatches, five
 * of which recorded the part on the order as a stock nobody asked for. There
 * are no family-less entries left to drop: every finish names stock a
 * furniture shop can buy, and the piece opens on one of them.
 */
export function materialsForSurfaces(surfaces: Surface[]): MaterialProfile[] {
  return surfaces.flatMap((surface) => materialsForSurface(surface));
}

/**
 * What a part is finished in before anybody chooses.
 *
 * Every model names its own per part (see `defaultFinishes`); this is the
 * backstop for a part whose model does not, and for the generated pieces,
 * which have no authored finishes at all. First in the surface's list, which
 * is the order the catalogue is written in and the one the panel shows.
 */
export function defaultMaterialForSurface(surface: Surface): MaterialProfile | null {
  return materialsForSurface(surface)[0] ?? null;
}

/**
 * The finishes a customer may pick, given what the shop permits.
 *
 * `null` allowed means the shop never restricted this template, which is every
 * template that existed before restrictions did -- so it means all of them.
 * An explicit empty list means no permitted materials, including when a shop
 * and template have no stock in common. Never widen that to the catalogue.
 */
export function allowedMaterialsForSurface(
  surface: Surface,
  allowed: string[] | null | undefined
): MaterialProfile[] {
  return allowedMaterialsForSurfaces([surface], allowed);
}

/** Intersect template and shop stock. An explicit empty intersection stays empty. */
export function combineAllowedMaterials(
  template: string[] | null | undefined,
  shop: string[] | null | undefined
): string[] | null {
  if (template == null) return shop ?? null;
  if (shop == null) return template;
  const stocked = new Set(shop);
  return template.filter((id) => stocked.has(id));
}

/** Every surface supported by the catalogue, including aperture inserts. */
export const ALL_SURFACES: Surface[] = ["wood", "cloth", "rattan", "cane", "glass", "metal", "stone", "plastic"];

export function allowedMaterialsForSurfaces(
  surfaces: Surface[],
  allowed: string[] | null | undefined
): MaterialProfile[] {
  const all = materialsForSurfaces(surfaces);
  if (allowed == null) return all;
  return all.filter((material) => allowed.includes(material.id));
}

// ----------------------------------------------------- the advisor's opinion

/**
 * Who the piece is for, by the part of their age that changes the answer.
 *
 * Three bands and not four: an adult is the baseline every finish in the
 * catalogue is already chosen for, so an "Adult" chip would be a control that
 * changes nothing when pressed. These three each carry a real consequence --
 * a child's piece is one that will be climbed on and drawn on, a teenager's
 * is one that takes hard use, and an elder's is one that should ask for as
 * little upkeep as possible and have nothing sharp or breakable to fall
 * against.
 */
export type AgeBand = "child" | "teen" | "elder";

/**
 * Who it is being made for, in the customer's own words.
 *
 * Recorded and shown back in the advisor's summary; deliberately absent from
 * `scoreMaterial`. There is no honest material consequence to this -- narra is
 * not a timber for boys, and ranking a blush weave up for a girl would be
 * inventing advice and dressing it as a recommendation. Age is what changes
 * which finish is right; this is context for the piece, and it is carried so
 * the customer can see the advice is about a real person.
 */
export type PersonGender = "boy" | "girl" | "unspecified";

/** The looks the catalogue is already tagged for; each one is a real tag on real finishes. */
export type StylePreference = "modern" | "warm" | "formal";

export type BudgetPreference = "budget" | "premium";

export type LifestyleAnswers = {
  pets: boolean;
  kids: boolean;
  outdoor: boolean;
  /** Damp air or salt air: humid rooms, or a house near the sea. */
  humid: boolean;
  /** A spot in strong, direct sun most of the day. */
  sun: boolean;
  /** Empty means no one in particular, which is the baseline. */
  ages: AgeBand[];
  who: PersonGender;
  /** Null is "no preference", which ranks nothing. */
  budget: BudgetPreference | null;
  styles: StylePreference[];
};

export const LIFESTYLE_QUESTIONS: Array<{
  key: "pets" | "kids" | "outdoor";
  label: string;
  hint: string;
}> = [
  { key: "pets", label: "Pets", hint: "Claws, hair, and the occasional accident" },
  { key: "kids", label: "Children", hint: "Spills, and being climbed on" },
  { key: "outdoor", label: "Covered outdoors", hint: "A porch or lanai, not full weather" },
];

/** Where the piece will live, beyond indoors or out. Each changes which finishes last. */
export const CONDITION_QUESTIONS: Array<{ key: "humid" | "sun"; label: string; hint: string }> = [
  { key: "humid", label: "Humid or near the sea", hint: "Damp air and salt are hard on timber and steel" },
  { key: "sun", label: "Strong sun", hint: "Direct sun fades fabric and dries out leather" },
];

export const BUDGET_OPTIONS: Array<{ key: BudgetPreference | null; label: string }> = [
  { key: "budget", label: "Budget-friendly" },
  { key: null, label: "No preference" },
  { key: "premium", label: "Premium" },
];

export const STYLE_OPTIONS: Array<{ key: StylePreference; label: string }> = [
  { key: "modern", label: "Modern" },
  { key: "warm", label: "Warm" },
  { key: "formal", label: "Formal" },
];

export const AGE_QUESTIONS: Array<{ key: AgeBand; label: string; hint: string }> = [
  { key: "child", label: "A child", hint: "Climbed on, drawn on, and nothing breakable" },
  { key: "teen", label: "A teenager", hint: "Hard use, and it has to survive it" },
  { key: "elder", label: "An elder", hint: "As little upkeep as possible, and nothing sharp to fall against" },
];

export const PERSON_OPTIONS: Array<{ key: PersonGender; label: string }> = [
  { key: "boy", label: "A boy" },
  { key: "girl", label: "A girl" },
  { key: "unspecified", label: "Rather not say" },
];

/** The blank slate the studio opens on, and what "nothing asked" means. */
export const NO_LIFESTYLE: LifestyleAnswers = {
  pets: false,
  kids: false,
  outdoor: false,
  humid: false,
  sun: false,
  ages: [],
  who: "unspecified",
  budget: null,
  styles: [],
};

/**
 * The advice in a sentence, so the customer can check it is about the person
 * they meant before trusting the list under it.
 */
export function describeAudience(answers: LifestyleAnswers): string | null {
  const person = PERSON_OPTIONS.find((option) => option.key === answers.who);
  const ages = AGE_QUESTIONS.filter((question) => answers.ages.includes(question.key)).map(
    (question) => question.label.replace(/^A /, "").replace(/^An /, "")
  );

  if (!ages.length && answers.who === "unspecified") return null;

  const subject =
    answers.who === "unspecified"
      ? ages.length
        ? ages.join(" and ")
        : null
      : ages.length
        ? `${person!.label.toLowerCase()} (${ages.join(" and ")})`
        : person!.label.toLowerCase();

  return subject ? `Choosing for ${subject}.` : null;
}

/**
 * What a part is for, as far as wear goes.
 *
 * The same answer weighs differently on different parts: a dog's claws meet a
 * seat cushion every day and a back leg almost never, and a spilled drink lands
 * on a table top, not on its apron. Derived from the part's role, so every
 * model -- shipped or generated -- is covered without a list per model.
 */
export type PartFocus = "contact" | "surface" | "structure" | "touch" | "general";

const FOCUS_BY_ROLE: Partial<Record<string, PartFocus>> = {
  seatCushion: "contact",
  backCushion: "contact",
  armrest: "contact",
  mattress: "contact",
  bedding: "contact",
  pillows: "contact",
  headboardPanel: "contact",
  tabletop: "surface",
  leaf: "surface",
  tabletopBorder: "surface",
  shelf: "surface",
  base: "structure",
  seatFrame: "structure",
  backFrame: "structure",
  apron: "structure",
  stretcher: "structure",
  bedRail: "structure",
  mattressSupport: "structure",
  carcass: "structure",
  headboard: "structure",
  footboard: "structure",
  door: "touch",
  drawer: "touch",
  hardware: "touch",
  accessory: "touch",
};

export function partFocusOf(role: string | null | undefined): PartFocus {
  return (role && FOCUS_BY_ROLE[role]) || "general";
}

/** How much the household's wear (claws, spills) counts on a part of this kind. */
const WEAR_WEIGHT: Record<PartFocus, number> = { contact: 1, surface: 1, touch: 0.75, structure: 0.5, general: 1 };
/** How much plain strength counts on a part of this kind. */
const STRENGTH_WEIGHT: Record<PartFocus, number> = { contact: 0.75, surface: 1, touch: 1, structure: 1.25, general: 1 };

const STYLE_REASON: Record<StylePreference, string> = {
  modern: "modern look",
  warm: "warm look",
  formal: "formal look",
};

/**
 * Scores a material against how the piece will actually be lived with.
 *
 * Deliberately simple and readable rather than a weighting nobody can audit:
 * each answer names the tags that matter and the qualities that do. A customer
 * asked why a finish is recommended should get an answer from `reasons`, and
 * why one is not from `cautions` -- never from a number.
 *
 * `focus` is the part being finished (see `partFocusOf`). It scales the wear
 * answers, never flips them: a claw-proof weave is still claw-proof on a leg,
 * it just matters less there.
 */
export function scoreMaterial(
  material: MaterialProfile,
  answers: LifestyleAnswers,
  focus: PartFocus = "general"
): { score: number; reasons: string[]; cautions: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const wear = WEAR_WEIGHT[focus];
  const strength = STRENGTH_WEIGHT[focus];
  const has = (tag: MaterialTag) => material.tags.includes(tag);

  if (answers.pets) {
    if (has("pet-friendly")) {
      score += 3 * wear;
      reasons.push("stands up to claws");
    }
    if (material.type === "fabric" && material.durability < 6) {
      score -= 2 * wear;
      cautions.push("snags on claws");
    }
    if (material.durability >= 8) score += 1 * strength;
  }

  if (answers.kids) {
    if (has("stain-resistant") || has("easy-clean")) {
      score += 3 * wear;
      reasons.push("wipes clean");
    }
    if (has("kid-friendly")) {
      score += 2 * wear;
      reasons.push("forgiving of knocks");
    }
    if (material.maintenance >= 7) {
      score -= 2;
      cautions.push("needs care");
    }
  }

  // Who it is for. Each band names a real hazard or a real chore, which is
  // why "adult" is not one of them: there is nothing to say.
  if (answers.ages.includes("child")) {
    if (has("kid-friendly")) {
      score += 3 * wear;
      reasons.push("made for knocks");
    }
    if (has("easy-clean") || has("stain-resistant")) {
      score += 2 * wear;
      reasons.push("wipes clean");
    }
    // The one answer that is genuinely wrong rather than merely unwise: a
    // pane at a child's head height, in a piece they will climb.
    if (material.type === "glass") {
      score -= 4;
      cautions.push("glass, at a child's height");
    }
    if (material.maintenance >= 7) {
      score -= 2;
      cautions.push("needs looking after");
    }
  }

  if (answers.ages.includes("teen")) {
    if (material.durability >= 8) {
      score += 3 * strength;
      reasons.push("takes hard use");
    }
    if (has("easy-clean")) {
      score += 2 * wear;
      reasons.push("wipes clean");
    }
    if (material.maintenance >= 7) {
      score -= 2;
      cautions.push("needs looking after");
    }
  }

  if (answers.ages.includes("elder")) {
    // Upkeep is the whole question here. A finish that wants oiling twice a
    // year is a chore handed to somebody who did not ask for it.
    if (material.maintenance <= 3) {
      score += 3;
      reasons.push("almost no upkeep");
    }
    if (material.maintenance >= 7) {
      score -= 3;
      cautions.push("needs looking after");
    }
    if (material.durability >= 8) {
      score += 2 * strength;
      reasons.push("stands up to daily use");
    }
    // Something to steady yourself on should not be something that breaks.
    if (material.type === "glass") {
      score -= 3;
      cautions.push("glass to fall against");
    }
  }

  if (answers.outdoor) {
    if (has("outdoor")) {
      score += 3;
      reasons.push("suits covered outdoor use");
    }
    if (has("waterproof")) {
      score += 3;
      reasons.push("shrugs off rain");
    }
    // Untreated fabric in humidity is the one genuinely bad answer here.
    if (material.type === "fabric" && !has("outdoor") && !has("waterproof")) {
      score -= 3;
      cautions.push("holds damp outdoors");
    }
    if (material.type === "wood" && material.durability >= 8) score += 1;
  }

  // Damp and salt air. Read from what the finish is rated for, not guessed:
  // the outdoor and waterproof tags are the catalogue's own claim.
  if (answers.humid) {
    if (has("waterproof") || has("outdoor")) {
      score += 2;
      reasons.push("handles damp air");
    } else if (material.type === "wood" && material.durability <= 5) {
      score -= 2;
      cautions.push("less suited to damp rooms");
    } else if (material.type === "fabric" || material.type === "leather") {
      score -= 1;
      cautions.push("can mildew in damp air");
    }
  }

  if (answers.sun) {
    if ((material.type === "fabric" || material.type === "leather") && !has("outdoor")) {
      score -= 2;
      cautions.push("fades in strong sun");
    } else if (has("outdoor")) {
      score += 1;
      reasons.push("made for sunlit spots");
    }
  }

  // Taste and money. A match is a reason; a mismatch is quietly ranked down,
  // never written up as a warning -- a premium finish is not a fault.
  if (answers.budget === "budget") {
    if (has("budget")) {
      score += 2;
      reasons.push("budget-friendly");
    }
    if (has("premium")) score -= 1;
  } else if (answers.budget === "premium") {
    if (has("premium")) {
      score += 2;
      reasons.push("premium finish");
    }
    if (has("budget")) score -= 1;
  }

  for (const style of answers.styles) {
    if (has(style)) {
      score += 2;
      reasons.push(STYLE_REASON[style]);
    }
  }

  // With no context given, nothing is recommended over anything else -- the
  // list stays in the shop's own order rather than being silently reranked.
  const reasonSet = Array.from(new Set(reasons));
  return {
    score: Math.round(score * 100) / 100,
    reasons: reasonSet,
    cautions: Array.from(new Set(cautions)).filter((caution) => !reasonSet.includes(caution)),
  };
}

/**
 * Gathers a ranked finish list into the families it declares.
 *
 * Gathered, not cut where the family changes. The advisor sorts the whole list
 * by score, so a recommended bamboo lands in the middle of the timbers -- and a
 * pass that only breaks runs then emits "Hardwood" twice, once either side of
 * it, producing duplicate React keys and two identical headings in a panel
 * whose whole purpose is to stop the list looking like a wall.
 *
 * `order` supplies the heading order and comes from the catalogue rather than
 * the ranked list, so the sections stay put as the advisor's answers change and
 * only the finishes move within them.
 *
 * Lives here rather than inside the panel so it can be exercised directly:
 * the defect above only appears once a lifestyle is given, which a preview of
 * the unranked list cannot reach.
 */
export function groupByFamily<T extends { material: MaterialProfile }>(
  order: MaterialProfile[],
  ranked: T[]
): Array<{ family: string | null; items: T[] }> {
  const families: Array<string | null> = [];
  for (const material of order) {
    const family = material.family ?? null;
    if (!families.includes(family)) families.push(family);
  }

  const byFamily = new Map<string | null, T[]>();
  for (const entry of ranked) {
    const family = entry.material.family ?? null;
    const bucket = byFamily.get(family);
    if (bucket) bucket.push(entry);
    else byFamily.set(family, [entry]);
  }

  return families
    .filter((family) => byFamily.has(family))
    .map((family) => ({ family, items: byFamily.get(family)! }));
}

// ------------------------------------------------------------- categories

/**
 * The first question a material picker asks: what kind of stock.
 *
 * Families are the right grain for headings and the wrong one for a first
 * choice -- there are two dozen of them, and a row of twenty-four chips is the
 * same wall the headings were meant to break up. So families are gathered one
 * level further, into the categories a customer or a shop actually thinks in:
 * "solid wood", "metal", "fabric". Pick one and only its finishes are listed,
 * still under their family headings.
 *
 * Derived from `family` rather than stored on each finish, so nothing saved
 * changes: a design records a finish id, never its category, and moving a
 * family between categories here moves it everywhere at once. A family missing
 * from this table is not dropped -- it lands in "Other", which the verify
 * script refuses, so the omission is caught before a customer sees it.
 */
export type MaterialCategoryId =
  | "solid-wood"
  | "panel"
  | "bamboo"
  | "rattan"
  | "fabric"
  | "leather"
  | "glass"
  | "metal"
  | "stone"
  | "plastic"
  | "other";

export const MATERIAL_CATEGORIES: Array<{ id: MaterialCategoryId; label: string; families: string[] }> = [
  { id: "solid-wood", label: "Solid wood", families: ["Hardwood", "Plantation timber", "Softwood"] },
  { id: "panel", label: "Panels", families: ["Engineered panel"] },
  { id: "bamboo", label: "Bamboo", families: ["Bamboo"] },
  { id: "rattan", label: "Rattan & cane", families: ["Cane strand", "Synthetic rattan", "Reeded cane"] },
  { id: "fabric", label: "Fabric", families: ["Woven fabric", "Velvet"] },
  { id: "leather", label: "Leather & vinyl", families: ["Leather", "Vinyl"] },
  { id: "glass", label: "Glass", families: ["Glass"] },
  {
    id: "metal",
    label: "Metal",
    families: ["Brass", "Steel", "Stainless steel", "Aluminium", "Powder-coated steel", "Copper", "Wrought iron"],
  },
  { id: "stone", label: "Stone", families: ["Stone"] },
  { id: "plastic", label: "Plastic & composite", families: ["Composite", "Moulded polymer", "Outdoor polymer"] },
  { id: "other", label: "Other", families: [] },
];

const CATEGORY_BY_FAMILY = new Map(
  MATERIAL_CATEGORIES.flatMap((category) => category.families.map((family) => [family, category.id] as const))
);
const CATEGORY_LABEL = new Map(MATERIAL_CATEGORIES.map((category) => [category.id, category.label]));

export function materialCategoryOf(material: MaterialProfile): MaterialCategoryId {
  return (material.family && CATEGORY_BY_FAMILY.get(material.family)) || "other";
}

export function materialCategoryLabel(id: MaterialCategoryId): string {
  return CATEGORY_LABEL.get(id) ?? "Other";
}

/**
 * The categories a list actually contains, in the table's order, each with its
 * finishes already gathered under their family headings.
 *
 * A category with nothing in it is left out rather than shown empty: a part
 * that can only be timber offers no "Glass" chip to press and find nothing
 * behind. Takes the same `order` / `ranked` pair as `groupByFamily`, so the
 * advisor's ranking survives inside each category.
 */
export function groupByCategory<T extends { material: MaterialProfile }>(
  order: MaterialProfile[],
  ranked: T[]
): Array<{ category: MaterialCategoryId; label: string; count: number; families: Array<{ family: string | null; items: T[] }> }> {
  const families = groupByFamily(order, ranked);
  return MATERIAL_CATEGORIES.map(({ id, label }) => {
    const mine = families.filter(({ items }) => materialCategoryOf(items[0].material) === id);
    return { category: id, label, count: mine.reduce((sum, { items }) => sum + items.length, 0), families: mine };
  }).filter(({ count }) => count > 0);
}

export function hasAnyLifestyle(answers: LifestyleAnswers): boolean {
  // `who` is deliberately not counted: on its own it ranks nothing, so
  // treating it as an answer would mark the panel as advising when it is not.
  return (
    answers.pets ||
    answers.kids ||
    answers.outdoor ||
    answers.humid ||
    answers.sun ||
    answers.ages.length > 0 ||
    answers.budget !== null ||
    answers.styles.length > 0
  );
}
