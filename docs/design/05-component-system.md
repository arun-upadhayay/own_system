# 05 — Component System

The component library at `packages/ui`: first-party source built on Radix primitives (ADR-020). This document is the inventory and the contract each component honors.

---

## 1. Layering

```text
Tier 1 — PRIMITIVES     Radix (unstyled behavior + a11y) · React Aria (2 widgets)
Tier 2 — BASE           Button, Input, Select, Dialog… styled, generic, no domain
Tier 3 — COMPOSED       DataTable, FormField, ConfirmDialog, PageHeader…
Tier 4 — DOMAIN         ProductTile, SeatCounter, AccessStateBadge, LimitMeter…
```

**Tier 4 is where the architecture shows up**, and it is the tier most likely to accumulate violations. A `ProductTile` renders registry data and must never branch on a product slug (C1). An `AccessStateBadge` maps a backend state string to a badge and must never compute the state itself (C5).

Rules: a tier may import from lower tiers only; Tier 2 contains no business vocabulary; Tier 4 contains no fetching — it receives props.

---

## 2. Universal contract

Every component in the library satisfies all of these. A component that does not is incomplete.

| Requirement | Detail |
|---|---|
| Typed props, no `any` | Extends the native element's props where one exists |
| `ref` forwarded | Needed by Radix for positioning and focus |
| `className` merged, not replaced | `cn()` helper; callers can extend |
| `data-*` state attributes | `data-state`, `data-disabled` — styling hooks, and test selectors |
| Keyboard operable | Per WAI-ARIA pattern (`10` §4) |
| Visible focus | `:focus-visible` ring; never removed |
| Theme-agnostic | Tier 2 semantic tokens only — never a primitive (`02` §1) |
| Loading + disabled + error states | Where applicable; specified, not improvised |
| No fetching, no business logic | Props in, events out |
| Composable | `asChild` where Radix supports it |

---

## 3. Base components

### 3.1 Button

| Variant | Appearance | Use |
|---|---|---|
| `primary` | Filled `--action-primary`, white text (**6.29:1**) | One per view — the main action |
| `secondary` | Surface + border | Standard actions |
| `ghost` | Transparent, hover wash | Toolbar, table row actions |
| `danger` | Filled `--status-critical` | Destructive, after confirmation |
| `link` | Text only, `--text-link` | Inline navigation |

Sizes `sm` / `md` / `lg` map to `--control-height-*` (`02` §2.1), so density mode changes buttons automatically.

States: default, hover, active, focus-visible, disabled, **loading**.

**Loading is a required state, not a nicety.** Mutations can fail on the server for permission, entitlement or limit reasons (C8), so every mutating button needs an in-flight state. It stays the same width — a button that shrinks to fit a spinner shifts the layout around it. Loading implies `aria-busy` and `disabled`.

### 3.2 Input, Textarea

States: default, hover, focus, filled, **error**, disabled, read-only.

| Rule | Reason |
|---|---|
| Always paired with a `<label>` | A placeholder is not a label (`10` §5) |
| Error shown with icon + message + `aria-invalid` + `aria-describedby` | Color alone insufficient |
| Error text uses `--status-critical-text` (**6.52:1**) | Not the swatch hue |
| Placeholder uses `--text-placeholder` | Theme-dependent; see `04` §3.2 |
| Monospace variant for ids/keys | `--font-mono` |
| Read-only ≠ disabled | Read-only stays focusable and copyable |

The read-only distinction matters in this system: the console shows many fields a given operator may view but not edit, and disabling them would make the values unselectable and remove them from tab order.

### 3.3 Select, Combobox

| Component | Primitive | Use |
|---|---|---|
| `Select` | Radix Select | Fixed, short option sets — status, plan, role |
| `Combobox` | **React Aria** (ADR-020 exception) | Searchable, async, virtualized — organizations, users, products |

The split is a capacity decision. Selecting an organization from thousands needs async search plus virtualization, which is the documented React Aria exception. Selecting a status from five options does not.

Both: typeahead, keyboard navigation, `aria-activedescendant`, loading state, empty state, error state.

### 3.4 Checkbox, Radio, Switch

All three support an indeterminate or mixed state where meaningful, carry a visible label, and remain operable by keyboard.

**Switch vs Checkbox is a semantic distinction, not cosmetic.** A Switch applies immediately; a Checkbox is submitted with a form. Using a Switch for a deferred change is a lie about when the change takes effect — in a console where staff suspend customers, that matters.

### 3.5 Dialog, Drawer, Popover, Tooltip, DropdownMenu

All from Radix, which handles the genuinely hard parts: focus trapping, scroll locking, dismissal layering, and returning focus to the trigger.

| Component | Radius | Elevation | z |
|---|---|---|---|
| Dialog | `xl` | 3 | 60 |
| Drawer | 0 (edge) | 3 | 60 |
| Popover | `lg` | 2 | 70 |
| DropdownMenu | `md` | 2 | 70 |
| Tooltip | `sm` | 2 | 80 |

Dropdowns sit above dialogs (70 > 60) because a select inside a modal is routine and must not clip (`02` §6).

