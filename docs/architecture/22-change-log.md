# 22 — Architecture Change Log

Every change to the baseline or to an architecture document is recorded here. Architectural decisions are never changed silently (master prompt §28). An entry records what changed, why, which documents are affected, and what the impact is on work already done.

---

## BL-1.1 — Plan limits are explicitly configuration, not fixed values

| Field | Value |
|---|---|
| **Version** | Baseline v1.0 → v1.1 |
| **Date** | 2026-10-01 |
| **Type** | Clarification (no change to the business model) |
| **Raised by** | Architecture audit, question A-R1; confirmed by the product owner |

**Change.** Baseline §17 and §18 carried numeric limits — "Users: 2", "Maximum Users = 2" — in a form that could be read as platform rules. Both sections now carry an explicit clarification that these are illustrative, that real limits are commercial configuration set per plan and overridable per customer, and that the architectural requirements are configurability, server-side resolution, and race-safe enforcement. The document version was raised to 1.1.

**Reason.** The product owner confirmed during the audit that limits are a business decision made per customer — the company decides how much to grant whom and adjusts accordingly. The original wording risked an implementation that treated a limit as a constant, which would turn an ordinary commercial act (granting a customer an extra seat) into a code change and a deployment.

**Affected documents.** `00-baseline.md` and the source `doc.md` (both annotated, version bumped); `21-architecture-decisions.md` (ADR-010, ADR-011); `04-erd.md` and `05-data-dictionary.md` (limits modeled as rows with override support); `09-plans-and-subscriptions.md` (resolution order: subscription override, then plan value); `20-testing-strategy.md` (concurrency test for limit enforcement).

**Impact.** None on existing work — the clarification arrived before implementation began, which is the point of the architecture-first sequence. Going forward it binds the implementation: no numeric limit may appear in source code, and limit resolution is always a query.

---

## AR-001 — Baseline ambiguities resolved by decision

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Architectural resolution of items the baseline deferred |

**Change.** Five ambiguities identified in `01-repository-audit.md` §5.3 were resolved by decision rather than left open, each recorded as an ADR:

| Audit item | Question | Resolution | ADR |
|---|---|---|---|
| A1 | Branch permission model, deferred by baseline §10 | Branch is a dimension within the organization, not a tenant boundary | ADR-014 |
| A2 | `subscriptions` vs `organization_products` both listed in §35 | Subscription is the single source of truth; the other is a derived read model | ADR-006 |
| A3 | Company users and customer users: one table or two | One `users` table; scope carried by assignment | ADR-005 |
| A4 | Whether a trial is a subscription or a separate entity | A subscription in `trialing` status | ADR-007 |
| A5 | Usage: product counters vs entitlement counters conflated in §30 | Entitlement counters are authoritative; product counters are reported, never used for access decisions | `04-erd.md`, `12-product-integration-contract.md` |

**Reason.** The baseline deferred these to later phases by design. Each had to be settled before the ERD could be written, because each determines table structure.

**Impact.** None of these contradicts the baseline; each selects among options the baseline left open. No baseline revision was required beyond BL-1.1.

---

## AR-002 — Identity approach evaluated and decided

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Decision on an item the baseline listed as not finalized (§44) |

**Change.** The baseline left "authentication provider, OAuth/OIDC implementation, token strategy" open. At the product owner's request, both an external identity provider and an in-house authorization server were evaluated against this platform's specific requirements before a choice was made. The decision is an in-house, OIDC-conformant authorization server built as a replaceable module, with the full evaluation, the binding implementation constraints, and the conditions that would trigger reconsideration recorded in ADR-003. Token strategy follows in ADR-004.

**Reason.** Identity is the platform's highest-stakes subsystem and the baseline required a deliberate decision rather than a default. The deciding factor was that authorization depends on organization, membership, subscription and usage state that only the Control Plane holds — so the Control Plane must own the authoritative access decision under either option, which substantially reduces what an external provider would remove from the problem.

**Affected documents.** `21-architecture-decisions.md` (ADR-003, ADR-004); `06-identity-and-sso.md`; `12-product-integration-contract.md` (written against the OIDC specification, not against the implementation, to keep the migration path open); `15-security-architecture.md`; `20-testing-strategy.md` (OIDC conformance suite).

