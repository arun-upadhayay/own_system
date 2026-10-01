# 01 — Frontend Stack

Every library is evaluated against the brief's stated priorities — **consistency, accessibility, maintainability, performance, long-term stability, TypeScript support, Next.js compatibility, premium enterprise capability** — plus the architectural constraints in `00` §2. Popularity is not a criterion; where a popular choice wins, it wins on the criteria.

## The locked stack

| Concern | Locked choice | ADR |
|---|---|---|
| Framework | **Next.js 15, App Router** | ADR-019 |
| UI library | **React 19** | ADR-019 |
| Language | TypeScript 5.x, `strict` | inherited |
| Styling | **Tailwind CSS v4** + CSS custom properties | ADR-021 |
| Component primitives | **Radix UI Primitives**, wrapped in a first-party library | ADR-020 |
| Complex-widget exception | **React Aria** for date-range and virtualized combobox only | ADR-020 |
| Icons | **Lucide React** | ADR-022 |
| Forms | **React Hook Form + Zod** | ADR-023 |
| Tables | **TanStack Table v8** (+ TanStack Virtual) | ADR-024 |
| Server state | **TanStack Query v5** | ADR-025 |
| Client state | **Zustand** | ADR-025 |
| Charts | **Recharts** | ADR-026 |
| Dates | **date-fns v4 + @date-fns/tz** | ADR-027 |
| Animation | **CSS/Tailwind first; Motion where justified** | ADR-028 |
| Unit/component tests | **Vitest + React Testing Library** | ADR-029 |
| E2E | **Playwright** | ADR-029 |
| Accessibility tests | **axe-core** via `vitest-axe` + Playwright | ADR-029 |
| Fonts | **Inter Variable + JetBrains Mono**, self-hosted | ADR-030 |

---

## 1. Framework

**Locked: Next.js 15, App Router.** Amends HLD §1, which specified Vite (ADR-019).

| Option | Verdict |
|---|---|
| **Next.js App Router** | **Selected.** Server-renders the public discovery pages; one framework for all four surfaces; enables httpOnly-cookie sessions behind route handlers |
| Vite SPA | Rejected. Cannot server-render the public discovery pages, which are SEO-relevant marketing surfaces (baseline §14, §38). Would require a second toolchain later |
| Split (Next for public, Vite for app) | Rejected. Two build systems, two deploy targets, and a design system consumed two ways — the highest long-term maintenance cost |
| Remix / React Router 7 | Viable and architecturally clean, but a smaller ecosystem for the enterprise component patterns needed here, and no advantage over Next for this shape of app |
| TanStack Start | Rejected on **stability**: too new for a multi-year platform commitment |

**The deciding fact.** Three surfaces are authenticated SPAs where SSR adds little. The fourth is public, anonymous and must rank in search — `12` §5.2 and `13` §9.6 both make discovery pages unauthenticated. A pure SPA serves those as an empty shell.

**The real cost, stated plainly.** Next.js adds a Node rendering tier beside the Fastify API, so `17-deployment-architecture.md` gains a service. It also brings App Router complexity — Server Components, caching semantics, and the discipline of deciding per component where it runs. That is accepted; the mitigation is a strict convention in `11-frontend-architecture.md` §2 rather than case-by-case judgement.

**A genuine security benefit.** With route handlers acting as a thin BFF, the web app's session lives in an httpOnly, SameSite=Strict cookie and access tokens never reach JavaScript — materially better than the SPA pattern of holding tokens in memory or storage. This is the one place where the framework change improves security rather than merely enabling SSR.

The API remains Fastify and unchanged. Next.js **does not** own business logic; its route handlers only attach the session cookie and proxy (`11` §4).

---

## 2. Styling

**Locked: Tailwind CSS v4 with CSS custom properties as the token layer** (ADR-021).

| Option | Verdict |
|---|---|
| **Tailwind v4** | **Selected.** Zero runtime, CSS-first `@theme` config, variants compose cleanly, excellent with RSC |
| CSS Modules | Viable and zero-runtime, but no constraint system — spacing and color drift immediately without one |
| Emotion / styled-components | Rejected. **Runtime cost and RSC friction.** Both are poor fits for App Router, and both re-render styles on the client |
| Vanilla Extract | Strong typed, zero-runtime alternative. Rejected on ergonomics: every variant needs a recipe, which slows a large component library |
| Panda CSS | Technically close to Vanilla Extract with better DX. Rejected on **long-term stability** — smaller adoption, younger project |
| Plain CSS + BEM | Rejected. No mechanical constraint; relies on discipline the system is trying to make unnecessary |

**Why zero-runtime is a requirement, not a preference.** The admin console renders tables of hundreds of rows. A CSS-in-JS runtime that serializes styles per render is measurable there, and it conflicts with Server Components, which must not ship a styling runtime to produce markup.

