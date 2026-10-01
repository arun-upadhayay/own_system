# 00 — Design System Baseline

Phase 0.5. Produced after the architecture validation gate passed (`docs/architecture/23-architecture-validation.md`) and before any implementation.

This document states what the design system is for, the constraints it inherits from the architecture, and the principles that settle disagreements later.

---

## 1. What is being designed

Four surfaces, one system:

| Surface | Audience | Auth | Character |
|---|---|---|---|
| **Product Launcher** | Customer users | yes | Calm, fast, ecosystem-wide. The front door |
| **Organization Admin** | Org owners/admins | yes | Dense, task-focused, confidence-inspiring |
| **Company Console** | Internal staff | yes | High-density, information-rich, powerful |
| **Product Discovery** | Anyone, incl. anonymous | **no** | Persuasive, public, SEO-visible |

The fourth is the outlier and it drives a major technical decision: discovery pages are **public marketing surfaces** (baseline §14, §38) and must be server-rendered. That is why the framework choice is not a pure SPA (ADR-019).

---

## 2. Constraints inherited from the architecture

These are not preferences. Each comes from a decision already locked, and violating one breaks an architectural guarantee.

| # | Constraint | Source | Consequence for design |
|---|---|---|---|
| C1 | **No product-specific code, anywhere** | ADR-013 | Product name, icon, accent color and copy are **registry data**. No product may appear in a conditional, a theme map, or an icon constant |
| C2 | **Products supply their own accent color** | `products.accent_color` | Platform chrome must be **neutral enough that an arbitrary brand color sits on it without clashing**. This rules out a strongly-hued chrome |
| C3 | **No client-side authorization** | master prompt §13, `07` §10 | The UI hides for usability; the server decides. A hidden control is never a security boundary |
| C4 | **No limit arithmetic in the client** | master prompt §34 | "2 of 2 seats" is displayed from the API; the client never computes whether an action is permitted |
| C5 | **`canOpen` and `appUrl` come from the backend** | `11` §2 | The launcher renders a boolean it did not compute; a denied product has **no URL in the payload** |
| C6 | **Self-hosted fonts only** | `15` §7 CSP `default-src 'self'` | No Google Fonts CDN. Fonts ship with the app |
| C7 | **Admin console is a separate bundle** | HLD §8 | A customer's browser never downloads cross-tenant administration code |
| C8 | **Every mutation may fail on the server** | C3, C4 | Optimistic UI must be able to roll back, and errors must be designed, not incidental |
| C9 | **Unlimited is `null`, not a number** | ADR-010 | Renders as the word "Unlimited". A `null` that renders as `0` or blank is a misread with commercial consequences |
| C10 | **Not-included ≠ zero** | `09` §2 | Two visually distinct states in every plan and limit display |
| C11 | **Dangerous actions are flagged in data** | `permissions.is_dangerous` | The UI reads the flag; it does not maintain its own list of scary buttons |
| C12 | **Seats are per product** | ADR-018 | Seat UI is always scoped to a product, never to the organization as a whole |

C2 deserves emphasis because it is easy to miss and expensive to undo. The Control Plane is a *container* for products that each carry their own brand color. If the platform chrome were, say, strongly green, a product whose accent is red would look broken inside it. The chrome is therefore near-neutral by requirement, and the one brand hue is reserved for platform actions only.

---

## 3. Design principles

Ordered. When two conflict, the earlier wins.

### 1. Correct before comfortable
The interface must not imply a permission the server will refuse, a limit it has not checked, or an entitlement that has lapsed. Where the client cannot know, it asks rather than guesses.

### 2. Density with air
This is an operational tool used all day, not a landing page. Default body text is 14px and table rows are compact — but spacing is systematic, so density never becomes noise. Enterprise density is about *predictable* rhythm, not small type.

### 3. Neutral chrome, borrowed color
Chrome is near-achromatic (C2). One brand hue for platform actions. Product color comes from the registry and appears only on that product's own surfaces. Status color is reserved and never decorative.

### 4. Hairlines over shadows
Structure comes from 1px borders and surface steps, not drop shadows. Shadows are reserved for things that genuinely float — dropdowns, modals, popovers. This reads as precise rather than soft, and it survives dark mode, where shadows are nearly invisible.

