# 19 — Implementation Plan

Phased plan following master prompt §39's ordering. Each phase states its goal, dependencies, deliverables, database changes, APIs, tests and acceptance criteria. A phase is not complete until its acceptance criteria pass — per the Definition of Done (master prompt §40).

---

## 0. Prerequisites

Two environment items block specific phases. Recorded in AR-003.

| Prerequisite | Blocks | Workaround until then |
|---|---|---|
| PostgreSQL 16+ reachable, `citext` available | Phase 2 integration tests onward | Domain and application layers are dependency-inverted and test without a database (HLD §3) |
| Docker + Compose | Phase 17 (deployment) | None needed earlier |

The architecture was shaped so this blocks as little as possible: entitlement rules, limit resolution and state machines are pure logic and can be built and tested first.

---

## 0.5 Phase 0.5 — UI/UX and design system architecture

**Status: COMPLETE** — `docs/design/`, validated in `docs/design/13-design-validation.md`.

Inserted after the architecture validation gate and before Phase 1, because the frontend stack determines Phase 1's scaffold: choosing a framework after scaffolding the repository would mean rebuilding it.

**Delivered.** Design-system baseline, frontend stack with alternatives evaluated, design tokens, typography, color system, component system, layout and navigation, launcher UX, console UX, responsive strategy, accessibility, frontend architecture, ADR-019…032, and a consistency review.

**What it changed in the architecture**, all via `22-change-log.md` AR-007:

| Change | Reason |
|---|---|
| Framework → **Next.js App Router** (ADR-019) | Public discovery pages are SEO-relevant and need server rendering |
| HLD §1, §8 amended | Framework and frontend structure |
| **CSP corrected** (`15` §7.1) | The original policy would have blocked product icons *and* prevented the app from hydrating |
| Deployment gains a web tier (`17` §2) | ADR-019 |
| Session → httpOnly cookie behind a thin BFF (ADR-032) | Tokens never reach JavaScript |

**Value realized.** Two accessibility failures found by computation (a placeholder at 2.57:1; dark surfaces at 1.08:1) and four architecture conflicts found by review — three of which would have produced a non-functional application.

---

## 1. Sequencing

```mermaid
graph LR
    P1["1 Foundation"] --> P2["2 Database"]
    P2 --> P3["3 Identity"]
    P3 --> P4["4 Organizations"]
    P4 --> P5["5 RBAC"]
    P5 --> P6["6 Catalog"]
    P6 --> P7["7 Plans"]
    P7 --> P8["8 Subscriptions"]
    P8 --> P9["9 Entitlements"]
    P9 --> P10["10 Seats & limits"]
    P10 --> P11["11 Launcher"]
    P11 --> P12["12 Discovery"]
    P12 --> P13["13 Accounts"]
    P13 --> P14["14 Console"]
    P14 --> P15["15 Usage"]
    P15 --> P16["16 Audit UI"]
    P16 --> P17["17 Integration"]
    P17 --> P18["18 Hardening"]
    P18 --> P19["19 Observability"]
    P19 --> P20["20 Deployment"]

    style P9 fill:#1e3a5f,stroke:#4a9eff,color:#fff
    style P10 fill:#4a1f1f,stroke:#ff6b6b,color:#fff
```

Phase 10 is highlighted: it contains the platform's most security-critical write path (ADR-011) and cannot be deferred or rushed.

---

## Phase 1 — Project foundation

**Goal.** A repository that builds, lints, types, tests and logs, with module boundaries mechanically enforced.

**Dependencies.** **Phase 0.5** — the stack must be locked before the scaffold is built.

