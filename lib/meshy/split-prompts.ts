import type { FurnitureCategoryId } from "@/components/design/studio/studio-models";

/**
 * What Meshy's split is told to look for, per kind of piece.
 *
 * The split was built for 3D printing and will cut a model into whatever
 * pieces print well unless told otherwise. Naming the parts is what made the
 * test table come back as its top, its pedestal and its plinth -- the pieces
 * a furniture shop builds and a customer refinishes -- rather than arbitrary slabs.
 *
 * Every list names only parts the studio can do something with (see the role
 * vocabularies in lib/architect-analysis/generic-classify.ts), and hedges
 * with "if any" where many pieces have none, so the split is not pushed to
 * invent an armrest a stool never had. Meshy caps the prompt at 600
 * characters and 10 parts.
 */
export const SPLIT_PROMPTS: Record<FurnitureCategoryId, string> = {
  chair:
    "A chair. Split it into: the legs, the seat frame, the seat cushion if any, the back frame with its slats or rails, the back cushion if any, the armrests if any, and any stretchers or rails between the legs. Keep every cushion separate from the wooden frame behind or under it.",
  stool: "A stool. Split it into: the legs or base, the seat, and any rungs or rails between the legs.",
  table:
    "A table. Split it into: the tabletop, the legs or pedestal, the apron or rail under the top if any, any stretchers between the legs, and the base or plinth on the floor if any.",
  desk: "A desk. Split it into: the desktop, the legs or side panels, the drawer box if any, the drawer fronts, the handles, and the modesty panel at the back if any.",
  sofa: "A sofa. Split it into: the legs, the base frame, the back frame with its slats or rails, the seat cushions, the back cushions, and the arms. Keep every cushion separate from the frame behind or under it.",
  bed: "A bed. Split it into: the headboard, the footboard if any, the side rails, the mattress, the bedding and pillows if any, and the legs or base.",
  cabinet:
    "A cabinet. Split it into: the cabinet body, the doors, the drawer fronts, the shelves, the handles, and the plinth or legs.",
  bookshelf:
    "A bookshelf. Split it into: the frame and sides, each shelf, the doors if any, the back panel, and the plinth or legs.",
};