### 5. States are designed, not discovered
Loading, empty, partial, error, denied, over-limit and offline are specified for every screen before it is built. An unhandled state in an admin console is how an operator makes a wrong decision about a customer.

### 6. Accessible by construction
WCAG 2.1 AA is a floor, verified by computation and automated tests — not by inspection. Every contrast figure in this system was calculated (`04-color-system.md`); none was judged by eye.

### 7. Own the components
The component layer is first-party source in the repository, built on unstyled accessible primitives. Not a themed third-party kit. The reasoning is in ADR-020: over a multi-year platform, the cost of fighting someone else's opinions exceeds the cost of owning a few hundred lines per component.

### 8. One obvious way
One date picker. One table. One modal. One toast. A second implementation of anything is a defect, because inconsistency in an admin tool is a correctness risk — an operator who misreads a familiar-looking control acts on the wrong assumption.

---

## 4. What "premium enterprise" means concretely

The brief asks for a premium enterprise SaaS interface. Operationally that means:

| Signal | Implementation |
|---|---|
| Restraint | Near-neutral chrome; one accent; no gradients or decorative imagery |
| Precision | 4px spacing grid; optical alignment; tabular figures in every numeric column |
| Confident typography | One variable sans, three weights, a strict scale — no mixed families |
| Considered motion | 120–200ms, ease-out, opacity and small transforms only. No bounce |
| Instant feedback | Optimistic where safe, skeletons that match final layout, no layout shift |
| Keyboard parity | Every action reachable without a mouse; a command palette |
| Information hierarchy | Clear primary/secondary/muted ink; generous but systematic whitespace |
| Trustworthy data display | Charts validated for colorblind safety; limits never ambiguous |

What it explicitly does *not* mean: large hero type, illustrations, animated backgrounds, glassmorphism, or purple gradients. Those read as consumer-marketing, and they fight C2 by making the chrome assertive.

---

## 5. Non-goals

| Not doing | Why |
|---|---|
| Multi-brand white-labelling | No requirement. Tokens are structured so it is possible later, but no theming API is built now |
| Right-to-left layout | No requirement yet. Logical CSS properties are used throughout so RTL is a stylesheet change, not a rewrite |
| Native mobile apps | Responsive web only (`09-responsive-design.md`) |
| Email template system | Transactional email is plain and separate |
| Marketing site | Discovery pages live in the Control Plane; a corporate site does not |
| Theme builder UI | Dark and light are both hand-selected and validated. A generated theme cannot be validated in advance |

The last one matters: dark mode is **a selected set of values**, not an algorithmic inversion of light mode. Inverted palettes fail contrast and colorblind checks in ways nobody notices until a user complains.

---

## 6. Document map

| Doc | Settles |
|---|---|
| `01-frontend-stack.md` | Every library choice, with the alternatives evaluated |
| `02-design-tokens.md` | Spacing, radius, shadow, motion, z-index, token architecture |
| `03-typography.md` | Family, weights, scale, numerals |
| `04-color-system.md` | Palettes, themes, chart colors — all computed |
| `05-component-system.md` | Component inventory, anatomy, states, variants |
| `06-layout-and-navigation.md` | Shell, sidebar, header, org switcher, command palette |
| `07-product-launcher-ux.md` | Launcher and discovery experience |
| `08-admin-console-ux.md` | Console patterns: tables, forms, dangerous actions |
| `09-responsive-design.md` | Breakpoints, grid, mobile behavior |
| `10-accessibility.md` | WCAG conformance, keyboard, screen readers, testing |
| `11-frontend-architecture.md` | App structure, data fetching, state, auth, performance |
| `12-ui-decisions.md` | ADR-019 … ADR-03x |
| `13-design-validation.md` | Consistency review against the architecture docs |

---

## 7. Relationship to the architecture documents

`docs/design/` is subordinate to `docs/architecture/`. Where they disagree, the architecture wins — **except** where this phase found an architectural defect, in which case the architecture document is corrected through the change log, never silently.

This phase found four such items, all in `13-design-validation.md` and applied: the Content-Security-Policy in `15-security-architecture.md` §7 would have blocked product icons, the app's own fonts, and Next.js hydration. Those are recorded as review findings D-1 to D-4 with corrections.

---

Next: `01-frontend-stack.md`.
