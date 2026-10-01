# 04 — Color System

**Every contrast figure in this document was computed, not estimated.** UI pairs were measured with a WCAG relative-luminance script; the chart palette was validated with the data-visualization validator against the exact surfaces this system renders on. Two failures were found during that process and corrected before the palette was locked (§7).

---

## 1. Strategy

Three constraints shape every choice:

**C2 — the chrome must be near-achromatic.** Products carry their own `accent_color` from the registry (ADR-013). A strongly-hued chrome would clash with an arbitrary product brand placed inside it. So: neutral chrome, one reserved platform hue, product color only on that product's own surfaces.

**Dark mode is selected, not inverted.** Every dark value was chosen for the dark surface and measured against it. Algorithmic inversion fails contrast and colorblind checks in ways nobody notices until a user reports it.

**Status color never carries meaning alone.** Always paired with an icon and a text label (`10` §3).

---

## 2. Primitives

### 2.1 Neutral — the chrome

Cool-tinted gray. The tint is slight: enough to avoid the deadness of pure gray, not enough to read as a hue (C2).

| Token | Hex | Role |
|---|---|---|
| `--neutral-0` | `#FFFFFF` | Light card surface |
| `--neutral-50` | `#F7F8FA` | Light page background |
| `--neutral-100` | `#EEF0F4` | Subtle fill, hover wash |
| `--neutral-200` | `#E2E5EB` | **Light border** |
| `--neutral-300` | `#CBD0DA` | Strong border; dark secondary text |
| `--neutral-400` | `#9AA2B1` | Dark muted text; **non-text use only in light** |
| `--neutral-500` | `#6B7482` | Light muted text / placeholder |
| `--neutral-600` | `#4D5563` | Light secondary text |
| `--neutral-700` | `#3A4150` | Light body text; **dark border** |
| `--neutral-800` | `#252A35` | Dark raised surface (dropdown, modal) |
| `--neutral-900` | `#14171F` | Light primary text; **dark card surface** |
| `--neutral-950` | `#0B0D12` | Dark page background |

### 2.2 Primary — the one platform hue

Indigo. Restrained, reads as infrastructure rather than consumer, and sits behind any product accent without competing.

| Token | Hex | Role |
|---|---|---|
| `--primary-50` | `#EEF0FF` | Subtle background |
| `--primary-100` | `#E0E4FF` | Selected row wash |
| `--primary-200` | `#C7CDFE` | Border on tinted surface |
| `--primary-300` | `#A5ADFB` | **Dark-mode link / focus ring** |
| `--primary-400` | `#8187F6` | Dark-mode hover |
| `--primary-500` | `#5B5BD6` | — |
| `--primary-600` | `#4F46E5` | **Primary action; light focus ring** |
| `--primary-700` | `#4338CA` | Hover; light-mode link text |
| `--primary-800` | `#3730A3` | Active/pressed |
| `--primary-900` | `#2A2487` | — |

### 2.3 Status — fixed, never themed

Taken from the validated data-visualization status palette so a status badge and a chart status mark agree.

| Role | Hex | On white | On dark card `#1A1E28` |
|---|---|---|---|
| `good` | `#0CA30C` | **3.35:1** | **4.97:1** |
| `warning` | `#FAB219` | **1.83:1** ⚠ | **9.08:1** |
| `serious` | `#EC835A` | **2.64:1** ⚠ | **6.32:1** |
| `critical` | `#D03B3B` | **4.80:1** | **3.47:1** |

**`warning` and `serious` are below 3:1 on white by design.** They are the correct semantic hues and no accessible step of amber/orange exists at that lightness. The mitigation is mandatory, not optional: a status color is **always** accompanied by an icon and a text label, and status *text* uses a darkened variant (§4.3) rather than the swatch hue.

---

## 3. Semantic tokens

Computed values. Every text pair clears WCAG AA; every non-text pair clears 3:1.

### 3.1 Surfaces

