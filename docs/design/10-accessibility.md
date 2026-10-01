# 10 — Accessibility

**Target: WCAG 2.1 Level AA**, with selected AAA criteria adopted where cheap. This is a floor verified by computation and automated tests, not an aspiration checked by inspection.

Two business reasons beyond the ethical one: this is B2B software sold to organizations that increasingly require accessibility conformance in procurement, and an admin console where staff act on customer data must be operable by every member of that team.

---

## 1. Conformance summary

| Principle | Where it is satisfied |
|---|---|
| **Perceivable** | Computed contrast (`04`); never color-alone (§3); text alternatives (§7) |
| **Operable** | Full keyboard parity (§4); visible focus (`02` §8); 44px targets (`09` §6) |
| **Understandable** | Consistent navigation (`06`); labelled inputs (§5); error identification (§6) |
| **Robust** | Semantic HTML; Radix ARIA patterns; tested with real assistive tech (§8) |

---

## 2. Contrast — computed, not estimated

Every pair in `04-color-system.md` was measured with a WCAG relative-luminance script. **Two failures were found and corrected before the palette was locked** (`04` §7):

| # | Issue | Measured | Fix |
|---|---|---|---|
| V-1 | `neutral-400` as light placeholder | **2.57:1** — fails even 3:1 | Moved to `neutral-500` (**4.72:1**) |
| V-2 | Dark page vs dark card | **1.08:1** — layers indistinguishable | Card changed to `#1A1E28` (**1.17:1**) |

Both would have shipped if judged by eye: 2.57:1 looks like an acceptable gray, and 1.08:1 looks "subtle".

### 2.1 Requirements

| Content | Minimum | Achieved |
|---|---|---|
| Body text | 4.5:1 | 17.92:1 light / 15.68:1 dark |
| Secondary text | 4.5:1 | 7.51:1 / 10.77:1 |
| Muted + placeholder text | 4.5:1 | 4.72:1 / 6.49:1 |
| Link text | 4.5:1 | 7.90:1 / 7.91:1 |
| White on primary button | 4.5:1 | 6.29:1 |
| **Focus ring** (non-text) | 3:1 | **6.29:1 / 8.51:1** |
| Status text variants | 4.5:1 | 5.95–6.60:1 |

**Placeholder text is real text.** It must clear 4.5:1, which is why the token differs by theme (`04` §3.2) — a system-wide `neutral-400` would fail in light mode. Many design systems quietly skip this.

### 2.2 The two documented exceptions

**Status swatches.** `warning` (1.83:1) and `serious` (2.64:1) are below 3:1 on white. No accessible step of amber or orange exists at that lightness, so the mitigation is mandatory: the swatch is only ever a **dot beside a text label**, and status *text* uses the darkened `-text` variant (`04` §4.2). Color never carries the meaning.

**Three chart series.** Aqua (2.82:1), yellow (2.17:1), magenta (2.69:1) on white. The data-visualization relief rule applies: any light-mode chart using those slots **must** carry visible direct labels or a table view (`04` §6.2). Not dismissable.

---

## 3. Never color alone — WCAG 1.4.1

Every state is conveyed by at least two channels.

| State | Color | Shape/icon | Text |
|---|---|---|---|
| Active | green | ● | "Active" |
| Trial | primary | ◐ | "Trial · 6 days" |
| Past due | amber | ⚠ | "Payment required" |
| Expired | orange | ○ | "Expired" |
| Suspended | red | ⊘ | "Suspended" |
| Not subscribed | neutral | → | "Learn more" |
| Over limit | amber | ⚠ | "3 of 2 · over limit" |
| Form error | red | ⚠ | Message text |
| Metric delta | green/red | ▲▼ | Signed number |

Also: required fields marked with `*` **and** `aria-required`; sorted columns show a direction arrow; selected rows show a checkbox, not only a tint; chart series carry a legend and direct labels.

This is not merely about colorblindness. It also covers monochrome printing, forced-colors mode, low-quality displays, and the common case of a screenshot pasted into a ticket.

---

## 4. Keyboard

**Every action is reachable and operable by keyboard.** No exceptions.

