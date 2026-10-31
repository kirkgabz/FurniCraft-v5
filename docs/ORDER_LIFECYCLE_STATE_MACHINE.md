# FurniCraft Order Lifecycle & State Machine

This document details the transactional state machine governing the relationship between customers and furniture shops in **FurniCraft**.

---

## 1. The 7-State Lifecycle State Diagram

```mermaid
stateDiagram-v2
    [*] --> pending_quote : Customer sends 3D design order

    pending_quote --> quoted : Shop sends total price & downpayment %
    pending_quote --> declined : Customer cancels OR Shop declines

    quoted --> confirmed : Customer accepts quote
    quoted --> quoted : Shop updates quote
    quoted --> declined : Customer cancels OR Shop declines

    confirmed --> payment_submitted : Customer uploads payment receipt
    confirmed --> declined : Customer cancels OR Shop declines

    payment_submitted --> in_production : Shop verifies receipt & accepts
    payment_submitted --> confirmed : Shop rejects receipt (requires re-upload)
    payment_submitted --> declined : Shop declines order

    in_production --> completed : Shop finishes & ships piece
    
    completed --> [*]
    declined --> [*]
```

---

## 2. Order States & Human-Readable Semantics

| State (`status`) | UI Badge Label | Customer Hint | Shop Owner Hint |
| :--- | :--- | :--- | :--- |
| `pending_quote` | **Needs quote** | Waiting for the shop to price your design. | Send the customer a price and downpayment. |
| `quoted` | **Quoted** | Review the quote and confirm or decline it. | Waiting for the customer to accept your quote. |
| `confirmed` | **Downpayment due** | Pay the downpayment with the shop's QR, then upload receipt. | Waiting for customer to pay and upload receipt. |
| `payment_submitted` | **Receipt to check** | The shop is checking your payment. | Check your GCash/bank app, then approve or reject. |
| `in_production` | **In production** | Your piece is being built. | Building. Mark completed when it ships. |
| `completed` | **Completed** | Done — you can leave the shop a review. | Done. |
| `declined` | **Declined** | No longer active. | No longer active. |

---

## 3. Transition Authority: Database Guard (`guard_design_order_columns`)

State transitions are not governed by client-side logic. The PostgreSQL trigger function `guard_design_order_columns` strictly validates the caller's role against an allowed transition matrix before committing changes:

### Allowed Transitions by Role

```
┌────────────────────────────────────────┬────────────────────────────────────────┐
│             Shop Owner                 │                Customer                │
├────────────────────────────────────────┼────────────────────────────────────────┤
│ pending_quote     --> quoted           │ pending_quote     --> declined         │
│ pending_quote     --> declined         │ quoted            --> confirmed        │
│ quoted            --> quoted (requote) │ quoted            --> declined         │
│ quoted            --> declined         │ confirmed         --> payment_subm.    │
│ payment_submitted --> in_production    │ confirmed         --> declined         │
│ payment_submitted --> confirmed (reject│                                        │
│ payment_submitted --> declined         │                                        │
│ in_production     --> completed        │                                        │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

> [!CAUTION]
> A customer **cannot** mark an order `in_production` or `completed`.
> A shop owner **cannot** accept a quote or submit a receipt on behalf of a customer.
> Attempting an unauthorized transition triggers an immediate PostgreSQL exception (`RAISE EXCEPTION`), which is caught and surfaced directly in the UI.

---

## 4. Payment Model: Direct QR & Manual Verification

FurniCraft avoids third-party payment gateway fees and compliance hurdles by employing a **Direct QR Transfer** model:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer
    participant UI as FurniCraft UI
    actor Shop as Shop Owner
    participant Bank as GCash / Bank App

    Customer->>UI: Accept quote (Order -> confirmed)
    UI-->>Customer: Display Shop's GCash / QR Ph Image & Bank Info
    Customer->>Bank: Transfer downpayment directly to Shop
    Customer->>UI: Upload proof of payment screenshot
    Note over UI: Order status -> payment_submitted
    UI-->>Shop: Realtime Alert: "Receipt to check"
    Shop->>Bank: Check GCash/Bank app for incoming credit
    alt Receipt Verified
        Shop->>UI: Click "Approve Receipt"
        Note over UI: Order status -> in_production
        UI-->>Customer: Notification: "Your order is in production"
    else Receipt Invalid / Missing
        Shop->>UI: Click "Reject Receipt" (Provide reason)
        Note over UI: Order status -> confirmed (Receipt cleared)
        UI-->>Customer: Alert: "Receipt rejected: [Reason]"
    end
```

---

## 5. Cancellation & Decline Rules

1. **Customer Pre-Payment Cancellation**:
   - Customers may cancel their order at any point before money is transferred (`pending_quote`, `quoted`, `confirmed`).
2. **Post-Payment Cancellation Guard**:
   - Once an order reaches `payment_submitted` or `in_production`, the customer **cannot** unilaterally cancel in the UI. Cancellation requires a direct conversation with the shop owner to arrange a refund.
3. **Decline Reasons**:
   - When a shop declines an order or rejects a receipt, they can submit an explanation string (`decline_reason` or `receipt_rejection_reason`), which is stored on the order and published directly into the chat thread.

---

## 6. Realtime Chat Order Cards (`emit_order_event_message`)

Whenever an order changes state, the database trigger `emit_order_event_message` automatically synthesizes an **Interactive Order Card** inside the `shop_messages` thread:

- **Order Snapshot**: Displays miniature thumbnail, model name, and dimensions.
- **Quote / Payment Status**: Displays latest price, downpayment status, or rejection notices.
- **Deep Links**:
  - `[View Order Details]` -> Links to `/protected/orders/[id]`
  - `[Open 3D Design in Studio]` -> Loads the exact parametric JSON snapshot back into `/customize-furniture` for instant inspection.
