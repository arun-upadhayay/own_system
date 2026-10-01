# 02 — Design Tokens

The complete token set. Tokens are the contract between design and implementation: a value not in this document does not appear in a stylesheet.

---

## 1. Three-tier architecture

```text
Tier 1 — PRIMITIVES        raw values, no meaning
  --neutral-200: #E2E5EB
        ↓
Tier 2 — SEMANTIC          role in the interface; theme-dependent
  --border-default: var(--neutral-200)
        ↓
Tier 3 — COMPONENT         specific use; optional
  --button-border: var(--border-default)
```

**Components reference Tier 2 only.** This is the rule that makes dark mode possible: a component styled against `--border-default` works in both themes without change, while a component styled against `--neutral-200` is permanently light-mode. Tier 1 is referenced only inside theme definitions.

Tier 3 exists sparingly — only where a component needs to deviate and that deviation should be nameable rather than hardcoded.

### 1.1 Implementation

Tokens are **CSS custom properties** on `:root`, with dark values under both a media query and an explicit attribute. Tailwind v4's `@theme` maps them to utilities.

```css
@layer base {
  :root {
    color-scheme: light;
    --neutral-0:   #FFFFFF;
    --neutral-50:  #F7F8FA;
    /* …primitives… */
    --surface-raised: var(--neutral-0);
    --text-primary:   var(--neutral-900);
    /* …semantics… */
  }

  /* OS preference — loses to an explicit choice */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-raised: var(--neutral-900);
      --text-primary:   var(--neutral-50);
    }
  }

  /* Explicit choice — wins both ways */
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-raised: var(--neutral-900);
    --text-primary:   var(--neutral-50);
  }
}
```

The `:not([data-theme="light"])` guard lets a user who chooses light mode override OS dark. Declaring dark values twice is the cost of making the toggle authoritative in both directions; a single media query cannot do it.

`color-scheme` is set so native form controls, scrollbars and focus rings match the theme — without it, scrollbars stay light in dark mode, which is immediately noticeable.

---

## 2. Spacing

A **4px base grid**. Every margin, padding and gap is a token.

| Token | px | rem | Typical use |
|---|---|---|---|
| `--space-0` | 0 | 0 | Reset |
| `--space-0-5` | 2 | 0.125 | Hairline nudges, chart mark gaps |
| `--space-1` | 4 | 0.25 | Icon-to-label |
| `--space-2` | 8 | 0.5 | Inside compact controls |
| `--space-3` | 12 | 0.75 | Button padding, table cell x |
| `--space-4` | 16 | 1 | **Default rhythm**; card padding |
| `--space-5` | 20 | 1.25 | |
| `--space-6` | 24 | 1.5 | Card padding (comfortable), section gap |
| `--space-8` | 32 | 2 | Between sections |
| `--space-10` | 40 | 2.5 | |
| `--space-12` | 48 | 3 | Page section separation |
| `--space-16` | 64 | 4 | Page top/bottom |
| `--space-20` | 80 | 5 | Empty-state vertical centering |

4px rather than 8px because enterprise density needs intermediate steps: a 28px-tall compact control cannot be expressed on an 8px grid without looking wrong. 2px exists only for optical corrections and the chart-mark gaps the dataviz rules require.

### 2.1 Density tokens

Two densities, selected per surface rather than per component:

| Token | Comfortable | Compact | Used by |
|---|---|---|---|
| `--control-height-sm` | 32px | 28px | Inline table controls |
| `--control-height-md` | 40px | 36px | **Default** |
| `--control-height-lg` | 48px | 44px | Primary CTA, mobile |
| `--table-row-height` | 48px | 40px | Table rows |
| `--table-cell-px` | 16px | 12px | Table cell x-padding |

Launcher and discovery use **comfortable**. Company console and organization admin default to **compact**, because scanning hundreds of rows is their primary task. The density is a class on the surface root; components read the token.

---

## 3. Border radius

| Token | px | Use |
|---|---|---|
| `--radius-none` | 0 | Table cell edges, full-bleed |
| `--radius-sm` | 4 | Badges, tags, checkbox |
| `--radius-md` | **6** | **Default** — buttons, inputs, selects |
| `--radius-lg` | 8 | Cards, panels, product tiles |
| `--radius-xl` | 12 | Modals, large sheets |
| `--radius-full` | 9999 | Avatars, pills, toggles |