| Token | Light | Dark |
|---|---|---|
| `--surface-page` | `#F7F8FA` | `#0B0D12` |
| `--surface-raised` | `#FFFFFF` | `#1A1E28` |
| `--surface-overlay` | `#FFFFFF` | `#252A35` |
| `--surface-sunken` | `#EEF0F4` | `#090B0F` |
| `--surface-hover` | `#EEF0F4` | `#252A35` |
| `--surface-selected` | `#E0E4FF` | `#2A2487` |

Page-to-card separation is **1.17:1** in dark mode — measured. Enough to read as distinct layers, not enough to look banded. This pairing was corrected during validation; see §7.

### 3.2 Text

| Token | Light | Measured | Dark | Measured |
|---|---|---|---|---|
| `--text-primary` | `#14171F` | **17.92:1** | `#F7F8FA` | **15.68:1** |
| `--text-secondary` | `#4D5563` | **7.51:1** | `#CBD0DA` | **10.77:1** |
| `--text-muted` | `#6B7482` | **4.72:1** | `#9AA2B1` | **6.49:1** |
| `--text-placeholder` | `#6B7482` | **4.72:1** | `#9AA2B1` | **6.49:1** |
| `--text-on-primary` | `#FFFFFF` | **6.29:1** on `--primary-600` | `#FFFFFF` | **6.29:1** |
| `--text-link` | `#4338CA` | **7.90:1** | `#A5ADFB` | **7.91:1** |

**Placeholder differs by theme on purpose.** In light mode it is `neutral-500`; in dark, `neutral-400`. Using one token for both would fail on one side — `neutral-400` measures only **2.57:1** on white. Placeholder text is real text and must clear 4.5:1; many systems quietly skip this.

`--text-muted` is the floor for text. **`neutral-400` is non-text-only in light mode.**

### 3.3 Borders

| Token | Light | Dark | Measured vs its surface |
|---|---|---|---|
| `--border-default` | `#E2E5EB` | `#3A4150` | 1.26:1 / 1.63:1 |
| `--border-strong` | `#CBD0DA` | `#4D5563` | 1.55:1 / — |
| `--border-focus` | `#4F46E5` | `#A5ADFB` | **6.29:1 / 8.51:1** |

Decorative borders need no contrast minimum; the **focus ring does** (3:1), and clears it by a wide margin.

---

## 4. Status application

### 4.1 Mapping to platform states

Every state in the architecture maps to exactly one status role, defined once.

| State | Role | Source |
|---|---|---|
| Subscription `active`, org `active`, membership `active` | `good` | `08` §2 |
| `trialing` | `info` (primary hue) | — |
| `past_due`, trial ending ≤7d, override expiring | `warning` | `08` §2.1 |
| **Seats over limit** | `warning` | `09` §5.2 |
| `expired`, `cancelled` | `serious` | `08` §2 |
| `suspended` (org or subscription) | `critical` | baseline §13 |
| `not_subscribed` | **neutral** — not a status | baseline §38 |

**`not_subscribed` is deliberately neutral.** It is not an error or a warning — it is an opportunity (baseline §14, §38). Coloring it red would frame the company's own catalog as broken.

`trialing` uses the primary hue rather than a status color, because a trial is a normal healthy state, not a caution.

### 4.2 Variants

Each role provides four tokens:

| Variant | Use |
|---|---|
| `--status-{role}` | The swatch — dots, chart marks, bar fills |
| `--status-{role}-text` | **Text** — darkened to clear 4.5:1 |
| `--status-{role}-bg` | Tinted badge background |
| `--status-{role}-border` | Badge border |

| Role | `-text` light | Measured | `-text` dark |
|---|---|---|---|
| `good` | `#046904` | 5.95:1 | `#4ADE4A` |
| `warning` | `#7A4F00` | 6.60:1 | `#FAB219` |
| `serious` | `#8A3A17` | 6.47:1 | `#F0A07E` |
| `critical` | `#A32020` | 6.52:1 | `#F08A8A` |

The `-text` variants exist precisely because the swatch hues cannot carry text in light mode. A badge shows the tinted background with the darkened text on it.

