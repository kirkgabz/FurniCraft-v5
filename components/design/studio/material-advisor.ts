import { stockColorCategory } from "@/lib/shops/material-stock";
import {
  hasAnyLifestyle,
  scoreMaterial,
  type LifestyleAnswers,
  type MaterialProfile,
  type PartFocus,
} from "./materials-db";

/**
 * The studio's "Help me choose", for one part at a time.
 *
 * It only ever ranks the list it is given, and the studio gives it exactly the
 * finishes the shop has declared for that part (`allowedMaterialsForSurfaces`
 * over the shop's stock). Nothing outside that list can be recommended, so the
 * advice can never point at a material or colour the shop cannot supply.
 */
export type MaterialAdvice = {
  material: MaterialProfile;
  score: number;
  /** Why it suits, already deduplicated. Short phrases, shown two at most. */
  reasons: string[];
  /** Why it may not, for a finish that scored below zero. */
  cautions: string[];
  recommended: boolean;
  /** The single top finish for this part. At most one per list. */
  best: boolean;
  /** The other part it was matched against, e.g. "Seat frame", when it goes with it. */
  goesWith: string | null;
};

/** Another part of the same piece and what it is already finished in. */
export type ChosenPart = { label: string; material: MaterialProfile };

/** Score needed to be marked as suiting the answers -- one clear reason, or two small ones. */
export const RECOMMEND_AT = 3;

/**
 * Whether two finishes sit well together, read from their colour families.
 *
 * Kept to rules a shop would agree with rather than a colour wheel: neutrals
 * go with anything, natural tones go with each other and with neutrals and
 * metal, and a colour goes with the same colour family. Two finishes of the
 * same kind of material are not "matched" -- a narra leg does not go with a
 * narra seat, it simply is the same timber.
 */
function goesWith(candidate: MaterialProfile, other: MaterialProfile): boolean {
  if (candidate.type === other.type) return false;
  const mine = stockColorCategory(candidate);
  const theirs = stockColorCategory(other);
  if (mine === "neutral" || theirs === "neutral") return true;
  if (mine === theirs) return true;
  if (mine === "natural" && (theirs === "metallic" || theirs === "clear")) return true;
  if (theirs === "natural" && (mine === "metallic" || mine === "clear")) return true;
  return false;
}

/**
 * Ranks one part's permitted finishes against the answers.
 *
 * With nothing asked, the list comes back in the shop's own order, unmarked.
 * Otherwise it is sorted by score -- a stable sort, so equal scores keep the
 * shop's order -- and the first finish that clears `RECOMMEND_AT` is the best
 * match.
 */
export function adviseForPart(
  permitted: MaterialProfile[],
  answers: LifestyleAnswers,
  focus: PartFocus,
  otherParts: ChosenPart[] = []
): MaterialAdvice[] {
  const active = hasAnyLifestyle(answers);
  const advised = permitted.map((material): MaterialAdvice => {
    if (!active) return { material, score: 0, reasons: [], cautions: [], recommended: false, best: false, goesWith: null };
    const { score, reasons, cautions } = scoreMaterial(material, answers, focus);
    const match = otherParts.find((part) => goesWith(material, part.material)) ?? null;
    const total = score + (match ? 1 : 0);
    return {
      material,
      score: total,
      reasons,
      cautions: total < 0 ? cautions : [],
      recommended: total >= RECOMMEND_AT,
      best: false,
      goesWith: match?.label ?? null,
    };
  });
  if (!active) return advised;
  const ranked = [...advised].sort((a, b) => b.score - a.score);
  const top = ranked.find((entry) => entry.recommended);
  if (top) top.best = true;
  return ranked;
}

/** The best match for a part, or null when nothing in its list suits the answers. */
export function bestMatchFor(
  permitted: MaterialProfile[],
  answers: LifestyleAnswers,
  focus: PartFocus,
  otherParts: ChosenPart[] = []
): MaterialProfile | null {
  return adviseForPart(permitted, answers, focus, otherParts).find((entry) => entry.best)?.material ?? null;
}