6px is the default deliberately. 4px reads slightly austere, 8px slightly soft and consumer; 6px is the restrained-but-modern midpoint that matches §4 of `00`.

**Nested radii step down**, so an inner element inside a `--radius-lg` card uses `--radius-md`. An inner radius equal to or larger than its container produces a visible mismatch at the corner.

---

## 4. Elevation

Per principle 4 in `00` §3: **structure comes from hairlines, not shadows.** Shadows are reserved for things that genuinely float.

### 4.1 Light theme

| Token | Value | Use |
|---|---|---|
| `--elevation-0` | `none` + `1px solid var(--border-default)` | Cards, panels, table containers |
| `--elevation-1` | `0 1px 2px 0 rgb(16 19 26 / 0.05)` | Raised card, sticky header |
| `--elevation-2` | `0 4px 8px -2px rgb(16 19 26 / 0.10), 0 2px 4px -2px rgb(16 19 26 / 0.06)` | Dropdown, popover, tooltip |
| `--elevation-3` | `0 12px 24px -6px rgb(16 19 26 / 0.12), 0 4px 8px -4px rgb(16 19 26 / 0.08)` | Modal, drawer |
| `--elevation-4` | `0 24px 48px -12px rgb(16 19 26 / 0.18)` | Command palette |

Shadow color is the darkest neutral at low alpha, **never pure black** — black shadows look muddy over tinted neutrals.

### 4.2 Dark theme — a different mechanism

**Shadows barely read on dark surfaces.** Elevation in dark mode is carried by **surface lightness plus border**, which is why dark mode cannot be an inversion:

| Level | Light | Dark |
|---|---|---|
| Base page | `--neutral-50` | `--neutral-950` |
| Card | white + border | `--neutral-900` + border |
| Dropdown | white + shadow-2 | `--neutral-800` + border + faint shadow |
| Modal | white + shadow-3 | `--neutral-800` + stronger border + shadow |

The dark page (`#0B0D12`) and dark card (`#1A1E28`) were chosen for a measured **1.17:1** separation — enough to read as distinct layers, not enough to look stripey (`04-color-system.md` §3).

Dark shadows use a higher alpha against near-black and are additive to the surface step, never a substitute for it.

---

## 5. Motion

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 75ms | Hover, active — must feel immediate |
| `--duration-fast` | **120ms** | **Default**: color, opacity, small transforms |
| `--duration-normal` | 180ms | Dropdown, popover, tooltip entry |
| `--duration-slow` | 240ms | Modal, drawer |
| `--duration-deliberate` | 320ms | Full-screen or route transition |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | **Default** — entering |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exiting |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Moving between positions |

### 5.1 Rules

| Rule | Reason |
|---|---|
| Animate **opacity and transform only** | Compositor-driven; animating width/height/top triggers layout |
| Nothing exceeds 320ms | Longer reads as sluggish in a tool used all day |
| **No bounce or spring overshoot** | Reads consumer-playful; in an admin tool it reads imprecise |
| Enter with `ease-out`, exit with `ease-in` | Enter decelerating feels responsive; exit accelerating feels decisive |
| Exits are shorter than entrances | ~0.75×. A slow dismissal feels like lag |
| No animation on data updates | A table that animates row changes makes scanning harder |

### 5.2 Reduced motion

Honored globally, once:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`0.01ms` rather than `0` so transition-end events still fire — components that await them would otherwise hang open. Transitions are **not** removed from the markup; they are collapsed, which keeps state machines intact.

---

## 6. Z-index

A fixed scale. **Arbitrary z-index values are forbidden**, because an unmanaged stack is how a dropdown ends up behind a modal.

| Token | Value | Layer |
|---|---|---|
| `--z-base` | 0 | Page content |
| `--z-raised` | 10 | Sticky table header, raised card |
| `--z-sticky` | 20 | Sticky section header |
| `--z-header` | 30 | App header |
| `--z-sidebar` | 40 | Sidebar (above header on mobile) |
| `--z-backdrop` | 50 | Modal/drawer scrim |
| `--z-modal` | 60 | Modal, drawer |
| `--z-dropdown` | 70 | Menu, select, popover |
| `--z-tooltip` | 80 | Tooltip |
| `--z-toast` | 90 | Notifications |
| `--z-palette` | 100 | Command palette |

Dropdowns sit **above** modals at 70 > 60, because a select inside a modal is common and must not clip. Radix renders overlays in a portal, so the DOM order does not fight the scale.

