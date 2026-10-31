import type { MaterialProfile, Varnish } from "./materials-db";
import { stockPropertiesFor, type StockProperties } from "./stock-properties";
import type { PartId } from "./studio-config";
import type { MemberSurvey, StructureSurvey } from "./structure-survey";

/**
 * Design analysis: does this piece stand up, and is it specified in stock that
 * suits the job?
 *
 * Two scores, because they answer two different questions and a customer can
 * fix them independently. DURABILITY is about the piece as posed -- spans,
 * sections and proportions -- and moves when a slider moves. MATERIAL QUALITY
 * is about the stock and the seal chosen for each part, and moves when a
 * swatch changes. A slender leg in yakal and a chunky leg in falcata are
 * different failures and deserve to be told apart.
 *
 * ------------------------------------------------------------------ HONESTY
 *
 * Every check below computes a real physical quantity first -- a slenderness
 * ratio, a deflection in millimetres, a bending stress in MPa, a tipping angle
 * in degrees -- and only then maps it onto a percentage. The percentage is a
 * presentation of the number, never a substitute for it, which is why every
 * check carries its own `detail` string with the actual figures and its
 * `basis`. A customer who wants to know why their chair scores 62 can read
 * "seat rail deflects 3.1mm over a 44cm span; the limit for no visible sag is
 * 2.2mm" and either accept it or drag a slider.
 *
 * What this is NOT, and the studio has made this mistake before. It once
 * printed its own price on a design, and that figure followed the order into
 * the furniture shop's quote box, so a shop was quoting against this app's table
 * rather than its own stock. The price was removed. This analysis must not
 * become the same thing wearing an engineer's hat: it is an estimate from
 * published typical properties (see stock-properties.ts) using textbook beam
 * and column formulas with furniture safety factors. It tells a customer
 * whether their proportions are sane before they send the design. The furniture shop
 * that builds it remains the authority on whether it can be built, and on what
 * timber actually goes into it.
 *
 * ---------------------------------------------------------------- DATA SAFETY
 *
 * Pure. No I/O, no storage, no database. It takes a survey derived from the
 * live rig and returns an object that lives as long as the studio is open.
 * Nothing here adds a column, a migration, or a field inside a saved design,
 * and there is deliberately no stored score anywhere: a score written down
 * beside a design is a second source of truth that goes stale the moment
 * somebody drags a slider, and a stale durability figure on an order is worse
 * than no figure at all.
 */

// ---------------------------------------------------------------- test loads
//
// The numbers a piece of furniture is actually proved against, taken from the
// domestic furniture test standards rather than invented. They are static
// loads, applied at the point the standard applies them.

/**
 * Static downward load on a seat. EN 1728 / BS EN 12520 domestic seating and
 * ANSI-BIFMA X5.1 all sit around this figure; 1300 N is roughly a 130 kg
 * person, which is the point of testing to it rather than to an average one.
 */
const SEAT_LOAD_N = 1300;
/** Static rearward load on a backrest, per the same family of tests. */
const BACK_LOAD_N = 410;
/** For stability: a person, and how far above the seat their mass sits. */
const OCCUPANT_MASS_KG = 75;
const SEATED_COM_ABOVE_SEAT_CM = 22;
/**
 * Domestic shelving, N/m^2. A shelf packed with books runs about 40 kg per
 * metre of run; over a 300mm deep shelf that is ~1.3 kN/m^2, which is the
 * figure bookshelf sag is normally checked against.
 */
const SHELF_LOAD_N_M2 = 1300;
/** Domestic table and worktop surfaces, N/m^2. */
const TABLE_LOAD_N_M2 = 1000;

/**
 * Working stress is the stock's rupture strength divided by this. Three is the
 * usual furniture figure: it covers the spread between one plank and the next,
 * the difference between a static test and somebody dropping into a chair, and
 * the long-term creep that makes timber sag more at year ten than on day one.
 */
const TIMBER_SAFETY_FACTOR = 3;
/**
 * Glass and stone get double, because they fail without bending first. There
 * is no warning creak before a glass shelf lets go.
 */
const BRITTLE_SAFETY_FACTOR = 6;

/**
 * Effective length factor for a furniture leg: fixed into the seat rails at the
 * top, standing on the floor at the bottom, and free to sway. The textbook
 * conservative case, and the right one for a frame with no diagonal bracing.
 */
const LEG_EFFECTIVE_LENGTH_FACTOR = 2;

/**
 * The slenderness ceiling for a solid timber column, from timber design
 * practice (NDS §3.7: le/d must not exceed 50). Below 35 a leg is comfortable;
 * past 50 it is not a column any more.
 */
const SLENDERNESS_LIMIT = 50;
const SLENDERNESS_COMFORTABLE = 35;

/**
 * Deflection limits as a fraction of span. Sag becomes visible on a horizontal
 * member at about span/300 and objectionable at span/200, which is the limit
 * shelving is normally designed to.
 */
const DEFLECTION_VISIBLE = 300;
const DEFLECTION_LIMIT = 200;

/**
 * Effective thickness of a woven panel, cm: strand diameter times how much of
 * the panel is strand rather than hole. A weave's material is its area times
 * this, never the volume its mesh encloses.
 */
const WEAVE_EFFECTIVE_THICKNESS_CM = 0.24;

