/**
 * Shared vocabulary for the furniture studio: the parts a customer can click,
 * the rig parameters each part exposes, and the finishes available to it.
 *
 * The studio drives more than one model, and a part list is a property of the
 * model rather than of the studio -- a Victorian side chair has four turned legs
 * and no armrests, a cushion chair has a moulded shell and two arms. So the
 * types live here and each model supplies its own `PartDef[]`; see
 * studio-models.ts.
 *
 * `PartId` is the union across every model, because it is the key used for
 * colours, labels and saved designs. `PartRole` is what the rig actually reads:
 * ids name a piece for the customer ("Frame", "Legs"), roles tell the rig how a
 * piece behaves ("this one stands on the floor and carries the rest").
 */

/**
 * Which family of furniture a piece belongs to.
 *
 * It exists because two steps of the upload pipeline need to be told what
 * they are looking at rather than deduce it: `groupShells` (a chair's parts
 * separate by height, a bed's do not) and the AI role vocabulary in
 * `lib/architect-analysis/generic-classify.ts` (a bed has no seat to
 * cushion). Both are scoped rather than pooled, because every role the AI
 * can see is a role it can pick, and a wrong family picks the wrong words
 * for every part of the piece at once.
 *
 * `generic` covers chair- and table-shaped pieces together: they share
 * enough structure -- something on the floor, a horizontal surface riding
 * it, sometimes a back -- to be one list. `bed` is its own because a bed
 * shares almost none of that vocabulary; "headboard" and "mattress" are not
 * "backFrame" and "seatCushion" to anyone who is buying one, even where the
 * rig moves them identically.
 *
 * Deliberately asked, never guessed. Telling a bed from a wide low bench is
 * exactly the judgement this pipeline is not yet reliable at, and the person
 * uploading the file always knows the answer.
 */
export type FurnitureFamily = "generic" | "bed";

export type PartId =
  | "legs"
  | "frame"
  | "seatFrame"
  | "seatCushion"
  | "backFrame"
  | "backCushion"
  | "armrests"
  | "ornaments"
  | "tabletop"
  | "apron"
  | "tabletopBorder"
  | "stretchers"
  | "headboard"
  | "headboardPanel"
  | "footboard"
  | "bedRail"
  | "mattress"
  | "mattressSupport"
  | "bedding"
  | "pillows"
  | "carcass"
  | "plinth"
  | "doors"
  | "drawers"
  | "shelves"
  | "handles"
  | "leaves";