**Tooltips never carry essential information.** They do not appear on touch devices and are unreliable for keyboard users. Anything a user must know to act correctly is visible text — a limit, a status, a reason for a disabled control.

### 3.6 Badge, Tag, Avatar

`Badge` renders the status anatomy from `04` §4.3: dot plus label on a tinted background. `Tag` is a neutral, optionally removable label. `Avatar` falls back to initials, then to a generic icon — never a broken image.

### 3.7 Skeleton, Spinner, ProgressBar

| Use | Component |
|---|---|
| Content whose shape is known | **Skeleton** matching final layout |
| Action in flight | Spinner inside the button |
| Determinate progress | ProgressBar |

Skeletons are preferred because they prevent layout shift. A spinner where a table will be causes a visible jump when data arrives; a skeleton table does not.

---

## 4. Composed components

### 4.1 DataTable

The console's workhorse. TanStack Table (ADR-024) plus this system's chrome.

```text
┌─────────────────────────────────────────────────────────┐
│ [search]            [filters ▾]   [density] [columns ▾] │
├─────────────────────────────────────────────────────────┤
│ ☐ │ Name ↓      │ Status  │ Seats  │ MRR     │   ⋯     │
├─────────────────────────────────────────────────────────┤
│ ☐ │ ABC Rest…   │ ● Active│ 2 / 2  │ $99.00  │   ⋯     │
├─────────────────────────────────────────────────────────┤
│ 50 of 1,284                        [← Prev] [Next →]    │
└─────────────────────────────────────────────────────────┘
```

| Capability | Detail |
|---|---|
| **Cursor pagination** | Prev/Next, never numbered pages — offset paging skips and duplicates rows in mutating tables (`13` §3.1) |
| Server-side sort | Allowlisted fields only; ties resolve on `id` for stable paging |
| Server-side filter | Allowlisted per endpoint |
| Column visibility | Persisted per user in Zustand + `localStorage` |
| Density toggle | Switches `--table-row-height` (`02` §2.1) |
| Row selection | With a bulk action bar |
| Sticky header | `--z-raised` |
| **Tabular figures in every numeric column** | Mandatory (`03` §5) |
| Virtualization | **Only** for audit logs and cross-tenant lists |

Numbered pagination is structurally impossible here, and that is a deliberate consequence of the API contract rather than a UI simplification: a cursor cannot know how many pages exist.

**Required states**, all designed:

| State | Treatment |
|---|---|
| Loading (initial) | Skeleton rows matching column layout |
| Loading (page change) | Existing rows dimmed, controls disabled — never a blank table |
| Empty — no data | Illustrationless empty state + primary action |
| Empty — no matches | **Different copy** + "Clear filters". The fix differs, so the message must |
| Error | Inline error + Retry. **Never an empty table**, which reads as "no customers" |
| Partial failure | Rows render; the failed column shows an inline indicator |

### 4.2 FormField

Wraps label, control, help text and error into one accessible unit — the wiring of `id`, `aria-describedby` and `aria-invalid` is done once here rather than per form.

```text
Label *                        ← required marked in text, not color alone
┌────────────────────────┐
│ control                │
└────────────────────────┘
Help text, or error with icon
```

Errors appear **on blur and on submit**, not on every keystroke — validating as the user types an email tells them they are wrong before they have finished being right.

### 4.3 ConfirmDialog

Required for every destructive action (`18` §13).

| Severity | Requirement |
|---|---|
| Standard | Confirm button, clear consequence statement |
| **Dangerous** | **Typed confirmation of the subject's name** |

Typed confirmation applies to suspending an organization, cancelling a subscription, removing a member and revoking a platform role. A mis-clicked suspension takes a customer offline, which is not recoverable by undo. The dialog reads `permissions.is_dangerous` from the API (C11) rather than keeping its own list.

### 4.4 Other composed components

| Component | Purpose |
|---|---|
| `PageHeader` | Title, breadcrumb, actions, status |
| `Card` | Surface + optional header/footer |
| `Tabs` | Radix, URL-synced so a tab is linkable |
| `EmptyState` | Icon, heading, description, action |
| `ErrorState` | Message, retry, support reference |
| `Toast` | Transient notification (§6) |
| `CommandPalette` | ⌘K navigation and actions (`06` §6) |
| `DetailList` | Label/value pairs on detail pages |
| `MetricTile` | Single figure + label + optional delta |
| `Chart*` | Recharts wrappers enforcing the validated palette (`04` §6) |

---

## 5. Domain components

Tier 4. Each encodes an architectural rule so it cannot be got wrong per-screen.

### 5.1 AccessStateBadge

```tsx
<AccessStateBadge state={product.accessState} trialEndsAt={product.trialEndsAt} />
```

Maps the seven backend states (`08` §2) to the status system (`04` §4.1). **The component does not compute state** — it receives it (C5). Including `not_subscribed` → neutral, not an error.

### 5.2 SeatCounter and LimitMeter

```tsx
<SeatCounter used={2} limit={2} />          → "2 of 2"
<SeatCounter used={3} limit={2} />          → "3 of 2 · over limit"  (warning)
<SeatCounter used={7} limit={null} />       → "7 · Unlimited"
<LimitMeter resource="branches" used={3} limit={5} />
```