/** A woven seat panel dishes and stretches beyond about this clear span. */
const WEAVE_SPAN_COMFORTABLE_CM = 45;
const WEAVE_SPAN_LIMIT_CM = 55;

/**
 * Joinery minimums, in mm. A mortise-and-tenon tenon runs about a third of the
 * thickness of the member it enters, and under a 6mm tenon there is nothing
 * left to glue -- so a leg wants 20mm of section at the joint before anything
 * traditional is possible, and 28mm before it is comfortable. A rail shallower
 * than 25mm has no room for a tenon worth cutting and drops back to dowels.
 */
const LEG_MIN_SECTION_MM = 20;
const LEG_COMFORTABLE_SECTION_MM = 28;
const RAIL_MIN_DEPTH_MM = 25;
const RAIL_COMFORTABLE_DEPTH_MM = 45;

export type CheckStatus = "pass" | "watch" | "fail";

export type AnalysisCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  /** 0-100 for this check alone. */
  score: number;
  /** Relative importance within its score. */
  weight: number;
  /** The physical result, in the units it was computed in. */
  detail: string;
  /** What to change, when it is not a pass. */
  advice?: string;
  /** The rule or formula this was measured against. */
  basis: string;
};

export type ScoreBand = "rework" | "marginal" | "sound" | "robust";

export type ScoreBlock = {
  /** 0-100, rounded. Meaningless unless `analysable` is true. */
  score: number;
  band: ScoreBand;
  /**
   * False when no check applied to this piece at all. A score of zero and no
   * way to measure one are different statements, and showing "0%" for the
   * second is a lie about the design rather than a verdict on it.
   */
  analysable: boolean;
  checks: AnalysisCheck[];
};

export type DesignAnalysis = {
  durability: ScoreBlock;
  quality: ScoreBlock;
  /** Everything that is not a pass, worst first. */
  concerns: AnalysisCheck[];
  /** Notes that are true and worth saying but must not move a score. */
  notes: string[];
  /** Total mass of the piece as specified, kg. */
  massKg: number;
};

export type AnalysisInput = {
  survey: StructureSurvey;
  /** The catalogue finish resolved for each part, as the renderer resolved it. */
  stockByPart: Partial<Record<PartId, MaterialProfile | null>>;
  varnishByPart: Partial<Record<PartId, Varnish>>;
  /** Whether this piece is sat on, which decides which loads apply. */
  isSeating: boolean;
};

// ------------------------------------------------------------------ helpers

/** 100 at `good`, 0 at `bad`, linear between. Works in either direction. */
function ramp(value: number, good: number, bad: number): number {
  if (good === bad) return value <= good ? 100 : 0;
  const t = (value - bad) / (good - bad);
  return Math.max(0, Math.min(100, t * 100));
}

function statusFor(score: number): CheckStatus {
  if (score >= 70) return "pass";
  if (score >= 45) return "watch";
  return "fail";
}

function bandFor(score: number): ScoreBand {
  if (score >= 85) return "robust";
  if (score >= 70) return "sound";
  if (score >= 45) return "marginal";
  return "rework";
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  rework: "Needs rework",
  marginal: "Marginal",
  sound: "Sound",
  robust: "Robust",
};