**Deliverables**
- `git init`; branch and commit conventions (the audit found no version control at all)
- pnpm workspace per HLD §4; `apps/api` (Fastify), `apps/web` (**Next.js 15 App Router**), `packages/{core,db,ui,contracts}`
- **Frontend foundation** per `docs/design/`: Tailwind v4, the three-tier token layer as CSS custom properties, self-hosted Inter + JetBrains Mono via `next/font`, theme bootstrap with nonce, route groups `(public)`/`(auth)`/`(app)`/`(admin)`
- **CSP middleware** emitting the per-request nonce (`15` §7.1)
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- ESLint with the **architecture rules**: module-boundary imports, no `any`, no product-slug literals (ADR-013), no `dangerouslySetInnerHTML`
- `packages/core`: `Result`, error taxonomy, branded ids, **`Clock` port**, pagination types
- Fastify server; config validated by Zod at startup (refuses to boot on invalid config)
- Pino structured logging with correlation-id middleware
- `/healthz`, `/readyz`
- CI: typecheck, lint, test, audit, secret scan

**Database.** None.

**Tests.** Config validation rejects bad input; correlation id propagates; health endpoints respond; **a lint rule violation fails the build**.

**Acceptance**
- [ ] `pnpm build`, `lint`, `typecheck`, `test` all pass
- [ ] An import crossing a module boundary **fails the build**
- [ ] A hardcoded product slug **fails the build**
- [ ] Startup fails on missing configuration, on **both** tiers
- [ ] Every log line carries a correlation id
- [ ] **Contrast script passes over every token pair** (`docs/design/10` §9.1)
- [ ] **CSP nonce present; no `unsafe-inline`; the app hydrates** — verifies D-2
- [ ] Theme switches with no flash of the wrong theme
- [ ] `(admin)` bundle is absent from a customer-session page load

---

## Phase 2 — Database foundation

**Goal.** Full schema, migrations, typed query layer, tenant-scoping primitives.

**Dependencies.** Phase 1; **a reachable Postgres**.

**Deliverables**
- Kysely instance, generated types, transaction helper
- Forward-only migrations in the order of `17` §5.2: `citext` extension → database roles → tables → **composite integrity guards (§13.1)** → RLS policies → audit privilege revocation
- Branded `OrgScope`; repository base enforcing it (ADR-012)
- `membership_products`, `invitation_products` per ADR-018
- `audit` module (append-only writer); `outbox` module (enqueue)
- Test harness with per-test transaction rollback

**Database.** Everything in `04-erd.md`.

**Tests**
- Every migration applies to an empty database and is idempotent
- **Composite guards reject cross-tenant and cross-product rows** — each guard in §13.1 tested individually
- A plan from another product cannot be attached to a subscription (review R-5)
- `memberships.default_branch_id` cannot reference another tenant's branch
- Partial unique indexes hold: one primary branch, one live subscription per `(org, product)`
- `audit_logs` rejects `UPDATE` and `DELETE` from `app_role`
- RLS blocks a query without tenant context
- A scope-less repository call **does not compile** (type-level test)

**Acceptance**
- [ ] Schema matches `04-erd.md` exactly
- [ ] All composite guards verified
- [ ] RLS active on every `organization_id` table; views use `security_invoker`
- [ ] Audit append-only verified at the database level
- [ ] Migration runtime measured on a seeded dataset

---

## Phase 3 — Identity and authentication

**Goal.** Central identity with OIDC-conformant endpoints.

**Dependencies.** Phase 2.

**Deliverables**
- argon2id credentials; `algorithm` recorded for transparent rehash
- Registration, email verification, login, logout
- Sessions; `refresh_tokens` with per-family rotation (ADR-017)
- Access tokens via `jose`; `jwks_keys` with rotation and the `retiring` overlap
- OIDC: discovery, JWKS, `/authorize` (PKCE), `/token`, `/userinfo`, `/revoke`, `/introspect`, `/end-session`
- Password reset; rate limiting on auth endpoints
- `mfa_factors` schema in place, flow seam present, mechanism not enabled

**APIs.** `13` §9.1, §9.2.