**Impact.** Sets the scope of implementation Phase 3 and makes authentication code subject to security review rather than ordinary review. The reversal path is deliberately preserved and tested.

---

## AR-008 — Phase 1 implementation: three findings from running the code

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Implementation findings; amends `15` §7.1 |
| **Scope** | Phase 1 project foundation |
| **Outcome** | Phase 1 complete and validated; **1 architecture amendment**, 2 implementation bugs fixed |

**Change.** Phase 1 was implemented as specified. Building and running it surfaced three defects that documentation review could not have found, because each only appears when a browser executes the policy.

### D-9 — `style-src` blocked the mechanism the design mandates · **amends `15` §7.1**

The CSP from Phase 0.5 used `style-src 'self' 'nonce-…'` with no provision for inline style **attributes**. The browser then blocked the running application, because a nonce cannot cover a style attribute — per CSP only `'unsafe-inline'` or `'unsafe-hashes'` can.

Two approved design decisions require style attributes:

| Requirement | Source |
|---|---|
| Product accent colours applied as `style={{ '--product-accent': colour }}` at runtime | `docs/design/04` §5; ADR-013 forbids compiling product colours in, so there is **no static alternative** |
| Radix positions dialogs, popovers and tooltips with inline styles | ADR-020; not configurable |

**Resolution.** Added `style-src-attr 'unsafe-inline'` and `style-src-elem 'self' 'nonce-…'`. The permission is scoped to attributes; inline `<style>` **elements** stay nonce-gated, and `script-src` is untouched — no `'unsafe-inline'`, no `'unsafe-eval'` in production. CSS injection is a materially lower risk than script injection. An e2e test asserts this **per directive**, so the narrow permission cannot quietly widen into a blanket one.

This is the third time the CSP has been corrected (D-1, D-2, D-9). The pattern is consistent: a policy written against an abstract application blocks the concrete one, and only running it reveals which.

### Implementation bugs fixed (no architecture change)

| # | Bug | Why it mattered |
|---|---|---|
| **P1-1** | Font variable classes were on `<body>`, but `--font-sans` is defined on `:root` as `var(--font-inter), …`. At `:root` scope `--font-inter` was **undefined**, making the whole `font-family` declaration invalid — the page silently fell back to Times New Roman with **no error anywhere**. Classes moved to `<html>` | Self-hosted fonts are an ADR-030 requirement and a CSP constraint (C6); silently losing them defeats both. An e2e test now asserts the computed family and that woff2 loads from our own origin |
| **P1-2** | Webpack could not resolve the `.js` ESM specifiers that `verbatimModuleSyntax` and Node ESM require, so `@cp/ui` would not build | Fixed with `resolve.extensionAlias` in `next.config.ts` — teaching the bundler, rather than removing extensions the API tier genuinely needs to run as ESM |

### Deliberate deviations recorded

| Item | Decision |
|---|---|
| `packages/db` not created | Phase 1 has no database by instruction. An empty package would be noise; Phase 2 creates it with its first migration |
| `packages/contracts` not created | Nothing to share until the API has routes (Phase 3). Creating it empty would invite premature contents |
| Launcher owns `/`; public landing moved to `/welcome` | Two route groups cannot both own `/`. The launcher keeps `/` per `docs/design/07`; the SEO-critical public surface is `/products/[slug]` (Phase 12), not the landing page |
| `style-src-attr` permission | See D-9 |

**Validation.** `pnpm install`, `typecheck`, `lint`, `build` clean; **50 unit tests** and **21 e2e tests** pass; **28/28 contrast gates** pass; both architecture lint guards verified as firing against fixtures.

**Impact.** Phase 1 is complete. Phase 2 is blocked only on a reachable PostgreSQL (AR-003).

---

## AR-011 — Phase 4 implementation: organizations, branches, memberships

| Field | Value |
|---|---|
| **Date** | 2026-10-05 |
| **Type** | Implementation |
| **Scope** | `apps/api/src/modules/organizations` — tenant self-management |
| **Outcome** | Organization/branch/membership/invitation management, live on Neon; 12 module tests pass (39 API total) |

**Change.** The organization self-management surface is implemented as a second bounded module inside the standalone backend (domain/application/http), depending on identity only through its public interface (HLD §4.1):

