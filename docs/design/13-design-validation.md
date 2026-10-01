# 13 — Design System Validation

Consistency review of `docs/design/` against `docs/architecture/`, performed before implementation.

**Result: 8 findings. All corrected.** Three would have prevented the application from functioning at all — two of them by the platform's own security policy blocking its own assets.

**Date:** 2026-10-01 · **Scope:** design docs 00–12 against architecture docs 00–23 and Baseline v1.2

---

## 1. Findings

### D-1 — CSP would block every product icon · **High**

**Conflict.** `15-security-architecture.md` §7 specifies:

```text
default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'
```

There is no `img-src`, so it inherits `default-src 'self'`. But `products.icon_url` (`04-erd.md` §6.1) is an absolute URL — product icons are registry data served from a CDN (ADR-013, ADR-022).

**Consequence if shipped.** Every product icon in the launcher, the discovery pages and the admin console would be blocked by the browser. The launcher — the platform's front door — would render as a grid of broken images. The failure is silent server-side and appears only in the browser console.

**Correction.** `15` §7 gains an explicit `img-src 'self' data: https:` with a note that it is narrowed to the configured asset host in production. `data:` is included for inline SVG placeholders and avatar fallbacks.

---

### D-2 — CSP would block Next.js from running · **High**

**Conflict.** `script-src 'self'` forbids inline scripts, and `15` §7 states the build must "emit no inline scripts or styles". Next.js App Router **always** emits inline bootstrap and streaming-payload scripts; this is not configurable. The pre-paint theme script (`11` §6) is also inline by necessity.

**Consequence if shipped.** The application would not hydrate. Not degraded — non-functional.

**Correction.** `script-src` becomes `'self' 'nonce-{random}' 'strict-dynamic'`, with the nonce generated per request in Next middleware and applied to Next's scripts and the theme script. `'strict-dynamic'` lets nonce-trusted scripts load their own chunks without allowlisting every path — which is also a stronger policy than a host allowlist, so the correction improves security rather than relaxing it.

The sentence claiming the build emits no inline scripts is removed, because it was not true of the chosen framework.

---

### D-3 — `style-src` and `font-src` undeclared · **Medium**

**Conflict.** Both inherit `default-src 'self'`. Self-hosted fonts via `next/font` are same-origin, so fonts are fine — but Next injects inline `<style>` elements for critical CSS in some configurations, which `'self'` forbids.

**Consequence.** Intermittent unstyled flashes, or blocked styles depending on build configuration — the kind of defect that appears in production and not locally.

**Correction.** Explicit `style-src 'self' 'nonce-{random}'` and `font-src 'self'`. Declaring `font-src 'self'` explicitly also documents C6: **self-hosting is required by the CSP**, not merely preferred, so a future developer cannot "simplify" by adding a Google Fonts link.

---

### D-4 — The `dangerouslySetInnerHTML` ban conflicts with a required script · **Medium**

**Conflict.** `15` §6 lint-bans `dangerouslySetInnerHTML` outright. The pre-paint theme script (`11` §6) requires it — without running before first paint, every dark-mode user sees a white flash on every page load.

**Consequence.** Either the lint rule is disabled wholesale — losing a genuine XSS control across the codebase — or the flash ships.

**Correction.** The ban stands, with **one named exception**: the theme bootstrap script in the root layout, which contains a compile-time constant with no interpolated input. The lint rule uses a file-scoped disable with a comment pointing here. A blanket ban that developers routinely disable is weaker than a ban with one documented exception.

---

### D-5 — Deployment topology has no web rendering tier · **Medium**

**Conflict.** `17-deployment-architecture.md` §2 shows an API tier and a dispatcher. ADR-019 adds a Next.js server.

**Correction.** `17` §2 gains the web tier: stateless, horizontally scalable, behind the same load balancer, same image pattern with its own entrypoint. §3 gains the frontend environment variables, and §10's readiness checklist gains the web tier.

The web tier is stateless — the session cookie is self-contained and tokens are verified by the API — so it scales identically to the API and needs no sticky routing.

---

### D-6 — HLD specifies React + Vite · **Required amendment**

**Conflict.** `03-hld.md` §1 locks "React + Vite + TypeScript"; §8 describes an SPA with lazy-loaded bundles.

**Correction.** Both amended to Next.js App Router per ADR-019, recorded in `22-change-log.md` as AR-007 — never silently. The §8 intent is **preserved**: the admin console remains a separate bundle (C7), now achieved through route groups rather than lazy imports.

---

### D-7 — Implementation plan has no Phase 0.5 and assumes the old stack · **Required amendment**

**Conflict.** `19-implementation-plan.md` Phase 1 names a pnpm workspace with `apps/web` but no framework, and no phase covers the design system.

**Correction.** Phase 0.5 inserted; Phase 1 deliverables updated to include Next.js, Tailwind v4, the token layer and the font pipeline; frontend phases (11, 12, 14) reference the design documents. Phase 18 gains CSP verification against D-1 to D-4, and Phase 19 gains the contrast and palette CI gates.

