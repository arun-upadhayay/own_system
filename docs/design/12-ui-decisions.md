# 12 — UI Architecture Decision Records

Frontend decisions, continuing the numbering in `docs/architecture/21-architecture-decisions.md`. Same format: decision, reason, alternatives genuinely considered, consequences including the costs accepted. Append-only.

---

## ADR-019 — Next.js App Router, superseding React + Vite

**Status:** Accepted · **Supersedes:** HLD §1 (framework), HLD §8 (frontend architecture) · **Confirmed by:** product owner, 2026-10-01

**Decision.** The frontend is Next.js 15 with the App Router, React 19. The Fastify API is unchanged and remains the only place business logic lives.

**Reason.** Three of the four surfaces are authenticated application shells where server rendering adds little. The fourth — **product discovery — is public, anonymous and SEO-relevant** (baseline §14, §38; `12` §5.2; `13` §9.6 of the architecture). A pure SPA serves those pages as an empty shell to a crawler, which undermines the marketplace function the baseline asks for. A second, static-site toolchain bolted on later would mean two build systems and a design system consumed two ways.

A secondary benefit is genuine rather than incidental: with Next route handlers acting as a thin BFF, the web app's session lives in an **httpOnly cookie and access tokens never reach JavaScript** — materially better than the SPA pattern of holding tokens in memory or storage.

**Alternatives considered.** *Vite SPA* (the original HLD choice) — rejected: cannot server-render the public pages, and would need a second toolchain. *Split Next for public / Vite for app* — rejected: two build systems and two deploy targets, the highest long-term maintenance cost. *Remix / React Router 7* — architecturally clean and viable, but no advantage over Next for this shape of app and a smaller ecosystem for enterprise component patterns. *TanStack Start* — rejected on **stability**; too new for a multi-year platform.

**Consequences.**
- `17-deployment-architecture.md` gains a Node rendering tier beside the Fastify API. Accepted, and documented in `13-design-validation.md` (D-5).
- App Router complexity — Server Components, caching semantics, per-component runtime decisions — is managed by the convention in `11` §2, not by case-by-case judgement, with a lint rule for the costliest mistake.
- The BFF must stay thin. A route handler that grows authorization becomes a second place where access is decided, which is the duplication the architecture exists to avoid.
- HLD §1 and §8 are amended through the change log, not silently.

---

## ADR-020 — Radix Primitives wrapped in a first-party library, not a component kit

**Status:** Accepted

**Decision.** `packages/ui` is first-party source built on Radix UI Primitives. shadcn/ui is a **reference for composition patterns** — copied in and then owned — explicitly not a dependency. **React Aria is adopted for exactly two widgets**: the date-range picker and the virtualized async combobox.

**Reason.** Over a multi-year platform the cost of overriding a third-party kit's opinions compounds, because every upgrade re-litigates the overrides. Owning roughly a hundred lines per component is cheaper and fully controllable. Radix supplies the parts that are genuinely hard and dangerous to get wrong — focus trapping, dismissal layering, focus restoration, typeahead — while imposing no visual opinion, which C2 requires.

**Alternatives considered.** *React Aria as the base* — **the strongest accessibility implementation available**, and better for complex widgets; rejected as the base on verbosity across 30+ simple components, but adopted for the two where it genuinely wins. *MUI* — Material aesthetic reads as "Google product" and de-branding is a continuous fight; Emotion runtime. *Ant Design* — very distinctive identity that is hard to neutralize, against C2. *Mantine* — good, but still a styling opinion to override and its density defaults do not match. *Chakra* — runtime styling, v3 churn. *Radix Themes* — the styled layer removes the control "premium" needs. *Headless UI* — materially smaller primitive set. *From scratch* — rejected: accessible dialogs and comboboxes are harder than they look and already solved.

**Consequences.** More code owned, and a standing obligation to maintain it. Two mental models exist, bounded by a **named list of two widgets** — not a licence to mix freely, which would defeat the consistency the library exists for. Accessibility is our responsibility to test, which `10` §9 makes a CI gate.

---

## ADR-021 — Tailwind v4 with CSS custom properties as the token layer

**Status:** Accepted

**Decision.** Tailwind CSS v4 for utilities; **CSS custom properties** for tokens; dark mode by redefining properties under `data-theme` and `prefers-color-scheme`.

**Reason.** Zero runtime is a requirement here, not a preference: the console renders tables of hundreds of rows, and a CSS-in-JS runtime that serializes per render is measurable there — besides conflicting with Server Components, which must not ship a styling runtime. Tokens as custom properties rather than Tailwind config values mean theme switching is one attribute change on `<html>`, not two compiled stylesheets.

