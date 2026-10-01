# 03 — Typography

Locked per ADR-030. One UI family, one mono family, three weights, a fixed scale.

---

## 1. Families

| Role | Family | Delivery |
|---|---|---|
| **UI** | **Inter Variable** | Self-hosted via `next/font/local` |
| **Code / identifiers** | **JetBrains Mono** | Self-hosted, subset |
| Fallback | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | — |

```ts
// app/fonts.ts
import localFont from 'next/font/local'

export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-sans',
  display: 'swap',
  weight: '100 900',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-mono',
  display: 'swap',
  weight: '100 800',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
})
```

### 1.1 Why self-hosted is required, not preferred

The CSP in `15-security-architecture.md` §7 is `default-src 'self'` with no `font-src` exception. A Google Fonts request would be **blocked by the platform's own security policy**. Self-hosting also removes a third-party request from the critical path and the layout shift that accompanies it.

### 1.2 Why Inter

| Criterion | Inter |
|---|---|
| Small-size legibility | Designed for UI; tall x-height, open apertures |
| **Tabular figures** | Excellent — essential for numeric columns (§5) |
| Variable | One file, any weight; no multi-file loading |
| Coverage | Latin, Cyrillic, Greek — supports future i18n |
| Licence | SIL OFL, free commercially |
| Neutrality | No platform association, satisfying C2 |

`display: 'swap'` with a metric-compatible fallback list. One variable file means arbitrary weights are available without extra requests, which is why the scale can use 500 and 600 freely.

### 1.3 Mono is for identifiers, not prose

JetBrains Mono appears only where character-level precision matters: UUIDs, slugs, API keys, permission keys, correlation ids, JSON. It is **subset to Latin + digits + punctuation** — the full file with ligatures is unnecessary payload for a UI that never shows code.

Correlation ids in the audit log (`18` §11) are the main use, and they are selectable and copyable — that is the point of monospacing them.

---

## 2. Weights

**Three only**, deliberately.

| Token | Weight | Use |
|---|---|---|
| `--font-weight-normal` | **400** | Body, table cells, descriptions |
| `--font-weight-medium` | **500** | Labels, table headers, nav items, buttons |
| `--font-weight-semibold` | **600** | Headings, card titles, emphasis |

**No 700.** At the sizes this interface uses, 600 already reads as decisively bold; adding 700 produces two weights that are hard to tell apart and invites inconsistency. Fewer weights is a consistency mechanism (`00` §3, principle 8).

**No 300 or lighter.** Light weights at 13–14px fail legibility, especially on dark backgrounds where thin strokes thin further.

**Never synthesize bold.** `font-synthesis: none` is set globally; the variable font covers the range.

---

## 3. Type scale

Not a strict ratio. Enterprise density needs usable intermediate sizes, so sizes are chosen for purpose and line-heights land on the 4px grid.