### 4.3 Badge anatomy

```text
┌──────────────────────────┐
│ ● Suspended              │   dot (swatch) + label (-text) on -bg, -border ring
└──────────────────────────┘
```

Three channels — **color, shape, text**. A screen-reader user gets the label; a colorblind user gets the icon and label; everyone gets the color. Per `10` §3, color alone is never sufficient.

---

## 5. Product accent — the registry exception

`products.accent_color` arrives at runtime and is **never compiled into the token set** (C1, C2).

```tsx
<article style={{ '--product-accent': product.accentColor } as CSSProperties}>
```

| Rule | Reason |
|---|---|
| Scoped to that product's own subtree | Never leaks into chrome |
| Used for the tile indicator, icon backing and discovery accents | Never for text, borders or focus rings |
| **Never carries meaning** | Access state is conveyed by the status system, which is validated; an arbitrary registry color is not |
| Validated at registration, not at render | The admin console checks contrast when a product is created (`18` §6.1) |

The third rule is the important one. A product whose accent happens to be red must not look suspended. Access state uses the status palette; the accent is identity only.

---

## 6. Chart palette — validated

Computed with the data-visualization validator against **this system's exact surfaces** (light `#FFFFFF`, dark `#1A1E28`), not the validator's defaults.

### 6.1 Categorical — fixed order, never cycled

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2A78D6` | `#3987E5` |
| 2 | orange | `#EB6834` | `#D95926` |
| 3 | aqua | `#1BAF7A` | `#199E70` |
| 4 | yellow | `#EDA100` | `#C98500` |
| 5 | magenta | `#E87BA4` | `#D55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4A3AA7` | `#9085E9` |
| 8 | red | `#E34948` | `#E66767` |

**Validator results — all checks pass in both modes:**

| Check | Light (`#FFFFFF`) | Dark (`#1A1E28`) |
|---|---|---|
| Lightness band | PASS | PASS |
| Chroma floor | PASS | PASS |
| CVD separation (adjacent) | PASS — worst ΔE **9.1** | PASS — worst ΔE **8.4** |
| Normal-vision floor | PASS — worst ΔE **19.6** | PASS — worst ΔE **19.3** |
| Contrast vs surface | **WARN** — 3 slots <3:1 | PASS — all ≥3:1 |

### 6.2 Binding consequences

**The light-mode WARN is not dismissable.** Aqua (2.82:1), yellow (2.17:1) and magenta (2.69:1) sit below 3:1 on white. The relief rule applies: any light-mode chart using those slots **must** ship visible direct labels or a table view. This is a requirement on the chart component, not a note.

**Scatter, bubble and small-multiple forms cap at three series.** Those forms compare all pairs, not just adjacent ones, and only the first three slots clear the all-pairs floors — validated: CVD ΔE **9.2** light / **9.4** dark, normal-vision **24.0** / **20.9**. Past three, fold into "Other" or facet. The fourth slot puts yellow beside orange, which fails all-pairs.

**A ninth series is never a generated hue.** It folds into "Other", facets, or uses composite encoding.

### 6.3 Sequential and diverging

**Sequential** — single hue, blue, light→dark:

| 100 | 250 | 400 | 550 | 700 |
|---|---|---|---|---|
| `#CDE2FB` | `#86B6EF` | `#3987E5` | `#1C5CAB` | `#0D366B` |

For **ordinal** ramps (discrete ordered steps — tiers, funnel stages), the step nearest the surface must clear 2:1: start no lighter than **250** on light, no darker than **600** on dark.

**Diverging** — blue ↔ red with a **neutral gray** midpoint (`#F0EFEC` light, `#383835` dark). Never a hue at the midpoint; never a rainbow.

### 6.4 Chart chrome