Tokens are **CSS custom properties**, not Tailwind config values, so theme switching is a single attribute change on `<html>` rather than two compiled stylesheets (`02-design-tokens.md` §2).

---

## 3. Component primitives

**Locked: Radix UI Primitives, wrapped in a first-party component library at `packages/ui`** (ADR-020).

| Option | Verdict |
|---|---|
| **Radix Primitives + own layer** | **Selected.** Unstyled, WAI-ARIA-conformant, excellent focus and dismissal handling, no visual opinions to fight |
| React Aria Components | **Strongest accessibility in the field**, and genuinely better for complex widgets. Rejected as the *base* on verbosity and a heavier mental model for the 30+ simple components — but **adopted for two specific widgets** (below) |
| MUI | Rejected. Material aesthetic reads as "Google product", not bespoke enterprise; de-branding it is a continuous fight. Emotion runtime. Heavy |
| Ant Design | Rejected. Enterprise-complete but a very distinctive visual identity that is hard to neutralize — and C2 requires neutral chrome. Large bundle |
| Mantine | Good DX, comprehensive, v7 moved off CSS-in-JS. Rejected: still a styling opinion to override, and its density defaults do not match this system |
| Chakra | Rejected. Runtime styling; v3 churn is a stability concern |
| Radix Themes | Rejected. Styled layer removes the control the brief's "premium" requirement needs |
| Headless UI | Rejected. Materially smaller primitive set than Radix; gaps would need filling anyway |
| Build from scratch | Rejected. Accessible dialog focus-trapping, dismissal layers and typeahead select are **genuinely hard** and already solved |

**Why own the styled layer.** Over a multi-year platform, the cost of overriding a third-party kit's opinions compounds — every upgrade re-litigates the overrides. Owning ~100 lines per component is cheaper and fully controllable. shadcn/ui is used as a **reference for composition patterns**, copied in and then owned; it is explicitly **not a dependency**, since it is not a library.

**The bounded React Aria exception.** Two widgets are harder than Radix covers well: a **date-range picker** (locale, timezone, keyboard range selection) and a **virtualized combobox** (thousands of organizations, async search). Both use React Aria. This is a bounded exception with a named list, not a licence to mix freely — two mental models across a whole library would defeat the consistency this system exists for.

---

## 4. Icons

**Locked: Lucide React** (ADR-022).

| Option | Verdict |
|---|---|
| **Lucide** | **Selected.** ~1,500 icons on a consistent 24px grid, 2px stroke, MIT, per-icon tree-shaking, actively maintained |
| Heroicons | Good quality, but a materially smaller set — gaps appear quickly in an admin console |
| Phosphor | Excellent and larger, with weight variants. Rejected: heavier, and the weight axis invites inconsistency |
| Tabler | Very large and good. Close second; Lucide chosen for a tighter, more uniform grid |
| Font Awesome | Rejected. Licensing for the full set; icon-font delivery is worse than SVG |
| Material Icons | Rejected. Carries Material's visual language (C2) |

**Scope limit from C1.** The icon library is for **UI chrome only** — navigation, actions, status. **Product icons are registry data** (`products.icon_url`) and are rendered as images. An icon map keyed by product slug would violate ADR-013, and the lint rule in `19-implementation-plan.md` Phase 1 catches it.

---

## 5. Forms

**Locked: React Hook Form + Zod via `@hookform/resolvers`** (ADR-023).

| Option | Verdict |
|---|---|
| **RHF + Zod** | **Selected.** Uncontrolled by default so large forms do not re-render per keystroke; Zod is already the API's validation layer |
| TanStack Form | Promising and more type-safe in places. Rejected on **stability** for a multi-year commitment |
| Formik | Rejected. Re-renders on every change; weaker TypeScript; low maintenance activity |
| Final Form | Rejected. Effectively dormant |
| Native + manual | Rejected. Re-implements validation, error wiring and accessibility for every form |

**The decisive argument is schema sharing, not ergonomics.** The API validates with Zod (HLD §1) and publishes types in `packages/contracts`. The **same schema** validates in the browser, so client and server cannot disagree about what is valid. A second validation library would mean two definitions of the same rule, and they would drift — producing the worst failure mode in a form: client-side success followed by a server 400.

**Constraint C4 holds.** Shared schemas cover *shape* — required, format, length. They never cover **limits or permissions**, which are server-resolved state. The client never validates "do you have a seat available".

---

## 6. Tables

**Locked: TanStack Table v8, with TanStack Virtual for long lists** (ADR-024).