---

## 7. Borders

| Token | Value | Use |
|---|---|---|
| `--border-width` | 1px | Default everywhere |
| `--border-width-thick` | 2px | Focus ring, selected tab indicator |
| `--border-default` | theme | Card, input, table divider |
| `--border-strong` | theme | Emphasized separation, hover |
| `--border-subtle` | theme | Nested dividers inside a card |
| `--border-focus` | theme | Focus ring color |

1px at any device pixel ratio — never hairline fractions, which render inconsistently.

---

## 8. Focus

A single, consistent, highly visible focus treatment. Non-negotiable for accessibility.

| Token | Value |
|---|---|
| `--focus-ring-width` | 2px |
| `--focus-ring-offset` | 2px |
| `--focus-ring-color` | `--primary-600` (light) / `--primary-300` (dark) |

```css
:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
  border-radius: inherit;
}
*:focus:not(:focus-visible) { outline: none; }
```

`:focus-visible`, not `:focus`, so a mouse click does not leave a ring while keyboard navigation always does. **`outline` rather than `box-shadow`** so the ring survives Windows High Contrast mode, where box-shadows are discarded.

Measured contrast: **6.29:1** on white, **8.51:1** on the dark card — both far above the 3:1 minimum for non-text (`04-color-system.md` §2).

**Removing a focus indicator is never acceptable.** If a ring looks wrong somewhere, the component's layout is wrong — the ring stays.

---

## 9. Layout tokens

| Token | Value | Use |
|---|---|---|
| `--sidebar-width` | 260px | Expanded |
| `--sidebar-width-collapsed` | 64px | Icon-only |
| `--header-height` | 56px | App header |
| `--container-max` | 1440px | Max content width |
| `--container-prose` | 72ch | Discovery page reading width |
| `--page-px` | `--space-6` (24px) desktop, `--space-4` (16px) mobile | Page gutter |

`--container-prose` is in `ch` because reading measure depends on character width, not pixels — 72ch holds roughly 60–75 characters per line at any font size, which is the legibility target.

---

## 10. Iconography

| Token | Value | Use |
|---|---|---|
| `--icon-xs` | 14px | Inline with 13px text |
| `--icon-sm` | 16px | **Default** — buttons, menus |
| `--icon-md` | 20px | Section headers, nav |
| `--icon-lg` | 24px | Empty states, feature lists |
| `--icon-xl` | 32px | Product tiles, large empty states |
| `--icon-stroke` | 2px | Lucide default; never varied |

Icon size pairs with text size, not with the container. A 16px icon beside 14px text is optically balanced; 20px beside 14px looks heavy.

---

## 11. Opacity

| Token | Value | Use |
|---|---|---|
| `--opacity-disabled` | 0.5 | Disabled controls |
| `--opacity-muted` | 0.7 | De-emphasized content |
| `--opacity-scrim` | 0.6 | Modal backdrop (light) |
| `--opacity-scrim-dark` | 0.75 | Modal backdrop (dark) |

**Disabled state is not opacity alone.** Opacity at 0.5 pushes text below contrast minimums, so disabled controls also use a dedicated muted text token and `aria-disabled`. Opacity communicates to sighted users; the attribute communicates to everyone else.

---

## 12. Token naming

```text
--{category}-{role}-{variant?}-{state?}

--text-primary
--surface-raised
--border-default
--status-critical-subtle
--button-primary-bg-hover
```

| Rule | Reason |
|---|---|
| Semantic names, never visual | `--text-primary`, not `--text-dark-gray` — the latter is a lie in dark mode |
| No numbers in Tier 2 | Numbers belong to primitives |
| State as the last segment | Groups related values predictably |
| `subtle` = tinted background version | Consistent across status colors |

---

## 13. What is not a token

| Not tokenized | Why |
|---|---|
| One-off positions | A token used once is indirection, not a system |
| Product accent colors | **Registry data** (C1, C2). Applied as an inline custom property from the API, never compiled |
| Chart series colors | Supplied by the chart palette in `04` §6, assigned in fixed order |
| Content strings | Not design tokens |
| Breakpoints | Tailwind screens; see `09-responsive-design.md` |

The product accent exception is important: a product's color arrives at runtime from `products.accent_color` and is set as `style={{ '--product-accent': color }}` on that product's own subtree. Compiling product colors into the token set would violate ADR-013 and require a release per product.

---

Next: `03-typography.md`.