| Role | Light | Dark |
|---|---|---|
| Chart surface | `#FFFFFF` | `#1A1E28` |
| Primary ink | `#14171F` | `#F7F8FA` |
| Secondary ink | `#4D5563` | `#CBD0DA` |
| Axis / tick labels | `#6B7482` | `#9AA2B1` |
| Gridline | `#E2E5EB` | `#252A35` |
| Baseline / axis | `#CBD0DA` | `#3A4150` |

**Text in a chart wears text tokens, never the series color.** Values, labels and legend text stay in primary/secondary/muted ink; a colored mark beside the text carries the identity.

### 6.5 Non-negotiables

| Rule | Why |
|---|---|
| **Never a dual-axis chart** | The single most common chart error. Two scales → two charts, or index to a common base |
| Color follows the entity, never its rank | A filter that changes series count must not repaint survivors |
| Status colors never become "series 4" | Reserved |
| Legend for ≥2 series; ≤4 also direct-labeled | Identity never color-alone |
| Thin marks, recessive grid | Data dominates, not chrome |
| Table view available | The accessibility fallback |

---

## 7. Validation record

Two failures found by computation and corrected **before** the palette was locked. Both would have shipped as accessibility defects.

| # | Finding | Measured | Correction |
|---|---|---|---|
| **V-1** | `neutral-400` (`#9AA2B1`) as light-mode placeholder | **2.57:1** — fails 4.5:1, and fails even 3:1 | Light placeholder moved to `neutral-500` (**4.72:1**). `neutral-400` restricted to non-text use in light mode, and to muted *text* in dark only (**6.49:1**) |
| **V-2** | Dark page `#0B0D12` vs dark card `#14171F` | **1.08:1** — layers visually indistinguishable | Dark card surface changed to `#1A1E28` (**1.17:1**) |

**V-2 forced a re-validation.** Changing the dark card surface changed the chart surface, so the categorical palette was re-run against `#1A1E28` — all checks pass, including the all-pairs three-slot cap. Re-validating after a surface change is mandatory: contrast results are only meaningful against the surface the chart actually renders on.

Had these been judged by eye, V-1 would have shipped (2.57:1 looks like acceptable gray) and V-2 would have shipped (1.08:1 looks like "subtle").

---

## 8. Reference

```css
:root {
  color-scheme: light;
  --surface-page: #F7F8FA;  --surface-raised: #FFFFFF;
  --surface-overlay: #FFFFFF; --surface-sunken: #EEF0F4;
  --surface-hover: #EEF0F4; --surface-selected: #E0E4FF;
  --text-primary: #14171F;  --text-secondary: #4D5563;
  --text-muted: #6B7482;    --text-placeholder: #6B7482;
  --text-link: #4338CA;     --text-on-primary: #FFFFFF;
  --border-default: #E2E5EB; --border-strong: #CBD0DA;
  --border-focus: #4F46E5;
  --action-primary: #4F46E5; --action-primary-hover: #4338CA;
  --action-primary-active: #3730A3;
  --chart-surface: #FFFFFF; --chart-grid: #E2E5EB; --chart-axis: #6B7482;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark values — see §8.1 */ }
}
:root[data-theme="dark"] { /* identical dark values */ }
```

### 8.1 Dark values

```css
color-scheme: dark;
--surface-page: #0B0D12;  --surface-raised: #1A1E28;
--surface-overlay: #252A35; --surface-sunken: #090B0F;
--surface-hover: #252A35; --surface-selected: #2A2487;
--text-primary: #F7F8FA;  --text-secondary: #CBD0DA;
--text-muted: #9AA2B1;    --text-placeholder: #9AA2B1;
--text-link: #A5ADFB;     --text-on-primary: #FFFFFF;
--border-default: #3A4150; --border-strong: #4D5563;
--border-focus: #A5ADFB;
--action-primary: #4F46E5; --action-primary-hover: #5B5BD6;
--chart-surface: #1A1E28; --chart-grid: #252A35; --chart-axis: #9AA2B1;
```

Both scopes carry identical dark values — the media query serves the OS preference, the attribute serves the explicit toggle, and the toggle must win in both directions (`02` §1.1).

---

Next: `05-component-system.md`.
