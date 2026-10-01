# 09 — Responsive Design

Four surfaces with genuinely different mobile requirements. Treating them identically would either cripple the console or bloat the launcher, so each gets a stated posture.

---

## 1. Posture per surface

| Surface | Mobile posture | Reasoning |
|---|---|---|
| **Product Discovery** | **Mobile-first** | Public, SEO-relevant, likely arrived from a phone link |
| **Product Launcher** | **Fully responsive** | A user checking which products they have, on any device |
| **Organization Admin** | **Responsive, usable** | Occasional tasks: invite a member, check seats |
| **Company Console** | **Desktop-first, mobile read-mostly** | Dense multi-column tables; triage on mobile, act on desktop |

### 1.1 The console is deliberately not fully mobile

A table with organization, status, products, members, MRR, account manager and date cannot be made comfortable on a 375px screen without becoming a different product. Pretending otherwise produces a surface too cramped for desktop and too complex for mobile.

What mobile **does** support: viewing lists as cards, opening a customer, reading state, and simple actions. What it does not: bulk operations, plan limit editing, side-by-side comparison. Those show a short message pointing to desktop rather than a broken layout — an honest constraint beats a frustrating one.

**No feature is mobile-only-blocked for security reasons.** The restriction is ergonomic, and the API has no device awareness.

---

## 2. Breakpoints

Tailwind's defaults, which are sensible and widely understood. Inventing a custom scale costs familiarity for no benefit.

| Name | Min width | Target |
|---|---|---|
| *(base)* | 0 | Phone portrait |
| `sm` | 640px | Phone landscape, small tablet |
| `md` | **768px** | Tablet portrait — **sidebar becomes off-canvas below this** |
| `lg` | **1024px** | Tablet landscape, small laptop — **full sidebar appears** |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop — content capped at 1440px |

The two load-bearing breakpoints are `md` and `lg`; the others are content adjustments.

**Mobile-first CSS**: unprefixed styles are the small-screen case, `min-width` queries layer up. This keeps the smallest screen from inheriting desktop assumptions it has to undo.

---

## 3. Grid

12 columns, `--space-4` (16px) gutters on mobile, `--space-6` (24px) from `md`.

| Content | base | `md` | `lg` | `xl` |
|---|---|---|---|---|
| Metric tiles | 1 | 2 | 4 | 4 |
| Product tiles | 2 | 3 | 4 | 5 |
| Form | 1 | 1 | 1 | 1 |
| Detail panels | 1 | 1 | 2 | 2 |
| Charts | 1 | 1 | 2 | 2 |

**Forms stay single-column at every width** (`08` §6). Multi-column forms slow scanning, break the tab order's visual logic, and collapse awkwardly.

Product tiles go to **two across on the smallest screens**, not one. A single column of tiles turns the launcher into a long scroll and loses the at-a-glance quality that makes it a launcher.

---

## 4. Shell behavior

### 4.1 Below `md` — off-canvas

```text
┌─────────────────────┐
│ [≡] Logo  ⠿  [Av]   │   header, 56px
├─────────────────────┤
│                     │
│  Content, 1 col     │
│                     │
└─────────────────────┘
```

Sidebar becomes a drawer at `--z-sidebar` (above the header) with a scrim, closing on navigation, scrim tap, or Escape. Focus is trapped while open and returns to the toggle on close.

Header keeps the logo, launcher trigger and avatar; the organization switcher moves into the drawer, where there is room to show each organization's role.

### 4.2 `md` to `lg` — collapsed

Sidebar is 64px icon-only with tooltip labels, expandable on demand. The label remains in the link's accessible name, so screen-reader users are unaffected by the visual collapse.

### 4.3 `lg` and above — full

260px sidebar, persistent, user-collapsible with the state remembered.

---

## 5. Tables on small screens

The hardest responsive problem in this system. Three strategies, chosen per table rather than applied globally.

### 5.1 Card transformation — default for list screens

Below `md`, each row becomes a card with the primary field as its title and 3–4 key fields beneath.

```text
┌───────────────────────────────┐
│ ABC Restaurant Group      ⋯   │
│ ● Active · Customer           │
│ POS, Inventory · 14 members   │
│ $99.00/mo · Rahul Sharma      │
└───────────────────────────────┘
```

Fields are chosen deliberately — the ones needed to **identify and triage**, not all of them. The detail page has the rest. Dumping every column into a card produces an unreadable block.

### 5.2 Horizontal scroll — for genuinely tabular data

Where column relationships matter (audit logs, usage figures), the table scrolls horizontally with the first column pinned.

Requirements: a visible scroll affordance, keyboard scrolling, and `role="region"` with `aria-label` plus `tabindex="0"` so the scroll container is reachable without a mouse (`10` §4). A scrollable region that only a trackpad can reach is inaccessible.

### 5.3 Priority columns

Columns carry a priority; low-priority ones drop as width decreases. Used where a table is nearly narrow enough — cheaper than a card transformation.

**Never dropped at any width:** status, seat counts, limits, amounts. Those are the values an operator acts on (`08` §13).

---

## 6. Touch