/**
 * How a part behaves in the rig, independent of what it is called.
 *
 * - `base`           stands on the floor and lifts everything above it
 * - `seatFrame`      rides the base at seat height
 * - `backFrame`      rides the base at back height and carries the back cushion
 * - `armrest`        rides the base beside the seat, spreading as the seat widens
 * - `accessory`      is parented to the nearest base shell and rides along with it
 * - `tabletop`       nests on `seatFrame`/`apron`/`tabletopBorder` (or, absent
 *                    all three, rides the base directly) exactly like
 *                    `seatCushion` -- a table's top rather than a chair's
 *                    pad, but the identical mechanism
 * - `apron`          a table's under-frame tying the legs together, BELOW
 *                    the top and not part of its visible surface -- rides
 *                    the base exactly like `seatFrame` does
 * - `tabletopBorder` a frame or rim in the SAME plane as the top, bordering
 *                    a materially distinct inset (glass, stone, a different
 *                    wood) -- mechanically identical to `apron` (same rig
 *                    slot), but a different thing to a customer: a visible
 *                    part of the top itself, not a hidden support under it
 * - `stretcher`      a cross-brace lower down between legs, parented to the
 *                    nearest one exactly like `accessory`, with its own identity
 *
 * The bed roles below are the same pattern `tabletopBorder` set: each one is
 * mechanically identical to a role that already exists (it rides the same
 * pivot, obeys the same controls) but is a different thing to the person
 * buying it, so it gets its own name rather than being told it owns a
 * "seat cushion". Only `footboard` is genuinely new machinery -- there was
 * no assembly at the front of the piece before, because no chair or table
 * has one.
 *
 * - `bedRail`        the side and end rails carrying the mattress -- the same
 *                    rig slot as `seatFrame`/`apron`: a structural frame
 *                    riding the base at one fixed height
 * - `mattress`       the sleeping surface, nested inside the rails with its
 *                    own thickness exactly as `seatCushion`/`tabletop` are
 * - `headboard`      the panel at the head end -- the same rig slot as
 *                    `backFrame`: rides the base at the rear and grows upward
 * - `headboardPanel` an upholstered or woven insert on the headboard,
 *                    following it exactly as `backCushion` follows the back
 *                    frame; separate so it can wear a fabric finish while the
 *                    headboard around it stays timber
 * - `footboard`      the panel at the foot end -- the mirror of `headboard`,
 *                    with its own pivot and its own `footboardHeight`, since
 *                    a footboard is nearly always lower than the headboard
 *                    and is sized separately from it
 * - `mattressSupport` whatever the mattress lies on: a run of slats, a solid
 *                    platform, or a box spring. The same rig slot as
 *                    `stretcher` -- it spans the base's footprint low down
 *                    and thickens in place -- and one role rather than three
 *                    because a bed has exactly one of them and the rig moves
 *                    all three identically; only the customer-facing label
 *                    changes with what it turns out to be
 * - `bedding`        the flat layers over the mattress: sheets, blanket,
 *                    comforter, duvet, quilt. Its own pivot above the
 *                    mattress, growing upward from where it rests, so a
 *                    thicker duvet does not sink into the bed
 * - `pillows`        the pillows at the head end -- the same rig slot as
 *                    `armrest`: repeated shells that each keep their own
 *                    place, spread as the bed widens, and disappear at zero
 *
 * `bedding` and `pillows` are STAGING (see `PartDef.staging`): a furniture shop
 * builds the bed, not the bedlinen, so they are shown and refinishable but
 * never costed or drawn on the build sheet.
 *
 * Casegoods (a cabinet, a chest, a wardrobe) are the first pieces here that
 * are not built around a seat or a top, so they bring their own four roles.
 * A cabinet's plinth is genuinely a `base` -- it stands on the floor and
 * carries everything -- so it reuses that role rather than adding a synonym.
 * The rest have no chair equivalent:
 *
 * - `carcass`        the box itself: sides, deck, top and back, carrying every
 *                    other casegood part. Rides the base and scales with the
 *                    piece's width, depth and height
 * - `shelf`          a horizontal surface nested INSIDE the carcass, spanning
 *                    its interior width and travelling with it
 * - `door`           a front panel covering an opening, riding the carcass
 *                    face and scaling with it
 * - `drawer`         a drawer front: the same face as a `door` mechanically,
 *                    but a different thing to a customer and quoted per unit,
 *                    so it keeps its own identity
 * - `hardware`       pulls, knobs and hinges, parented to the door or drawer
 *                    they are fitted to. Like `accessory`, they ride their
 *                    host -- but they must NOT stretch when the piece is
 *                    resized, because a 90mm pull is 90mm on any cabinet
 */
export const PART_ROLES = [
  "base",
  "seatFrame",
  "seatCushion",
  "backFrame",
  "backCushion",
  "armrest",
  "accessory",
  "tabletop",
  "apron",
  "tabletopBorder",
  "stretcher",
  "bedRail",
  "mattress",
  "headboard",
  "headboardPanel",
  "footboard",
  "mattressSupport",
  "bedding",
  "pillows",
  "carcass",
  "shelf",
  "door",
  "drawer",
  "hardware",
  // A board hinged along one edge of a top, folding down against the legs
  // when it is not wanted. Its own role rather than another `tabletop`,
  // because the rig allows one part per role and a table already spends that
  // on the top itself -- and because a leaf is the only part here that has a
  // hinge line, which is a fact about the part, not about its finish.
  "leaf",
] as const;