| Key | Behavior |
|---|---|
| `Tab` / `Shift+Tab` | Move through interactive elements in visual order |
| `Enter` | Activate button or link |
| `Space` | Activate button, toggle checkbox |
| `Escape` | Close overlay, cancel, clear |
| Arrows | Within composites: menus, tabs, radios, table selection |
| `Home` / `End` | First / last in a composite |
| Typeahead | Jump in select and menu |

### 4.1 Composite widgets

Radix implements the WAI-ARIA Authoring Practices patterns — one of the main reasons it was chosen over building from scratch (`01` §3). Focus trapping, dismissal layering and focus restoration are genuinely hard to get right.

| Widget | Pattern |
|---|---|
| Dialog | Focus trapped; Escape closes; focus returns to trigger |
| Menu | Arrows, typeahead, Escape, focus restoration |
| Tabs | Arrows move, `Home`/`End`, automatic activation |
| Combobox | `aria-activedescendant`, arrows, Enter, Escape |
| Table | Arrow selection, Enter to open |
| Toast | Focusable, dismissible, announced |

### 4.2 Focus management rules

| Rule | Reason |
|---|---|
| Visible `:focus-visible` ring everywhere | **Never removed** (`02` §8) |
| `outline`, not `box-shadow` | Survives Windows High Contrast |
| Tab order follows visual order | No positive `tabindex` |
| Focus returns to the trigger on overlay close | Otherwise focus falls to the top of the document |
| Focus moves to the error summary on submit failure | §6 |
| Route change moves focus to the `h1` | Otherwise a screen reader stays on the old page |
| No focus traps outside modals | |
| Skip-to-content link, first in tab order | WCAG 2.4.1 |
| Scrollable regions are focusable | `tabindex="0"` + `role="region"` + label (`09` §5.2) |

The route-change rule matters particularly in Next.js App Router: client-side navigation does not reset focus or announce the new page by default, so it must be done explicitly.

---

## 5. Forms

| Requirement | Implementation |
|---|---|
| Every input has a `<label>` | **A placeholder is not a label** — it disappears on input and is not announced reliably |
| Programmatic association | `htmlFor` / `id`, wired once in `FormField` (`05` §4.2) |
| Help text linked | `aria-describedby` |
| Errors linked and flagged | `aria-describedby` + `aria-invalid="true"` |
| Required marked two ways | Visible `*` + `aria-required` |
| Groups labelled | `fieldset` + `legend`, or `role="group"` + `aria-labelledby` |
| Autocomplete on identity fields | WCAG 1.3.5 |
| **No disabled control without explanation** | A disabled button is otherwise an unanswerable question |

The last row has real weight in this product: controls are disabled because of a limit, a missing permission, or a lapsed subscription. Each case states which and what to do (`05` §9).

---

## 6. Errors and status messages

| Requirement | Implementation |
|---|---|
| Error identified in text | Not color alone — WCAG 3.3.1 |
| Error described, with correction | WCAG 3.3.3 |
| Summary on submit failure | Focused, links to each field |
| Live regions for async messages | `role="status"` polite, `role="alert"` assertive |
| Destructive actions confirmable | WCAG 3.3.4 (AA for legal/financial — suspension qualifies) |
| Server messages surfaced | With `requestId` for support (`13` §5) |

Toast notifications live in a region announced politely; **errors are assertive and persistent** (`05` §6.1), because an auto-dismissing error can be missed entirely and the user then believes the action succeeded.

---

## 7. Images, icons and alternatives

| Element | Treatment |
|---|---|
| Decorative icon | `aria-hidden="true"` |
| Icon-only button | `aria-label` describing the **action**, not the glyph |
| **Product icon** | `alt` = product name; registry data (C1) |
| Avatar | `alt` = person's name, or `aria-hidden` when the name is adjacent |
| Chart | `role="img"` + `aria-label` summary **plus a table view** |
| Logo | `alt` = company name |

Charts need more than a label: the accessible equivalent of a trend line is the data, so a **table view toggle** is required on every chart (`04` §6.5). An `aria-label` saying "MRR trend chart" tells a screen-reader user nothing actionable.

---

