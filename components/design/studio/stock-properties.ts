import { materialById, type MaterialProfile } from "./materials-db";

/**
 * The engineering properties of the stock a piece can be built from.
 *
 * `materials-db.ts` answers what a finish looks like and how it wears in daily
 * use. It cannot answer whether a leg will buckle or a shelf will sag, because
 * those need numbers a swatch does not carry: stiffness, bending strength,
 * density and surface hardness. This is that second table, kept separate for
 * the same reason the first one exists -- three different questions were about
 * to grow three different half-tables.
 *
 * WHAT THESE NUMBERS ARE, precisely, because a design analysis built on them
 * inherits whatever is claimed here:
 *
 *   - They are typical published values for air-dried stock at about 12%
 *     moisture content, clear and straight-grained, loaded in static bending.
 *     Philippine species are drawn from the FPRDI/Forest Products Research and
 *     Development Institute strength-grouping literature and the standard
 *     Philippine timber tables; imported species and non-timber stock from the
 *     USDA Wood Handbook and ordinary published material data.
 *   - They are NOT a specification for any particular board. Real timber varies
 *     by a third or more between two planks of one species depending on
 *     density, grain, knots and how dry it actually is. A furniture shop buying
 *     narra in Pampanga is not buying the number below; it is buying something
 *     scattered around it.
 *   - Therefore every calculation downstream carries a safety factor and every
 *     result is reported as an engineering estimate for a customer to react to
 *     and a furniture shop to confirm -- never as a promise about the finished piece.
 *
 * That last point is not decoration. The studio used to print its own price on
 * a design and that figure followed the order into the shop's quote box, so a
 * furniture shop was quoting against this app's table instead of its own stock. The
 * price came out. This table must not repeat the mistake in a new costume: it
 * informs a customer whether their proportions are sane, and it stops there.
 *
 * Ids match `MaterialProfile.id` and are permanent. A finish with no entry
 * falls back to its family, then to its type -- see `stockPropertiesFor`.
 */

export type StockClass =
  /** Sawn solid timber. Carries load, takes a joint, moves with humidity. */
  | "solid-timber"
  /** Laminated or sheet stock: plywood, MDF, particleboard. */
  | "panel"
  /** Bamboo, laminated or in the culm. Strong along the fibre, splits across it. */
  | "bamboo"
  /** Woven cane or rattan: a membrane in tension, not a beam. */
  | "weave"
  /** Upholstery. Carries nothing structurally. */
  | "textile"
  | "metal"
  | "glass"
  | "stone"
  | "polymer";

export type StockProperties = {
  /** Human name for the stock as an engineering material, not as a finish. */
  label: string;
  class: StockClass;
  /** kg/m^3, air-dry. Used for self-weight and therefore for stability. */
  densityKgM3: number;
  /**
   * Modulus of elasticity in bending, MPa. This is what decides deflection --
   * a sagging shelf is a stiffness failure, not a strength one.
   */
  modulusOfElasticityMPa: number;
  /**
   * Modulus of rupture (bending strength) in MPa. Where the stock actually
   * breaks. Compared against working stress with a safety factor applied.
   */
  modulusOfRuptureMPa: number;
  /**
   * Side hardness in kN (Janka, or its nearest equivalent). Resistance to
   * denting and wear on a surface people touch. Zero where the measure is
   * meaningless for the stock.
   */
  jankaKN: number;
  /**
   * Whether the stock can be a structural member -- a leg, a rail, a shelf.
   * False for upholstery and for a woven panel, which are real materials doing
   * real jobs that are not beam jobs.
   */
  structural: boolean;
  /**
   * True where the species is not actually stated by the finish. "Original"
   * is a photograph and a painted panel is a colour, not a timber, so
   * anything computed from them is a placeholder until the furniture shop names
   * the stock.
   */
  unspecified?: boolean;
  /** Anything a customer should know that the numbers do not say. */
  note?: string;
};

