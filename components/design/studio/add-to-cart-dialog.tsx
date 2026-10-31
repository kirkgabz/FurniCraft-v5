"use client";
import { useLanguage as useUiLanguage } from "@/components/language/language-context";


import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { MIN_QUANTITY, MAX_QUANTITY } from "./studio-design-state";

/**
 * How many of the piece just designed, asked once as it goes into the cart.
 *
 * Asked here rather than sat permanently in the panel because quantity is a
 * decision about an order, not about a design: it has no effect on the model,
 * the measurements or the finishes, and a control that changes nothing you can
 * see is a control people ignore until it is wrong. At the moment of adding, it
 * is the only question left.
 */
export function AddToCartDialog({
  open,
  onClose,
  onConfirm,
  pieceName,
  sizeLabel,
  busy,
  editing,
  lockedShopName,
  mode = "cart",
}: {
  /** "buy" is Buy now: the same question, then straight to checkout instead of the cart. */
  mode?: "cart" | "buy";
  open: boolean;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
  pieceName: string;
  /** The piece as built, e.g. "49 x 110 x 58.5 cm". Null while unmeasured. */
  sizeLabel?: string | null;
  busy?: boolean;
  /** True when the piece is already in the cart and is being changed. */
  editing?: boolean;
  /**
   * Set when this design came from a shop's published template, naming that
   * shop. Shown here rather than left for checkout to reveal: a destination
   * the customer cannot change is something they should learn while they can
   * still decide not to, not at the end when they are trying to send.
   */
  lockedShopName?: string | null;
}) {
  const { t: uiText } = useUiLanguage();
  const [quantity, setQuantity] = useState(MIN_QUANTITY);
  const buying = mode === "buy";

  // Each visit starts from one. Carrying the last answer over would quietly add
  // six of something the customer only wanted one of.
  useEffect(() => {
    if (open) setQuantity(MIN_QUANTITY);
  }, [open]);


  return (
    <Modal open={open} onClose={onClose} ariaLabel={buying ? uiText("Buy this piece now") : uiText("Add this piece to your cart")} className="sm:max-w-sm" bodyClassName="p-0 sm:p-0">
      <div className="p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-muted)]">
          {buying ? uiText("Buy now") : editing ? uiText("Update cart") : uiText("Add to cart")}
        </p>
        <h2 className="mt-1 text-xl font-bold text-[var(--fc-text)]">{pieceName}</h2>

        {lockedShopName ? (
          <p className="mt-3 rounded-xl border border-[var(--fc-border)] bg-[rgba(178,106,56,0.06)] px-3 py-2 text-[13px] leading-snug text-[var(--fc-muted)]">
            <span className="font-semibold text-[var(--fc-text)]">{lockedShopName}</span>
            {buying
              ? uiText(" designed this, so they are the furniture shop that builds it.")
              : uiText(" designed this, so they are the furniture shop that builds it. Everything else in your cart can still go wherever you like.")}
          </p>
        ) : null}

        <label className="mt-5 block text-sm font-semibold text-[var(--fc-text)]" htmlFor="cart-quantity">{uiText("How many of this piece?")}</label>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label={uiText("One fewer")}
            disabled={quantity <= MIN_QUANTITY}
            onClick={() => setQuantity((n) => Math.max(MIN_QUANTITY, n - 1))}
            className="h-11 w-11 shrink-0 rounded-xl border border-[var(--fc-border)] text-lg font-bold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <input
            id="cart-quantity"
            type="number"
            min={MIN_QUANTITY}
            max={MAX_QUANTITY}
            value={quantity}
            onChange={(event) => {
              // Clamped on the way in, so the cart can never hold a count the
              // order pipeline would refuse.
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              setQuantity(Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.round(next))));
            }}
            className="h-11 w-20 rounded-xl border border-[var(--fc-border)] bg-transparent text-center text-base font-bold tabular-nums text-[var(--fc-text)]"
          />
          <button
            type="button"
            aria-label={uiText("One more")}
            disabled={quantity >= MAX_QUANTITY}
            onClick={() => setQuantity((n) => Math.min(MAX_QUANTITY, n + 1))}
            className="h-11 w-11 shrink-0 rounded-xl border border-[var(--fc-border)] text-lg font-bold text-[var(--fc-text)] transition-[background-color,transform] duration-150 hover:bg-[rgba(178,106,56,0.08)] active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
          >
            +
          </button>
        </div>

        {/* Where the estimated total used to sit. The studio stopped pricing
            pieces when budgets replaced estimates, so this block could never
            render again; the size takes its place, because the thing worth
            confirming before you commit a piece to the cart is that it is the
            size you shaped it to. */}
        {sizeLabel ? (
          <p className="mt-3 flex items-baseline gap-2 text-sm text-[var(--fc-muted)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">{uiText("Size")}</span>
            <span className="font-bold tabular-nums text-[var(--fc-text)]">{sizeLabel}</span>
          </p>
        ) : null}
        {/* This said "An estimate. The shop quotes the real figure once it sees
            the whole order." It sat under a price that is no longer shown --
            the studio stopped pricing pieces when budgets replaced estimates --
            so it explained a number that was not on screen. What is true at
            this moment is that nothing here has a price at all, and where the
            money question actually gets asked. */}
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--fc-muted)]">
          {buying
            ? uiText("Goes straight to checkout on its own; your cart is not changed. You give your budget there, and the furniture shop quotes against it.")
            : uiText("Nothing is priced here. You give your budget when you send the cart, and the furniture shop quotes against it.")}
        </p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={busy}>{uiText("Cancel")}</button>
          <button
            type="button"
            onClick={() => onConfirm(quantity)}
            className="btn btn-primary btn-sm"
            disabled={busy}
          >
            {busy ? uiText("Saving…") : buying ? uiText("Continue to checkout") : editing ? uiText("Update cart") : uiText("Add to cart")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Where to go once a piece is in the cart.
 *
 * The whole reason for a cart is that the next piece is often the point, so
 * "keep designing" is offered first and the studio is left exactly as it was --
 * no reset, no navigation, the design still on screen to be varied into the
 * next one.
 */
export function AddedToCartDialog({
  open,
  onKeepDesigning,
  onCheckout,
  pieceName,
  quantity,
  lineCount,
  pieceCount,
  shopCount,
  undecidedCount,
}: {
  open: boolean;
  onKeepDesigning: () => void;
  onCheckout: () => void;
  pieceName: string;
  quantity: number;
  lineCount: number;
  pieceCount: number;
  /** How many furniture shops the cart is currently addressed to. */
  shopCount: number;
  /** Lines with no furniture shop chosen yet. */
  undecidedCount: number;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <Modal open={open} onClose={onKeepDesigning} ariaLabel={uiText("Added to your cart")} className="sm:max-w-sm" bodyClassName="p-0 sm:p-0">
      <div className="p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--fc-ink-accent)]">{uiText("Added to cart")}</p>
        <h2 className="mt-1 text-xl font-bold text-[var(--fc-text)]">
          {quantity > 1 ? `${quantity} × ${pieceName}` : pieceName}
        </h2>
        <p className="mt-2 text-sm text-[var(--fc-muted)]">{uiText("Your cart holds ")}{lineCount} {lineCount === 1 ? uiText("design") : uiText("designs")}
          {pieceCount !== lineCount ? uiText(" — {0} pieces in all", { 0: pieceCount }) : ""}.
        </p>

        {/* What the cart will actually become, said before checkout rather
            than discovered there. Pieces bound for different furniture shops are
            separate orders, each quoted and paid on its own, and that is a
            thing to know while there is still time to consolidate. */}
        <p className="mt-1.5 text-sm text-[var(--fc-muted)]">
          {undecidedCount > 0 && shopCount === 0 ? uiText("Choose a furniture shop for each piece at checkout.") : undecidedCount > 0 ? uiText("{0} {1} no furniture shop yet — pick one at checkout.", { 0: undecidedCount, 1: undecidedCount === 1 ? "piece has" : "pieces have" }) : shopCount === 1 ? uiText("All of it goes to one furniture shop, as a single order.") : uiText("It goes to {0} furniture shops, so it will be sent as {1} separate orders.", { 0: shopCount, 1: shopCount })}
        </p>

        <div className="mt-5 grid gap-2">
          <button type="button" onClick={onKeepDesigning} className="btn btn-secondary">{uiText("Keep designing")}</button>
          <button type="button" onClick={onCheckout} className="btn btn-primary">{uiText("Go to checkout")}</button>
        </div>
      </div>
    </Modal>
  );
}