## 8. Assistive technology

Tested against:

| AT | Platform |
|---|---|
| NVDA + Firefox | Windows — the most common combination |
| JAWS + Chrome | Windows enterprise |
| VoiceOver + Safari | macOS |
| VoiceOver | iOS |
| TalkBack | Android |

### 8.1 Manual checklist — automation does not cover this

axe catches roughly a third to a half of real WCAG issues. These require a human:

- [ ] Every flow completable with keyboard only
- [ ] Every flow completable with a screen reader
- [ ] Focus order is logical on every screen
- [ ] Focus is never lost or trapped unintentionally
- [ ] Route changes are announced
- [ ] Dynamic content is announced appropriately
- [ ] Error messages are announced and reachable
- [ ] Table structure is navigable by AT
- [ ] Headings form a sensible outline, no skipped levels
- [ ] Usable at 200% zoom
- [ ] Usable at 320px (reflow, WCAG 1.4.10)
- [ ] Usable in forced-colors / High Contrast mode
- [ ] Usable with `prefers-reduced-motion`
- [ ] Usable with CSS disabled (content order makes sense)

Treating an axe pass as conformance is the standard mistake, and it is why this list exists separately.

---

## 9. Automated testing

| Layer | Tool | Scope |
|---|---|---|
| Component | `vitest-axe` | **Every component, every variant and state** |
| Page | `@axe-core/playwright` | Every route, both themes |
| Keyboard | Playwright | Flows driven by keyboard only |
| Contrast | Custom script | **Every token pair, in CI** |
| Chart palette | dataviz validator | On any palette change |

```ts
it('has no axe violations', async () => {
  const { container } = render(<Button variant="primary">Save</Button>)
  expect(await axe(container)).toHaveNoViolations()
})
```

### 9.1 CI gates

A11y failures **block the merge**, like the architecture's tenant-isolation tests:

| Gate | Blocks on |
|---|---|
| axe (component) | Any violation |
| axe (page) | Any violation |
| Contrast script | Any computed pair below its minimum |
| Chart palette validator | Any FAIL |
| Keyboard flow tests | Any failure |

The contrast script is the important one: it recomputes every token pair, so a future change to a neutral or a surface cannot silently reintroduce V-1 or V-2.

---

## 10. Reduced motion and other preferences

| Preference | Response |
|---|---|
| `prefers-reduced-motion: reduce` | Transitions collapse to 0.01ms globally (`02` §5.2) |
| `prefers-color-scheme` | Honored, overridable by the explicit toggle |
| `prefers-contrast: more` | Border and text contrast increased |
| `forced-colors: active` | System colors respected; `outline` focus ring survives |
| 200% zoom | Reflows without loss (WCAG 1.4.4) |
| Text spacing overrides | No clipping (WCAG 1.4.12) |

`0.01ms` rather than `0` so `transitionend` still fires — components awaiting it would otherwise hang open.

---

## 11. Semantic HTML

| Use | Not |
|---|---|
| `<button>` | `<div onClick>` |
| `<a href>` | `<span onClick>` |
| `<table>` with `<th scope>` | `<div>` grid for tabular data |
| `<nav>`, `<main>`, `<aside>`, `<header>` | `<div class="nav">` |
| `<h1>`–`<h6>` in order | Sized `<div>`s |
| `<ul>`/`<ol>` for lists | `<div>` stacks |
| `<form>` with submit | Click handler on a div |
| `<fieldset>`/`<legend>` | Unlabelled groups |

A `<div onClick>` loses keyboard operability, focus, the accessible role and the native activation behavior — four defects from one shortcut. ARIA is for augmenting semantics, never for replacing them: **the first rule of ARIA is not to use ARIA** when a native element exists.

---

## 12. Accessibility statement

Published at `/accessibility`, stating the conformance target, known limitations (including the two documented contrast exceptions in §2.2 and the console's desktop-first posture in `09` §1.1), the feedback channel, and the last audit date.

Documenting a known limitation honestly is better than claiming conformance that testing does not support — and in procurement, an accurate statement is more defensible than an optimistic one.

---

Next: `11-frontend-architecture.md`.
