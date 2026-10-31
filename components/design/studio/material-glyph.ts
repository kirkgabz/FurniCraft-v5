import {
  IconAsShown,
  IconBamboo,
  IconCloth,
  IconGlass,
  IconHide,
  IconMetal,
  IconPanel,
  IconPolymer,
  IconReed,
  IconStone,
  IconTimber,
  IconWeave,
  type SolihiyaIcon,
} from "@/components/solihiya/icons";
import type { MaterialProfile } from "./materials-db";

/**
 * The glyph that stands for a finish in the picker.
 *
 * Family first, then type, because family is the more specific claim and only
 * some finishes make it. Bamboo, reeded cane and the engineered panels are all
 * `type: "wood"` and none of them looks or works like a plank: bamboo's figure
 * runs the wrong way, a reeded panel is parallel strands, and a laminated board
 * is a face over a core. Falling straight through to type would have drawn all
 * three as timber, which is the one thing the glyph exists to distinguish.
 *
 * Deliberately per family and not per finish. A swatch already carries colour,
 * and colour is what separates narra from kamagong; eighty-odd hand-drawn marks
 * would repeat what the swatch says and crowd out what it does not.
 */
export function materialGlyph(material: MaterialProfile): SolihiyaIcon {
  // Every finish names a family now -- the family-less "Original" entries are
  // gone -- so there is nothing to catch before the switch. An unrecognised
  // family still falls through to the picture-frame mark at the bottom.
  switch (material.family) {
    case "Bamboo":
      return IconBamboo;
    case "Engineered panel":
      return IconPanel;
    case "Reeded cane":
      return IconReed;
    case "Vinyl":
    case "Leather":
      return IconHide;
    case "Stone":
      return IconStone;
    default:
      break;
  }

  switch (material.type) {
    case "wood":
      return IconTimber;
    case "rattan":
      return IconWeave;
    case "fabric":
      return IconCloth;
    case "leather":
      return IconHide;
    case "glass":
      return IconGlass;
    case "metal":
      return IconMetal;
    case "stone":
      return IconStone;
    case "plastic":
      return IconPolymer;
    default:
      return IconAsShown;
  }
}