---

### D-8 — Input font size contradicts the body default · **Low, internal**

**Conflict.** `03` §3.1 sets 14px body; `09` §6.2 requires ≥16px on inputs because iOS Safari zooms the viewport on focus below that.

**Resolution.** Not an error — a genuine platform constraint. Documented as an explicit exception: **inputs are 16px on touch viewports**, 14px from `md` upward. Recorded here so it is not "corrected" later by someone enforcing the type scale.

---

## 2. Verified consistent

Checked and found aligned — no change needed.

| Architecture requirement | Design mechanism |
|---|---|
| ADR-013 no hardcoded products | Registry-driven tiles; lint rule; accent as runtime custom property (`04` §5, `07` §4.1) |
| C2 product accents coexist with chrome | Near-achromatic neutral chrome; one reserved platform hue |
| `07` §10 no client-side authorization | `PermissionGate` documented as presentational only (`05` §5.4) |
| master prompt §34 no client limit arithmetic | `SeatCounter` displays; server decides (`05` §5.2, `08` §6.2) |
| `11` §2 `appUrl` absent when denied | Absence, not CSS hiding (`07` §4.1) |
| `11` §4 open is re-authorized | Launcher payload treated as a snapshot (`07` §5) |
| ADR-010 unlimited is `null` | Renders as "Unlimited"; never blank (`05` §5.2, `08` §8) |
| `09` §2 not-included ≠ zero | Visually distinct in plan and limit UI (`08` §8) |
| `13` §3.1 cursor pagination | Prev/Next only; numbered pagination structurally impossible (`05` §4.1) |
| `07` §9 404 not 403 cross-tenant | Treated as not found (`11` §8) |
| `09` §7 409 limit → upgrade | `UpgradePrompt` from the 409 payload (`05` §5.4) |
| ADR-018 per-product seats | All seat UI scoped to a product (`08` §5.2) |
| `08` §8 entitlement never cached | `staleTime: 0`; never cached for an action (`11` §3.3) |
| `15` §10 audit includes denials | `outcome = denied` filter (`08` §10) |
| `10` §8.1 staff actions visible to customers | Same component, customer-facing view (`08` §5.3, §11) |
| `18` §13 timestamps in viewer's zone | `TimestampDisplay`; date-fns v4 timezone support (ADR-027) |
| `permissions.is_dangerous` | UI reads the flag, keeps no list (C11, `08` §7) |
| `13` §6 idempotency | Key per submit attempt (`11` §7) |
| HLD §8 admin bundle separate | Route group `(admin)` (`11` §1) |
| `12` of the architecture — product OIDC | Unaffected; ADR-032 applies only to the Control Plane's own web app |

---

## 3. Corrections applied

| Doc | Change | Finding |
|---|---|---|
| `15-security-architecture.md` §6, §7 | CSP: `img-src`, `script-src` nonce + `strict-dynamic`, `style-src`, `font-src`; scoped `dangerouslySetInnerHTML` exception | D-1…D-4 |
| `03-hld.md` §1, §8 | Framework → Next.js App Router; frontend architecture → route groups + BFF | D-6 |
| `17-deployment-architecture.md` §2, §3, §10 | Web rendering tier, frontend env vars, readiness items | D-5 |
| `19-implementation-plan.md` | Phase 0.5 added; Phases 1, 11, 12, 14, 18, 19 updated | D-7 |
| `21-architecture-decisions.md` | Pointer to ADR-019…032 | D-6 |
| `22-change-log.md` | AR-007 recording the whole phase | all |

---

## 4. The locked frontend specification

What implementation must follow. Changing anything here requires a new ADR and a change-log entry.

### 4.1 Stack

| Concern | Locked |
|---|---|
| Framework | **Next.js 15 App Router + React 19** |
| Styling | **Tailwind CSS v4** + CSS custom properties |
| Primitives | **Radix** + first-party `packages/ui`; React Aria for date-range and virtualized combobox only |
| Icons | **Lucide** (chrome only — product icons are registry data) |
| Forms | **React Hook Form + Zod**, schemas shared with the API |
| Tables | **TanStack Table v8** + TanStack Virtual |
| Server state | **TanStack Query v5** |
| Client state | **Zustand** |
| Charts | **Recharts** |
| Dates | **date-fns v4 + @date-fns/tz** |
| Animation | **CSS/Tailwind**; Motion only for listed cases |
| Testing | **Vitest + RTL + Playwright + axe-core** |
| Session | **httpOnly cookie behind a thin Next BFF** |

### 4.2 Typography

**Inter Variable** (UI) + **JetBrains Mono** (identifiers), **self-hosted** — required by the CSP.