| Option | Verdict |
|---|---|
| **TanStack Table** | **Selected.** Headless, so it imposes no visual opinion; excellent TS inference; sorting, filtering, grouping, column sizing; pairs with cursor pagination |
| AG Grid | Rejected. **Licensing** for the features that justify it; very heavy; its own visual language to override |
| MUI DataGrid | Rejected. Pro tier licensing, and it drags in MUI |
| Mantine DataTable | Rejected. Couples to Mantine |
| Hand-rolled | Rejected. Column sizing, multi-sort and selection semantics are more work than they look |

Headless matters because the architecture requires tables to behave in platform-specific ways a packaged grid resists: **cursor pagination** (`13` §3.1 — offset paging skips and duplicates rows in mutating tables), server-side sorting against allowlisted fields, and row states driven by entitlement rather than by local data.

Virtualization applies only where rows genuinely exceed a page — audit logs and cross-tenant organization lists. Virtualizing a 50-row page adds complexity and accessibility risk for nothing.

---

## 7. State management

**Locked: TanStack Query v5 for server state; Zustand for the little client state that exists** (ADR-025).

### Server state

| Option | Verdict |
|---|---|
| **TanStack Query** | **Selected.** Caching, invalidation, mutations with rollback, request dedup — all of which C8 requires |
| SWR | Lighter and adequate for reads. Rejected: weaker mutation and rollback story, which C8 makes central |
| RTK Query | Rejected. Requires Redux, which nothing else here needs |
| RSC fetching only | Rejected as the *whole* answer — but **used for public and initial data** (`11` §3) |
| Apollo / urql | Not applicable; the API is REST |

**Why rollback is the deciding feature.** Per C3 and C4, the client cannot know whether a mutation will be permitted — the server may refuse on permission, entitlement or a limit. Optimistic updates are therefore only safe with reliable rollback, and TanStack Query's `onMutate`/`onError` contract provides it directly.

### Client state

Deliberately minimal: theme, command-palette open state, sidebar collapse, table column preferences. **Zustand**, ~1KB.

| Option | Verdict |
|---|---|
| **Zustand** | **Selected.** Tiny, no provider ceremony, good TS |
| Redux Toolkit | Rejected as **overengineering** (master prompt §38). There is no complex client state here; nearly all state is server state |
| Jotai / Valtio | Fine; no advantage at this scale |
| Context only | Rejected. Context re-renders whole subtrees on change, which is wrong for a theme toggle above a large table |

**Server state is never duplicated into Zustand.** That is the single most common React state bug — two copies that disagree — and here it would also mean caching entitlement, which `08` §8 forbids.

---

## 8. Charts

**Locked: Recharts** (ADR-026), rendered under the validated palette in `04-color-system.md` §6.

| Option | Verdict |
|---|---|
| **Recharts** | **Selected.** Declarative React API, SVG, adequate for the console's dashboard needs, composable enough to apply this system's mark specs |
| Visx | Maximum control, but every chart is bespoke work. Rejected **for now**; retained as the escape hatch for a genuinely custom visualization |
| ECharts | Rejected. Powerful but heavy and imperative; its own theming model |
| Chart.js | Rejected. Canvas-based, so no DOM for accessibility or per-mark interaction |
| Nivo | Rejected. Heavier, opinionated styling |
| Observable Plot | Elegant, but imperative and awkward inside React's lifecycle |

The console's charts are modest — subscription counts by plan, seat utilization, usage trends, MRR over time. Visx would be the right call for a dedicated analytics product; here it would cost more than the requirement justifies (master prompt §38).

**Binding constraints, from the data-visualization discipline:**

- **No dual-axis charts, ever.** Two measures of different scale become two charts or an indexed comparison.
- Categorical hues assigned in **fixed order, never cycled**. A ninth series folds into "Other" or facets.
- Sequential encoding is **one hue, light→dark**; diverging is two hues with a **neutral gray** midpoint.
- Status colors are **reserved** and never reused as a series.
- A legend is present for ≥2 series; ≤4 series are also direct-labeled, so identity never depends on color alone.
- **Three light-mode series colors sit below 3:1** on white (§6 of `04`), so visible direct labels or a table view are **mandatory** on charts using them.
- Dark mode is a **selected** set of steps, validated against the dark surface — not an inversion.

---

## 9. Dates and times

**Locked: date-fns v4 + `@date-fns/tz`**, with `@internationalized/date` where React Aria requires it (ADR-027).

| Option | Verdict |
|---|---|
| **date-fns v4** | **Selected.** Tree-shakeable per function, immutable, excellent TS, and v4 adds first-class timezone support |
| Day.js | Smaller, but plugin-based timezone handling is weaker — and timezone correctness is a hard requirement here |
| Luxon | Excellent timezone model. Rejected: larger, monolithic, class-based |
| Moment | Rejected. Deprecated by its own maintainers |
| Temporal API | The right long-term answer. Rejected on **availability** — not yet broadly shipped. date-fns is the bridge |