**Tests**
- Password hashing and verification; rehash on parameter change
- **Refresh reuse revokes the entire family and raises an alert** (ADR-017) — including reuse of a token several generations old, which is the case the original design missed
- **Enumeration resistance**: identical responses and comparable timing for unknown vs known email, on login, register and reset
- Lockout indistinguishable from a wrong password
- **OIDC conformance suite** (ADR-003 constraint 6)
- Redirect URI exact matching; a wildcard is rejected
- PKCE required; `plain` refused
- Reset token single-use; reset revokes all sessions
- Key rotation does not invalidate tokens signed by a `retiring` key

**Acceptance**
- [ ] OIDC conformance passes
- [ ] No plaintext token or secret is stored anywhere
- [ ] Token family reuse detection works across generations
- [ ] No endpoint reveals whether an email exists

---

## Phase 4 — Organizations, branches, memberships

**Goal.** Tenancy with structurally enforced isolation.

**Dependencies.** Phase 3.

**Deliverables**
- Organization CRUD and lifecycle state machine
- Branches, with the one-primary constraint
- Memberships (`active`/`suspended`/`removed` — **no `invited`**, review R-3)
- Invitations with `invitation_roles`; seat reservation deferred to Phase 10
- Organization context middleware; organization selection and switching
- Last-owner protection

**APIs.** `13` §9.3–9.5.

**Tests**
- **Tenant isolation per resource**: Org A cannot read, write, list or enumerate Org B
- Cross-tenant access returns **404, not 403**
- Last owner cannot be removed, suspended or demoted
- Multi-organization membership: independent roles, one active context
- Organization switching mints a new token; the old one cannot reach the new tenant
- Suspension revokes sessions immediately
- Removal releases all seats (verified fully in Phase 10)

**Acceptance**
- [ ] Isolation tests pass for every organization-owned resource
- [ ] Organization context never read from a request body
- [ ] State machine rejects illegal transitions

---

## Phase 5 — RBAC

**Goal.** Server-side authorization with escalation prevention.

**Dependencies.** Phase 4.

**Deliverables**
- Permission catalog seeded by migration
- System roles (platform and organization); custom organization roles
- `membership_roles`, `platform_role_assignments` with mandatory grantor
- Permission resolution service; `perm_digest`
- Authorization middleware; declarative route config
- **Startup assertion: a route without a permission declaration fails to boot**
- Escalation controls (`07` §6)

**APIs.** Permission enforcement across all existing endpoints.

**Tests**
- Resolution: union across roles; no deny semantics
- **Default deny**: an undeclared route fails at startup
- **Superset rule**: a granter cannot assign permissions they lack
- No self-grant
- `is_system` roles immutable
- Platform grants require `platform.roles.grant`
- Assignment-scoped staff roles see only assigned organizations
- Role edits take effect **immediately** — a demoted user loses access on the next request, not on token expiry

**Acceptance**
- [ ] Every route declares a permission
- [ ] All escalation tests pass
- [ ] Authorization is never evaluated client-side

---

## Phase 6 — Product registry

**Goal.** Products as data (ADR-013).

**Dependencies.** Phase 5.

**Deliverables**
- Products CRUD; status and visibility
- Features with `enforced_by`, `countable_resource`, `countable_scope`
- `product_discovery_sections`
- OIDC client registration per product
- Product permission registration

**APIs.** `13` §9.6.

**Tests**
- Visibility honored: `hidden` never reaches a customer
- Slug immutable after creation
- `features` CHECK constraints enforced
- **A fictional product registered via API appears everywhere with no code change**

**Acceptance**
- [ ] No product slug appears in any conditional
- [ ] A product is onboardable entirely through the API

---

## Phase 7 — Plans and features

**Goal.** Limits as configuration (ADR-010).

**Dependencies.** Phase 6.

**Deliverables**
- Plans CRUD; tier ordering; `grandfathered` status
- `plan_features` with `limit_value` (NULL = unlimited)
- Limit resolution service: override → plan → not included
- Cross-product guard: a plan's features must belong to the plan's product

**APIs.** `13` §9.7.