| Rule | Source |
|---|---|
| `limit === null` renders **"Unlimited"** | C9 — a null rendering as 0 or blank is a commercially consequential misread |
| Not-included is visually distinct from zero | C10 |
| **Never computes whether an action is allowed** | C4 — it displays; the server decides |
| Over-limit shows `warning`, not `critical` | `09` §5.2 — a permitted, visible state after a downgrade |
| Tabular figures | `03` §5 |

### 5.3 ProductTile

```tsx
<ProductTile product={p} />   // p.accentColor applied as --product-accent
```

| Rule | Source |
|---|---|
| **No branch on slug, name or id** | C1, ADR-013 |
| Icon from `product.iconUrl` | Registry data, not an icon map |
| Accent scoped to this subtree | C2, `04` §5 |
| `canOpen` from the backend | C5 |
| **No `appUrl` when denied** | C5 — absent from the payload, not hidden by CSS |

### 5.4 Others

| Component | Encodes |
|---|---|
| `OrganizationSwitcher` | Multi-org membership; mints a new token on switch (`06` §5) |
| `PermissionGate` | Hides UI for usability — **never a security boundary** (C3) |
| `UpgradePrompt` | The 409 `limit_reached` payload: limit, usage, upgrade options (`09` §7) |
| `TimestampDisplay` | Viewer's timezone, UTC on hover (`18` §13) |
| `IdentifierDisplay` | Monospace, copyable, middle-truncated |
| `AuditEntry` | Actor, action, resource, outcome, correlation id |

`PermissionGate` carries a comment in its source stating that it is presentational only. It is the component most likely to be mistaken for a security control, and the mistake is invisible until someone calls the API directly.

---

## 6. Notifications

### 6.1 Toast

| Property | Value |
|---|---|
| Position | Bottom-right desktop, bottom-center mobile |
| Duration | 5s success · 7s warning · **persistent for error** |
| Max visible | 3, then queue |
| Dismissible | Always |
| Live region | `role="status"` / `role="alert"` for errors |

**Errors persist until dismissed.** An auto-dismissing error can be missed entirely, and in a console the user then believes an action succeeded.

### 6.2 Choosing the channel

| Channel | When |
|---|---|
| **Toast** | Transient confirmation of a completed action |
| **Inline** | Validation errors — beside the field |
| **Banner** | Page- or account-level persistent condition: suspended, past due, over limit |
| **Dialog** | Requires a decision before continuing |

Suspension and over-limit are **banners, not toasts** — they are ongoing conditions, not events, and must remain visible on every load until resolved.

---

## 7. Loading, empty, error — specified once

Per `00` §3 principle 5, these are designed for every screen. Defaults:

| State | Pattern |
|---|---|
| Initial load | Skeleton matching final layout |
| Refetch | Keep stale content, subtle indicator |
| Mutation | Button loading; optimistic where rollback is safe |
| Empty (never had data) | Icon, heading, one-sentence explanation, primary action |
| Empty (filtered out) | **Distinct copy** + clear-filters |
| Empty (no permission) | Explain and name who to ask |
| Error (fetch) | Message, Retry, support reference |
| Error (mutation) | Toast or inline, with the server's message |
| Error (403) | Reason from the API + path forward |
| Error (409 limit) | `UpgradePrompt` with limit, usage, options |
| Offline | Banner; disable mutations |

**Error states surface the server's message**, not a generic one. The API returns user-safe `message` text and a `requestId` (`13` §5), so support can find the exact request when a customer quotes it.

---

## 8. Documentation and testing

| Requirement | Detail |
|---|---|
| Props documented via TSDoc | Types are the primary documentation |
| Usage example per component | In the source file |
| **axe test per component** | `vitest-axe`, every variant and state (`10` §9) |
| Keyboard test for interactive components | Tab, arrows, Enter, Escape |
| Visual regression | Playwright screenshots, light and dark |
| Dark mode verified | Every component, both themes |

Storybook is **deferred, not rejected** (`01` §13) — a second build to maintain before the library has stabilized. Revisit once more than one developer consumes it.

---

## 9. Anti-patterns

| Forbidden | Why |
|---|---|
| A second button, modal or table implementation | `00` §3 principle 8 — inconsistency is a correctness risk |
| Branching on product slug | ADR-013; lint-enforced |
| Tier 1 primitive colors in a component | Breaks dark mode |
| Arbitrary z-index | `02` §6 |
| Removing the focus ring | `02` §8 |
| Color as the only signal | `10` §3 |
| Essential info in a tooltip | Unavailable on touch and to keyboard users |
| Business logic in a component | Belongs server-side |
| Computing limits or permissions client-side | C3, C4 |
| `div` with `onClick` instead of `button` | Loses keyboard, focus and semantics |
| Disabling a control with no explanation | The user cannot tell whether it is broken |

The last one is a real pattern in this product: controls are often disabled because of a limit, a missing permission or a lapsed subscription. Each case must say which, and what to do — a bare disabled button is an unanswerable question.

---

Next: `06-layout-and-navigation.md`.