**Timezones are not optional in this system.** Organizations and branches each carry a timezone (`04-erd.md` §4.1, §4.2), subscriptions expire at instants, and the admin console shows staff in one zone data about customers in another. `18` §13 requires timestamps in the **viewer's** zone with UTC on hover — which needs a real timezone library, not local-time formatting.

All timestamps cross the wire as **ISO 8601 UTC** (`13` §1). Conversion happens only at render.

---

## 10. Animation

**Locked: CSS transitions via Tailwind for the overwhelming majority; Motion only where justified** (ADR-028).

| Option | Verdict |
|---|---|
| **CSS / Tailwind transitions** | **Selected as default.** Zero JS, compositor-driven, no bundle cost |
| Motion (ex-Framer Motion) | **Permitted for specific cases**: shared-layout transitions, drag reordering, list add/remove where CSS cannot express it |
| React Spring | Rejected. No advantage over Motion for these cases |
| GSAP | Rejected. Licensing considerations and far more than needed |
| Auto-Animate | Rejected. Convenient but too implicit for a design system that specifies motion precisely |

Motion specification is in `02-design-tokens.md` §5. The short form: **120–200ms, ease-out, opacity and small transforms only.** No bounce, no spring overshoot — those read as consumer-playful and, in an admin tool, as imprecise. `prefers-reduced-motion` is honored globally, not per component.

---

## 11. Testing

**Locked: Vitest + React Testing Library + Playwright + axe-core** (ADR-029).

| Concern | Choice | Alternatives rejected |
|---|---|---|
| Unit / component | **Vitest** | Jest — slower, heavier ESM/TS config |
| Component queries | **React Testing Library** | Enzyme (dead); shallow rendering tests implementation, not behavior |
| E2E | **Playwright** | Cypress — slower, weaker multi-tab/multi-origin support, which the OIDC redirect flows need |
| Accessibility | **axe-core** (`vitest-axe` + `@axe-core/playwright`) | Manual-only auditing does not scale and regresses |
| Visual regression | **Playwright screenshots** | Chromatic/Percy — defer until churn justifies the cost |

**A deliberate inconsistency, acknowledged.** The backend uses `node:test` (HLD §1); the frontend uses Vitest. One runner across both would be tidier, but Vitest's browser-environment and JSX handling are materially better for component tests, and `node:test` has no reason to change on the backend. Two runners in two independent packages is a smaller cost than making either side use the wrong tool.

**Automated a11y testing is a floor, not a ceiling.** axe catches roughly a third to a half of real WCAG issues — contrast, missing labels, ARIA misuse. Keyboard traps, focus order and screen-reader comprehension need the manual checklist in `10-accessibility.md` §8. Treating an axe pass as conformance is the usual mistake.

---

## 12. Fonts

**Locked: Inter Variable (UI) + JetBrains Mono (code/identifiers), both self-hosted** (ADR-030).

| Option | Verdict |
|---|---|
| **Inter** | **Selected.** Designed for UI at small sizes; excellent tabular figures; variable; open licence; exceptional coverage |
| Geist | Good and similar in spirit. Rejected: younger, and tied in perception to one vendor |
| IBM Plex Sans | Strong and neutral. Slightly wider, costing density |
| system-ui stack | Zero cost and genuinely defensible. Rejected: inconsistent rendering across OSes undermines the "one system" goal, and tabular-figure support varies |
| Roboto / Open Sans | Rejected. Carry strong platform associations (C2) |
| A licensed display face | Rejected. Cost, and §4 of `00` excludes display type |

**Self-hosting is required, not preferred.** The CSP in `15` §7 is `default-src 'self'` with no font-src exception, so a Google Fonts CDN request would be **blocked by the platform's own security policy**. Fonts ship with the app via `next/font`, which also eliminates a third-party request on the critical path and the layout shift that comes with it.

Full specification — weights, scale, numerals — in `03-typography.md`.

---

## 13. Rejected wholesale

| Not adopted | Why |
|---|---|
| A component kit as the base layer | §3 — owning the styled layer beats fighting opinions for years |
| CSS-in-JS runtime | §2 — RSC friction and per-render cost |
| Redux | §7 — no complex client state exists |
| GraphQL client | The API is REST with typed contracts |
| i18n framework | No requirement yet. Strings are not inlined in a way that would block it |
| Design-token SaaS | Tokens are ~200 CSS custom properties; a hosted pipeline is unjustified |
| Storybook | **Deferred, not rejected.** Valuable, but it is a second build to maintain; revisit when the component library stabilizes and more than one developer consumes it |
| Icon font | SVG is better in every respect |
| Moment, Enzyme, Formik | Deprecated or dormant |

---

Next: `02-design-tokens.md`.