**Tests**
- Resolution order correct
- **NULL means unlimited**; no sentinel treated as a number
- A missing row means **not included**, never unlimited
- A plan cannot include another product's feature
- **No numeric limit appears in source** — verified by a grep-style test

**Acceptance**
- [ ] Limits changeable without a deployment
- [ ] Not-included and zero behave differently

---

## Phase 8 — Subscriptions

**Goal.** Per-product subscription lifecycle.

**Dependencies.** Phase 7.

**Deliverables**
- Subscription CRUD; the state machine of `09` §4
- `subscription_events` history
- `subscription_overrides` with mandatory reason and grantor
- Trials as `trialing` status (ADR-007)
- Scheduled jobs: trial expiry, period expiry, grace exhaustion, override expiry
- Single-leader dispatcher with the advisory lock

**APIs.** `13` §9.8.

**Tests**
- One live subscription per `(org, product)` — enforced by index
- Illegal transitions rejected
- **A plan change cannot cross products** (review R-5)
- Overrides require reason and grantor
- Every scheduled job is **idempotent**
- Only one dispatcher leads at a time
- `grandfathered` plans keep working for existing subscribers

**Acceptance**
- [ ] The access-granting status list exists in exactly one place
- [ ] Jobs are safe to run twice

---

## Phase 9 — Entitlements

**Goal.** The single access decision.

**Dependencies.** Phase 8.

**Deliverables**
- `v_organization_products` with the review R-6 corrections
- Entitlement service: `check`, `checkForMember`, `listForOrganization`
- Entitlement middleware
- Enforcement at all points in `08` §4, **including token refresh**

**APIs.** `13` §9.9.

**Tests**
- All seven access states produced correctly
- **`expired` is reachable** (the original view made it dead code)
- **A lapsed trial reports `expired`, not `not_subscribed`**
- Organization status dominates all subscriptions
- **Expiry is evaluated, not awaited** — a past `trial_ends_at` denies before the sweeper runs
- **Suspension takes effect on token refresh**
- Entitlement and permission block **independently** (ADR-015)
- Decisions are not cached across requests
- Cross-tenant entitlement reads blocked

**Acceptance**
- [ ] One implementation of the decision; no duplication
- [ ] Suspension is effective within one token lifetime for active clients

---

## Phase 10 — Product seats and limit enforcement

**Goal.** Race-safe seat enforcement (ADR-011, ADR-018). **The most security-critical phase.**

**Dependencies.** Phase 9.

**Deliverables**
- `membership_products` grant/revoke
- `invitation_products` seat reservation at invitation time
- Seat counting per ERD §4.6 (grants + pending invitations)
- **Transactional enforcement**: lock → resolve → count → compare → insert
- Lock target from `countable_scope`: subscription row or organization row
- Deterministic multi-product lock ordering
- Branch limit as MAX across subscriptions
- Over-provisioning handling (`09` §5.2)
- 409 responses carrying upgrade options

**APIs.** Seat endpoints in `13` §9.4; branch creation in §9.5.

**Tests — the critical set**
- **Concurrency: simultaneous grants cannot exceed the limit.** A sequential test passes against the broken implementation and is not sufficient evidence
- **Deadlock freedom**: crossed concurrent multi-product invitations complete
- Pending invitations occupy seats; expiry and revocation release them
- **Suspended members retain seats**: suspend → add → unsuspend cannot exceed
- Membership removal releases all seats atomically
- `inactive` branches still count
- Branch limit is the **MAX**; adding a cheaper product never reduces it
- Downgrade blocks new grants, revokes nothing, reports the overage
- Seats cannot be granted on an unentitled product
- 409, not 403, with upgrade options

**Acceptance**
- [ ] **The concurrency test passes and is in CI**
- [ ] No limit bypass via API, concurrency, suspension cycling, or invitation flooding
- [ ] Lock wait time instrumented

---

## Phase 11 — Product launcher

