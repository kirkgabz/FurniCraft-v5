# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: customers ordering custom furniture.** Mostly first-timers, likely on a phone, who can picture the chair they want but have never touched CAD software and will not learn it. They arrive knowing a room, a budget, and a rough idea — not dimensions. The interface has to carry them from "I want a chair like that, but taller" to a buildable specification without ever feeling like engineering software.

**Secondary: shop owners.** Small Philippine furniture makers who publish design templates, quote incoming orders, approve payment receipts, and message customers. They live in the shop dashboard daily and value speed and unambiguity over polish. Their surfaces are out of scope for the current redesign but share the same component vocabulary.

**Tertiary: an administrator** reviewing shop-owner applications against submitted business documents.

## Product Purpose

Customers design a real piece of furniture in a live 3D studio, pick a shop, and send that exact design in as an order — dimensions, materials, finishes and a dimensioned shop drawing included. Shops quote it, the customer pays a downpayment directly, and the shop builds it.

The problem it removes is the described-over-chat custom furniture order, where a customer sends a photo and a paragraph, the shop guesses, and both sides discover the mismatch after the piece is built. Success is an order arriving at a furniture shop specified precisely enough to cut from.

## Positioning

The studio does not generate furniture procedurally from boxes. It opens a real licensed GLTF model, recovers its individual parts by connected-component analysis over the triangle graph, classifies them per model, and rigs them so resizing behaves the way furniture behaves — raising the legs lifts the seat and back by exactly the distance their attachment points travelled; widening the seat spreads the legs to the new corners. It then traces a dimensioned blueprint from the posed geometry with marching squares, so the drawing shows the real silhouette rather than a stack of bounding boxes.

A neighbouring product can copy a furniture configurator. Copying this means shipping the segmentation, the role-based rig, and the measurement pipeline that turns a posed model into centimetres a furniture shop can cut to.

## Operating Context

- **Philippines.** Pricing in pesos. Shops are small local furniture shops, not chains.
- **Payment is direct and manual by design.** Each shop publishes its own GCash / QR Ph details; the customer pays the shop, uploads a receipt, and the shop confirms against its own banking app. No gateway, no money passing through FurniCraft, and nothing in the system can verify a payment — `payment_submitted` means *the customer says they have paid*.
- **Shops are vetted.** Owners apply with BIR registration and a valid ID; an admin approves or rejects before they can trade.
- **Orders move through a seven-state lifecycle**: `pending_quote → quoted → confirmed → payment_submitted → in_production → completed`, or `declined`. Transitions are enforced by a per-role database trigger, not by the UI.
- **Conversation carries the transaction.** Customer and shop message in realtime, and order events post into the thread as cards.
- **This is a capstone/thesis project.** It will be demonstrated and defended to panelists, so the work has to read as deliberate craft on a screen as well as function in a browser.

## Capabilities and Constraints

**Shipped today**

- Five studio models: Victorian Chair, Cushion Chair, Rattan Armchair, Patio Armchair, Rattan Stool.
- Per-part editing with human-readable controls — each model exposes named parts (legs, seat frame, seat cushion, backrest frame, back cushion, leg ornaments) with labelled sliders and plain-language hints.
- A two-tier finish system: a base material (wood species, bamboo, rattan, reeded cane, fabric, leather) crossed with a finish (raw/oiled, hand-rubbed wax, satin polyurethane, high-gloss lacquer), backed by scanned PBR texture sets.
- Live measurement in centimetres, a dimensioned blueprint traced from the posed model, and a price estimate.
- Shop browsing with storefronts, ratings and social links; design templates publishable by shops and loadable by customers.
- Realtime messaging, in-app notifications with deep links, and one-review-per-completed-order ratings.

**Constraints that bind design work**

- **Access control lives in the database.** Row-level security is the authority; the UI can only suggest. Every rejection must surface rather than be swallowed.
- **A shop owner's two roles never share a surface.** `/protected` is the customer's screen even for an account that owns a shop; `/protected/shop` is the shop's. No role toggle.
- Next.js 16 App Router, React 19, TypeScript, Tailwind, Three.js, Supabase (Auth, Postgres with RLS, Realtime, Storage).
- A saved design round-trips as JSON, never as a picture, so an order or template reopens as a real editable design.

## Brand Commitments

The name **FurniCraft** and its logo are fixed. Everything else — palette, typography, layout language, component styling, motion, iconography — is open to replacement.

## Evidence on Hand

- Five licensed 3D models with thumbnails, in `public/models/`, each with its own `license.txt`.
- Scanned PBR texture sets (bamboo, dark wood, reeded cane, synthetic rattan) with diffuse, normal and roughness maps, in `public/textures/`.
- One stock storefront image, `public/images/shop.webp`.

There are **no** real customer testimonials, no completed-order history, no press coverage, no partner logos, and no usage statistics. Future work must not fabricate any of these; empty states have to carry the weight instead.

## Product Principles

1. **The design is the order.** What the customer poses is what the shop receives, in centimetres, as an editable document — not a screenshot with a caption.
2. **Never make a first-timer feel like they opened CAD.** Every control is named for what it does to the furniture, not for the transform it applies.
3. **The database is the authority; the interface is a suggestion.** Anything the UI implies about permission must already be true in a policy.
4. **The money is between the customer and the shop.** The product carries the agreement, the receipt and the trust signals — never the transaction.
5. **Credit the makers.** Model attribution ships with the interface, not buried in a licence file.

## Accessibility & Inclusion

Mobile-first is a product requirement, not a breakpoint afterthought: the primary user is expected to be on a phone. No formal conformance target has been set; WCAG AA contrast is the working floor.