/**
 * Philippine hardwoods first, since they are what a Philippine furniture shop
 * actually mills, and their spread is the whole reason this table earns its
 * keep: yakal is roughly twice the timber falcata is, and a chair leg that is
 * fine in one is marginal in the other at the same size.
 */
const BY_ID: Record<string, StockProperties> = {
  // ---------------------------------------------------- Philippine hardwoods
  "wood-narra": {
    label: "Narra",
    class: "solid-timber",
    densityKgM3: 660,
    modulusOfElasticityMPa: 11000,
    modulusOfRuptureMPa: 88,
    jankaKN: 5.0,
    structural: true,
    note: "The classic Philippine cabinet timber: stable, works cleanly, holds a joint.",
  },
  "wood-molave": {
    label: "Molave",
    class: "solid-timber",
    densityKgM3: 740,
    modulusOfElasticityMPa: 11500,
    modulusOfRuptureMPa: 95,
    jankaKN: 5.9,
    structural: true,
    note: "Very durable and hard-wearing. Traditional for pieces meant to outlast their owner.",
  },
  "wood-yakal": {
    label: "Yakal",
    class: "solid-timber",
    densityKgM3: 830,
    modulusOfElasticityMPa: 16000,
    modulusOfRuptureMPa: 120,
    jankaKN: 7.1,
    structural: true,
    note: "One of the strongest local timbers. Heavy, and hard on tools.",
  },
  "wood-ipil": {
    label: "Ipil",
    class: "solid-timber",
    densityKgM3: 800,
    modulusOfElasticityMPa: 13000,
    modulusOfRuptureMPa: 100,
    jankaKN: 6.4,
    structural: true,
    note: "Dense and very durable, including outdoors.",
  },
  "wood-kamagong": {
    label: "Kamagong",
    class: "solid-timber",
    densityKgM3: 950,
    modulusOfElasticityMPa: 14000,
    modulusOfRuptureMPa: 110,
    jankaKN: 9.0,
    structural: true,
    note: "Philippine ebony. Extremely hard and heavy; supply is restricted and it is priced accordingly.",
  },

  "wood-tanguile": {
    label: "Tanguile",
    class: "solid-timber",
    densityKgM3: 550,
    modulusOfElasticityMPa: 10500,
    modulusOfRuptureMPa: 75,
    jankaKN: 3.6,
    structural: true,
    note: "The usual mid-weight furniture lauan. Easy to work, moderate strength.",
  },


  "wood-acacia": {
    label: "Acacia (raintree)",
    class: "solid-timber",
    densityKgM3: 600,
    modulusOfElasticityMPa: 8500,
    modulusOfRuptureMPa: 70,
    jankaKN: 3.9,
    structural: true,
    note: "Widely available in wide boards, so it is the usual choice for a one-piece top.",
  },

  // ------------------------------------------------- Plantation / fast-grown
  "wood-lanete": {
    label: "Lanete",
    class: "solid-timber",
    densityKgM3: 530,
    modulusOfElasticityMPa: 9000,
    modulusOfRuptureMPa: 70,
    jankaKN: 3.0,
    structural: true,
    note: "Close and even in the grain, which is why it is the carving timber. Moderate strength, so it is not a first choice for a long unsupported rail.",
  },
  "wood-calantas": {
    label: "Calantas",
    class: "solid-timber",
    densityKgM3: 430,
    modulusOfElasticityMPa: 8200,
    modulusOfRuptureMPa: 58,
    jankaKN: 2.2,
    structural: true,
    note: "Light and soft for a hardwood — the lightest here. Good for panels, drawer sides and casework; marginal for slim legs.",
  },
  "wood-dao": {
    label: "Dao",
    class: "solid-timber",
    densityKgM3: 520,
    modulusOfElasticityMPa: 9200,
    modulusOfRuptureMPa: 65,
    jankaKN: 2.8,
    structural: true,
    note: "Cut in wide boards, so a one-piece top is possible where other species would need a glue-up.",
  },
  "wood-katmon": {
    label: "Katmon",
    class: "solid-timber",
    densityKgM3: 700,
    modulusOfElasticityMPa: 11500,
    modulusOfRuptureMPa: 85,
    jankaKN: 4.5,
    structural: true,
    note: "Hard and stiff. Moves while it is drying, so it wants properly seasoned stock.",
  },
  "wood-bayok": {
    label: "Bayok",
    class: "solid-timber",
    densityKgM3: 560,
    modulusOfElasticityMPa: 9500,
    modulusOfRuptureMPa: 70,
    jankaKN: 3.0,
    structural: true,
    note: "A mid-weight secondary timber. Works easily and takes a finish without fuss.",
  },
  "wood-bayanti": {
    label: "Bayanti",
    class: "solid-timber",
    // Deliberately the most conservative figures in this table. Bayanti is a
    // regional trade name rather than a nationally graded species, so these
    // are the low end of what a mid-weight Philippine hardwood does. The
    // analysis should under-promise on a stock it cannot pin down, never over.
    densityKgM3: 550,
    modulusOfElasticityMPa: 9000,
    modulusOfRuptureMPa: 65,
    jankaKN: 2.9,
    structural: true,
    note: "Figures are indicative: bayanti is a regional name covering more than one stock, so confirm the actual board with the shop.",
  },
  "wood-benguet-pine": {
    label: "Benguet pine",
    class: "solid-timber",
    densityKgM3: 530,
    modulusOfElasticityMPa: 9500,
    modulusOfRuptureMPa: 72,
    jankaKN: 2.6,
    structural: true,
    note: "Stiff for its weight, but soft on the surface and it dents. Resinous, so it needs sealing before a finish will hold.",
  },
  "wood-almaciga": {
    label: "Almaciga",
    class: "solid-timber",
    densityKgM3: 480,
    modulusOfElasticityMPa: 9000,
    modulusOfRuptureMPa: 65,
    jankaKN: 2.3,
    structural: true,
    note: "Even and easy to work, and soft. Better under paint than under a clear finish, and better in a panel than in a leg.",
  },
  "wood-gmelina": {
    label: "Gmelina",
    class: "solid-timber",
    densityKgM3: 450,
    modulusOfElasticityMPa: 7500,
    modulusOfRuptureMPa: 60,
    jankaKN: 2.4,
    structural: true,
    note: "Plantation-grown and cheap. Soft enough that edges and surfaces dent in daily use.",
  },





  // ------------------------------------------------------ Imported hardwoods






  // ------------------------------------------------------------ Not a species

  // ------------------------------------------------------------------ Bamboo
  "bamboo-natural": {
    label: "Laminated bamboo",
    class: "bamboo",
    densityKgM3: 700,
    modulusOfElasticityMPa: 11000,
    modulusOfRuptureMPa: 95,
    jankaKN: 6.0,
    structural: true,
    note: "Very strong along the fibre and weak across it, so it takes a glued lamination rather than a cut joint.",
  },

  // ------------------------------------------------------- Engineered panels
  "panel-marine-ply": {
    label: "Marine plywood",
    class: "panel",
    densityKgM3: 650,
    modulusOfElasticityMPa: 7000,
    modulusOfRuptureMPa: 45,
    jankaKN: 2.8,
    structural: true,
    note: "Stable, water-resistant glue line, and stiff in the face grain direction it is laid up for.",
  },
  "panel-laminate-oak": {
    label: "Laminated particleboard",
    class: "panel",
    densityKgM3: 680,
    modulusOfElasticityMPa: 2500,
    modulusOfRuptureMPa: 15,
    jankaKN: 1.5,
    structural: true,
    note: "Cheap and flat, and the weakest board here. It sags under load over any real span and its edges will not hold a screw twice.",
  },
  "panel-mdf-white": {
    label: "Painted MDF",
    class: "panel",
    densityKgM3: 750,
    modulusOfElasticityMPa: 3200,
    modulusOfRuptureMPa: 30,
    jankaKN: 1.8,
    structural: true,
    note: "Takes paint better than anything else here and swells permanently if it gets wet.",
  },

  // ------------------------------------------------------------------- Weave
  "cane-honey": {
    label: "Woven cane",
    class: "weave",
    densityKgM3: 350,
    modulusOfElasticityMPa: 4500,
    modulusOfRuptureMPa: 55,
    jankaKN: 0,
    structural: false,
    note: "A caned panel works in tension across its frame, like a drum skin. It carries weight well and spans badly.",
  },
  "synth-slate": {
    label: "All-weather polymer weave",
    class: "weave",
    densityKgM3: 400,
    modulusOfElasticityMPa: 900,
    modulusOfRuptureMPa: 25,
    jankaKN: 0,
    structural: false,
    note: "Woven over a frame that does the structural work. Holds up to sun and rain far better than natural cane.",
  },
};

