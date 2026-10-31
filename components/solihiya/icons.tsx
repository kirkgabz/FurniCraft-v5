/**
 * The icon set, drawn in the solihiya grammar.
 *
 * This replaces two things: emoji standing in for icons, and the default
 * lucide set. Both are tells. Emoji render as somebody else's artwork at
 * whatever weight the OS feels like, and lucide is the most-reached-for icon
 * library there is, so a product wearing it unmodified looks like every other
 * product built this year.
 *
 * The grammar is taken from the material rather than picked as a style, and it
 * is four rules:
 *
 *   1. Square caps and mitred joins. Cane strands are cut flat, never rounded.
 *      This is the single biggest departure from lucide's rounded caps and does
 *      most of the work of making these read as constructed rather than soft.
 *   2. Octagons where a generic set would use circles -- an octagon is the
 *      opening a six-pass cane weave actually makes.
 *   3. Diagonals at exactly 45 degrees, the lattice's own angle.
 *   4. Forms built from crossing strands rather than traced as outlines.
 *
 * Everything sits on a 24-unit grid stepping in 3s, so the icons share a module
 * with the weave itself. Stroke is 1.5 at 24px: heavy enough to hold at 18px in
 * a nav rail, light enough not to blacken beside Archivo's UI weight.
 */

/**
 * Anything a plain <svg> accepts, so these drop into call sites the same way an
 * icon-library component would -- including the `aria-hidden` a decorative use
 * passes explicitly, and the `role`/`aria-label` a meaningful one needs.
 */
export type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  /** Overrides the default weight where an icon sits unusually large or small. */
  strokeWidth?: number;
};

/** The shape every icon in this set has, for callers that store one in a table. */
export type SolihiyaIcon = (props: IconProps) => React.ReactElement;