- **Organization**: read + update of descriptive settings only. Status transitions (suspend/cancel/reinstate) are company-controlled (baseline §20) and are **not** accepted fields here; the org never raises its own limits.
- **Branches**: list/create/update/delete with the one-primary-per-org rule (unset-then-set so the partial unique index never transiently breaks). The branch *limit* (MAX across subscriptions) is deferred to Phase 10 with the rest of limit enforcement, per plan.
- **Memberships**: list, suspend/reinstate/remove, branch-scope management, transfer-ownership. **Last-owner protection** (the last active owner cannot be suspended/removed/demoted) and **immediate session revocation** on suspend/remove (requested from identity through its public `revokeUserSessions`). Removal releases the member's product seats (full enforcement Phase 10).
- **Invitations**: create (one pending per org+email), list, revoke, public preview, and accept — for a brand-new user (provisioned verified, since the invite proves the email) and for an existing authenticated user joining a second organization (baseline §8 multi-org).

**Tenant isolation.** The acting organization comes only from the verified token's `org` claim, never from a request body; a path org id must equal it, and a mismatch is **404, not 403** (07 §9). Org-owned work runs under `withOrgScope`, so RLS is the defense-in-depth layer beneath the token scope.

**Authorization (interim).** Phase 4 gates management on membership ownership (`is_owner`); Phase 5 (RBAC) replaces this with the `organization.*` permission set and the org_admin role, at which point the route-declared permissions become the real check. Reads require active membership; mutations require ownership.

**New in the identity public interface (HLD §4.1).** `provisionInvitedUser` (create a verified user on invitation acceptance) and `revokeUserSessions` (used by the org module on member suspend/remove), plus the `EmailPort`/`ConsoleEmail` exports, moved into `identity/services.ts` and re-exported from the module index.

**Fix found while testing.** The branded `OrgScope`/`PlatformScope` constructors used their phantom brand symbol as a *runtime* object key (`[scopeBrand]: …`), but the symbol is a type-only `declare const` → `ReferenceError: scopeBrand is not defined` at runtime. The brand is now purely compile-time; the constructors return the real fields cast to the branded type. (This also means `packages/core` was rebuilt so `dist` matches.)

**Validation.** 12 organization tests pass against Neon — tenant isolation per resource (404-not-403), org context only from the token, one-primary branch, ownership-gated management, last-owner protection, new-user and existing-user invitation acceptance, duplicate-invitation rejection. Full API suite 39/39; workspace typecheck, lint, build, contrast (28/28), lint guards green. Integration-test timeout raised to 60s (argon2 + Neon latency make full flows slow). Secrets remain in gitignored `.env`.

---

## AR-010 — Phase 3 implementation: identity and authentication

| Field | Value |
|---|---|
| **Date** | 2026-10-04 |
| **Type** | Implementation; amends ERD §11/§13 (audit FK), adds ADR-033 |
| **Scope** | `apps/api` identity module — the highest-stakes subsystem (ADR-003) |
| **Outcome** | In-house OIDC-conformant auth server, live on Neon; 27 API tests pass |

**Change.** The identity subsystem is implemented inside the standalone backend (`apps/api/src/modules/identity`, layered domain/application/infrastructure/http). It delivers registration + email verification, enumeration-resistant login with per-account lockout, session management, refresh-token rotation with per-family reuse detection (ADR-017), password reset, organization selection, and the OIDC/OAuth 2.1 endpoints (discovery, JWKS, authorize+PKCE, token, userinfo, revoke, end-session). argon2id via `@node-rs/argon2`; all JWT/JWKS via `jose`; signing keys in `jwks_keys`, private keys AES-256-GCM encrypted at rest. The API now connects as `app_role` (RLS applies) and `/readyz` probes the database.

