# 23 — Architecture Validation Gate

The review required by master prompt §29, performed after all documentation was complete and before any implementation. Each of the eleven required checks is answered with the mechanism that satisfies it and the test that proves it — a check answered only by intention is not answered.

This document is an addition to the structure in master prompt §6; the gate needed a recorded outcome.

**Date:** 2026-10-01 · **Scope:** documents 00–22 against Baseline v1.2 · **Preceded by:** review AR-004 (13 findings, 12 corrected) and confirmation AR-005.

---

## 1. Baseline consistency

> Does the design follow the baseline?

| Baseline | Requirement | Mechanism |
|---|---|---|
| §4.2, §41 | Control Plane owns no product business logic | No domain table in the schema; `features.enforced_by` makes the boundary explicit |
| §8, §9 | Multi-organization users, different role each | `memberships` unique on `(user_id, organization_id)`; permissions attach to the membership |
| §11 | Global product registry, no per-org duplication | `products` is global; entitlement is a subscription row |
| §13 | Five product access states | `v_organization_products.access_state` |
| §14 | Non-subscribed products are discoverable, with conversion | `product_discovery_sections`, `organization_product_requests` |
| §16 | Multiple product subscriptions per organization | `subscriptions` unique per `(org, product)` |
| §17, §18 | Plan-defined, server-enforced limits | `plan_features` + transactional enforcement |
| §20 | Company/organization responsibility split | Platform vs organization permission scopes; no org-scope limit endpoint exists |
| §21 | Customer account management | `customer_accounts`, `customer_account_assignments` |
| §22 | User → Membership → Role → Permission | Exactly that chain |
| §23 | Entitlement AND permission both required | ADR-015; now three gates with seats |
| §24 | One central identity, no product credentials | Single `users` table; OIDC |
| §25 | Full request context | Token claims + resolved permissions |
| §26 | Tenant isolation | Four layers (§2) |
| §30 | Usage | Authoritative counters vs informational reports, kept separate |
| §31 | Audit | Append-only, including denials |
| §33 | Modular, not prematurely distributed | ADR-001 |
| §34 | Future service extraction possible | Acyclic module graph; interface-only coupling |

**Three baseline clarifications were required** and are recorded rather than assumed (BL-1.1, BL-1.2): limits are configuration not constants; limits are overridable per customer; a user limit counts per-product seats. Five deferred ambiguities were resolved by ADR (AR-001).

**Verdict: PASS.** No decision contradicts the baseline. Where the baseline was silent, the choice is recorded as an ADR; where it was ambiguous, it was clarified and versioned.

---

## 2. Tenant isolation

> Can organizations access only their own data?

Four independent layers, no single one of which is relied upon:

| Layer | Mechanism | Catches |
|---|---|---|
| 1 | One `org` claim per token | There is nowhere for a second tenant to come from |
| 2 | Branded `OrgScope` required by repository signatures | An unscoped query **does not compile** |
| 3 | Cross-tenant reads only via named, permissioned, audited methods | Makes the dangerous capability visible and singular |
| 4 | Postgres RLS with transaction-local tenant setting | A query that omits its filter |

Reinforcements: cross-tenant resources return **404, not 403** (a 403 confirms existence); composite foreign keys prevent cross-tenant *references* (ADR-016); `set_config(..., true)` keeps the RLS setting transaction-local, since a connection-level setting would leak across a pooled connection.

**Review AR-004 found this check failing in one respect** — composite guards were specified for one table and omitted everywhere else, notably allowing `memberships.default_branch_id` to point at another tenant's branch, a value the Control Plane hands to products as session context. Corrected by ADR-016 and `04-erd.md` §13.1.

Proof: isolation tested **per resource**, generated from the route table so new endpoints are covered automatically (`20` §2.1).

**Verdict: PASS**, after correction.

---

## 3. Product independence

> Does the Control Plane avoid owning product business logic?

| Control Plane holds | Does not hold |
|---|---|
| Identity, organizations, memberships, seats | Orders, tables, payments, stock, suppliers, kitchen queues |
| Products, features, plans, subscriptions | Any product's domain entity |
| Entitlement decisions | Product authorization decisions |
| Seat and branch counts | Product-metered counts (carried, never interpreted) |

**AR-004 found an accidental coupling** (R-7): a single free-text `unit` column mixed `users`/`branches` with `orders_per_month`, so enforcement code would have had to recognize product-specific strings — meaning the Control Plane would know what an order is. Corrected by `enforced_by` plus a **closed** `countable_resource` enum.

Also guarded: `industry`, `category` and `unit` are documented as never driving behavior (data dictionary §10), and product-reported usage can never affect an access decision (it is self-reported, so trusting it would let a product grant itself entitlement).