**Alternatives considered.** *CSS Modules* — zero-runtime and viable, but no constraint system, so spacing and color drift immediately. *Emotion / styled-components* — runtime cost and RSC friction. *Vanilla Extract* — strong typed zero-runtime alternative; rejected on ergonomics, since every variant needs a recipe. *Panda CSS* — technically close with better DX; rejected on **long-term stability**. *Plain CSS + BEM* — relies on the discipline the system is trying to make unnecessary.

**Consequences.** Utility-dense markup, mitigated by components encapsulating it. Tailwind's `@theme` must stay synchronized with the custom properties — one source, generated. CSP must not require `unsafe-inline` for styles, which Tailwind's static output satisfies.

---

## ADR-022 — Lucide for chrome icons; product icons stay registry data

**Status:** Accepted

**Decision.** Lucide React for UI iconography. **Product icons come from `products.icon_url`** and are rendered as images.

**Reason.** Lucide offers ~1,500 icons on a consistent 24px grid with a uniform 2px stroke, MIT-licensed, per-icon tree-shaking, actively maintained. The second half is the architecturally important half: an icon map keyed by product slug would violate ADR-013 and require a release to onboard a product.

**Alternatives considered.** *Heroicons* — quality but a materially smaller set; gaps appear fast in an admin console. *Phosphor* — larger and excellent, but heavier and its weight axis invites inconsistency. *Tabler* — close second; Lucide chosen for a tighter grid. *Font Awesome* — licensing for the full set, and icon-font delivery is worse than SVG. *Material Icons* — carries Material's language, against C2.

**Consequences.** One icon set, one stroke weight, no variants — a consistency mechanism. The lint rule from Phase 1 catches a slug-keyed icon map.

---

## ADR-023 — React Hook Form + Zod, with schemas shared with the API

**Status:** Accepted

**Decision.** React Hook Form with `zodResolver`, validating against the **same Zod schemas the API uses**, published in `packages/contracts`.

**Reason.** The decisive argument is schema sharing, not ergonomics. The API already validates with Zod (HLD §1), so sharing means client and server **cannot disagree about what is valid**. A second validation library would be a second definition of the same rule, and the two would drift — producing the worst form failure mode: client-side success followed by a server 400. RHF's uncontrolled-by-default model also avoids re-rendering large forms per keystroke.

**Alternatives considered.** *TanStack Form* — promising and more type-safe in places; rejected on **stability**. *Formik* — re-renders on every change, weaker TS, low maintenance. *Final Form* — dormant. *Native + manual* — re-implements validation, error wiring and accessibility per form.

**Consequences.** Shared schemas cover **shape only**. Limits, permissions and entitlement are server-resolved state and are never validated client-side (C4) — a boundary that must be respected, since a shared schema makes it tempting to put a limit in it.

---

## ADR-024 — TanStack Table, headless

**Status:** Accepted

**Decision.** TanStack Table v8 for all tables; TanStack Virtual only for audit logs and cross-tenant lists.

**Reason.** Headless matters because this platform's tables must behave in ways a packaged grid resists: **cursor pagination** (`13` §3.1 — offset paging skips and duplicates rows in mutating tables), server-side sorting against allowlisted fields, and row states driven by entitlement rather than local data. A grid with its own pagination model would fight all three.

**Alternatives considered.** *AG Grid* — **licensing** for the features that justify it, very heavy, its own visual language. *MUI DataGrid* — Pro licensing and drags in MUI. *Mantine DataTable* — couples to Mantine. *Hand-rolled* — column sizing, multi-sort and selection semantics are more work than they appear.

**Consequences.** All chrome is ours to build, once, in `DataTable`. Virtualization is selective — virtualizing a 50-row page adds complexity and accessibility risk for nothing.

---

## ADR-025 — TanStack Query for server state; Zustand for the little client state

**Status:** Accepted

**Decision.** TanStack Query v5 for authenticated reads and all mutations; Server Components for public and initial data; Zustand for theme, layout, palette and table preferences. **No Redux.**

**Reason.** Per C3 and C4 the client cannot know whether a mutation will be permitted — the server may refuse on permission, entitlement or a limit — so optimistic updates are only safe with reliable rollback, which TanStack Query's `onMutate`/`onError` contract provides directly. For client state, there is almost none: nearly everything is server state, so Redux would be overengineering (master prompt §38).

**Alternatives considered.** *SWR* — lighter and fine for reads, but a weaker mutation and rollback story, which C8 makes central. *RTK Query* — requires Redux, which nothing else needs. *RSC fetching only* — insufficient for an interactive console, though used for public and initial data. *Context for client state* — re-renders whole subtrees, wrong for a theme toggle above a large table.