| Requirement | Value |
|---|---|
| Minimum target | **44 × 44px** (WCAG 2.5.5 AAA; AA requires 24px — the stricter figure is adopted) |
| Spacing between targets | ≥ 8px |
| Mobile control height | `--control-height-lg` (48px) |
| Table row tap height | ≥ 48px |
| No hover-only information | Touch has no hover |
| No `:hover`-dependent actions | Row actions are always visible on touch |

### 6.1 Patterns that do not survive touch

| Desktop pattern | Touch replacement |
|---|---|
| Hover tooltip | Tap-to-open popover, or visible text |
| Row actions on hover | Always-visible `⋯` button |
| Hover row highlight | Active/pressed state |
| Drag to reorder | Explicit move buttons |
| Right-click menu | `⋯` menu |

**Tooltips never carry essential information** (`05` §3.5), and touch is the main reason. A disabled control explaining itself only on hover is unexplained on a phone.

### 6.2 Mobile input hygiene

Correct `type` and `inputMode` so the right keyboard appears: `type="email"`, `inputMode="numeric"` for limits, `type="search"`. `autocomplete` on identity fields. **Font size ≥ 16px on inputs**, because iOS Safari zooms the viewport on focus for anything smaller — which is a layout break, not a preference.

That last point conflicts with the 14px body default (`03` §3.1), and inputs are the documented exception.

---

## 7. Overlays on mobile

| Component | Desktop | Mobile |
|---|---|---|
| Dialog | Centered, max 560px | **Full-screen sheet** |
| Drawer | Right, 480px | Full-screen |
| Dropdown | Anchored popover | Bottom sheet |
| Select | Popover | Native-feeling bottom sheet |
| Tooltip | On hover | Not rendered |
| Toast | Bottom-right | Bottom-center, full width |
| Command palette | Centered | Full-screen |
| Launcher | Popover | Full-screen |

Dialogs become full-screen sheets because a centered modal on a 375px screen leaves unusable margins and its content scrolls awkwardly inside a box.

---

## 8. Launcher responsiveness

| Width | Grid | Behavior |
|---|---|---|
| base | 2 across | Full-screen from header trigger |
| `sm` | 3 | |
| `md` | 3 | Popover becomes available |
| `lg` | 4 | |
| `xl` | 5 | |

Tiles keep a consistent aspect ratio; taglines clamp to two lines (`03` §7). Search is always reachable, since a user with many products needs it most on the smallest screen.

---

## 9. Discovery pages — mobile-first

The only genuinely mobile-first surface, because visitors arrive from links on phones.

| Element | Mobile |
|---|---|
| Hero | Stacked, 24px title |
| Features | Single column |
| Plans | Stacked cards, **recommended plan first** |
| CTAs | Full-width, 48px |
| Prose | 16px / 24px, 72ch cap irrelevant at this width |
| Sticky CTA | Appears after the hero scrolls out |

Reordering plans to put the recommended one first on mobile is a real decision: a horizontal three-column pricing table stacked in source order buries the plan most customers should choose.

---

## 10. Performance on mobile

| Technique | Detail |
|---|---|
| Server Components for public pages | Less JavaScript shipped (ADR-019) |
| Route-based code splitting | Console bundle never reaches customer sessions (C7) |
| `next/image` for product icons | Sized, lazy, modern formats |
| Variable fonts, subset, `display: swap` | One file, no FOIT |
| Virtualization only where needed | `05` §4.1 |
| No layout shift | Skeletons match final layout; images carry dimensions |

Targets on a mid-range phone over 4G: LCP < 2.5s, INP < 200ms, CLS < 0.1 — the Core Web Vitals thresholds, which matter commercially for discovery pages since they are search-ranked.

---

## 11. Testing matrix

| Viewport | Device class |
|---|---|
| 375 × 667 | Small phone |
| 390 × 844 | Modern phone |
| 768 × 1024 | Tablet portrait |
| 1024 × 768 | Tablet landscape |
| 1440 × 900 | Laptop |
| 1920 × 1080 | Desktop |

Also tested: 200% browser zoom (WCAG 1.4.4), 320px minimum width (WCAG 1.4.10 reflow — **no horizontal scrolling of the page itself** at 320px), landscape phone, and both themes at every breakpoint.

The 320px reflow requirement is a WCAG AA obligation, not a nicety: at that width every surface must remain usable with vertical scrolling only. A table's own horizontal scroll (§5.2) is permitted; the page scrolling sideways is not.

---

## 12. Anti-patterns

| Forbidden | Why |
|---|---|
| Hiding content on mobile without an alternative | Mobile users need the information too |
| A separate mobile codebase | Two things to maintain and keep consistent |
| Device detection for layout | Breakpoints, not user-agent sniffing |
| Hover as the only way to reach an action | Touch has no hover |
| Targets under 44px | §6 |
| Inputs under 16px | iOS zooms the viewport |
| Horizontal **page** scroll at 320px | WCAG 1.4.10 |
| Dropping status, limits or amounts at any width | Values operators act on |
| Multi-column forms | Break on narrow and slow scanning anywhere |
| Fixed pixel heights on text containers | Break when text expands or zooms |

---

Next: `10-accessibility.md`.