**Goal.** Backend-computed, data-driven launcher.

**Dependencies.** Phase 10.

**Deliverables**
- UX per `docs/design/07-product-launcher-ux.md`
- `GET /me/products` with `accessState` and server-computed `canOpen`
- `POST /me/products/{slug}/open` with re-authorization
- Launcher UI; My Products / Explore grouping; search; categories
- All states from `11` §8

**Tests**
- `canOpen` is the full conjunction
- **`appUrl` is absent when access is denied**, not merely hidden
- The open is **re-authorized**, not trusted from the payload
- A registered fictional product appears with no code change
- Every empty and error state renders; a fetch failure never shows an empty grid

**Acceptance**
- [ ] No product-specific code in the launcher
- [ ] A new product appears on registration alone

---

## Phase 12 — Discovery and conversion

**Goal.** Non-subscribed products convert (baseline §14, §39).

**Dependencies.** Phase 11.

**Deliverables**
- UX per `docs/design/07-product-launcher-ux.md` §6; **server-rendered** (ADR-019)
- Public discovery pages from registry data
- Demo / contact / trial / upgrade requests
- `source` tracking, including `limit_reached`
- Plan comparison

**APIs.** `13` §9.6 public routes.

**Tests**
- Public pages reachable unauthenticated for `public` products only
- `private` and `hidden` products are not publicly reachable
- Anonymous requests captured with null organization
- `limit_reached` source recorded from a 409 flow

**Acceptance**
- [ ] Discovery content editable without a deployment
- [ ] High-intent requests distinguishable

---

## Phase 13 — Customer accounts

**Goal.** Company-side relationship management (baseline §21).

**Dependencies.** Phase 12.

**Deliverables**
- `customer_accounts`; lifecycle stage, health score
- `customer_account_assignments` with one-primary-per-relationship
- Assignment-scoped visibility for scoped staff roles
- Product request queue

**APIs.** `13` §9.11.

**Tests**
- Scoped staff see only assigned organizations — **enforced server-side**
- One primary per relationship
- Queue sorts by intent

**Acceptance**
- [ ] Least privilege holds for scoped roles

---

## Phase 14 — Admin console

**Goal.** The internal dashboard (baseline §27–29).

**Dependencies.** Phase 13.

**Deliverables.** Every screen in `18-admin-console-architecture.md`, as the `(admin)` route group bundle, following the UX patterns in `docs/design/08-admin-console-ux.md`.

**Tests**
- Navigation driven by permissions
- Destructive actions require typed confirmation
- Unlimited renders as "Unlimited"; not-included differs from zero
- Over-limit, override and trial-expiring states surfaced
- No client-side authorization
- Admin bundle is not served to customer sessions

**Acceptance**
- [ ] A product is fully onboardable through the console
- [ ] Every screen's empty and error states implemented

---

## Phase 15 — Usage

**Goal.** Entitlement counters and product reporting, kept separate.

**Dependencies.** Phase 14.

**Deliverables**
- `usage_counters` with `period_key`
- `product_usage_reports` with idempotency
- Usage views; seat utilization

**APIs.** `13` §9.10.

**Tests**
- Duplicate reports collapse on idempotency key
- **Reported metrics never affect an access decision**
- Concurrent-count resources counted live, not from counters

**Acceptance**
- [ ] The two usage kinds are separate in data and UI

---

## Phase 16 — Audit

**Goal.** Complete, queryable, immutable trail.

**Dependencies.** Phase 15.

**Deliverables**
- Audit coverage for every category in `15` §10
- Denormalized actor and resource labels
- Organization-facing audit view including staff actions
- Correlation id surfaced

**APIs.** `13` §9.12.

**Tests**
- Every mutating endpoint writes an audit record **in the same transaction**
- **Denials are recorded**
- Labels survive subject deletion
- S3 absent and S2 redacted in `changes`
- Staff actions visible in the customer's own view
- `UPDATE`/`DELETE` rejected