export type PartRole = (typeof PART_ROLES)[number];

/**
 * Whether an untrusted value is a role this build knows.
 *
 * Needed wherever roles arrive from outside the type system -- the AI's JSON
 * reply, and a `GeneratedSource` read back out of a stored design. The type
 * above is derived from the list rather than written twice, so a role added
 * to one is a role added to both; the alternative drifts the instant someone
 * extends the union and forgets the guard.
 */
export function isPartRole(value: unknown): value is PartRole {
  return typeof value === "string" && (PART_ROLES as readonly string[]).includes(value);
}

/**
 * Which palette a part draws from, and therefore what it can be built in.
 *
 * This is a compatibility rule, not a label: a woven panel cannot be made of
 * plank timber and a turned leg cannot be woven, so the two never share a list.
 * "rattan" and "cane" are both woven and still separate, because the split is
 * about geometry rather than material. A cane part is woven in the mesh -- the
 * caned armchair's seat is 401 individually modelled strands -- so painting a
 * cross-weave image over it prints a weave on top of a weave and produces a
 * dirty moire. A rattan part is a flat panel whose weave exists only in the
 * texture. The same physical cane needs opposite treatment in the two cases,
 * so they cannot share a finish list.
 *
 * "metal" is the casegood addition: a cabinet's pulls and knobs are the first
 * parts here that are neither timber, textile, weave nor pane. They cannot
 * share the wood list -- offering Narra or Gmelina for a brass handle is
 * meaningless -- and unlike every other surface they are bought as fitted
 * components rather than finished on site, so the list is a hardware range
 * rather than a set of stains.
 *
 * "stone" and "plastic" arrived with the wider catalogue. Stone is a slab
 * material -- a marble or granite top is cut and polished, never stained --
 * and plastic covers moulded and extruded stock, from a polypropylene shell
 * to the polyethylene strand an all-weather weave is made from. Both are
 * bought finished, like metal and glass and unlike timber, which is why
 * neither takes a stain list.
 */
export type Surface = "wood" | "cloth" | "rattan" | "cane" | "glass" | "metal" | "stone" | "plastic";

export type RigParamKey =
  | "legHeight"
  | "legThickness"
  | "seatWidth"
  | "seatDepth"
  | "seatCushionThickness"
  | "backHeight"
  | "backCushionThickness"
  | "armScale"
  | "ornamentScale"
  | "apronThickness"
  | "stretcherThickness"
  | "footboardHeight"
  | "beddingThickness"
  // Casegoods. Width and depth are not repeated here: `seatWidth` and
  // `seatDepth` already mean "how wide/deep is the whole piece" to the rig
  // (a table's top rides them exactly as a seat does), and a cabinet's
  // carcass rides them the same way. Height does need its own key -- a
  // cabinet grows upward as a box, which is neither `legHeight` lifting a
  // seat nor `backHeight` raising a backrest.
  | "cabinetHeight"
  | "shelfThickness"
  | "handleScale"
  // The two counts. Every other key on this list is a multiplier against the
  // model's own proportions; these are absolute quantities -- three shelves is
  // three shelves, not three times as many as the mesh happened to ship with.
  // They are here rather than in a separate mechanism because everything a
  // parameter already gets for free is what a count needs too: it is stored
  // with the design, reopened with it, redrawn on the blueprint and priced
  // into the order, and none of that wants a second path through the code.
  | "shelfCount"
  | "doorCount"
  | "drawerCount"
  // Drop leaves. One key per side, and each is how far THAT leaf is raised --
  // 0 hanging, 1 level with the top -- rather than whether it exists. A leaf
  // down is still a leaf, which is the whole point of the form: you raise the
  // one you need and leave the rest hanging. `leafWidth` is shared, because a
  // table with leaves of four different widths is not a table anyone builds.
  | "leafWidth"
  | "leafWest"
  | "leafEast"
  | "leafNorth"
  | "leafSouth";

