# 01 — Repository Audit

**Date:** 2026-10-01
**Auditor:** Architecture phase, pre-implementation
**Repository root:** `D:\own_system`

---

## 1. Method

The audit inspected the full working directory tree (no `node_modules`, no VCS directory present), and probed the local toolchain for installed runtimes, package managers, databases and container tooling. Nothing in this document is assumed; every statement below is the result of a direct observation. Where a capability is absent, it is recorded as absent rather than inferred.

---

## 2. Finding: the repository is greenfield

The complete contents of the repository at audit time:

```text
D:\own_system
└── doc.md          (28,479 bytes)  — Company Central Control Plane, System Baseline v1.0
```

There is **no source code of any kind**. Consequently the following sections of the master prompt's audit checklist have the same answer — *does not exist yet*:

| Audit area | Finding |
|---|---|
| Package manager | None configured. No `package.json`, lockfile, or workspace manifest. |
| Framework | None. |
| Language | None. Only Markdown prose exists. |
| Folder structure | Flat; a single document at the root. |
| Existing applications | None. |
| Existing APIs | None. |
| Database | None. No schema, no migrations, no ORM, no connection configuration. |
| Environment configuration | None. No `.env`, `.env.example`, or config module. |
| Authentication | None. |
| Deployment configuration | None. |
| Docker configuration | None. No `Dockerfile`, no `compose.yaml`. |
| CI/CD | None. No `.github/`, no pipeline definition. |
| Testing setup | None. No test runner, no test files. |
| Linting | None. |
| Formatting | None. |
| Shared packages | None. |

### 2.1 Not a git repository

The working directory is **not** under version control. `git` is installed (2.55.0) but no repository has been initialized here. This is a gap to close in implementation Phase 1: without version control there is no history, no review mechanism, and no safe rollback — all of which the Definition of Done depends on.

---

## 3. Local toolchain inventory

Probed directly on the development machine (Windows 11, win32):

| Tool | Status | Version |
|---|---|---|
| Node.js | present | 24.18.0 |
| npm | present | 11.16.0 |
| pnpm | present | 11.25.0 |
| Bun | present | 1.4.2 |
| Yarn | absent | — |
| git | present | 2.55.0.windows.2 |
| Docker | **absent** | — |
| Docker Compose | **absent** | — |
| PostgreSQL client (`psql`) | **absent** | — |
| Redis (`redis-server`) | **absent** | — |
| Python | absent | — |

### 3.1 What the toolchain implies

**Node.js 24 with pnpm is the natural stack.** Node 24 is a current LTS-line runtime with stable `node:test`, native TypeScript type-stripping, and modern ESM. pnpm 11 is installed and is the strongest choice for the monorepo this platform needs — content-addressed store, strict dependency isolation (a package cannot import what it did not declare), and first-class workspace support. Bun is also present and is attractive for speed, but its ecosystem compatibility for production Postgres drivers, migration tooling and OpenTelemetry is less proven than Node's; it is a reasonable local test accelerator, not the production runtime. This is recorded as **ADR-002**.

**The absence of Docker is the single most consequential environment finding.** The baseline (§33) names PostgreSQL, Redis and object storage as shared infrastructure. None of them is installed, and the usual answer — run them as containers — is unavailable on this machine today. This has three implications:

1. The architecture must not *require* Docker in order for a developer to run tests. Database-backed integration tests need a path that works against a managed/remote Postgres or a locally installed one, selected by connection string alone.
2. Docker and Compose remain the correct **deployment** target and will be specified in `17-deployment-architecture.md`, but installing them is a developer-environment prerequisite, not an architectural assumption.
3. Until Postgres is reachable, implementation can proceed through the domain and application layers (which must be pure and dependency-inverted so they are testable without a database) but cannot complete repository-layer integration tests. This ordering constraint is carried into `19-implementation-plan.md`.

**Redis is not needed on day one.** It is absent locally, and the baseline lists it as *may include*. Sessions, rate limiting and caching can all be served correctly by PostgreSQL at the scale of an early multi-tenant platform, behind interfaces that allow a later swap. Introducing Redis before there is load to justify it would violate the master prompt's §38 directive. Recorded as **ADR-008**.

---

## 4. Existing reusable components

**None.** There is no code to preserve, no technical debt to pay down, and no existing implementation that could conflict with the baseline. This is the cleanest possible starting position: every architectural decision is a free choice, constrained only by the baseline document and by the toolchain above.

---

## 5. Audit of the baseline document itself