function Strand({
  size = 20,
  className,
  strokeWidth = 1.25,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      /* `solihiya-icon` pins the stroke to non-scaling in the stylesheet, which
         is what keeps the set looking like one family. Stroke is otherwise
         measured in viewBox units, so a fixed weight renders at 0.9px in a 14px
         slot and 1.5px in a 24px one -- the same icon visibly lighter beside a
         small label than in the nav rail. Sizing here comes from Tailwind
         classes as often as from `size`, so the fix has to survive the
         attributes being overridden; non-scaling-stroke does, an arithmetic
         adjustment against `size` would not. */
      className={`solihiya-icon${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** One woven cell: the panel itself, and so the way back to the whole of it. */
export function IconOverview(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 4 H15 L20 9 V15 L15 20 H9 L4 15 V9 Z" />
      <path d="M12 4 V20 M4 12 H20" opacity="0.55" />
    </Strand>
  );
}

/** A crate, on the diagonals the lattice already uses. */
export function IconOrders(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 8 L12 4 L20 8 V16 L12 20 L4 16 Z" />
      <path d="M4 8 L12 12 L20 8 M12 12 V20" opacity="0.55" />
    </Strand>
  );
}

/**
 * A bayong: the woven market bag, with its handle, standing in for a cart.
 * The crate (IconOrders) used to do both jobs, so Cart and Orders sat side
 * by side in the nav under the same picture.
 */
export function IconCart(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M5 9 H19 L17.5 20 H6.5 Z" />
      <path d="M9 9 V7.5 A3 3 0 0 1 15 7.5 V9" />
      <path d="M5.6 13.5 H18.4 M9.5 9 L9 20 M14.5 9 L15 20" opacity="0.55" />
    </Strand>
  );
}

/** An arrow turning back on itself: put things back as they were. */
export function IconUndo(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M8 5 L4 9 L8 13" />
      <path d="M4 9 H14 A5 5 0 0 1 14 19 H9" />
    </Strand>
  );
}

/** Three knots on a strand: more of what is here, in a list. */
export function IconMore(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M5 12 H5.01 M12 12 H12.01 M19 12 H19.01" strokeWidth={3.2} />
    </Strand>
  );
}

/** A sample of the weave: warp and weft, which is what a template is here. */
export function IconTemplates(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 4 H20 V20 H4 Z" />
      <path d="M4 10 H20 M4 14 H20 M10 4 V20 M14 4 V20" opacity="0.55" />
    </Strand>
  );
}

/** A bubble with its corners chamfered, the way a cane opening cuts a square. */
export function IconMessages(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 5 H18 L20 7 V13 L18 15 H13 L9 19 V15 H6 L4 13 V7 Z" />
    </Strand>
  );
}

/** A storefront awning, built from posts and a span. */
export function IconSeller(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 9 L7 4 H17 L20 9 Z" />
      <path d="M5 9 V20 H19 V9" />
      <path d="M10 20 V14 H14 V20" opacity="0.55" />
    </Strand>
  );
}

/** A rosette rather than a gear: the same octagon, adjusted from its centre. */
export function IconSettings(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 4 H15 L20 9 V15 L15 20 H9 L4 15 V9 Z" />
      <path d="M12 9 L15 12 L12 15 L9 12 Z" opacity="0.55" />
    </Strand>
  );
}

/** A chair in front elevation -- the same view the blueprint draws. */
export function IconFurniture(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M7 3 V13 M17 3 V13 M7 6 H17" />
      <path d="M5 13 H19" />
      <path d="M7 13 V21 M17 13 V21" />
    </Strand>
  );
}

/** A person, squared off so they belong to the same set. */
export function IconProfile(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 5 H15 L16 8 L15 11 H9 L8 8 Z" />
      <path d="M4 20 V17 L8 14 H16 L20 17 V20" />
    </Strand>
  );
}

/** A caning awl: the tool that actually threads a panel. */
export function IconEdit(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 20 L6 14 L16 4 L20 8 L10 18 Z" />
      <path d="M14 6 L18 10" opacity="0.55" />
    </Strand>
  );
}

/** Struck, not rung: a bell squared into the set's geometry. */
export function IconBell(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 17 V11 L9 6 H15 L18 11 V17" />
      <path d="M4 17 H20" />
      <path d="M10 20 H14" opacity="0.55" />
    </Strand>
  );
}

/** A dimension line with its end ticks: the studio's own measuring mark. */
export function IconRuler(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 6 V18 M20 6 V18" />
      <path d="M4 12 H20" opacity="0.55" />
    </Strand>
  );
}

/**
 * A rating star, and deliberately the conventional five-pointed one.
 *
 * The first attempt was a four-pointed version, on the theory that it sat
 * closer to the set's octagonal geometry. On screen it read as a sparkle --
 * the same "AI magic" mark this set exists to avoid, and it did not say
 * "rating" at all. A star is a symbol people read, not a shape to restyle;
 * the grammar shows up in the square caps and mitred joins instead.
 */
/**
 * Turn the piece on the spot.
 *
 * An octagon rather than a circle, per rule 2 -- and left open on the
 * top-left, where the strand carries on past the ring and ends in a tip at
 * exactly 45 degrees. The tip is the whole point: a closed ring says
 * "circle", and only the break and the arrowhead say which way the thing
 * turns.
 */
export function IconRotate(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 6 H15 L18 9 V15 L15 18 H9 L6 15 V9" />
      <path d="M6 9 L12 3" />
      <path d="M12 3 H9 M12 3 V6" />
    </Strand>
  );
}

/**
 * A carcass with its door swung open, and the shelves the door was covering.
 *
 * The door is a parallelogram rather than a rectangle because that is what a
 * panel on a hinge looks like from the front, and its leading edge runs at the
 * lattice's own 45 degrees. The shelves are drawn lighter: they are what the
 * icon is *about*, but the carcass is what makes it read as a cabinet.
 */
export function IconCabinetOpen(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 3 H21 V21 H9 Z" />
      <path d="M9 9 H21 M9 15 H21" opacity="0.55" />
      <path d="M9 3 L3 6 V18 L9 21" />
    </Strand>
  );
}

/**
 * A sofa seen from the front: a long seat between two arms, a back rising
 * behind it, and the cushion seam that makes it a sofa rather than a bench.
 */
export function IconSofa(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 12 V6 H18 V12" />
      <path d="M3 9 H6 V15 H18 V9 H21 V18 H3 Z" />
      <path d="M12 12 V15" opacity="0.55" />
      <path d="M6 18 V21 M18 18 V21" />
    </Strand>
  );
}

/**
 * A bookshelf: a tall case, two shelves, and books on them -- two upright and
 * one leaning at the lattice's own 45 degrees, which is what makes the lines
 * read as books and not as more shelving.
 */
export function IconBookshelf(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 3 H18 V21 H6 Z" />
      <path d="M6 9 H18 M6 15 H18" />
      <path d="M9 9 V4.5 M12 9 V4.5 M12 15 L15 12" opacity="0.55" />
    </Strand>
  );
}

/* ------------------------------------------------------- kinds of furniture
 *
 * One per category on the studio picker, beside IconSofa and IconBookshelf
 * above. Each is the piece in the view that tells it from its neighbours --
 * a chair and a stool from the side, where the back is what differs; a table
 * and a desk from the front, where the drawer pedestal is -- with the
 * secondary lines (slats, rails, drawer fronts) at the lighter weight.
 */

/** A chair from the side: a back post that runs to the floor, the seat, the front leg. */
export function IconChair(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M7.5 3 V21" />
      <path d="M7.5 13.5 H16.5 V21" />
      <path d="M7.5 6 H10.5 M7.5 9 H10.5" opacity="0.55" />
    </Strand>
  );
}

/** A table: a thick top on four legs, with the stretcher between them. */
export function IconTable(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 7.5 H21 V10.5 H3 Z" />
      <path d="M6 10.5 V21 M18 10.5 V21" />
      <path d="M6 16.5 H18" opacity="0.55" />
    </Strand>
  );
}

/** A cabinet: a pair of doors over a drawer, with their pulls. */
export function IconCabinet(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 3 H18 V21 H6 Z" />
      <path d="M12 3 V15 M6 15 H18" />
      <path d="M10.5 7.5 V10.5 M13.5 7.5 V10.5 M10.5 18 H13.5" opacity="0.55" />
    </Strand>
  );
}

/** A bed from the side: a tall headboard, the mattress, a low footboard, a pillow. */
export function IconBed(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 6 V21 M21 12 V21" />
      <path d="M3 12 H21 M3 16.5 H21" />
      <path d="M6 12 V9.5 H10.5 V12" opacity="0.55" />
    </Strand>
  );
}

/** A desk: the top, one open leg, and a drawer pedestal under the other end. */
export function IconDesk(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 7.5 H21" />
      <path d="M4.5 7.5 V21" />
      <path d="M13.5 7.5 V21 H19.5 V7.5" />
      <path d="M13.5 12 H19.5 M13.5 16.5 H19.5" opacity="0.55" />
    </Strand>
  );
}

/** A stool: a deep round seat seen edge-on, on legs joined by a rung, and no back. */
export function IconStool(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 6 H18 V9 H6 Z" />
      <path d="M7.5 9 V21 M16.5 9 V21" />
      <path d="M7.5 16.5 H16.5" opacity="0.55" />
    </Strand>
  );
}

/* --------------------------------------------------------------- materials
 *
 * One glyph per kind of stock, drawn as what the material DOES rather than as
 * a picture of a chair made from it: timber is figure running along a board,
 * a weave is strands crossing, a slab is bedding planes, glass is a plane you
 * can see through. Grouped by family rather than one per finish, because a
 * finish's colour is already carried by its swatch -- narra and kamagong are
 * the same timber to a glyph and different to the eye, and drawing eighty-odd
 * near-identical marks would say less than these do.
 */

/** Figure running the length of a board. */
export function IconTimber(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 6 H21 M3 12 H21 M3 18 H21" />
      <path d="M9 6 L12 12 L9 18" opacity="0.55" />
    </Strand>
  );
}

/** Vertical culms with their nodes: bamboo runs the other way to a plank. */
export function IconBamboo(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 3 V21 M12 3 V21 M18 3 V21" />
      <path d="M6 9 H12 M12 15 H18" opacity="0.55" />
    </Strand>
  );
}

/** A manufactured sheet, and the core its face is only a face over. */
export function IconPanel(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 6 H21 V18 H3 Z" />
      <path d="M3 9 H21 M3 15 H21" opacity="0.55" />
    </Strand>
  );
}

/** Strands crossing at the lattice's own angle: a woven field. */
export function IconWeave(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 9 L9 3 M3 15 L15 3 M3 21 L21 3 M9 21 L21 9 M15 21 L21 15" />
    </Strand>
  );
}

/** Parallel reeds, close-set and all one way. */
export function IconReed(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 3 V21 M8 3 V21 M12 3 V21 M16 3 V21 M20 3 V21" />
    </Strand>
  );
}

/** Warp over weft: cloth, as a weave of two directions rather than four. */
export function IconCloth(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 8 H21 M3 12 H21 M3 16 H21" />
      <path d="M8 4 V20 M16 4 V20" opacity="0.55" />
    </Strand>
  );
}

/** A hide, cut and stitched: no weave at all, and an edge that shows it. */
export function IconHide(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 4 L18 4 L21 12 L18 20 L6 20 L3 12 Z" />
      <path d="M7 8 H9 M11 8 H13 M15 8 H17" opacity="0.55" />
    </Strand>
  );
}

/** A pane, and the one diagonal that says you are looking through it. */
export function IconGlass(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 4 H20 V20 H4 Z" />
      <path d="M8 16 L16 8" opacity="0.55" />
    </Strand>
  );
}

/** A drawn section with a bevelled edge: bar stock, not board. */
export function IconMetal(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 9 L9 3 H21 V15 L15 21 H3 Z" />
      <path d="M9 3 V15 H21 M3 15 H9" opacity="0.55" />
    </Strand>
  );
}

/** A slab, with the bedding the veining follows. */
export function IconStone(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 7 H21 V17 H3 Z" />
      <path d="M6 7 L9 12 L6 17 M13 7 L16 12 L13 17" opacity="0.55" />
    </Strand>
  );
}

/** A moulded shell: one continuous form, which is the whole point of a polymer. */
export function IconPolymer(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 3 H18 L21 9 V15 L18 21 H6 L3 15 V9 Z" />
      <path d="M9 9 H15 V15 H9 Z" opacity="0.55" />
    </Strand>
  );
}

/** The stock the model was photographed in, whatever that happens to be. */
export function IconAsShown(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 6 H20 V18 H4 Z" />
      <path d="M4 18 L10 10 L14 15 L17 12 L20 15" opacity="0.55" />
    </Strand>
  );
}

export function IconStar(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M12 3 L14.6 9.3 L21.4 9.9 L16.3 14.4 L17.8 21 L12 17.5 L6.2 21 L7.7 14.4 L2.6 9.9 L9.4 9.3 Z" />
    </Strand>
  );
}

/** Two strands hooked through one another. */
export function IconLink(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M10 14 L14 10" />
      <path d="M13 5 L16 5 L20 9 V12 L16 16 H14" />
      <path d="M11 19 H8 L4 15 V12 L8 8 H10" opacity="0.7" />
    </Strand>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M5 6 H19" />
      <path d="M9 6 V4 H15 V6" />
      <path d="M7 6 L8 20 H16 L17 6" />
      <path d="M11 10 V16 M14 10 V16" opacity="0.55" />
    </Strand>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M20 12 H5" />
      <path d="M11 6 L5 12 L11 18" />
    </Strand>
  );
}

/**
 * The disclosure caret, rotated by the caller to point where it needs to.
 *
 * Two strands meeting at exactly 45 degrees, which is the lattice's own angle,
 * so it needs no special pleading to sit in this set: it is the same corner the
 * weave makes wherever two canes cross.
 */
/**
 * "Opens its own page", drawn as the lattice's own 45 degree diagonal with the
 * two caps that close a strand's corner.
 */
export function IconArrowUpRight(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M7 17 L17 7" />
      <path d="M8 7 H17 V16" />
    </Strand>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 9 L12 15 L18 9" />
    </Strand>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M12 5 V19 M5 12 H19" />
    </Strand>
  );
}

/** An arrow settling into a tray -- the universal "keep this," on the grid. */
export function IconSave(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M12 4 V15 M7 10 L12 15 L17 10" />
      <path d="M4 17 V20 H20 V17" />
    </Strand>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 12 L10 18 L20 6" />
    </Strand>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M8 8 H19 V19 H8 Z" />
      <path d="M5 16 H4 V4 H16 V5" opacity="0.55" />
    </Strand>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </Strand>
  );
}

/** Three strands of warp, which is what a nav rail is. */
export function IconMenu(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 7 H20 M4 12 H20 M4 17 H20" />
    </Strand>
  );
}

/** A place marker, pointed the way a chamfered cane opening would be. */
export function IconLocation(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M12 21 L6 12 A6 6 0 1 1 18 12 Z" />
      <path d="M12 7 L15 10 L12 13 L9 10 Z" opacity="0.55" />
    </Strand>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M7 3 H17 V21 H7 Z" />
      <path d="M10 18 H14" opacity="0.55" />
    </Strand>
  );
}

/** The octagon again, with hands: an opening you read the time off. */
export function IconClock(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M9 4 H15 L20 9 V15 L15 20 H9 L4 15 V9 Z" />
      <path d="M12 8 V12 L15 15" opacity="0.7" />
    </Strand>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M12 4 L21 20 H3 Z" />
      <path d="M12 10 V14 M12 17 H12.01" opacity="0.7" />
    </Strand>
  );
}

export function IconDocument(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18 M9 12 H15 M9 16 H15" opacity="0.55" />
    </Strand>
  );
}

/** An identity card: the document, laid on its side with a portrait block. */
export function IconId(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M3 6 H21 V18 H3 Z" />
      <path d="M7 10 H10 V13 H7 Z M13 10 H18 M13 14 H18" opacity="0.55" />
    </Strand>
  );
}

/**
 * Presence, as a woven cell rather than a coloured ball.
 *
 * A green circle beside "Online" is the same emoji problem in CSS: the state
 * lives entirely in hue, so it disappears for anyone who cannot separate the
 * two colours. Here `online` is a filled cell and `away` is bare warp, which
 * is the same distinction the commission path already uses -- and it survives
 * being printed in black and white.
 */
export function IconPresence({
  online,
  size = 12,
  className,
}: {
  online: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke={online ? "var(--fc-online)" : "var(--fc-muted)"}
      strokeWidth="1.5"
      strokeLinecap="square"
      className={className}
    >
      <path d="M4 1 H8 L11 4 V8 L8 11 H4 L1 8 V4 Z" />
      {online ? <path d="M4 6 H8 M6 4 V8" /> : null}
    </svg>
  );
}

/* --- Conversation controls ---------------------------------------------
   The chat header and composer needed five glyphs the set did not carry.
   They are drawn here, in the same grammar as everything above, rather than
   pulled from a second icon library: one family per product, and a rounded
   lucide camera sitting beside these would be visible immediately. */

/** A camcorder: the body on the grid, the lens as a strand cut away from it. */
export function IconVideo(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 8 H14 V16 H4 Z" />
      <path d="M14 11 L20 8 V16 L14 13 Z" />
    </Strand>
  );
}

/** A camera: octagon lens, because the weave makes octagons, not circles. */
export function IconCamera(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 8 H20 V19 H4 Z" />
      <path d="M9 8 L10.5 5 H13.5 L15 8" />
      <path d="M10.5 10.5 H13.5 L15.5 12.5 V15.5 L13.5 17.5 H10.5 L8.5 15.5 V12.5 Z" />
    </Strand>
  );
}

/** A picture: a frame with the horizon crossing it on the lattice diagonal. */
export function IconImage(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 5 H20 V19 H4 Z" />
      <path d="M4 15 L9 10 L13 14 L16 11 L20 15" />
      <path d="M15 8 H17 V10 H15 Z" opacity="0.55" />
    </Strand>
  );
}

/** A microphone, its capsule an octagon on the same module as the rest. */
export function IconMic(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M10.5 3 H13.5 L15 4.5 V10.5 L13.5 12 H10.5 L9 10.5 V4.5 Z" />
      <path d="M6 10 V12 L9 15 H15 L18 12 V10" />
      <path d="M12 15 V20 M9 20 H15" />
    </Strand>
  );
}

/** A raised thumb: the cuff and the hand as two woven blocks. */
export function IconThumbUp(props: IconProps) {
  return (
    <Strand {...props}>
      <path d="M4 11 H7 V20 H4 Z" />
      <path d="M7 11 L11 4 H12.5 L12 9 H18 L20 11 L18 20 H7 Z" />
    </Strand>
  );
}