Weights **400 / 500 / 600 only**. Body **14px / 20px**; discovery prose 16px; inputs 16px on touch. Scale: 32 · 24 · 20 · 16 · 14 · 13 · 12 · 11. **Tabular figures mandatory in every numeric column.**

### 4.3 Color — all computed

| Role | Light | Dark |
|---|---|---|
| Page | `#F7F8FA` | `#0B0D12` |
| Card / chart surface | `#FFFFFF` | `#1A1E28` |
| Overlay | `#FFFFFF` | `#252A35` |
| Primary text | `#14171F` (17.92:1) | `#F7F8FA` (15.68:1) |
| Secondary text | `#4D5563` (7.51:1) | `#CBD0DA` (10.77:1) |
| Muted / placeholder | `#6B7482` (4.72:1) | `#9AA2B1` (6.49:1) |
| Border | `#E2E5EB` | `#3A4150` |
| Primary action | `#4F46E5` (white text 6.29:1) | `#4F46E5` |
| Link / focus ring | `#4338CA` (7.90:1) | `#A5ADFB` (7.91:1) |

Status: `good #0CA30C` · `warning #FAB219` · `serious #EC835A` · `critical #D03B3B`, each with a darkened `-text` variant clearing 4.5:1. **Never color alone** — always icon plus label.

**Chart categorical, fixed order, validated in both modes:** blue `#2A78D6`/`#3987E5` · orange `#EB6834`/`#D95926` · aqua `#1BAF7A`/`#199E70` · yellow `#EDA100`/`#C98500` · magenta `#E87BA4`/`#D55181` · green `#008300` · violet `#4A3AA7`/`#9085E9` · red `#E34948`/`#E66767`.

Binding: no dual-axis charts; hues never cycled; scatter caps at **three** series; the three sub-3:1 light slots require visible labels or a table view.

### 4.4 Tokens

4px spacing grid (2px for optical corrections only). Radius 4/**6**/8/12/full. **Hairlines over shadows**; dark-mode elevation by surface step, not shadow. Motion **120–200ms ease-out, no bounce**; reduced-motion honored globally. Fixed z-index scale; **arbitrary values forbidden**. Focus ring **2px `outline`** with 2px offset, never removed.

Three-tier token architecture: components reference **semantic tokens only**, never primitives.

### 4.5 Component strategy

First-party `packages/ui` on Radix. Four tiers — primitives, base, composed, domain. One implementation of each pattern; a second is a defect. Every component: typed props, forwarded ref, `data-*` state, keyboard operable, visible focus, loading/disabled/error states, axe-tested in both themes.

### 4.6 Responsive

Breakpoints `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Sidebar off-canvas below `md`, collapsed `md`–`lg`, full at `lg`. Touch targets **44px**. Tables become cards below `md`, except where column relationships matter. **No page-level horizontal scroll at 320px.** Discovery mobile-first; console desktop-first by decision (ADR-031).

### 4.7 Accessibility

**WCAG 2.1 AA**, enforced in CI: axe on every component and route, a contrast script over every token pair, the chart-palette validator, and keyboard-only flow tests. Two documented exceptions, both mitigated by icon-plus-label: status `warning` and `serious` swatches on light, and three chart slots below 3:1.

### 4.8 Major UI patterns

| Pattern | Rule |
|---|---|
| Access state | `AccessStateBadge` from the backend state; `not_subscribed` is **neutral, not an error** |
| Seats and limits | `SeatCounter` / `LimitMeter`; "Unlimited" as a word; over-limit is a **warning**, not critical |
| Destructive actions | ConfirmDialog; **typed subject name** when `is_dangerous`; blast radius stated |
| Tables | Cursor pagination; tabular figures; distinct no-data vs no-matches empty states; **never an empty table on error** |
| Forms | Single column; labels above; validate on blur; server errors mapped to fields with `requestId` |
| Limit reached | 409 → `UpgradePrompt` with limit, usage, options; `source=limit_reached` on any resulting request |
| Org switch | New token + **full cache clear**; keys contain `orgId` |
| Launcher | Registry-driven; `canOpen` from backend; no `appUrl` when denied; re-authorized on click |
| Discovery | Server-rendered, public; all copy is data |
| Notifications | Toast for events; **banner for ongoing conditions**; errors persist |
| Disabled controls | **Always explain why** |

---

## 5. Gate

| Check | Result |
|---|---|
| Every requested topic specified | ✅ 37 of 37 |
| Libraries evaluated, not assumed | ✅ Alternatives and rejection reasons recorded for all 13 |
| Contrast computed, not estimated | ✅ 2 failures found and corrected |
| Chart palette validated | ✅ Both modes, against this system's surfaces |
| Consistency with architecture | ✅ 8 findings, all corrected |
| Architecture amended openly | ✅ ADR-019…032, change log AR-007 |
| Stack locked and stated | ✅ §4 |
| No UI implemented | ✅ Documentation only |

## 🟢 Phase 0.5 passes — implementation may begin at Phase 1