**Consequences.** **Every tenant-scoped query key contains `orgId`**, and the cache is cleared on organization switch (`11` §3.1). Without that, cached data from one tenant renders under another's heading — indistinguishable from a cross-tenant leak to a user. Server state is never duplicated into Zustand. Entitlement is never cached beyond a request.

---

## ADR-026 — Recharts, under a validated palette

**Status:** Accepted

**Decision.** Recharts for all charts, wrapped in `packages/ui` components that enforce the palette and mark rules in `04` §6. Visx is the documented escape hatch for a genuinely bespoke visualization.

**Reason.** The console's charts are modest — subscription counts by plan, seat utilization, usage trends, MRR over time. Recharts' declarative React API and SVG output are adequate and composable enough to apply this system's mark specifications. Visx would be right for a dedicated analytics product; here it would cost more than the requirement justifies (master prompt §38).

**Alternatives considered.** *Visx* — maximum control, but every chart becomes bespoke work. *ECharts* — powerful but heavy, imperative, own theming model. *Chart.js* — canvas, so no DOM for accessibility or per-mark interaction. *Nivo* — heavier, opinionated styling. *Observable Plot* — elegant but imperative and awkward inside React's lifecycle.

**Consequences, all binding.** No dual-axis charts, ever. Categorical hues in **fixed order, never cycled**; a ninth series folds into "Other" or facets. Scatter and small-multiple forms **cap at three series** (all-pairs validation). **Three light-mode slots sit below 3:1**, so charts using them must ship visible direct labels or a table view — not dismissable. Dark mode is a selected set of steps validated against the dark surface, re-validated whenever that surface changes (which happened: `04` §7, V-2).

---

## ADR-027 — date-fns v4 with timezone support

**Status:** Accepted

**Decision.** date-fns v4 plus `@date-fns/tz`; `@internationalized/date` where React Aria requires it. All timestamps cross the wire as ISO 8601 UTC; conversion happens at render.

**Reason.** Timezone correctness is a hard requirement, not a nicety: organizations and branches each carry a timezone (`04-erd.md` §4.1, §4.2), subscriptions expire at instants, and `18` §13 requires timestamps in the **viewer's** zone with UTC on hover — staff in one zone reading data about customers in another. date-fns v4 added first-class timezone support, is tree-shakeable per function, immutable, and has excellent types.

**Alternatives considered.** *Day.js* — smaller, but plugin-based timezone handling is weaker. *Luxon* — excellent timezone model; rejected as larger, monolithic, class-based. *Moment* — deprecated by its own maintainers. *Temporal* — the right long-term answer, rejected on **availability**; date-fns is the bridge, and migration later is mechanical.

**Consequences.** Formatting goes through a shared `format.ts` so timezone handling is not re-decided per component. Two date libraries coexist where React Aria needs its own calendar types — a bounded, documented cost of the ADR-020 exception.

---

## ADR-028 — CSS-first animation

**Status:** Accepted

**Decision.** CSS transitions via Tailwind for essentially all motion; Motion permitted only for shared-layout transitions, drag reordering, and list add/remove that CSS cannot express.

**Reason.** Zero JS, compositor-driven, no bundle cost. The motion this interface needs is almost entirely opacity and small transforms, which CSS does natively and better. The specification — **120–200ms, ease-out, no bounce** (`02` §5) — is expressible without a library.

**Alternatives considered.** *Motion for everything* — bundle cost for capability the system does not use. *React Spring* — no advantage for these cases. *GSAP* — licensing considerations and far beyond need. *Auto-Animate* — too implicit for a system that specifies motion precisely.

**Consequences.** `prefers-reduced-motion` is honored globally in one place (`02` §5.2). No spring overshoot: it reads consumer-playful and, in an admin tool, imprecise. Adding Motion requires justification against the listed cases.

---

## ADR-029 — Vitest + RTL + Playwright + axe

**Status:** Accepted

**Decision.** Vitest with React Testing Library for unit and component tests; Playwright for E2E; axe-core via `vitest-axe` and `@axe-core/playwright`. MSW mocks the API from shared contract types.

**Reason.** Vitest's browser-environment and JSX handling are materially better than Jest's for component tests, with far less configuration. Playwright is chosen over Cypress specifically for **multi-origin and multi-tab support**, which the OIDC redirect flows in `20` §9 require — a Cypress limitation that would block testing the most important journey. MSW mocking from contract types means a mock cannot drift from the real response shape.

**Alternatives considered.** *Jest* — slower, heavier ESM/TS setup. *Cypress* — weaker multi-origin handling. *Enzyme* — dead, and shallow rendering tests implementation rather than behavior. *Chromatic / Percy* — deferred until churn justifies the cost.