/** Fallbacks by family, for finishes that share a stock with their neighbours. */
const BY_FAMILY: Record<string, StockProperties> = {
  Bamboo: BY_ID["bamboo-natural"],
  "Engineered panel": BY_ID["panel-mdf-white"],
  "Cane strand": BY_ID["cane-honey"],
  "Reeded cane": BY_ID["cane-honey"],
  "Synthetic rattan": BY_ID["synth-slate"],
  // Tanguile rather than the hardest or the softest on the list: a finish
  // that falls through to this fallback is one with no stock entry of its
  // own, and the honest guess for an unnamed Philippine hardwood is the one
  // a furniture shop reaches for by default, not narra and not gmelina.
  Hardwood: BY_ID["wood-tanguile"],
  "Plantation timber": BY_ID["wood-gmelina"],
  Softwood: BY_ID["wood-benguet-pine"],
};

/**
 * Timber whose species nobody has stated.
 *
 * This used to be an entry in the table above, keyed "wood-original" -- the
 * id of the catalogue's "Original" finish, which no longer exists: a customer
 * now opens every model on a named timber, so "as shown" is not a stock
 * anybody can pick. It is still reachable, and has to be: a piece generated
 * from a photograph arrives with no finish named, and a hand-picked colour
 * belongs to no species either. Mid-range hardwood, and the analysis says so
 * rather than scoring the piece as though the timber were known.
 */