export type RigParams = Record<RigParamKey, number>;

/**
 * Which of its part's measured dimensions each size control actually moves.
 *
 * The rig runs on multipliers, because that is the only thing that makes
 * sense when one slider has to drive four legs of unequal length. What a
 * customer wants to read, though, is the piece -- "56.9 cm", not "100% of a
 * number nobody showed me". This is the bridge: the slider still sends a
 * multiplier, and the readout beside it names the centimetres that multiplier
 * currently produces, straight off the live measured rig.
 *
 * Deliberately the dimension of the control's OWN part rather than of the
 * whole piece. A leg-thickness slider that reported the chair's overall width
 * would be answering a question nobody asked; the hint underneath already
 * explains what else moves with it.
 *
 * "max" is for the two controls that scale a part uniformly, where no single
 * axis is the one being changed -- its longest dimension stands in, since
 * that is the one a person looking at an armrest or a carving would quote.
 */
export const RIG_PARAM_DIMENSION: Partial<Record<RigParamKey, { axis: "w" | "h" | "d" | "max"; of: "part" | "component" }>> = {
  // Width and depth size the PIECE -- widening a bed widens all of it, and
  // the span of the whole part is the honest number beside that slider.
  seatWidth: { axis: "w", of: "part" },
  seatDepth: { axis: "d", of: "part" },
  // Everything else sizes an individual piece. Four legs share one thickness
  // slider, and the number beside it has to be one leg's cross-section, not
  // the distance from the leftmost leg to the rightmost.
  legHeight: { axis: "h", of: "component" },
  legThickness: { axis: "w", of: "component" },
  seatCushionThickness: { axis: "h", of: "component" },
  backHeight: { axis: "h", of: "component" },
  backCushionThickness: { axis: "d", of: "component" },
  armScale: { axis: "max", of: "component" },
  ornamentScale: { axis: "max", of: "component" },
  apronThickness: { axis: "h", of: "component" },
  stretcherThickness: { axis: "h", of: "component" },
  footboardHeight: { axis: "h", of: "component" },
  beddingThickness: { axis: "h", of: "component" },
  // A cabinet grows as a box, so its height is the carcass's own.
  cabinetHeight: { axis: "h", of: "part" },
  shelfThickness: { axis: "h", of: "component" },
  handleScale: { axis: "max", of: "component" },
  // Left out on purpose: the counts, the leaf width and how far each leaf
  // is raised. None is a length of the part, so the slider shows each as
  // the number or the percentage it is.
};

/**
 * Every multiplier defaults to 1, the model's own proportions. A model that
 * exposes no control for a key simply leaves it at 1, where it is inert.
 *
 * The two counts are the exception and default to 2, which is not a neutral
 * number but the authored one: the only piece here with doors and shelves has
 * two of each. That matters beyond the first load -- a design saved before
 * these existed carries no count at all, and reopening it fills the gap from
 * this table, so anything other than what the mesh actually ships would
 * silently rebuild every stored cabinet with the wrong number of shelves. A
 * second casegood authored with a different count will need its own default
 * carried on the model rather than here.
 */
export const DEFAULT_RIG_PARAMS: RigParams = {
  legHeight: 1,
  legThickness: 1,
  seatWidth: 1,
  seatDepth: 1,
  seatCushionThickness: 1,
  backHeight: 1,
  backCushionThickness: 1,
  armScale: 1,
  ornamentScale: 1,
  apronThickness: 1,
  stretcherThickness: 1,
  footboardHeight: 1,
  beddingThickness: 1,
  cabinetHeight: 1,
  shelfThickness: 1,
  handleScale: 1,
  shelfCount: 2,
  doorCount: 2,
  drawerCount: 2,
  leafWidth: 1,
  // All four hanging. The asset authors its leaves level -- the rig needs a
  // known position to fold from -- so without this the table would open with
  // every leaf extended, which is the state a drop-leaf table spends the least
  // of its life in. It is also what every design saved before leaves existed
  // reopens as, and those tables were drawn with no leaves showing at all.
  leafWest: 0,
  leafEast: 0,
  leafNorth: 0,
  leafSouth: 0,
};