Since the baseline is the only existing artifact, it is the proper subject of the audit. It is substantially complete and internally consistent. The following are points requiring architectural resolution rather than defects — each is carried into the document named.

### 5.1 Resolved during this audit

**R1 — Plan limits are examples, not fixed values.** Baseline §17/§18 state "Users: 2", "Maximum Users = 2". Confirmed with the product owner: these are illustrative only. Limits are **per-plan configuration data, set commercially per customer**, not constants in the architecture. The data model must therefore store limits as rows, support per-subscription overrides for negotiated deals, and never hardcode a numeric ceiling anywhere in code. Carried into `09-plans-and-subscriptions.md`, enforced as a rule in `05-data-dictionary.md`, and the baseline is annotated accordingly in `22-change-log.md` (BL-1.1).

### 5.2 Open items the baseline defers to later phases

These are listed by the baseline itself (§44, "Intentionally Not Finalized Yet") and are each assigned an owning document:

| Deferred item | Resolved in |
|---|---|
| Exact database columns, ERD | `04-erd.md`, `05-data-dictionary.md` |
| Authentication provider, OAuth/OIDC, token strategy | `06-identity-and-sso.md`, ADR-003/004/005 |
| Billing provider, payment architecture | `09-plans-and-subscriptions.md` (metadata only; provider deferred) |
| Event contracts / Kafka | `14-event-architecture.md`, ADR-009 |
| API gateway | `13-api-specification.md`, `17-deployment-architecture.md` |
| Deployment architecture | `17-deployment-architecture.md` |
| Frontend architecture, design system | `03-hld.md`, `18-admin-console-architecture.md` |
| Product integration contracts | `12-product-integration-contract.md` |

### 5.3 Ambiguities needing an architectural decision

**A1 — Branch-level permissions.** §10 explicitly defers the branch permission model to RBAC design. Decision required: whether a membership is scoped to specific branches, or to the whole organization with branch as a filter. Resolved in `07-rbac-and-authorization.md`.

**A2 — `subscriptions` vs `organization_products`.** §35 lists both tables. They overlap: a subscription already identifies an organization and a product. Carrying both invites drift, where the two disagree about whether a product is active. Resolved in `04-erd.md` by making the subscription the single source of truth, with any `organization_products` concern expressed as a derived read model rather than a second writable table.

**A3 — Company users and organization users in one table or two.** §5 defines two user categories with different role scopes. Decision: one `users` table (one human, one identity, one credential) with scope expressed through membership — a company staff member holds a platform-scoped assignment, a customer user holds organization-scoped memberships. Two tables would mean two credential stores, which §24 forbids. Resolved in `06-identity-and-sso.md` and `07-rbac-and-authorization.md`.

**A4 — Trial ownership.** §13 lists Trial as a product access state, but §15's chain (Organization → Subscription → Plan) does not say whether a trial is a subscription with a trial status or a separate entity. Decision: a trial is a subscription in `trialing` status with an end timestamp — one lifecycle, one enforcement path. Resolved in `08-product-entitlements.md`.

**A5 — Usage semantics.** §30 mixes two different things: product-domain counters (POS orders: 12,430) which the Control Plane does not own per §4.2, and entitlement counters (users 2/2, branches 3/5) which it must own to enforce limits. Conflating them would pull product business logic into the Control Plane. Decision: entitlement counters are authoritative Control Plane state; product-domain counters are *reported* figures, write-only from the product's side, used for analytics and never for access decisions. Resolved in `04-erd.md` and `12-product-integration-contract.md`.

---

## 6. Architecture gaps to be closed before implementation

1. No version control — initialize git, define branch and commit conventions.
2. No project scaffold — monorepo layout, TypeScript configuration, strict compiler settings.
3. No database — schema, migration tool, connection management, tenant-scoping strategy.
4. No identity — the largest single subsystem; see ADR-003.
5. No authorization enforcement layer — must be server-side middleware, per baseline §26 and master prompt §35.
6. No test harness — required by the Definition of Done for every feature.
7. No CI — required to make the Definition of Done enforceable rather than aspirational.
8. No observability — structured logging and request correlation must be present from the first endpoint, not retrofitted.

---

## 7. Conclusion

The repository contains a complete, high-quality baseline specification and nothing else. There is no legacy code, no conflicting implementation, and no technical debt. The local toolchain supports a Node 24 + TypeScript + pnpm monorepo immediately; PostgreSQL and Docker must be provisioned before database-backed integration tests and deployment work can complete, and the architecture is being shaped so that this absence blocks as little work as possible.

Proceeding to `02-system-overview.md`.