const UNSPECIFIED_TIMBER: StockProperties = {
  label: "Timber, species not stated",
  class: "solid-timber",
  densityKgM3: 550,
  modulusOfElasticityMPa: 10000,
  modulusOfRuptureMPa: 72,
  jankaKN: 3.5,
  structural: true,
  unspecified: true,
  note: "No species chosen, so this uses mid-range hardwood values. Pick a timber to analyse the piece properly.",
};

/**
 * Last resort, by material type. Deliberately conservative: an unknown stock
 * should not score better than a known one.
 */
const BY_TYPE: Record<MaterialProfile["type"], StockProperties> = {
  wood: UNSPECIFIED_TIMBER,
  rattan: BY_ID["cane-honey"],
  fabric: {
    label: "Upholstery fabric",
    class: "textile",
    densityKgM3: 250,
    modulusOfElasticityMPa: 0,
    modulusOfRuptureMPa: 0,
    jankaKN: 0,
    structural: false,
  },
  leather: {
    label: "Leather / vinyl",
    class: "textile",
    densityKgM3: 300,
    modulusOfElasticityMPa: 0,
    modulusOfRuptureMPa: 0,
    jankaKN: 0,
    structural: false,
  },
  metal: {
    label: "Steel",
    class: "metal",
    densityKgM3: 7850,
    modulusOfElasticityMPa: 200000,
    // Yield rather than rupture: steel bends long before it breaks, and a
    // permanently bent leg is already a failed piece.
    modulusOfRuptureMPa: 250,
    jankaKN: 0,
    structural: true,
  },
  glass: {
    label: "Glass",
    class: "glass",
    densityKgM3: 2500,
    modulusOfElasticityMPa: 70000,
    // Annealed glass, and the number is why: it fails suddenly, with no warning
    // and no bend first, which is what the safety factor downstream respects.
    modulusOfRuptureMPa: 40,
    jankaKN: 0,
    structural: true,
    note: "Brittle. It gives no warning before it breaks, so a glass component is analysed with a heavier safety margin than timber.",
  },
  stone: {
    label: "Stone",
    class: "stone",
    densityKgM3: 2700,
    modulusOfElasticityMPa: 50000,
    modulusOfRuptureMPa: 12,
    jankaKN: 0,
    structural: true,
    note: "Immensely stiff and weak in bending — a stone top needs continuous support, not a span.",
  },
  plastic: {
    label: "Moulded polymer",
    class: "polymer",
    densityKgM3: 950,
    modulusOfElasticityMPa: 1400,
    modulusOfRuptureMPa: 30,
    jankaKN: 0,
    structural: true,
  },
};