/**
 * What a cabinet can actually be built as, in centimetres.
 *
 * These are the numbers behind the count controls, kept here rather than
 * buried in the panel because they are a claim about joinery, not about the
 * interface. A count outside them is not a matter of taste: a 1.2-metre leaf
 * on a pair of hinges drops at the free edge and fouls its own frame, and a
 * shelf bay under a hand's depth is not storage.
 */
/**
 * The keys that count things rather than scale them.
 *
 * Worth naming rather than sniffing at `step === 1`: a multiplier could
 * legitimately be given a step of 1 one day, and the difference matters where
 * it is read -- a count reads "3", a multiplier reads "120%", and getting that
 * backwards puts "300%" beside a slider offering three shelves.
 */
export const COUNT_KEYS = new Set<RigParamKey>(["shelfCount", "doorCount", "drawerCount"]);

export const BUILDABLE = {
  /** Narrower and the leaf is a strip; wider and it sags on its hinges. */
  doorLeafWidthCm: { min: 30, max: 70 },
  /** Clear height between shelves. Below this the bay holds nothing useful. */
  shelfClearanceCm: 15,
  /**
   * How wide a drawer can be built, measured across the run they divide.
   *
   * The floor is a hand: under 20cm you cannot get into the box, and the
   * front is a strip of timber with a pull most of its width. The ceiling is
   * where a side-hung drawer stops behaving -- past about 90cm a wide,
   * shallow drawer racks in its opening as it is pulled from one end, and the
   * answer a furniture shop gives is two drawers, not a heavier runner.
   *
   * Wider on both ends than a door leaf, and deliberately: a drawer is
   * supported along its whole length by its runners, where a door hangs off
   * two hinges on one edge.
   */
  drawerWidthCm: { min: 20, max: 90 },
} as const;

/**
 * Narrows a count control to the counts this piece can be built as.
 *
 * The published min and max on a count control are the widest the piece could
 * ever support; what it supports RIGHT NOW depends on how big the customer has
 * made it, and those are different numbers. A 90cm carcass takes one leaf or
 * two; the same cabinet dragged out to 126cm takes only two, because a single
 * leaf that wide is not a door any more. Returning a narrowed control rather
 * than clamping the value silently means the slider itself stops where the
 * furniture shop stops, and the customer can see that it did.
 *
 * `spanCm` is the run the parts have to divide: the opening's width for doors,
 * the bay's height for shelves. Zero or unknown leaves the control alone --
 * better a control that is too permissive for one frame than one that
 * collapses to nothing because a measurement had not arrived yet.
 */
export type ResolvedCountControl = SizeControl & {
  /**
   * The fewest of this part that will divide the span, ONCE THERE ARE ANY.
   *
   * Distinct from `min`, and the distinction is the whole point. Zero is
   * always buildable -- a carcass with no doors is open shelving, which is a
   * real piece at any width -- but one leaf across a 119cm opening is not a
   * door. So the buildable answers are zero, or `fittedMin` and up, and the
   * numbers in between are not offered. Folding that into `min` instead loses
   * the zero, which is how the first version of this quietly made open
   * shelving impossible to ask for at every width there is.
   */
  fittedMin: number;
};