function round(value: number, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Combines checks into a score.
 *
 * A weighted mean, with one guardrail: a single outright failure caps the
 * total, because a piece with a leg that buckles is not "sound overall" no
 * matter how good its shelf spans are. Averaging a failure away is how a
 * scoring system ends up reassuring somebody about a chair that collapses.
 */
const FAIL_CAP = 45;

function combine(checks: AnalysisCheck[]): ScoreBlock {
  if (checks.length === 0) {
    return { score: 0, band: "marginal", analysable: false, checks };
  }
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const mean = checks.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight;
  const capped = checks.some((check) => check.status === "fail") ? Math.min(mean, FAIL_CAP) : mean;
  const score = Math.round(capped);
  return { score, band: bandFor(score), analysable: true, checks };
}

function make(
  check: Omit<AnalysisCheck, "status"> & { status?: CheckStatus }
): AnalysisCheck {
  // Rounded here rather than at the point of display. The ramps return
  // continuous values, so an unrounded score reaches anything that renders one
  // as "54.8920505431103%" -- which is what it did. The status is taken from
  // the raw value first, so a check on a band edge is not moved by the
  // rounding.
  return {
    ...check,
    status: check.status ?? statusFor(check.score),
    score: Math.round(check.score),
  };
}

/** Second moment of area of a rectangle, mm^4, bending about the `depth` axis. */
function rectangularI(widthMm: number, depthMm: number): number {
  return (widthMm * depthMm ** 3) / 12;
}

/**
 * Second moment of area of a compact solid section known only by its area.
 * A square of area A has I = A^2/12; a circle of the same area has A^2/(4pi),
 * about 5% less. The difference is far inside the scatter of the timber, so a
 * turned leg and a square one are treated alike.
 */
function compactI(areaMm2: number): number {
  return areaMm2 ** 2 / 12;
}

function safetyFactorFor(stock: StockProperties): number {
  return stock.class === "glass" || stock.class === "stone"
    ? BRITTLE_SAFETY_FACTOR
    : TIMBER_SAFETY_FACTOR;
}

type Resolved = {
  member: MemberSurvey;
  material: MaterialProfile | null;
  stock: StockProperties;
  varnish: Varnish | null;
};

/**
 * How much material is actually in a part, cm^3.
 *
 * Solid stock is its volume. A weave is its surface area times a strand
 * thickness, because the mesh of a caned shell encloses the chair rather than
 * describing the cane -- taken as a solid it made a rattan patio chair weigh
 * 33 kg. The smaller of the two is used, so a weave modelled as flat strands
 * rather than as a shell is still measured as itself.
 */
function materialVolumeCm3(entry: Resolved): number {
  const { volumeCm3, surfaceAreaCm2 } = entry.member;
  if (entry.stock.class !== "weave") return volumeCm3;
  const fromArea = surfaceAreaCm2 * WEAVE_EFFECTIVE_THICKNESS_CM;
  return fromArea > 0 ? Math.min(volumeCm3, fromArea) : volumeCm3;
}

/**
 * The section of a horizontal rail, in mm.
 *
 * Two shapes arrive here. A rail modelled as its own mesh gives its section
 * directly. A seat frame modelled as one closed ring gives a volume covering
 * all four rails at once, and dividing that by the ring's width would report a
 * rail four times too fat -- so a ring is detected by being wide AND deep
 * relative to its height, and its volume is divided by its perimeter instead.
 */
function railSection(member: MemberSurvey): { widthMm: number; depthMm: number } {
  const depthMm = member.each.h * 10;
  const isRing = member.each.w > 3 * member.each.h && member.each.d > 3 * member.each.h;
  if (isRing && member.volumeCm3 > 0 && member.each.h > 0) {
    const perimeterCm = 2 * (member.each.w + member.each.d);
    const sectionCm2 = member.volumeCm3 / perimeterCm;
    return { widthMm: (sectionCm2 / member.each.h) * 10, depthMm };
  }
  const widthMm = member.each.h > 0 ? (member.sectionAreaCm2 / member.each.h) * 10 : 0;
  return { widthMm, depthMm };
}

// ------------------------------------------------------------------ the run

export function analyseDesign(input: AnalysisInput): DesignAnalysis {
  const { survey, stockByPart, varnishByPart, isSeating } = input;

  const resolved: Resolved[] = survey.members.map((member) => {
    const material = stockByPart[member.id] ?? null;
    return {
      member,
      material,
      stock: stockPropertiesFor(material),
      varnish: varnishByPart[member.id] ?? null,
    };
  });

  const byRole = (...roles: MemberSurvey["role"][]) =>
    resolved.filter((entry) => roles.includes(entry.member.role));

  const durability: AnalysisCheck[] = [];
  const quality: AnalysisCheck[] = [];
  const notes: string[] = [];

  // ---------------------------------------------------------------- mass
  //
  // Real mass from real volumes and real densities, which is what makes the
  // stability check below mean anything.
  const massKg = resolved.reduce((sum, entry) => {
    const volumeM3 = (materialVolumeCm3(entry) * entry.member.count) / 1_000_000;
    return sum + volumeM3 * entry.stock.densityKgM3;
  }, 0);

  // ------------------------------------------------------- legs as columns
  const base = byRole("base")[0];
  /** A set of legs, as opposed to a solid frame or a woven shell. */
  const legs =
    base && base.member.count >= 2 && base.member.axis === "y" ? base : null;

  if (legs) {
    const { member, stock } = legs;
    const sideMm = Math.sqrt(member.sectionAreaCm2) * 10;
    const lengthMm = member.lengthCm * 10;
    const effectiveMm = lengthMm * LEG_EFFECTIVE_LENGTH_FACTOR;
    const slenderness = sideMm > 0 ? effectiveMm / sideMm : Infinity;

    const areaMm2 = member.sectionAreaCm2 * 100;
    const criticalN =
      (Math.PI ** 2 * stock.modulusOfElasticityMPa * compactI(areaMm2)) / effectiveMm ** 2;
    const appliedN = (isSeating ? SEAT_LOAD_N : massKg * 9.81 * 3) / member.count;
    const bucklingMargin = appliedN > 0 ? criticalN / appliedN : Infinity;

    // Slenderness governs, with the buckling margin able to pull it down: a
    // stubby leg in a very weak stock can still be the wrong answer.
    const slendernessScore = ramp(slenderness, SLENDERNESS_COMFORTABLE, SLENDERNESS_LIMIT);
    const marginScore = ramp(bucklingMargin, 8, 2);
    const score = Math.min(slendernessScore, marginScore);

    durability.push(
      make({
        id: "leg-columns",
        label: "Legs as columns",
        score,
        weight: 3,
        detail: `${member.count} legs, ${round(Math.sqrt(member.sectionAreaCm2), 1)} cm equivalent square × ${round(member.lengthCm)} cm. Slenderness ${round(slenderness)} (limit ${SLENDERNESS_LIMIT}). Buckling margin ${bucklingMargin > 99 ? "99+" : round(bucklingMargin)}× the ${round(appliedN / 1000, 2)} kN each carries.`,
        advice:
          score < 70
            ? slendernessScore <= marginScore
              ? "Thicken the legs or shorten them. Slenderness climbs with the square of length, so a small drop in height buys a lot."
              : `Move to a stiffer timber, or thicken the legs — ${stock.label} is on the soft side for a leg this slim.`
            : undefined,
        basis: `Euler buckling, effective length ${LEG_EFFECTIVE_LENGTH_FACTOR}× (fixed at the rail, free to sway). Slenderness against the le/d ≤ 50 timber column limit.`,
      })
    );

  } else if (base) {
    notes.push(
      `${base.member.label} is a one-piece ${base.stock.label.toLowerCase()} frame rather than a set of legs, so it is not analysed as a column — its strength is in the form, which this cannot measure.`
    );
  }

  // ------------------------------------------------- seat rails / aprons
  const rail = byRole("seatFrame", "apron", "tabletopBorder")[0];
  /** Rail depth at the joint, mm. Zero where the piece has no rail at all. */
  let railDepthMm = 0;
  if (rail && rail.stock.structural && rail.member.each.h > 0) {
    const { member, stock } = rail;
    const { widthMm, depthMm } = railSection(member);
    railDepthMm = depthMm;

    // The clear span between legs along the wider axis, which is the one that
    // governs. Leg thickness comes off each end where there are legs to take it.
    const legInsetCm = legs ? Math.sqrt(legs.member.sectionAreaCm2) : 0;
    const spanCm = Math.max(4, Math.max(member.span.w, member.span.d) - 2 * legInsetCm);
    const spanMm = spanCm * 10;

    // Half the seat load carried by the governing rail, spread along it.
    const loadN = isSeating ? SEAT_LOAD_N / 2 : (TABLE_LOAD_N_M2 * (member.span.w * member.span.d)) / 20_000;
    const wPerMm = loadN / spanMm;

    const I = rectangularI(widthMm, depthMm);
    const momentNmm = (wPerMm * spanMm ** 2) / 8;
    const stressMPa = I > 0 ? (momentNmm * (depthMm / 2)) / I : Infinity;
    const allowableMPa = stock.modulusOfRuptureMPa / safetyFactorFor(stock);
    const deflectionMm =
      I > 0 ? (5 * wPerMm * spanMm ** 4) / (384 * stock.modulusOfElasticityMPa * I) : Infinity;
    const visibleLimitMm = spanMm / DEFLECTION_VISIBLE;
    const hardLimitMm = spanMm / DEFLECTION_LIMIT;

    const strengthScore = ramp(stressMPa / allowableMPa, 0.4, 1);
    const stiffnessScore = ramp(deflectionMm, visibleLimitMm, hardLimitMm);

    durability.push(
      make({
        id: "rail-strength",
        label: isSeating ? "Seat rail strength" : "Frame strength",
        score: strengthScore,
        weight: 3,
        detail: `${round(stressMPa)} MPa working stress against ${round(allowableMPa)} MPa allowable in ${stock.label}, on a ${round(spanCm)} cm span carrying ${round(loadN / 1000, 2)} kN.`,
        advice:
          strengthScore < 70
            ? "Deepen the rail, shorten the span, or move to a stronger timber. Depth is the cheapest of the three — strength rises with the square of it."
            : undefined,
        basis: `Simply supported beam under a distributed load, σ = Mc/I, against rupture strength ÷ ${safetyFactorFor(stock)}.`,
      })
    );
    durability.push(
      make({
        id: "rail-deflection",
        label: isSeating ? "Seat rail sag" : "Frame sag",
        score: stiffnessScore,
        weight: 2,
        detail: `${round(deflectionMm, 2)} mm of sag over ${round(spanCm)} cm. Visible from about ${round(visibleLimitMm, 2)} mm; ${round(hardLimitMm, 2)} mm is the limit.`,
        advice:
          stiffnessScore < 70
            ? "Deepen the rail or shorten the span. Sag rises with the cube of depth, so 10 mm more depth is worth far more than a stiffer timber."
            : undefined,
        basis: `δ = 5wL⁴/384EI against a span/${DEFLECTION_LIMIT} limit.`,
      })
    );
  }

  // ---------------------------------------------------------- the joinery
  //
  // A mortise and tenon is a fact about two members at once: the leg has to be
  // thick enough to be mortised without splitting, and the rail deep enough to
  // give the tenon a face worth gluing. Scoring the leg alone would pass a
  // chunky leg joined to a rail too shallow to hold it.
  if (legs) {
    const legSectionMm = Math.sqrt(legs.member.sectionAreaCm2) * 10;
    const legScore = ramp(legSectionMm, LEG_COMFORTABLE_SECTION_MM, LEG_MIN_SECTION_MM);
    const railScore =
      railDepthMm > 0 ? ramp(railDepthMm, RAIL_COMFORTABLE_DEPTH_MM, RAIL_MIN_DEPTH_MM) : 100;
    const jointScore = Math.min(legScore, railScore);
    const legGoverns = legScore <= railScore;

    durability.push(
      make({
        id: "joinery",
        label: "Room for a joint",
        score: jointScore,
        weight: 1.5,
        detail:
          railDepthMm > 0
            ? `${round(legSectionMm)} mm of leg to mortise into, ${round(railDepthMm)} mm of rail to tenon. Cut joinery wants ${LEG_COMFORTABLE_SECTION_MM} mm and ${RAIL_COMFORTABLE_DEPTH_MM} mm; below ${LEG_MIN_SECTION_MM} mm and ${RAIL_MIN_DEPTH_MM} mm there is nothing left to glue.`
            : `${round(legSectionMm)} mm of leg section at the joint. Cut joinery wants ${LEG_COMFORTABLE_SECTION_MM} mm or more; under ${LEG_MIN_SECTION_MM} mm there is no tenon left to glue.`,
        advice:
          jointScore < 70
            ? legGoverns
              ? "Thicken the legs, or accept dowelled or bolted joints instead of cut joinery."
              : "Deepen the seat rails. A shallow rail gives the tenon almost no glue face, and that joint is the one that works loose."
            : undefined,
        basis: `A tenon runs about a third of the thickness of the member it enters, and under 6 mm of tenon there is no glue area worth having.`,
      })
    );
  }

  // -------------------------------------------------------------- shelves
  const shelf = byRole("shelf")[0];
  if (shelf && shelf.member.each.w > 0 && shelf.member.each.d > 0) {
    const { member, stock } = shelf;
    const spanMm = member.each.w * 10;
    const depthMm = member.each.d * 10;
    const thicknessMm =
      member.each.d > 0 ? (member.sectionAreaCm2 / member.each.d) * 10 : member.each.h * 10;

    const areaM2 = (member.each.w * member.each.d) / 10_000;
    const loadN = SHELF_LOAD_N_M2 * areaM2;
    const wPerMm = loadN / spanMm;
    const I = rectangularI(depthMm, thicknessMm);
    const deflectionMm =
      I > 0 ? (5 * wPerMm * spanMm ** 4) / (384 * stock.modulusOfElasticityMPa * I) : Infinity;
    const hardLimitMm = spanMm / DEFLECTION_LIMIT;
    const visibleLimitMm = spanMm / DEFLECTION_VISIBLE;
    const score = ramp(deflectionMm, visibleLimitMm, hardLimitMm);

    durability.push(
      make({
        id: "shelf-sag",
        label: "Shelf sag",
        score,
        weight: 2.5,
        detail: `${round(deflectionMm, 1)} mm over a ${round(member.each.w)} cm span in ${round(thicknessMm)} mm ${stock.label.toLowerCase()}, loaded as full shelving. The limit is ${round(hardLimitMm, 1)} mm.`,
        advice:
          score < 70
            ? "Thicken the shelf, shorten the span with a divider, or add a front edge lip — a 20 mm lip on its edge stiffens a shelf more than doubling its thickness."
            : undefined,
        basis: `δ = 5wL⁴/384EI at ${SHELF_LOAD_N_M2} N/m² (domestic shelving, books), against span/${DEFLECTION_LIMIT}.`,
      })
    );
  }

  // ---------------------------------------------------- woven seat panels
  const weave = resolved.find(
    (entry) =>
      (entry.member.role === "seatCushion" || entry.member.role === "backCushion") &&
      entry.stock.class === "weave"
  );
  if (weave) {
    const clearSpanCm = Math.min(weave.member.span.w, weave.member.span.d);
    const score = ramp(clearSpanCm, WEAVE_SPAN_COMFORTABLE_CM, WEAVE_SPAN_LIMIT_CM);
    durability.push(
      make({
        id: "weave-span",
        label: "Woven panel span",
        score,
        weight: 1.5,
        detail: `${round(clearSpanCm)} cm across the weave. Past about ${WEAVE_SPAN_COMFORTABLE_CM} cm a woven panel dishes under use; ${WEAVE_SPAN_LIMIT_CM} cm needs a centre support.`,
        advice:
          score < 70
            ? "Narrow the seat, or ask the furniture shop for a centre rail under the weave."
            : undefined,
        basis: "A caned panel works in tension like a drum skin: it carries load well and spans badly.",
      })
    );
  }

  // ------------------------------------------------------------ stability
  //
  // Where the mass actually is, against the ground the piece actually stands
  // on. The occupant dominates a seat, so they are part of the sum.
  if (survey.footprint) {
    let mass = 0;
    let comX = 0;
    let comY = 0;
    let comZ = 0;
    for (const entry of resolved) {
      const volumeM3 = (materialVolumeCm3(entry) * entry.member.count) / 1_000_000;
      const kg = volumeM3 * entry.stock.densityKgM3;
      mass += kg;
      comX += entry.member.centroid.x * kg;
      comY += entry.member.centroid.y * kg;
      comZ += entry.member.centroid.z * kg;
    }
    const seat = resolved.find((entry) => entry.member.role === "seatCushion" || entry.member.role === "seatFrame");
    if (isSeating && seat) {
      const kg = OCCUPANT_MASS_KG;
      mass += kg;
      comX += seat.member.centroid.x * kg;
      comY += (survey.seatHeightCm + SEATED_COM_ABOVE_SEAT_CM) * kg;
      comZ += seat.member.centroid.z * kg;
    }

    if (mass > 0) {
      comX /= mass;
      comY /= mass;
      comZ /= mass;

      const { minX, maxX, minZ, maxZ } = survey.footprint;
      const reaches = [comX - minX, maxX - comX, comZ - minZ, maxZ - comZ];
      const worstReachCm = Math.max(0, Math.min(...reaches));
      const tipDegrees = comY > 0 ? (Math.atan(worstReachCm / comY) * 180) / Math.PI : 90;
      // Calibrated against pieces that exist rather than against a round
      // number: an ordinary dining chair with someone on it works out near 20
      // degrees and must pass cleanly, while a tall stool on a narrow base
      // lands around 10 and deserves a flag rather than a condemnation --
      // those are sold, and they really are tippy. Below about 5 degrees a
      // piece goes over when somebody leans, which is a fault.
      const score = ramp(tipDegrees, 15, 5);

      durability.push(
        make({
          id: "stability",
          label: "Stability",
          score,
          weight: 2.5,
          detail: `Tips at ${round(tipDegrees)}° ${isSeating && seat ? "with someone sitting on it" : "unloaded"}. Centre of mass ${round(comY)} cm up, ${round(worstReachCm)} cm inside the nearest edge of the footprint.`,
          advice:
            score < 70
              ? "Widen the stance or lower the seat. Splaying the legs outward costs nothing in material and buys the most."
              : undefined,
          basis: `Static tipping angle: centre of mass from part volumes and stock densities${isSeating && seat ? `, plus a ${OCCUPANT_MASS_KG} kg occupant ${SEATED_COM_ABOVE_SEAT_CM} cm above the seat` : ""}, against the ground the piece stands on.`,
        })
      );
    }
  }

  // -------------------------------------------------------- backrest load
  const backFrame = byRole("backFrame")[0];
  /**
   * A back that also forms the arms is a closed loop returning to the seat at
   * the front -- the rattan armchair is exactly this -- and a loop braced at
   * both ends is not a cantilever. Running the cantilever formula over it
   * reports a stress the piece never sees, and would condemn a form that has
   * been built successfully for a century. Depth is the discriminator: an
   * ordinary back frame is a thin slab at the rear, and a back-and-arms loop
   * reaches most of the way forward.
   */
  const wrapsIntoArms =
    !!backFrame && survey.overall.d > 0 && backFrame.member.span.d > 0.55 * survey.overall.d;
  /**
   * A woven back panel is stretched across the frame and triangulates it, the
   * same way a drum skin stiffens its hoop. A frame carrying one is not a bare
   * cantilever either.
   */
  const bracedByWeave = resolved.some(
    (entry) => entry.member.role === "backCushion" && entry.stock.class === "weave"
  );
  const backIsBraced = wrapsIntoArms || bracedByWeave;
  if (isSeating && backFrame && backIsBraced) {
    notes.push(
      wrapsIntoArms
        ? `${backFrame.member.label} wraps forward into the arms, so it is braced at both ends rather than cantilevered off the seat. Its strength is in that loop, which this cannot measure.`
        : `${backFrame.member.label} carries a woven panel stretched across it, which braces the frame the way a drum skin braces its hoop. That bracing is real and is not something this can measure, so the backrest is not analysed as a bare cantilever.`
    );
  }
  if (isSeating && backFrame && !backIsBraced && backFrame.stock.structural && backFrame.member.lengthCm > 0) {
    const { member, stock } = backFrame;
    // A back post is a cantilever off the seat: the rearward load acts at the
    // top and the whole moment lands where it leaves the seat frame.
    const leverMm = Math.max(0, member.max.y - survey.seatHeightCm) * 10;
    const sideMm = Math.sqrt(member.sectionAreaCm2) * 10;
    const areaMm2 = member.sectionAreaCm2 * 100;
    const I = compactI(areaMm2);
    const perPost = Math.max(1, member.count);
    const momentNmm = (BACK_LOAD_N * leverMm) / perPost;
    const stressMPa = I > 0 && sideMm > 0 ? (momentNmm * (sideMm / 2)) / I : Infinity;
    const allowableMPa = stock.modulusOfRuptureMPa / safetyFactorFor(stock);
    const score = ramp(stressMPa / allowableMPa, 0.4, 1);

    durability.push(
      make({
        id: "back-post",
        label: "Backrest under load",
        score,
        weight: 2,
        detail: `${round(stressMPa)} MPa where the back meets the seat, against ${round(allowableMPa)} MPa allowable in ${stock.label}. ${round(BACK_LOAD_N)} N pushed back at ${round(leverMm / 10)} cm above the seat.`,
        advice:
          score < 70
            ? "Lower the backrest or thicken it where it leaves the seat. This joint is where chairs break first, and the moment grows straight with back height."
            : undefined,
        basis: `Cantilever under the ${BACK_LOAD_N} N backrest load of the domestic seating tests, σ = Mc/I at the seat joint.`,
      })
    );
  }

  // -------------------------------------------------------- surface wear
  //
  // Not structural: how the surfaces somebody actually touches hold up. Read
  // from the finish's own daily-punishment rating rather than re-derived.
  const contactRoles: MemberSurvey["role"][] = [
    "seatCushion",
    "tabletop",
    "armrest",
    "shelf",
    "door",
    "drawer",
  ];
  const contact = resolved.filter((entry) => contactRoles.includes(entry.member.role) && entry.material);
  if (contact.length > 0) {
    const mean =
      contact.reduce((sum, entry) => sum + (entry.material?.durability ?? 5), 0) / contact.length;
    const weakest = contact.reduce((worst, entry) =>
      (entry.material?.durability ?? 5) < (worst.material?.durability ?? 5) ? entry : worst
    );
    // The catalogue's scale runs 1-10 with most finishes near the middle, so
    // the ramp has to put "average" at average. Anchored at 9 the default
    // upholstery scored 33% and dragged an otherwise sound chair into rework,
    // which is a statement about the ramp rather than about the chair.
    const score = ramp(mean, 8, 2);
    durability.push(
      make({
        id: "surface-wear",
        label: "Surface wear",
        score,
        weight: 1.5,
        detail: `The surfaces in daily contact average ${round(mean)} out of 10 for resistance to knocks, claws and dragging. Weakest: ${weakest.member.label} in ${weakest.material?.name}.`,
        advice:
          score < 70
            ? `Pick a harder-wearing finish for the ${weakest.member.label.toLowerCase()} if this piece will see daily use.`
            : undefined,
        basis: "The per-finish durability rating in the finish catalogue.",
      })
    );
  }

  // ============================================================== QUALITY

  // ------------------------------------------- stock suited to the job
  const structuralRoles: MemberSurvey["role"][] = [
    "base",
    "seatFrame",
    "backFrame",
    "apron",
    "carcass",
    "shelf",
    "tabletop",
    "stretcher",
  ];
  const structural = resolved.filter(
    (entry) => structuralRoles.includes(entry.member.role) && entry.stock.structural
  );
  /**
   * A woven shell or a webbed frame carries its load through its form, not
   * through a section. Scoring cane against the stiffness expected of a beam
   * fails every rattan piece ever built, so those are judged on how they wear
   * instead -- which is the question that actually applies to them.
   */
  const nonStructural = resolved.filter(
    (entry) => structuralRoles.includes(entry.member.role) && !entry.stock.structural
  );
  if (structural.length === 0 && nonStructural.length > 0) {
    const primary = nonStructural[0];
    const rating = primary.material?.durability ?? 5;
    quality.push(
      make({
        id: "woven-stock",
        label: "Stock for the frame",
        score: ramp(rating, 9, 3),
        weight: 3,
        detail: `The ${primary.member.label.toLowerCase()} is ${primary.stock.label.toLowerCase()}, which carries its load through its shape rather than through a cross-section. It rates ${rating}/10 for standing up to daily use.`,
        advice:
          rating < 6
            ? "An all-weather polymer weave holds up to sun, rain and scrubbing far better than natural cane if this piece will live outdoors."
            : undefined,
        basis: "A woven form is judged on how the weave wears, since no beam formula applies to it.",
      })
    );
  }
  if (structural.length > 0) {
    let worst: { entry: Resolved; score: number } | null = null;
    for (const entry of structural) {
      // A frame wants stiffness and bending strength. These are the thresholds
      // between a furniture timber and a utility one, not between good and bad
      // wood: falcata is excellent at what it is for, and a chair leg is not it.
      /**
       * Three tiers, because "structural" covers three different jobs.
       *
       * A leg or a seat rail is a beam and is held to beam numbers. A carcass,
       * a shelf, a door or a drawer side is panel work, and panel goods are
       * what those are actually made of -- holding a cabinet side to a
       * hardwood's bending strength failed every panel-built carcass ever
       * made, which is most of them. The panel tier still separates the real
       * boards from the cheap one: marine ply and MDF pass, and laminated
       * particleboard does not, which is the distinction that decides whether
       * a cabinet survives being moved.
       *
       * Everything else -- a tabletop, an apron, a stretcher -- sits between.
       */
      const carriesFrame =
        entry.member.role === "base" || entry.member.role === "seatFrame" || entry.member.role === "backFrame";
      const isPanelWork =
        entry.member.role === "carcass" ||
        entry.member.role === "shelf" ||
        entry.member.role === "door" ||
        entry.member.role === "drawer";
      const stiffness = ramp(
        entry.stock.modulusOfElasticityMPa,
        isPanelWork ? 3_000 : 10_000,
        carriesFrame ? 6_000 : isPanelWork ? 1_200 : 2_500
      );
      const strength = ramp(
        entry.stock.modulusOfRuptureMPa,
        isPanelWork ? 30 : 80,
        carriesFrame ? 45 : isPanelWork ? 12 : 20
      );
      const score = Math.min(stiffness, strength);
      if (!worst || score < worst.score) worst = { entry, score };
    }
    if (worst) {
      const { entry, score } = worst;
      quality.push(
        make({
          id: "structural-stock",
          label: "Stock for the frame",
          score,
          weight: 3,
          detail: `Weakest structural part is the ${entry.member.label.toLowerCase()} in ${entry.stock.label}: ${round(entry.stock.modulusOfElasticityMPa / 1000, 1)} GPa stiffness, ${round(entry.stock.modulusOfRuptureMPa)} MPa bending strength.`,
          advice:
            score < 70
              ? `${entry.stock.label} is light for a load-bearing part. A denser hardwood in the ${entry.member.label.toLowerCase()} is the single biggest change you can make here.`
              : undefined,
          basis: "Published typical stiffness and bending strength for the stock, against what a furniture frame needs.",
        })
      );
    }
  }

  // ------------------------------------------------ hardness where it shows
  const wearSurfaces = resolved.filter(
    (entry) =>
      (entry.member.role === "tabletop" ||
        entry.member.role === "shelf" ||
        entry.member.role === "armrest" ||
        entry.member.role === "seatFrame") &&
      (entry.stock.class === "solid-timber" || entry.stock.class === "panel" || entry.stock.class === "bamboo")
  );
  if (wearSurfaces.length > 0) {
    const softest = wearSurfaces.reduce((worst, entry) =>
      entry.stock.jankaKN < worst.stock.jankaKN ? entry : worst
    );
    const score = ramp(softest.stock.jankaKN, 5, 2);
    quality.push(
      make({
        id: "surface-hardness",
        label: "Hardness where it shows",
        score,
        weight: 1.5,
        detail: `${softest.stock.label} on the ${softest.member.label.toLowerCase()} rates ${round(softest.stock.jankaKN, 1)} kN for denting. Around 5 kN shrugs off daily use; under 2.5 kN marks from a dropped key.`,
        advice: score < 70 ? "A harder timber on the surfaces people touch will keep its edges far longer." : undefined,
        basis: "Janka side hardness for the stock.",
      })
    );
  }

  // ----------------------------------------------------------- the seal
  const needsSeal = resolved.filter(
    (entry) =>
      (entry.member.role === "tabletop" ||
        entry.member.role === "shelf" ||
        entry.member.role === "seatFrame" ||
        entry.member.role === "carcass") &&
      (entry.stock.class === "solid-timber" || entry.stock.class === "panel" || entry.stock.class === "bamboo")
  );
  if (needsSeal.length > 0) {
    // Raw is a real choice and a common one, and it is genuinely less
    // protection on a horizontal surface that meets cups and hands.
    const sealScore = (varnish: Varnish | null) => {
      switch (varnish?.id) {
        case "lacquer":
        case "satin":
          return 100;
        case "wax":
          return 72;
        // Raw and oiled is a legitimate, traditional and very common choice --
        // it is less protection on a working surface, not a fault. Scored to
        // flag rather than to condemn, because a failure here would cap the
        // whole quality block and tell somebody their perfectly good oiled
        // narra table needs rework.
        default:
          return 50;
      }
    };
    const weakest = needsSeal.reduce((worst, entry) =>
      sealScore(entry.varnish) < sealScore(worst.varnish) ? entry : worst
    );
    const score = needsSeal.reduce((sum, entry) => sum + sealScore(entry.varnish), 0) / needsSeal.length;
    quality.push(
      make({
        id: "seal",
        label: "Protective finish",
        score,
        weight: 2,
        detail:
          score >= 70
            ? `Working surfaces are sealed with a film finish.`
            : `The ${weakest.member.label.toLowerCase()} is ${weakest.varnish?.name.toLowerCase() ?? "unsealed"}. A surface that meets cups, hands and spills wants a film over it.`,
        advice:
          score < 70
            ? "Satin polyurethane on the working surfaces. It is the usual choice for daily use precisely because it takes the abuse the timber cannot."
            : undefined,
        basis: "Whether load-bearing and working surfaces carry a film finish rather than oil or wax alone.",
      })
    );
  }

  // -------------------------------------------------- is the stock stated
  const unstated = structural.filter((entry) => entry.stock.unspecified);
  if (unstated.length > 0) {
    quality.push(
      make({
        id: "stock-stated",
        label: "Stock specified",
        // A gap rather than a fault: on a piece nobody has finished specifying
        // yet, which is every piece on first open, this must read as "there is
        // more to decide" and not as "your design is broken".
        score: 55,
        weight: 1.5,
        detail: `${unstated.length} structural ${unstated.length === 1 ? "part has" : "parts have"} no timber chosen — ${unstated.map((entry) => entry.member.label.toLowerCase()).join(", ")}. Everything above them is estimated on mid-range hardwood.`,
        advice: "Pick a named timber for the load-bearing parts. Until you do, the furniture shop chooses, and so does this analysis.",
        basis: "A finish that names a colour rather than a species does not specify a stock.",
      })
    );
  }

  // ---------------------------------------------------- unscored, but true
  const fussiest = resolved
    .filter((entry) => entry.material)
    .reduce<Resolved | null>(
      (worst, entry) => ((entry.material?.maintenance ?? 0) > (worst?.material?.maintenance ?? 0) ? entry : worst),
      null
    );
  if (fussiest?.material && fussiest.material.maintenance >= 7) {
    // Deliberately a note and not a check. The finish catalogue is explicit
    // that maintenance is not quality -- a silk is not worse than a vinyl, it
    // is more work -- and scoring it here would quietly contradict that.
    notes.push(
      `${fussiest.material.name} on the ${fussiest.member.label.toLowerCase()} is high-maintenance (${fussiest.material.maintenance}/10). That is upkeep, not a fault.`
    );
  }
  for (const entry of resolved) {
    if (entry.stock.note && structuralRoles.includes(entry.member.role)) {
      notes.push(`${entry.member.label}: ${entry.stock.note}`);
    }
  }

  const durabilityBlock = combine(durability);
  const qualityBlock = combine(quality);
  const concerns = [...durability, ...quality]
    .filter((check) => check.status !== "pass")
    .sort((a, b) => a.score - b.score);

  return {
    durability: durabilityBlock,
    quality: qualityBlock,
    concerns,
    notes,
    massKg: round(massKg, 1),
  };
}
