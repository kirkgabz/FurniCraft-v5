# FurniCraft Design System (DESIGN.md)

<!-- impeccable:design-tokens 1 -->

## Design Philosophy & Directives
FurniCraft is a bespoke Philippine custom furniture studio connecting clients with local verified master craftsmen. The visual language embodies **warm artisanal craftsmanship, architectural clarity, and tactile digital physics**.

Every surface is governed by three integrated skill systems:
1. **Taste Skill (`Leonxlnx/taste-skill`)**: Anti-slop layout variance, intentional whitespace, editorial hierarchy, strictly **zero pink/magenta/crimson**.
2. **Emil Kowalski (`emil-design-eng`)**: Physics-based springs, responsive `:active` scaling, smooth layout transitions, and no `transition: all`.
3. **Impeccable (`impeccable`)**: Systematic token discipline, robust empty states, accessible WCAG AA contrast.

---

## 1. Color Palette (Zero Pink / Warm Artisan Canvas)

### Light Mode (Daylight Furniture Shop)
| Token | Hex Value | Purpose |
| :--- | :--- | :--- |
| `--fc-bg` | `#F8F6F0` | Warm Alabaster canvas (clean, luminous, natural) |
| `--fc-panel` | `#FFFFFF` | Crisp elevated surface cards |
| `--fc-text` | `#1A1309` | Deep charcoal espresso for crisp text |
| `--fc-muted` | `#6E6254` | Warm earth secondary text |
| `--fc-border` | `rgba(26, 19, 9, 0.10)` | Hairline architectural borders |
| `--fc-btn` | `#2B1810` | Deep Philippine Walnut / Mahogany primary action |
| `--fc-btn-hover` | `#190E09` | Rich dark espresso hover state |
| `--fc-accent` | `#C67D38` | Warm Amber / Burnished Brass highlight & active states |
| `--fc-accent-2` | `#96561D` | Deep ochre secondary accent |
| `--fc-cane` | `#C67D38` | Natural Solihiya cane strand tone |
| `--fc-danger` | `#A83A2A` | Subdued terracotta / rust (no pink/magenta) |
| `--fc-verify` | `#315278` | BIR / Verified artisan trust blue |
| `--fc-online` | `#226E4A` | Active craftsman presence green |

### Dark Mode (Night Kamagong Studio)
| Token | Hex Value | Purpose |
| :--- | :--- | :--- |
| `--fc-bg` | `#120F0D` | Deep Kamagong dark ground |
| `--fc-panel` | `#1A1512` | Elevated dark timber panel |
| `--fc-text` | `#F4EFE6` | Soft ivory text |
| `--fc-muted` | `#A89B8C` | Muted cane text |
| `--fc-border` | `rgba(232, 213, 169, 0.12)` | Subtle illuminated border |
| `--fc-btn` | `#E8D5A9` | Pale cane / Ivory primary CTA |
| `--fc-btn-hover` | `#F2E7D0` | High-contrast ivory hover |
| `--fc-accent` | `#D4954A` | Luminous amber accent |
| `--fc-danger` | `#E05D4A` | Warm rust danger |

---

## 2. Typography
- **Display / Brand / Hero Headlines**: `var(--font-display)` (Warm Editorial Serif / Architectural Display)
- **Body & Controls**: `var(--font-sans)` (Clean Geometric Sans with optical tabular numbers for 3D measurements)
- **Studio Dimensions & Measurements**: Monospace / Tabular numbers (`font-mono` / `tabular-nums`)

---

## 3. Motion & Micro-Interactions (Emil Kowalski Standard)
- **Spring Curves**: `cubic-bezier(0.16, 1, 0.3, 1)` for entrances and layout transitions.
- **Tactile Active Press**: All interactive buttons & cards trigger `transform: scale(0.98)` on `:active`.
- **Explicit Transitions**: No `transition: all`. Properties must be explicit (`transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1), background-color 150ms ease, opacity 150ms ease`).
- **Modal Entrance**: Scale from `scale(0.96)` to `scale(1)` with concurrent `opacity: 0` to `opacity: 1`.

---

## 4. Iconography
- **Library**: `lucide-react`
- **Stroke Width**: `1.5px` (lightweight, refined, non-bulky)
- **Optical Sizing**: `16px` (compact controls), `20px` (standard navigation/buttons), `24px` (feature icons)

---

## 5. The Pointer (Nail & Hammer)

The system arrow is replaced by the shop's own tool. Owned by
`components/cursor/nail-cursor.tsx`; all styling lives in the `.nail-*` rules at
the end of `app/globals.css`.

- **The nail**: point at the hotspot, shaft falling away down-right on the
  lattice's 45°, head trailing. Position is written straight to `transform` on
  every `pointermove` — no follower lag, no spring. The tip is the truth.
- **States**: plain at rest; `scale(1.16) rotate(-8deg)` with a brass pilot-hole
  halo over anything actionable; `scale(0.93)` while pressed. Everything pivots
  on the point, so the tip never leaves the pixel it is addressing.
- **The strike**: every press, mouse or touch, swings a hammer onto the nail
  head over 520ms, landing at 200ms. The shockwave rings and the cane-coloured
  splinters are delayed to that beat and thrown from the entry point, not the
  head. On touch there is no cursor to hit, so the strike brings its own nail.
- **Tokens**: `--fc-nail-body`, `--fc-nail-head`, `--fc-nail-sheen`,
  `--fc-nail-edge`, `--fc-hammer-steel`, `--fc-hammer-wood`, `--fc-hammer-grip`.
  Timber, never grey steel. `--fc-nail-edge` is a halo painted under the fill
  (`paint-order: stroke fill`) so the tool holds its silhouette over a lit 3D
  render as well as over paper.
- **What it must never cost anyone**: the cursor is drawn only where a real
  mouse is (`hover: hover and pointer: fine`); the caret still wins inside text
  fields; `forced-colors: active` hands back the system arrow untouched;
  `prefers-reduced-motion` reduces the strike to a single quiet ring; and an
  element that sets its own cursor from script — the studio canvas marking a
  selectable part — is read and carried through as the nail's cocked state
  rather than overridden.
