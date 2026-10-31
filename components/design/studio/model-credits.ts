/**
 * Attribution for the third-party models the studio ships.
 *
 * Five of the eight pieces were made by somebody else and licensed on
 * condition that they are credited: four under CC-BY-4.0, one under
 * CC-BY-SA-4.0, and one under cadnav's free-model terms. The rocking chair,
 * the dining table and the storage cabinet are this project's own and appear
 * nowhere below, because there is nobody to credit for them.
 *
 * ---------------------------------------------------------------------------
 * Why this is its own file
 *
 * The credits used to live only as a `credit` string on each entry in
 * studio-models.ts, printed at the foot of the studio's side panel. The panel
 * line is gone -- it sat under the size controls on every piece and read as
 * chrome -- so the attribution needed somewhere else to be shown, and the
 * obvious place is the site footer, which is a server-rendered page.
 *
 * studio-models.ts cannot be imported there. It pulls in the segmentation
 * classifiers, which pull in three.js, so importing it to read eight strings
 * would put the whole 3D library in the bundle for the landing page. Holding
 * the strings apart costs one file and keeps the homepage what it was.
 *
 * They are still a single source of truth: studio-models.ts imports this and
 * fills its own `credit` fields from it, so the two cannot drift.
 *
 * ---------------------------------------------------------------------------
 * On removing them
 *
 * Attribution is a condition of use on every entry here, not a courtesy.
 * CC-BY-4.0 s3(a)(1) requires the creator's name, the licence, and a link to
 * it; s3(a)(2) allows that to be satisfied "in any reasonable manner based on
 * the medium", including by a link to a resource carrying the information --
 * which is why moving these from the studio panel to the site footer is
 * allowed and deleting them outright is not.
 */

export type ModelCredit = {
  /** The piece as the studio names it. */
  model: string;
  /** The line the licence asks to be reproduced. */
  credit: string;
  /** Where the original lives, so the credit can link to it. */
  source: string;
  /** Named so the footer can group the share-alike one honestly. */
  license: string;
};

export const MODEL_CREDITS: ModelCredit[] = [
  {
    model: "Victorian Chair",
    credit: 'This work is based on "Victorian chair" by BATRIC_18, licensed under CC-BY-4.0.',
    source:
      "https://sketchfab.com/3d-models/victorian-chair-6479a1900b614b59b26784c3a7922eb3",
    license: "CC-BY-4.0",
  },
  {
    model: "Cushion Chair",
    credit:
      'This work is based on "Cushion Chair" by durgaprasadpuppala, licensed under CC-BY-4.0.',
    source: "https://sketchfab.com/durgaprasadpuppala",
    license: "CC-BY-4.0",
  },
  {
    model: "Rattan Armchair",
    credit: "Rattan armchair model sourced from cadnav.com, used under its free-model terms.",
    source: "https://www.cadnav.com/",
    license: "cadnav free-model terms",
  },
  {
    model: "Patio Armchair",
    credit: 'This work is based on "Rattan armchair" by 1-3D.com, licensed under CC-BY-SA-4.0.',
    source: "https://sketchfab.com/1-3D.com",
    // Share-alike, unlike the rest: the licence additionally requires that a
    // modified version carry the same licence, which covers the re-export in
    // public/models/patio-armchair/.
    license: "CC-BY-SA-4.0",
  },
  {
    model: "Rattan Stool",
    credit: 'This work is based on "Rattan stool" by Antoine Dresen, licensed under CC-BY-4.0.',
    source: "https://sketchfab.com/antoinedresen",
    license: "CC-BY-4.0",
  },
];

/** The credit line for one model, by the name the studio gives it. */
export function creditFor(model: string): string | undefined {
  return MODEL_CREDITS.find((entry) => entry.model === model)?.credit;
}