const BY_ID_EXTRA: Record<string, StockProperties> = {
  "metal-aluminium": {
    label: "Anodised aluminium",
    class: "metal",
    densityKgM3: 2700,
    modulusOfElasticityMPa: 69000,
    modulusOfRuptureMPa: 240,
    jankaKN: 0,
    structural: true,
  },
  "metal-brass": {
    label: "Brass",
    class: "metal",
    densityKgM3: 8500,
    modulusOfElasticityMPa: 100000,
    modulusOfRuptureMPa: 200,
    jankaKN: 0,
    structural: true,
  },
  "glass-tempered": {
    label: "Tempered glass",
    class: "glass",
    densityKgM3: 2500,
    modulusOfElasticityMPa: 70000,
    // Roughly four times annealed, and it breaks into blunt granules rather
    // than shards. The only glass worth putting where somebody sits.
    modulusOfRuptureMPa: 160,
    jankaKN: 0,
    structural: true,
    note: "Four times the bending strength of ordinary glass, and it breaks into blunt granules instead of shards.",
  },
  "stone-black-granite": {
    label: "Granite",
    class: "stone",
    densityKgM3: 2650,
    modulusOfElasticityMPa: 60000,
    modulusOfRuptureMPa: 15,
    jankaKN: 0,
    structural: true,
  },
  "plastic-hdpe-marine": {
    label: "Marine HDPE",
    class: "polymer",
    densityKgM3: 960,
    modulusOfElasticityMPa: 900,
    modulusOfRuptureMPa: 25,
    jankaKN: 0,
    structural: true,
  },
  "plastic-acrylic-clear": {
    label: "Acrylic",
    class: "polymer",
    densityKgM3: 1180,
    modulusOfElasticityMPa: 3000,
    modulusOfRuptureMPa: 70,
    jankaKN: 0,
    structural: true,
    note: "Stiffer than it looks and prone to crazing where it is stressed at a fixing.",
  },
};

/**
 * The stock behind a finish.
 *
 * Resolution walks id, then family, then type, so a new swatch added to an
 * existing family is analysed correctly the day it lands rather than falling
 * through to a default nobody checked.
 */
export function stockPropertiesFor(material: MaterialProfile | null | undefined): StockProperties {
  if (!material) return BY_TYPE.wood;
  return (
    BY_ID[material.id] ??
    BY_ID_EXTRA[material.id] ??
    (material.family ? BY_FAMILY[material.family] : undefined) ??
    BY_TYPE[material.type] ??
    BY_TYPE.wood
  );
}

/** Convenience for callers holding only an id. */
export function stockPropertiesById(id: string | null | undefined): StockProperties {
  return stockPropertiesFor(materialById(id ?? undefined));
}