**Verdict: PASS**, after correction.

---

## 4. Subscription correctness

> Are product entitlements correctly enforced?

Single source of truth (ADR-006): no `organization_products` writable table, no stored entitlement cache. A partial unique index permits one live subscription per `(org, product)`, and it deliberately includes `suspended` so a suspended subscription cannot be bypassed by creating a fresh one beside it.

Enforced at **seven** points, including the two most often omitted: `/authorize` before a code is issued, and **token refresh** — without which a client holding a valid refresh token renews access indefinitely after suspension.

Expiry is **evaluated against the clock, not awaited** from a sweeper job, closing the window in which a lapsed trial is used for free.

**AR-004 found two state-derivation defects** (R-6): the `expired` state was unreachable dead code, so the design could not satisfy baseline §13; and a lapsed trial fell through to `not_subscribed`, erasing the highest-intent conversion moment. Both corrected.

**Verdict: PASS**, after correction.

---

## 5. RBAC correctness

> Can users only perform authorized actions?

Default deny, enforced structurally: **a route without a declared permission fails at server startup**, because the dangerous failure mode of declarative security is the forgotten annotation.

Permissions resolve from the database per request, not from token claims — so a role edit takes effect on the next request rather than at token expiry. The token carries only a digest.

Grants only, no deny rules: the effective set is a union, so there is exactly one answer to "why could this user do that", computable by hand during an incident.

Escalation controls (`07` §6), of which the **superset rule** is the subtle and essential one — without it, the ability to create roles silently becomes the ability to hold any permission.

**AR-004 found a coherence gap** (R-11): `roles` had no CHECK despite two scoping columns, so `scope = 'platform'` with `organization_id` set was representable — incoherent in the table governing cross-tenant privilege. Corrected.

**Verdict: PASS**, after correction.

---

## 6. User limits

> Can subscription limits be bypassed?

Every identified bypass route is closed, and each has a named test:

| Route | Closure |
|---|---|
| **Concurrency** | `FOR UPDATE` on the subscription, then count, then compare, all in one transaction (ADR-011) |
| **Invitation flooding** | Pending invitations occupy seats (ERD §4.6) |
| **Suspension cycling** | Suspended members retain seats |
| Direct API call | Enforcement is server-side, in the use case |
| Client-supplied limit | Field absent from the request schema |
| Expired invitations | Released at **read time**, not by a job |
| Deactivated branches | Still counted |
| Cross-product confusion | Composite guard; per-product counting |
| Multi-product deadlock | Deterministic lock ordering by product id |

**AR-004 found this check failing in two ways.** ADR-011 could not be implemented at all, because the seat dimension was undefined — nothing said *which subscription row to lock* when an organization holds several (R-9, escalated and resolved as ADR-018). And seat occupancy was ill-defined: `memberships.status = 'invited'` was structurally impossible and duplicated the `invitations` table (R-3).

The decisive test: a **concurrency** test, because a sequential test passes against the broken implementation and is therefore not evidence.

**Verdict: PASS**, after correction and the ADR-018 confirmation.

---

## 7. SSO

> Can users move between products without repeated login?

All three baseline §37 paths specified in `06` §6: launcher click-through with no login prompt; direct product URL with the deep link preserved in `state`; and organization selection where a user holds several memberships.

Products verify tokens against cached JWKS with no network call, while asking the Control Plane for entitlement — the division that makes tokens cacheable and revocation immediate simultaneously.

**AR-004 found that ADR-003's own guarantee was undeliverable** (R-8): `sessions.previous_token_hash` detected only last-generation reuse, so a token stolen at generation *N* and replayed after *N+3* was rejected without revoking the family — discarding the clearest evidence of credential theft available. Corrected by ADR-017's per-token family table.

**Verdict: PASS**, after correction.

---

## 8. Product launcher

> Are products dynamically determined?

No product slug, name or id appears in any conditional (ADR-013). State is computed server-side; `canOpen` is a single boolean the client cannot get wrong; `appUrl` is **absent** when access is denied rather than hidden by the UI.

Enforced mechanically rather than by review: a lint rule rejects product-slug literals, and a test registers a fictional product and asserts it appears in the launcher, renders a discovery page and accepts a conversion request **with no code change**.

**AR-004 found `visibility` ignored** by the derivation view (R-6), which would have shown pre-launch `hidden` products in every customer's launcher. Corrected.

**Verdict: PASS**, after correction.

---

## 9. Future products

> Can a new product be added without redesigning the Control Plane?

Onboarding is five data operations — `products`, `features`, `product_discovery_sections`, `plans` + `plan_features`, `oidc_clients` — all available through the admin console (`18` §6.2).

Zero changes to: launcher, discovery, entitlement engine, RBAC engine, API surface, or schema.