### Decisions recorded as ADR-033
- **argon2id via `@node-rs/argon2`** (prebuilt binary) rather than node-gyp `argon2` — reliable cross-platform install; argon2id is the default variant.
- **Modules live in `apps/api/src/modules/`**, not `packages/modules/`, keeping the backend one deployable unit (the user's requirement). Logical module architecture and the domain-purity lint rule are preserved.

### Bugs found and fixed while testing against the live database
| # | Bug | Fix |
|---|---|---|
| P3-1 | Org slug built from `uuidv7().slice(0,8)` — v7's leading bytes are the timestamp, so registrations in the same moment collided on `organizations_slug_unique` | Random suffix (`randomBytes`) |
| P3-2 (amends ERD §11/§13) | `audit_logs.actor_user_id` FK's `ON DELETE SET NULL` is an UPDATE on `audit_logs`, which the append-only trigger (0016) forbids — so deleting a user failed | **Dropped the FK** (migration 0018). An append-only, long-retention log should have no referential coupling into it; the denormalized `actor_label` already preserves readability |
| P3-3 | Refresh issued the new token before consuming the old, briefly creating two live tokens → violated the one-live-token-per-family unique index (ADR-017) → 500 | Consume first, then issue; same fix applied to organization-switch |
| P3-4 | Reuse-detection revoked the session **inside** the transaction that then threw, rolling the revoke back — so the family stayed alive | The use case returns a discriminated result; the failure is thrown **after** the transaction commits, so the revoke persists |
| P3-5 | A per-email login rate limit collided with per-account lockout (both at 5) | Login is rate-limited per-IP only; account lockout is the per-account defense |

**Deferred within Phase 3 (seams in place).** MFA (schema + `amr` claim present, mechanism off, ADR-D5); the browser-cookie authorization-server session for product SSO (the PKCE code/exchange mechanics are complete; full web-tier session linkage lands with product integration, Phase 17); a real email provider (dev logs; delivery runs off the outbox). Permissions in the access token are an empty set with a working `perm_digest` seam until RBAC (Phase 5).

**Validation.** 27 API tests pass (14 foundation + 13 identity integration against Neon): enumeration resistance, lockout, refresh rotation + reuse → family revocation, reset single-use + session revocation, PKCE round trip + bad-verifier rejection, exact-match redirect URIs, discovery/JWKS. Live boot confirmed: the process starts, loads/creates a signing key from the DB, and serves OIDC with no private key in JWKS. Workspace typecheck, lint, build, contrast (28/28) and lint guards green. Secrets remain in gitignored `.env`.

---

## AR-009 — Phase 2 implementation: database foundation on Neon, and the refinements it forced

| Field | Value |
|---|---|
| **Date** | 2026-10-03 |
| **Type** | Implementation + environment-driven refinements; amends ERD §13.1, §14, §1.0 notes |
| **Scope** | `@cp/db` — schema, migrations, guards, RLS, repositories, audit/outbox, tests |
| **Outcome** | Full schema live on Neon (39 app tables); 15 integration tests pass; **4 refinements recorded** |

**Change.** Phase 2 was implemented against the provided Neon PostgreSQL instance. The full ERD is migrated (17 forward-only migrations), the composite guards, RLS and the append-only audit log are in place, and an integration suite verifies the security invariants in rolled-back transactions. Running it against a real managed Postgres surfaced four things documentation could not.

### Environment finding: PostgreSQL 18.6, not 16

The instance is **18.6**. PG 18 has a native `uuidv7()`, but the ERD (§1.0) deliberately generates ids in the application so the schema stays portable to 16/17. **That decision stands** — app-side `uuidv7()` is used, no `gen_random_uuid()` defaults — so the platform is not pinned to an 18-only feature. Recorded, not changed.

### R2-1 — FK targets must be unique CONSTRAINTS, not bare unique indexes (amends ERD §13.1)

The ERD sketched the referenceable `(id, scope)` pairs as `CREATE UNIQUE INDEX`. PostgreSQL requires a foreign-key target to be a unique **constraint** (or PK), not merely a unique index, so those are now `ALTER TABLE … ADD CONSTRAINT … UNIQUE (id, scope)`. Functionally identical (a unique constraint is backed by a unique index), but it is what makes the composite guards referenceable. Grandparent agreements (plan↔feature, override↔subscription, role↔permission product) are `CONSTRAINT TRIGGER`s, `DEFERRABLE INITIALLY IMMEDIATE`, as the ERD specified.

### R2-2 — the app connects as a non-bypass role; the owner has BYPASSRLS (amends ERD §14, 15 §3)

Neon's `neondb_owner` has `rolbypassrls = true`, which **overrides `FORCE ROW LEVEL SECURITY`**. Connecting the application as the owner would make RLS inert. This is a push toward the *more* correct design that §15 §3 already intended: the runtime and the RLS tests connect as **`app_role`** (login enabled, `rolbypassrls = false`), so RLS genuinely applies; **migrations** run as the owner (trusted DDL). `FORCE RLS` is kept as defense in depth. The `app_role` credential lives only in a gitignored `.env`.

Consequence for a later phase: when `apps/api` wires to the database (Phase 3), it connects via the `app_role` URL, not the owner URL. The owner URL is for migrations only.

### R2-3 — RLS policies must tolerate an unset tenant setting (amends ERD §14)

`set_config('app.current_organization_id', NULL)` stores an **empty string**, and `''::uuid` raises `string_to_uuid`. A request that cleared its scope would error instead of returning no rows. The tenant policies now wrap the setting in `NULLIF(current_setting('app.current_organization_id', true), '')::uuid` (migration 0017), so both unset (NULL) and cleared ('') resolve to NULL → the comparison is false → no rows. This is the behaviour the "unscoped query sees nothing" test asserts.

### R2-4 — audit append-only is enforced by a trigger, not only by GRANT revocation (amends ERD §11.1)

Because the owner bypasses table privileges, `REVOKE UPDATE, DELETE ON audit_logs FROM app_role` alone would not stop the owner rewriting the log. A `BEFORE UPDATE/DELETE` trigger enforces append-only **regardless of connecting role**, unless an explicit `app.allow_audit_maintenance` flag is set (for the retention job). Both mechanisms are present: the REVOKE is the app-facing boundary (tested: `app_role` gets "permission denied"), the trigger is the owner/retention backstop.

**Tooling note.** `tsx` (dev-only) runs the migration/probe CLIs: Node's `--experimental-strip-types` does not remap `.js` specifiers to `.ts`, and the source uses `.js` specifiers because `@cp/db` and `@cp/core` ship compiled ESM consumed by the Node backend (`apps/api`).

**Validation.** All 16 migrations apply and are idempotent; schema verification counts 39 app tables, 15 FORCE-RLS tables, the critical plan/product guard, the view, and all 5 guard/append-only triggers; 15 integration tests pass (tenant isolation, composite guards incl. R-5, partial unique indexes, append-only, outbox atomicity, view states). Workspace typecheck, lint, build, contrast (28/28) and lint-guard checks all green.

**Impact.** Phase 2 complete. The backend remains a standalone deployable Node.js service (`apps/api` + `@cp/core`/`@cp/db`). The `app_role` login credential and the Neon URLs are local-only secrets; **the user should rotate the database password that was shared in chat.**

---

## AR-007 — Phase 0.5: design system, and the architecture amendments it forced

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | New phase inserted before implementation; amends HLD §1/§8, `15` §6/§7, `17` §2/§3, `19` |
| **Scope** | `docs/design/` 00–13; ADR-019 … ADR-032 |
| **Outcome** | Design system locked; **8 consistency findings, all corrected** |

**Change.** A UI/UX and design-system architecture phase was inserted after the validation gate and before Phase 1, producing `docs/design/` (14 documents) and fourteen new ADRs. Phase 0.5 precedes Phase 1 because the frontend stack determines the repository scaffold — choosing a framework afterwards would mean rebuilding it.

**Reason.** The architecture documents specified the backend completely but left the frontend at one line of HLD §1. "Premium enterprise SaaS interface" is not implementable from that, and the library choices have multi-year consequences.

### Framework change: Vite → Next.js (ADR-019)

HLD §1 locked React + Vite. The product owner prioritized Next.js, so the conflict was surfaced rather than resolved silently, and both options were evaluated.

**Decided: Next.js App Router.** The deciding fact is that **product discovery pages are public, anonymous and SEO-relevant** (baseline §14, §38; `12` §5.2; `13` §9.6) — a pure SPA serves them to a crawler as an empty shell, undermining the marketplace function the baseline requires. A secondary benefit is real: with route handlers as a thin BFF, the session is an httpOnly cookie and **access tokens never reach JavaScript** (ADR-032), which is better than the SPA pattern.

**Cost accepted:** a Node rendering tier beside the API, and App Router complexity managed by convention plus a lint rule rather than case-by-case judgement.

### Findings corrected in the architecture

Three would have produced a non-functional application, using the platform's own security policy against itself.

| # | Severity | Finding | Correction |
|---|---|---|---|
| **D-1** | **High** | CSP had no `img-src`, so it inherited `'self'` — **every product icon would have been blocked.** `products.icon_url` is an absolute URL on an asset host (ADR-013). The launcher would have rendered as broken images, failing silently server-side | `15` §7.1: explicit `img-src 'self' data: {asset-host}` |
| **D-2** | **High** | `script-src 'self'` would have **prevented the application from hydrating.** The framework always emits inline bootstrap scripts; the doc's claim that the build emits no inline scripts was untrue of the chosen framework | `15` §7.1: per-request nonce + `'strict-dynamic'` — which is *stronger* than a host allowlist |
| **D-3** | Medium | `style-src` and `font-src` undeclared | Declared explicitly; `font-src 'self'` now documents that self-hosting is **mandated**, so nobody later adds a font CDN |
| **D-4** | Medium | Blanket `dangerouslySetInnerHTML` ban conflicted with the required pre-paint theme script | `15` §6: ban stands with **one** named, nonce-carrying exception |
| **D-5** | Medium | Deployment topology had no web tier | `17` §2, §3, §10: stateless web tier, same image, frontend env schema |
| **D-6** | Required | HLD §1, §8 specified Vite/SPA | Amended to Next.js; **§8's intent preserved** — admin console still a separate bundle, now via route groups |
| **D-7** | Required | Implementation plan had no Phase 0.5 and assumed the old stack | Phase 0.5 added; Phases 1, 11, 12, 14, 18, 19 updated |
| **D-8** | Low | 16px inputs vs 14px body default | Documented platform exception — iOS Safari zooms below 16px |

### Accessibility failures found by computation

Contrast was calculated, not estimated. Two failures were caught and fixed **before** the palette was locked:

| # | Issue | Measured | Fix |
|---|---|---|---|
| V-1 | `neutral-400` as light-mode placeholder | **2.57:1** — fails even the 3:1 non-text floor | Placeholder → `neutral-500` (**4.72:1**); `neutral-400` restricted to non-text in light |
| V-2 | Dark page vs dark card surface | **1.08:1** — layers visually indistinguishable | Dark card → `#1A1E28` (**1.17:1**), which forced a **re-validation** of the chart palette against the new surface |

Both would have shipped on visual judgement: 2.57:1 reads as an acceptable gray and 1.08:1 reads as "subtle".

**Affected documents.** New `docs/design/` 00–13. Amended: `03-hld.md` §1/§8, `15-security-architecture.md` §6/§7, `17-deployment-architecture.md` §2/§3, `19-implementation-plan.md`, `21-architecture-decisions.md`.

**Impact.** No code existed, so no rework. Phase 1's scaffold is now fully specified, including the CSP middleware that D-2 showed is required for the application to run at all.

---

## AR-006 — Architecture validation gate passed

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Validation gate (master prompt §29, §30) |
| **Scope** | Documents 00–22 against Baseline v1.2 |
| **Outcome** | **All 11 checks pass.** Implementation unblocked |

**Change.** The full architecture review required before implementation was performed and recorded in the new `23-architecture-validation.md`. Each of the eleven required checks is answered with its enforcing mechanism and the test that proves it. Seven of the eleven required a correction first, all of which came from review AR-004 and were applied before this gate ran.

**Reason.** Master prompt §29 requires the review after documentation is complete, and §30 forbids implementation until it passes. Recording the outcome makes the gate auditable rather than asserted.

**Affected documents.** New: `23-architecture-validation.md` (an addition to the structure in master prompt §6, which ends at 22 and had no place to record a gate outcome).

**Impact.** Implementation may begin at Phase 1, which needs no database. Two environment prerequisites remain tracked rather than open: a reachable PostgreSQL 16+ with `citext` before Phase 2 completes, and Docker before Phase 20 (AR-003).

**Cumulative result of the architecture-first sequence.** Thirteen defects found and corrected with no code written: two would have failed on first migration run, four would have shipped as silent wrong behavior (limit enforcement, tenant isolation, launcher state, domain coupling), one was a business-model question escalated rather than assumed, and one was a guarantee an ADR made that its own schema could not deliver.

---

## BL-1.2 / AR-005 — Seat dimension confirmed: per-product seats

| Field | Value |
|---|---|
| **Version** | Baseline v1.1 → v1.2 |
| **Date** | 2026-10-01 |
| **Type** | Business-model confirmation resolving review finding R-9 |
| **Decided by** | Product owner |

**Change.** Review finding R-9 (AR-004) escalated an undecidable question: a `users` limit was modeled as a *product* feature while memberships were *organization-wide*, so with multiple concurrent product subscriptions nothing defined which subscription an invitation counted against. The product owner confirmed **Option A — per-product seats** as the correct reading of the business model. ADR-018 moves from Proposed to Accepted; baseline §18 carries the interpretation; the ERD gains `membership_products` and `invitation_products`.

**Reason.** Per-product seats make baseline §17–18 mean literally what they say, allow capacity to be sold independently per product to the same customer, and give baseline §23's user-level product access a representation as data rather than as an inference from role permissions.

**What it settles.** Three things the schema previously could not answer: which subscription an invitation counts against (that product's); what ADR-011 locks (that subscription row, or the organization row for organization-scoped resources); and how "can **this user** use this product" is represented (a grant row).

**Secondary decisions taken as consequences**, each recorded in ADR-018 and `04-erd.md`:

| Question the confirmation forced | Decision | Why the alternative was rejected |
|---|---|---|
| Are organization members capped at all? | No — a member with no product grant consumes no seat | Capacity is sold per product; carrying an unseated account costs nothing |
| How do branch limits resolve, since branches are organization-wide? | MAX across access-granting subscriptions; locks the organization row | Taking the minimum would mean adding a cheap second product silently *reduced* what the customer could already do |
| What happens when a downgrade leaves more seats occupied than allowed? | Overage is permitted and visible; new grants blocked; existing holders keep working | Auto-revoking would remove a named person's access with no human decision |

**Affected documents.** `doc.md` and `00-baseline.md` (§18 annotated, → v1.2); `21-architecture-decisions.md` (ADR-018 Accepted; ADR-011 amendment resolved); `04-erd.md` (§4.6 rewritten per-product, new §4.6.1 scope rules, §4.7 `membership_products`, §4.7.1 `invitation_products`, §4.7.2 over-provisioning, `features.countable_scope`, §13.1 guard added, §14.1 closed).

**Impact.** Unblocks Phase 2 migrations — the last open gate before implementation. No code existed, so no rework. Inviting a user is now a richer operation that names the products granted, which is inherent to selling capacity per product.

---

## AR-004 — Architecture review of documents 00–04 and ADR-003/010/011

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Strict review against Baseline v1.1, before continuing documentation |
| **Scope** | `00-baseline.md`, `01-repository-audit.md`, `02-system-overview.md`, `03-hld.md`, `04-erd.md`, ADR-003, ADR-010, ADR-011 |
| **Outcome** | 13 findings; 12 corrected, 1 escalated for business confirmation |

**Reason.** The ERD fixes the shape of every document and every migration downstream, so it was reviewed before further documents were written rather than after. Twelve defects were found, including two migrations that would not have executed and three that would have produced wrong access or limit decisions silently.

### Findings and corrections

| ID | Severity | Finding | Correction |
|---|---|---|---|
| R-1 | **Blocker** | `usage_counters` unique index used `COALESCE(period_start, 'epoch'::timestamptz)`; the cast is STABLE, so Postgres rejects it in an index | Replaced with a NOT NULL `period_key` text column |
| R-2 | **Blocker** | `subscription_overrides` partial index predicate used `now()`, which is STABLE and illegal in an index — and would not have expired continuously even if allowed | Uniqueness keyed on `superseded_at`; expiry evaluated at read time |
| R-3 | **High** | `memberships.status = 'invited'` was structurally impossible (`user_id` NOT NULL, invitee has no user row) **and** duplicated the `invitations` table — a second source of truth for "pending seat" | `invited` removed; seat occupancy defined once in `04-erd.md` §4.6 as a union across both tables |
| R-4 | **High** | `invitations.role_ids uuid[]` — Postgres cannot foreign-key an array element, so roles deciding a new member's permissions could dangle | `invitation_roles` junction table with `RESTRICT` |
| R-5 | **High** | Composite tenant/product guards applied to one table and omitted everywhere else. `memberships.default_branch_id` could point at another tenant's branch (and that value is sent to products as active branch context); `subscriptions` could point at **another product's plan**, silently resolving the wrong product's limits | New `04-erd.md` §13.1; ADR-016 |
| R-6 | **High** | `v_organization_products`: the `expired` state was **unreachable** (dead `CASE` branch — the join filtered expired rows out), a lapsed trial fell through to `not_subscribed`, and `visibility` was ignored so `hidden` products would appear in every launcher | View rewritten with `LEFT JOIN LATERAL`, explicit lapsed-trial branch, visibility filter, `security_invoker = true` |
| R-7 | **High** | `features.unit` mixed Control Plane resources with product-domain ones, so enforcement would have had to recognize strings like `orders_per_month` — product coupling through a column, against baseline §4.2/§41 | Added `enforced_by` and `countable_resource` (closed enum); ADR-010 amended |
| R-8 | **High** | `sessions.previous_token_hash` detected only last-generation reuse, so it could not deliver ADR-003 constraint 4 — a token stolen at generation *N* and replayed after *N+3* was rejected but the family was not revoked and the breach signal was discarded | New `refresh_tokens` table per family; ADR-017; ADR-003 constraint 4 annotated |
| R-10 | Medium | UUID v7 has no native generator before PostgreSQL 18 (target is 16+), and `citext` needs an extension migration | Generation moved to the application, no `gen_random_uuid()` defaults; extension ordering documented |
| R-11 | Medium | `roles` had no coherence CHECK despite two scoping columns, so `scope='platform'` with `organization_id` set was representable — incoherent in the table governing cross-tenant privilege | `roles_scope_coherence_chk` added |
| R-12 | Low | `subscriptions.plan_id` unindexed, needed for plan-retirement and plan-population queries | Index added |
| R-13 | Low | `REVOKE DELETE ON audit_logs` would also block partition-based retention | Retention assigned to a separate maintenance role |

### Escalated

| ID | Finding | Status |
|---|---|---|
| R-9 | **The seat dimension is undefined.** `users` limits are modeled as a *product* feature, but memberships are *organization-wide*, so with multiple concurrent subscriptions (baseline §16, the normal case) nothing defines which subscription's limit an invitation counts against — and ADR-011's row lock cannot be written without knowing which row to lock. Also leaves baseline §23's "can **this user** use this product" unrepresented | **ADR-018, Proposed.** Per-product seats recommended, needing a `membership_products` entity. Not applied — it changes the unit of sale, a business-model decision outside what an architect may assume (master prompt §37). **Blocks Phase 2 migrations.** |

**Affected documents.** `04-erd.md` (corrections R-1 to R-13 applied inline, each annotated with its reasoning); `21-architecture-decisions.md` (ADR-016, ADR-017, ADR-018 added; ADR-003, ADR-010, ADR-011 amended).

**Impact.** No implementation existed, so no code required rework — which is the return on reviewing before writing migrations rather than after. Two corrections (R-1, R-2) would otherwise have surfaced as failed migrations on first run; four (R-3, R-5, R-6, R-7) would have surfaced as wrong behavior in production with no error, in limit enforcement, tenant isolation, launcher state and domain coupling respectively.

**Baseline conformance.** No baseline revision required. R-6 was a case of the design *failing* to meet baseline §13, now corrected, rather than the baseline needing change.

---

## AR-003 — Environment constraint recorded: Docker absent locally

| Field | Value |
|---|---|
| **Date** | 2026-10-01 |
| **Type** | Constraint discovered during audit |

**Change.** Docker, Docker Compose, PostgreSQL client tooling and Redis are not installed on the development machine (`01-repository-audit.md` §3). The architecture was shaped so that this blocks as little as possible: Redis is deferred behind interfaces (ADR-008), the domain and application layers are dependency-inverted so they test without a database, and database connectivity is selected by connection string so a local, remote or containerized Postgres are interchangeable.

**Reason.** An architecture that cannot be run or tested in the environment it is being built in produces work that cannot be verified, and unverified work is the thing the Definition of Done exists to prevent.

**Impact.** Docker and a reachable PostgreSQL instance are developer-environment prerequisites before the repository-layer integration tests and the deployment phase can complete. This ordering is carried into `19-implementation-plan.md`. Docker remains the deployment target regardless (`17-deployment-architecture.md`).