| Token | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--text-display` | 32px / 2rem | 40px | 600 | -0.02em | Page hero (discovery only) |
| `--text-h1` | 24px / 1.5rem | 32px | 600 | -0.015em | Page title |
| `--text-h2` | 20px / 1.25rem | 28px | 600 | -0.01em | Section heading |
| `--text-h3` | 16px / 1rem | 24px | 600 | -0.005em | Card title, subsection |
| `--text-h4` | 14px / 0.875rem | 20px | 600 | 0 | Small card title, group label |
| `--text-body` | **14px** | **20px** | 400 | 0 | **Default UI text** |
| `--text-body-lg` | 16px | 24px | 400 | 0 | Discovery prose, empty-state body |
| `--text-sm` | 13px | 18px | 400 | 0 | Secondary, table metadata |
| `--text-xs` | 12px | 16px | 400 | 0.01em | Captions, badges, timestamps |
| `--text-label` | 13px | 18px | 500 | 0.005em | Form labels, table headers |
| `--text-overline` | 11px | 16px | 600 | 0.06em | Section eyebrow, uppercase |
| `--text-mono-sm` | 12px | 18px | 400 | 0 | Inline identifiers |
| `--text-mono` | 13px | 20px | 400 | 0 | Code blocks, ids |

### 3.1 Why 14px body

The default is 14px, not 16px, and the reasoning is specific:

- This is a **dense operational tool**. At 16px, a table showing organization, status, products, seats, MRR and account manager either overflows or truncates on a laptop.
- 14px Inter at 20px line-height is comfortable for UI text. Inter's tall x-height makes 14px read closer to 15px in other faces.
- **Discovery pages use 16px** (`--text-body-lg`) because they are prose for reading, not data for scanning.
- **Nothing drops below 12px**, and 12px is reserved for genuinely secondary content — never for anything a user must read to act correctly.

This is a considered trade, not a default. If usability testing shows 14px is too small for the console's primary audience, the fix is the **comfortable** density mode (`02` §2.1), not a system-wide change.

### 3.2 Tracking

Negative tracking on larger sizes, because type set large appears loose at default spacing; neutral at body sizes; **positive** at 11–12px, where tight spacing hurts legibility. Uppercase overline gets 0.06em — uppercase always needs more.

---

## 4. Semantic text tokens

Components use roles, not sizes.

| Token | Maps to | Color |
|---|---|---|
| `--text-page-title` | `h1` | `--text-primary` |
| `--text-section-title` | `h2` | `--text-primary` |
| `--text-card-title` | `h3` | `--text-primary` |
| `--text-body-default` | `body` | `--text-primary` |
| `--text-body-secondary` | `body` | `--text-secondary` |
| `--text-body-muted` | `sm` | `--text-muted` |
| `--text-form-label` | `label` | `--text-primary` |
| `--text-form-help` | `xs` | `--text-secondary` |
| `--text-form-error` | `xs` | `--status-critical-text` |
| `--text-table-header` | `label` | `--text-secondary` |
| `--text-table-cell` | `body` | `--text-primary` |
| `--text-metric-value` | `h1`, tabular | `--text-primary` |
| `--text-metric-label` | `xs` | `--text-secondary` |

A card title is `--text-card-title`, not "16px semibold". When the scale changes, every card title changes with it.

---

## 5. Numerals — the detail that matters most

| Context | Setting | Why |
|---|---|---|
| **Table columns** | `font-variant-numeric: tabular-nums` | **Mandatory.** Proportional digits make columns ragged and unscannable |
| Chart axis ticks | `tabular-nums` | Same |
| Metric / stat values | `tabular-nums` | Prevents width jitter when a value updates |
| Seat counts, limits | `tabular-nums` | "2 of 2" must not shift as numbers change |
| Inline prose | default proportional | Reads better in a sentence |
| Version strings, ids | mono | Character-level precision |

Tabular figures in every numeric column is the single highest-leverage typographic decision in a data-dense admin tool. Without it, scanning a column of amounts requires re-fixating on each row.

Also applied:

```css
.tabular { font-variant-numeric: tabular-nums; font-feature-settings: 'ss01'; }
```

`ss01` in Inter gives the disambiguated single-storey digits and a slashed zero — valuable where a zero and an O appear near each other, which happens constantly in ids and slugs.

---

## 6. Hierarchy rules

| Rule | Reason |
|---|---|
| One `h1` per page | Document structure and screen-reader navigation |
| **Heading levels never skip** | `h2` → `h4` breaks the a11y outline (`10` §4) |
| Visual size ≠ semantic level | Use the right tag, then a size token. An `h2` styled as `--text-h3` is fine |
| Hierarchy by weight and color before size | Density allows few size steps; 500 vs 400 and primary vs secondary ink carry more |
| Max 3 levels per view | More is noise |
| Prose capped at `--container-prose` | 72ch measure |

---

## 7. Truncation and overflow

User-supplied content — organization names, product names, member names — is arbitrary length. Every surface must handle it.

| Pattern | Use |
|---|---|
| Single-line ellipsis + `title` | Table cells, nav items |
| 2-line clamp | Card descriptions, product taglines |
| Full wrap | Detail pages, modal bodies |
| Middle-truncate | Long ids where both ends matter |
| **Never truncate** | Status, limits, amounts, seat counts |

```css
.truncate-1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
```

**Never truncating values** matters: a limit shown as "1…" instead of "10" is a wrong number, and in a console where staff act on limits, that is a correctness failure rather than a cosmetic one. Those columns get fixed width and tabular figures instead.

Every truncated element carries its full text in `title` **and** is readable by screen readers — CSS truncation does not remove text from the accessibility tree, which is why CSS truncation is used rather than JavaScript string slicing.

---

## 8. Localization readiness

No i18n framework yet (`00` §5), but typography does not block it:

| Decision | Enables |
|---|---|
| Logical properties (`margin-inline-start`) | RTL as a stylesheet change |
| No text baked into images | Translatable |
| Containers sized by content, not fixed width | German/Finnish text expansion |
| Inter covers Latin/Cyrillic/Greek | Most target locales without a second font |
| No concatenated sentence fragments | Translatable grammar |

---

## 9. Reference

```css
:root {
  --font-sans: var(--font-inter), system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, SFMono-Regular, Consolas, monospace;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --text-display:  2rem;      --leading-display: 2.5rem;
  --text-h1:       1.5rem;    --leading-h1:      2rem;
  --text-h2:       1.25rem;   --leading-h2:      1.75rem;
  --text-h3:       1rem;      --leading-h3:      1.5rem;
  --text-h4:       0.875rem;  --leading-h4:      1.25rem;
  --text-body-lg:  1rem;      --leading-body-lg: 1.5rem;
  --text-body:     0.875rem;  --leading-body:    1.25rem;
  --text-sm:       0.8125rem; --leading-sm:      1.125rem;
  --text-xs:       0.75rem;   --leading-xs:      1rem;
  --text-overline: 0.6875rem; --leading-overline: 1rem;
}

html { font-family: var(--font-sans); font-synthesis: none;
       -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
body { font-size: var(--text-body); line-height: var(--leading-body);
       color: var(--text-primary); }
```

---

Next: `04-color-system.md`.