**Acceptance**
- [ ] No mutation occurs unaudited
- [ ] Trail is immutable at the database level

---

## Phase 17 — Product integration

**Goal.** A real product can integrate using only `12-product-integration-contract.md`.

**Dependencies.** Phase 16; Docker for the reference product.

**Deliverables**
- Webhook delivery with HMAC signing, retry, dead-letter
- Client credentials for server-to-server
- Product health polling
- **A reference product** implementing the contract end to end
- Published `packages/contracts`

**Tests**
- Webhook signature verification; idempotent handling
- Dead-letter alerting
- Reference product completes both baseline §37 entry paths
- Reference product **fails safe** when the Control Plane is unreachable
- Missed webhook does not leave a suspended customer served — the periodic check catches it

**Acceptance**
- [ ] The reference product integrates with no access to Control Plane internals
- [ ] The contract is sufficient and accurate

---

## Phase 18 — Security hardening

**Goal.** The full checklist in `15` §15.

**Dependencies.** Phase 17.

**Deliverables.** Headers, **CSP verification against design findings D-1 to D-4** (product icons load; app hydrates; no `unsafe-inline`), CORS from registered clients, rate limiting, RLS verification and benchmarking, secret scanning, SAST, dependency policy, redaction verification.

**Tests**
- No S3 field in any response schema, log or error — schema-walking test
- Headers on every response; CSP has no `unsafe-inline`
- RLS blocks unscoped queries; overhead measured
- Full penetration checklist

**Acceptance**
- [ ] Every item in `15` §15 checked
- [ ] RLS cost measured and recorded as an ADR if it changes the plan

---

## Phase 19 — Observability

**Goal.** The system is diagnosable in production.

**Dependencies.** Phase 18.

**Deliverables.** OTel exporter wired; metrics from `16` §4; dashboards; alert rules with runbooks. **Frontend CI gates**: axe on every component and route, contrast script over every token pair, chart-palette validator, performance budgets (`docs/design/11` §9.1).

**Acceptance**
- [ ] A request id resolves to logs, trace, audit and emitted events
- [ ] Every critical alert names a runbook
- [ ] Event pipeline dashboard detects a stalled dispatcher

---

## Phase 20 — Deployment

**Goal.** Repeatable deploys with tested recovery.

**Dependencies.** Phase 19; Docker.

**Deliverables.** Image, Compose, CI/CD pipeline, migration step, staging, graceful shutdown, backups, PITR.

**Acceptance**
- [ ] Every item in `17` §10 checked
- [ ] **Restore tested**, not assumed
- [ ] Rollback rehearsed
- [ ] Signing keys backed up separately

---

## 2. Definition of Done

Per master prompt §40, a phase is complete only when:

- [ ] Code implemented per the architecture documents
- [ ] Database changes migrated and tested
- [ ] APIs documented in `13-api-specification.md` **before** implementation
- [ ] Authorization enforced server-side
- [ ] Tenant isolation tested
- [ ] Tests written, including the phase's critical cases
- [ ] Edge cases and errors handled
- [ ] Security reviewed
- [ ] Documentation updated
- [ ] Decisions recorded as ADRs
- [ ] Architectural changes recorded in `22-change-log.md`
- [ ] Acceptance criteria pass, with evidence

---

## 3. Highest-risk phases

| Phase | Risk | Mitigation |
|---|---|---|
| **10 — Seats and limits** | A race condition is an exploitable limit bypass with no error | Concurrency tests mandatory; lock waits instrumented |
| **3 — Identity** | A defect compromises every organization | OIDC conformance; vetted libraries only; security review |
| **2 — Database** | A missing guard permits silent cross-tenant corruption | Every composite guard individually tested |
| **9 — Entitlements** | A wrong state gives away product or blocks a customer | All states tested; expiry evaluated not awaited |
| **5 — RBAC** | An escalation path grants cross-tenant access | Every escalation control tested |

---

Next: `20-testing-strategy.md`.