The property that makes this hold under pressure is `features.enforced_by`: a product with exotic metering needs no Control Plane change, because the Control Plane never interprets its units — it carries them as data.

**Verdict: PASS.**

---

## 10. Scalability

> Can the architecture scale?

Every pressure point has a response reachable without redesign, because each sits behind an interface:

| Pressure | Response |
|---|---|
| Request throughput | More stateless instances |
| Read load | Replica, then partition by organization |
| Session latency / rate-limit contention | Redis, swapped behind existing interfaces (ADR-008) |
| Event volume | Broker fed by the same outbox (ADR-009) |
| Audit growth | Monthly range partitioning — the time-ordered PK and time-leading indexes are already shaped for it |
| Module ownership | Extraction along the acyclic graph (ADR-001) |

The acyclic module rule is what keeps extraction real: the first cycle admitted is the moment the modular monolith quietly becomes a monolith.

**One deliberate exclusion:** entitlements is not an extraction candidate. It is the hottest read path and the most security-critical decision; splitting it across a network would add latency to every request and a failure mode to every access decision.

**Verdict: PASS**, with the honest caveat that no measurement exists yet. The headroom is architectural, not demonstrated — RLS overhead in particular will be benchmarked in Phase 2 and recorded as an ADR with numbers rather than assumed either way.

---

## 11. Security

> Are critical security boundaries enforced server-side?

| Boundary | Server-side mechanism |
|---|---|
| Authentication | OIDC authorization server; argon2id; no client-side trust |
| Authorization | Middleware + resolution per request; UI hides, server decides |
| Tenant isolation | Four layers (§2) |
| Entitlement | Per-request check, including on refresh |
| Limits | Transactional with row locks |
| Audit | Append-only at the database level |
| Secrets | S3 never serialized; verified by a schema-walking test |

The frontend holds **no** authorization, limit arithmetic or entitlement derivation. Every mutation is authorized on arrival whether or not the UI offered it.

**Verdict: PASS.**

---

## 12. Gate summary

| # | Check | Verdict | Corrections required |
|---|---|---|---|
| 1 | Baseline consistency | ✅ PASS | 3 clarifications, 5 ADR resolutions |
| 2 | Tenant isolation | ✅ PASS | R-5 (composite guards) |
| 3 | Product independence | ✅ PASS | R-7 (unit coupling) |
| 4 | Subscription correctness | ✅ PASS | R-6 (unreachable state, lapsed trial) |
| 5 | RBAC correctness | ✅ PASS | R-11 (role coherence) |
| 6 | User limits | ✅ PASS | R-3, R-9 (seat definition, dimension) |
| 7 | SSO | ✅ PASS | R-8 (token families) |
| 8 | Product launcher | ✅ PASS | R-6 (visibility) |
| 9 | Future products | ✅ PASS | — |
| 10 | Scalability | ✅ PASS | — (unmeasured, stated) |
| 11 | Security | ✅ PASS | — |

**Thirteen defects were found and corrected before any code was written.** Two would have failed on first migration run; four would have shipped as silent wrong behavior in limit enforcement, tenant isolation, launcher state and domain coupling; one escalated a business-model question the architect could not assume.

---

## 13. Outstanding items

Nothing blocks implementation. These are tracked, not open:

| Item | Status | Resolved in |
|---|---|---|
| PostgreSQL reachable, `citext` available | **Environment prerequisite** | Before Phase 2 completes |
| Docker + Compose installed | **Environment prerequisite** | Before Phase 20 |
| RLS overhead | To be measured, then recorded as an ADR | Phase 2 |
| Payment provider | Deferred by baseline §39 | ADR-D1 |
| Object storage | No requirement yet | ADR-D2 |
| Message broker | Outbox suffices | ADR-D3 |
| Kubernetes | Compose suffices | ADR-D4 |
| MFA mechanism | Schema and flow seam ready | ADR-D5 |

---

## 14. Implementation gate

Master prompt §30's conditions:

- [x] Baseline understood — and clarified to v1.2 where ambiguous
- [x] Repository audit complete
- [x] ERD complete, reviewed, corrected
- [x] HLD complete
- [x] Identity architecture complete (ADR-003 evaluated both options)
- [x] RBAC complete, including the deferred branch model (ADR-014)
- [x] Entitlements complete
- [x] Subscription model complete, including the seat dimension (ADR-018)
- [x] Product integration contract complete
- [x] API architecture complete
- [x] Security architecture complete
- [x] Implementation plan complete
- [x] **Architecture validation passes**

## 🟢 Implementation may begin — Phase 1

Phase 1 (project foundation) requires no database and is unblocked immediately. Phase 2's integration tests need a reachable PostgreSQL.