**Consequences.** **Two test runners in the monorepo** — `node:test` on the backend (HLD §1), Vitest on the frontend. Acknowledged as a deliberate inconsistency: one runner would be tidier, but neither side should use the wrong tool, and the packages are independent. A11y failures are **CI merge gates** (`10` §9.1), like the architecture's tenant-isolation tests.

---

## ADR-030 — Inter + JetBrains Mono, self-hosted

**Status:** Accepted

**Decision.** Inter Variable for UI, JetBrains Mono (subset) for identifiers, both self-hosted via `next/font/local`. Three weights only: 400, 500, 600.

**Reason.** Self-hosting is **required, not preferred**: the CSP in `15` §7 is `default-src 'self'` with no font exception, so a Google Fonts request would be blocked by the platform's own security policy (C6). Inter is designed for UI at small sizes, has excellent **tabular figures** — essential for the numeric columns in `03` §5 — is variable, openly licensed, and carries no platform association (C2).

**Alternatives considered.** *Geist* — good and similar in spirit; younger, and perceptually tied to one vendor. *IBM Plex Sans* — strong and neutral, slightly wider so it costs density. *system-ui stack* — zero cost and genuinely defensible; rejected because inconsistent cross-OS rendering undermines the single-system goal and tabular-figure support varies. *Roboto / Open Sans* — strong platform associations. *A licensed display face* — cost, and `00` §4 excludes display type.

**Consequences.** Fonts ship with the app, removing a third-party request from the critical path and the layout shift with it. **Three weights only** — no 700, because at these sizes 600 already reads decisively bold and two near-identical bolds invite inconsistency. `font-synthesis: none` prevents synthetic bolding.

---

## ADR-031 — The console is desktop-first, by decision

**Status:** Accepted

**Decision.** Discovery is mobile-first; launcher and organization admin are fully responsive; the **company console is desktop-first and read-mostly on mobile**. Bulk operations, plan-limit editing and side-by-side comparison show a short pointer to desktop rather than a degraded layout.

**Reason.** A table with organization, status, products, members, MRR, account manager and date cannot be made comfortable at 375px without becoming a different product. Attempting it produces a surface too cramped for desktop and too complex for mobile. Staff triage on phones and act at desks; designing for that is honest.

**Alternatives considered.** *Fully responsive console* — rejected: compromises the primary desktop use case. *Mobile-blocked console* — rejected: triage on mobile is genuinely useful. *A separate mobile app* — rejected: two codebases (`00` §5).

**Consequences.** Mobile still supports viewing, reading state and simple actions, with no page-level horizontal scroll at 320px (WCAG 1.4.10). **No feature is restricted for security reasons** — the limitation is ergonomic, the API has no device awareness, and the accessibility statement documents it honestly (`10` §12).

---

## ADR-032 — Session in an httpOnly cookie behind a thin BFF

**Status:** Accepted · **Depends on:** ADR-019

**Decision.** The web app's session is an httpOnly, Secure, SameSite=Strict cookie set by a Next route handler. Access tokens are **never exposed to JavaScript**. Route handlers proxy authenticated requests to Fastify, attaching the token server-side, and contain no business logic.

**Reason.** The SPA alternative — a token in memory or `localStorage` — is readable by any successful XSS. An httpOnly cookie is not. Since ADR-019 already puts a Node tier in the request path, taking the security benefit costs nothing additional. Product applications continue to use the standard OIDC flow with their own tokens (`12` of the architecture); this applies only to the Control Plane's own web app.

**Alternatives considered.** *Token in memory* — lost on reload, and still script-readable. *`localStorage`* — XSS-readable, the worst option. *Non-httpOnly cookie* — gives up the entire benefit. *Direct browser-to-Fastify with CORS* — viable, but forfeits httpOnly and needs a broader CORS surface.

**Consequences.** The BFF must stay thin — a route handler that grows authorization becomes a second place access is decided, which is the duplication the architecture avoids. `SameSite=Strict` plus an origin check on mutations covers CSRF. Refresh happens in a route handler, which re-sets the cookie. The proxy adds one hop of latency, accepted for the XSS elimination.

---

## Superseded

| ADR | Superseded by | What changed |
|---|---|---|
| HLD §1 — React + Vite | **ADR-019** | Framework is Next.js App Router |
| HLD §8 — SPA frontend architecture | **ADR-019, ADR-032** | Route groups, Server Components, cookie session behind a BFF |

Both amendments are recorded in `docs/architecture/22-change-log.md` as AR-007, never applied silently.

---

Next: `13-design-validation.md`.