export function resolveCountControl(control: SizeControl, spanCm: number): ResolvedCountControl {
  const untouched = { ...control, fittedMin: control.min };
  if (!Number.isFinite(spanCm) || spanCm <= 0) return untouched;

  if (control.key === "doorCount") {
    const { min: narrowest, max: widest } = BUILDABLE.doorLeafWidthCm;
    const max = Math.max(control.min, Math.min(control.max, Math.floor(spanCm / narrowest)));
    // A leaf wider than the joinery allows means more leaves, not a wider one.
    const fittedMin = Math.min(max, Math.max(1, Math.ceil(spanCm / widest)));
    return { ...control, max, fittedMin };
  }

  if (control.key === "drawerCount") {
    // The same shape as the door rule above, and for the same reason: a run
    // divides into a whole number of drawers, and which numbers are buildable
    // depends on how wide the customer has made the piece. Zero is a real
    // answer here too -- a desk with no drawers is a writing table, which is
    // a piece people buy on purpose.
    const { min: narrowest, max: widest } = BUILDABLE.drawerWidthCm;
    const max = Math.max(control.min, Math.min(control.max, Math.floor(spanCm / narrowest)));
    const fittedMin = Math.min(max, Math.max(1, Math.ceil(spanCm / widest)));
    return { ...control, max, fittedMin };
  }

  if (control.key === "shelfCount") {
    // n shelves make n + 1 compartments, so the clearance divides the bay one
    // more time than there are shelves. No floor: one shelf in a tall bay is
    // a perfectly good answer, it is only the ceiling that joinery sets.
    const max = Math.max(control.min, Math.min(control.max, Math.floor(spanCm / BUILDABLE.shelfClearanceCm) - 1));
    return { ...control, max, fittedMin: control.min };
  }

  return untouched;
}

/**
 * Moves a count out of the gap between zero and the fewest that fit.
 *
 * Which way it moves depends on which way the customer was dragging, so the
 * handle keeps going the direction it was pushed: coming down off a pair lands
 * on none, coming up off none lands on a pair. Snapping always one way would
 * make one of the two ends unreachable by dragging, which is worse than the
 * gap it is there to cover.
 */
export function snapCount(control: ResolvedCountControl, next: number, previous: number): number {
  if (next <= control.min || next >= control.fittedMin) return next;
  return next < previous ? control.min : control.fittedMin;
}

export type SizeControl = {
  key: RigParamKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
};

export type PartDef = {
  id: PartId;
  role: PartRole;
  label: string;
  blurb: string;
  /**
   * Built, measured and listed on the order, but not offered in the parts
   * picker as something to select and finish.
   *
   * For a component that is genuinely part of another one. A table's drop
   * leaves are the top's own edges unfolded: they take the top's finish, they
   * are controlled from the top's panel, and a separate row for them in the
   * parts list invited a customer to finish the extension in a different
   * timber from the thing it extends.
   *
   * Not the same as `setPartHidden`, which is a customer temporarily getting a
   * part out of their way. This is a fact about the model, and it still needs
   * a PartDef: the role here is what tells the rig to build the part at all
   * (see `rolesOf`), and the label is what the build sheet calls it.
   */
  hidden?: boolean;
  surface: Surface;
  /**
   * Shown in the studio and refinishable, but not something the furniture shop is
   * being asked to build.
   *
   * An uploaded bed arrives with its bedlinen modelled -- a duvet, a pair of
   * pillows -- and leaving those out of the render would make the piece look
   * wrong, while leaving them ON the build sheet would ask a furniture shop
   * to quote for a duvet. So they stay on screen, keep their own finish and
   * can be hidden like any other part, and `measureRig` drops them from the
   * measured parts that feed the blueprint's drawn views, its component
   * schedule and the overall dimensions.
   *
   * Distinct from both of the rig's existing off-screen states: a REMOVED
   * part is gone from the design entirely, a HIDDEN part is built but not
   * currently drawn, and a staging part is drawn but was never being built.
   */
  staging?: boolean;
  /**
   * What this part is actually made of, for the order and the blueprint.
   *
   * Surface says which palette a part draws from, which is not the same thing.
   * A caned seat and an all-weather weave share the rattan palette, and a build
   * sheet that calls either of them "Rattan" when one is cane is wrong in a way
   * that costs someone a phone call. Defaults to a name for the surface.
   */
  stock?: string;
  /**
   * Every palette this part may be built in, widest sense first.
   *
   * `surface` says which list a part draws from *by default* -- the stock the
   * model was authored in. This says what else a furniture shop could actually make
   * the same part out of, which is a different question and the one a customer
   * is really asking: a dining top is timber here, but a glass or marble top
   * on the same frame is an ordinary thing to order, and a moulded plastic
   * seat shell is not a stain over wood but a different piece entirely.
   *
   * Absent means "work it out from the role", which is right for almost every
   * part -- see `surfacesForPart`. Set it explicitly only where a specific
   * part breaks its role's rule.
   */
  accepts?: Surface[];
  controls: SizeControl[];
};

/**
 * What each role can be built in, before a part overrides it.
 *
 * Keyed on role rather than on part id because this is a fact about what the
 * piece DOES, which is exactly what a role already encodes: anything that
 * stands on the floor and carries weight has the same shortlist whether it is
 * called "Legs" or "Plinth", and a cushion is a cushion on every model.
 *
 * These lists are buildability rules, not a catalogue of everything that
 * exists. The studio is a commissioning tool -- what a customer configures
 * here, a furniture shop has to make -- so a combination nobody can build has no
 * business being offered, however much choice it would appear to add. Glass
 * is on tops, doors and shelves and nowhere else, because a pane can be
 * supported at its edges but cannot be a leg or take a screw. Stone is on
 * tops alone, for the same reason plus its weight. Cloth appears only where
 * something is upholstered, and never as structure.
 */
const ROLE_SURFACES: Record<PartRole, Surface[]> = {
  leaf: ["wood", "glass", "stone"],
  // Structure: it carries load, so it is timber, metal or a moulded polymer.
  // Carbon fibre rides in with the polymers -- to a furniture shop it is the same
  // job, a moulded shell bought finished.
  //
  // Several of these also take cloth, and that is not a stretch: a frame,
  // an arm, a case or a bed rail can be upholstered, and a fully covered
  // piece is one of the ordinary ways any of them is built. The ones that
  // stay bare are the ones nobody upholsters -- a leg, a stretcher, a pull.
  base: ["wood", "metal", "plastic"],
  seatFrame: ["wood", "metal", "plastic", "cloth"],
  backFrame: ["wood", "metal", "plastic", "cloth"],
  armrest: ["wood", "metal", "plastic", "cloth"],
  apron: ["wood", "metal", "plastic", "cloth"],
  stretcher: ["wood", "metal", "plastic"],
  carcass: ["wood", "metal", "plastic", "cloth"],
  drawer: ["wood", "metal", "plastic"],
  // Upholstery. Leather and vinyl live in the cloth list already, because
  // they are the same job to a furniture shop: a covering stretched over a pad.
  seatCushion: ["cloth"],
  backCushion: ["cloth"],
  // Surfaces held at their edges, which is what lets them be a pane or a slab.
  // Stone reaches a shelf as well as a top: a marble shelf in a display
  // cabinet is an ordinary thing to be asked for, and the load is carried by
  // the carcass either way. It does not reach a door, which swings.
  // Cloth on a top and a door is a padded bench lid and an upholstered panel
  // door -- both real, both asked for. Not on a shelf: nobody pads a shelf,
  // and what would stand on it.
  tabletop: ["wood", "glass", "stone", "metal", "plastic", "cloth"],
  shelf: ["wood", "glass", "stone", "metal", "plastic"],
  door: ["wood", "glass", "metal", "plastic", "cloth"],
  // A rim in the plane of the top: it frames a pane or a slab, so it has to
  // be something that can be worked and screwed, never the pane itself.
  //
  // Cloth belongs here too, and only looks odd until you have seen a
  // leather-topped writing table: the covering is laid into the frame the
  // same way a pane is, and it is the frame that is worked and screwed.
  tabletopBorder: ["wood", "metal", "cloth"],
  // Carving is subtractive and needs a dense solid; cast or moulded ornament
  // is real too, hence metal, but there is no such thing as a glass carving
  // on a piece like this.
  accessory: ["wood", "metal"],
  // Beds, by what each part does rather than what it is called. The rails,
  // both boards and whatever the mattress lies on carry the sleeper, so they
  // are structure; the mattress and a padded headboard insert are upholstery.
  bedRail: ["wood", "metal", "plastic", "cloth"],
  headboard: ["wood", "metal", "plastic", "cloth"],
  footboard: ["wood", "metal", "plastic", "cloth"],
  // Cloth belongs on a mattress support for one piece and one reason: a
  // sofa bed's pull-out is upholstered on every face a customer can see,
  // because it sits in the middle of the room when it is open. A bed's
  // slat deck is not, and nothing forces this on it -- the list says what
  // MAY be built, and a slat deck simply is not ordered in velvet.
  mattressSupport: ["wood", "metal", "plastic", "cloth"],
  mattress: ["cloth"],
  headboardPanel: ["cloth"],
  // Staging -- shown and refinishable, never built -- and only ever cloth.
  bedding: ["cloth"],
  pillows: ["cloth"],
  // Bought as components, not finished on site.
  hardware: ["metal", "plastic"],
};

/**
 * Woven parts answer to their geometry, not to their role.
 *
 * A caned seat's weave is in the MESH -- the rattan armchair's is 401
 * individually modelled strands -- and a rattan panel's weave is in the
 * texture. Either way the part is a woven field, and the question "what else
 * could this be woven from" has a short and specific answer: another weave,
 * or the polyethylene strand an all-weather chair uses. It is emphatically
 * not "a plank of narra": offering plank timber here would print a wood
 * grain across a woven surface, which is the moire the surface split exists
 * to prevent, and no furniture shop can weave a board in any case.
 *
 * The polymer answer is already in this list without naming "plastic": the
 * all-weather strand a garden chair is woven from lives in the rattan
 * palette, where it belongs, because it is a weave first and a polymer
 * second. Adding the solid-polymer list here instead would offer a moulded
 * polypropylene shell as a finish for 401 individually modelled strands,
 * which is not a finish at all but a different part.
 */
const WEAVE_SURFACES: Surface[] = ["cane", "rattan"];

/**
 * Every palette a part may be built in, its own first.
 *
 * Its own first because that is the stock the model was authored in and the
 * one its scan matches, so it is what the customer should see at the top of
 * the list and what "Original" belongs to. The rest follow in the role's
 * declared order, which is deliberate rather than alphabetical: timber before
 * metal before polymer is roughly the order a Philippine furniture shop would
 * suggest them in.
 */
export function surfacesForPart(part: PartDef): Surface[] {
  const declared =
    part.accepts ??
    (part.surface === "cane" || part.surface === "rattan"
      ? WEAVE_SURFACES
      : ROLE_SURFACES[part.role]);
  const ordered = [part.surface, ...declared];
  return ordered.filter((surface, i) => ordered.indexOf(surface) === i);
}

export const DEFAULT_PART_COLORS: Record<PartId, string> = {
  legs: "#ffffff",
  frame: "#ffffff",
  seatFrame: "#ffffff",
  seatCushion: "#ffffff",
  backFrame: "#ffffff",
  backCushion: "#ffffff",
  armrests: "#ffffff",
  ornaments: "#ffffff",
  tabletop: "#ffffff",
  apron: "#ffffff",
  tabletopBorder: "#ffffff",
  stretchers: "#ffffff",
  headboard: "#ffffff",
  headboardPanel: "#ffffff",
  footboard: "#ffffff",
  bedRail: "#ffffff",
  mattress: "#ffffff",
  mattressSupport: "#ffffff",
  bedding: "#ffffff",
  pillows: "#ffffff",
  carcass: "#ffffff",
  plinth: "#ffffff",
  doors: "#ffffff",
  drawers: "#ffffff",
  shelves: "#ffffff",
  handles: "#ffffff",
  leaves: "#ffffff",
};
