# 21 — Architecture Decision Records

Each record states a decision, the reasoning behind it, the alternatives that were genuinely considered, and the consequences — including the costs the decision accepts. Records are append-only. A decision that is later reversed gets a new record that supersedes the old one; the original is never edited away, because the reasoning that was once persuasive is evidence about how the team thinks.

**Status values:** Accepted · Superseded by ADR-nnn · Deferred

---

## ADR-001 — Modular monolith, not microservices

**Status:** Accepted

**Decision.** The Control Plane is built as a single deployable application composed of strictly-bounded internal modules (identity, organizations, RBAC, product registry, plans, subscriptions, entitlements, usage, audit). Modules communicate through explicit, typed service interfaces — never by reaching into one another's tables.

**Reason.** The baseline (§33) asks for this directly, and the master prompt (§38) forbids distributed complexity without justification. None of the usual justifications for separate services exists yet: there is one team, no independent deployment pressure, no divergent scaling profile, and no module whose failure must be isolated from the rest. A microservice split now would buy network calls, distributed transactions and operational overhead in exchange for boundaries that module structure already provides.

**Alternatives considered.** Microservices from day one — rejected: it converts in-process function calls into failure-prone network hops, and would require a distributed transaction to do something as ordinary as "create organization, create owner membership, start trial". A single unstructured application — rejected: without enforced module boundaries, the later extraction the baseline requires (§34) becomes impossible.

**Consequences.** Cross-module access must be disciplined, and that discipline needs mechanical enforcement, not good intentions: module boundaries are enforced by lint rules and by pnpm's strict dependency isolation, so an undeclared import fails the build rather than passing review. Each module owns its tables; foreign keys crossing module lines are permitted only toward stable identity tables (`users`, `organizations`, `products`). Any module can later become a service, because its interface is already the only way in.

---

## ADR-002 — Node 24 + TypeScript (strict) + pnpm workspaces

**Status:** Accepted

**Decision.** TypeScript in strict mode on Node.js 24, in a pnpm workspace monorepo.

**Reason.** The master prompt (§32) asks for TypeScript and strong typing. Node 24 and pnpm 11 are already installed (see `01-repository-audit.md`), so this is the path of least environmental friction. pnpm's strict linking is a correctness tool here, not just a disk-space optimization: it makes ADR-001's module boundaries structurally real.

**Alternatives considered.** Bun as the production runtime — it is installed and faster, but its compatibility with production Postgres drivers, migration tooling and OpenTelemetry instrumentation is less proven; the risk is not worth the startup-time saving for a server process that starts once. npm workspaces — adequate, but lacks pnpm's strict isolation, so it cannot enforce module boundaries.

**Consequences.** `strict: true`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are on from the first commit; retrofitting strictness is far harder than starting with it. `any` is lint-banned except at genuinely untyped boundaries, where it must be narrowed by a validator immediately. Bun may still be used as a local test runner where it is faster.

---

## ADR-003 — In-house OIDC-conformant authorization server, not an external IdP

**Status:** Accepted

This is the most consequential decision in the platform, and it was evaluated against the project's actual requirements rather than general preference. The evaluation is recorded in full because a future reader needs to be able to check whether the reasoning still holds.

### The requirements being evaluated against

From the baseline: central identity with one credential per human (§24); SSO across multiple independently-deployed products (§24, §37); users belonging to **multiple organizations with different roles in each** (§8, §9); RBAC resolved per organization (§22); product entitlement evaluated per organization per product (§23); subscription limits enforced server-side (§18); every request resolving a full context of user + organization + role + product + permissions + branch (§25); and tenant isolation as an absolute rule (§26).

The decisive characteristic is this: **authentication is the small part.** Verifying a password and issuing a token is perhaps 10% of what this system's "login" must accomplish. The other 90% — which organization is this session acting as, what does this membership permit, is the product entitled, has the plan's limit been reached — is Control Plane domain logic that lives in the Control Plane's own database no matter which component checks the password.

### Option A — External identity provider (Keycloak, Ory Hydra/Kratos, Auth0, Clerk)

**What it genuinely gives.** A battle-tested implementation of the parts that are dangerous to write: password hashing and reset flows, brute-force lockout, TOTP and WebAuthn MFA, token issuance and rotation, JWKS and key rollover, and — significantly for a B2B SaaS — enterprise SAML/social federation, which customers eventually ask for and which is tedious to implement well. Security patches arrive from a vendor or community rather than from this team. For social login and enterprise SSO *into* the platform, this is a real and lasting advantage.

**Where it fits this project badly.** Four specific frictions, in order of severity:

1. **The multi-organization model does not map onto IdP primitives.** Keycloak's realms and Auth0's organizations assume a user belongs to one tenant, or that multi-tenancy means separate realms. This platform's model is the opposite: one user, one credential, many memberships, a different role in each (§8). Expressing that in an external IdP means either duplicating membership data into the IdP — creating two sources of truth for the single most security-critical relationship in the system — or keeping membership in the Control Plane and treating the IdP as a bare authenticator. The second is the honest arrangement, and it reduces the IdP to roughly the 10% noted above.

2. **Authorization data cannot live in the token issuer.** Permissions derive from membership, role, plan entitlement and current usage. All of that is Control Plane data. An external IdP would need to call back into the Control Plane during token minting to embed it — adding a synchronous dependency in the hottest path, in the wrong direction. Alternatively the token carries only identity and the Control Plane resolves authorization itself, which is the correct design and again reduces the IdP's role.

3. **Entitlement state changes must invalidate access immediately.** When the company suspends an organization or a subscription expires, access must stop. Externally-issued JWTs are valid until expiry; honoring immediate revocation requires either very short lifetimes (pushing load back onto the IdP) or a Control-Plane-side check on every request. The latter is needed regardless — which means the Control Plane owns the authoritative access decision either way.

4. **Operational cost against current environment.** Docker is not installed on the development machine (`01-repository-audit.md` §3). Keycloak or Ory as a local dependency means every developer must run a container before authenticating, and CI must orchestrate it. A hosted service (Auth0, Clerk) avoids that but adds per-MAU cost that scales with exactly the growth this platform is built for, plus a vendor dependency on the login path of every product in the ecosystem.

### Option B — In-house authorization server, OIDC-conformant

**What it gives.** The token issuer sits inside the system that owns organizations, memberships, roles and entitlements, so the org-scoped access token can be minted in one transaction against authoritative data with no cross-service callback. Organization switching — a core flow (§25) — becomes an ordinary domain operation. Revocation is immediate because the issuer owns the session table. No new infrastructure, which matters given the Docker gap. No per-user cost.

**What it costs, stated plainly.** This team becomes responsible for credential handling, session fixation and rotation, token replay, timing attacks, reset-token entropy and single-use semantics, and key rollover. These are solved problems, but only if the solutions are actually applied. Writing an authorization server badly is a severe outcome: it is the one component where a defect compromises every organization at once.

**Why the cost is acceptable and bounded.** The surface is narrow and well-mapped. It is not a general-purpose IdP — it serves first-party products the company itself deploys, so the only grant types required are authorization code with PKCE (for product SSO) and refresh token rotation. No implicit flow, no resource-owner password grant, no dynamic client registration, no consent screens for third parties. Every dangerous primitive is delegated to a vetted library rather than written here:

| Primitive | Delegated to |
|---|---|
| Password hashing | `argon2id`, tuned parameters, never a hand-rolled KDF |
| JWT signing, verification, JWKS | `jose` — no manual base64 or signature code |
| Random tokens | `node:crypto` CSPRNG only |
| Constant-time comparison | `crypto.timingSafeEqual` |
| TOTP (when MFA lands) | A maintained library, not hand-rolled HMAC |

What remains in-house is flow orchestration and storage — session rows, token rotation bookkeeping, lockout counters — which is domain logic, not cryptography.

### Decision

**Build the authorization server in-house, strictly conformant to OIDC/OAuth 2.1 at its external contract, and architect it as a replaceable module.**

The deciding argument is that the Control Plane must own the authoritative access decision under every option, because authorization depends on organization, subscription and usage state that only it holds. Given that, an external IdP does not remove the hard part; it adds a network hop, a second source of truth for membership, and an infrastructure dependency, in exchange for password-handling code that a vetted library provides anyway.

**Conformance is what makes this decision safe rather than a bet.** Because the external contract is standard OIDC — discovery document, JWKS endpoint, authorization code + PKCE, standard claims — products integrate against the specification, not against this implementation. If the in-house server is later outgrown, Keycloak or Ory can be placed behind the same contract and products need no change. The reversal cost is deliberately kept low, and it is checked: the integration contract in `12-product-integration-contract.md` is written against the OIDC spec, and a conformance test suite verifies the endpoints match it.

### Constraints this decision binds the implementation to

Non-negotiable; a violation is a release blocker, not a backlog item:

1. Argon2id for passwords. No alternative, no fallback, no "temporarily".
2. All JWT operations through `jose`. No hand-written token parsing anywhere in the codebase.
3. Access tokens short-lived (10–15 min) and **never** the sole basis for an authorization decision — entitlement and organization status are verified server-side per request (§23, §26).
4. Refresh tokens: opaque, stored hashed, single-use with rotation, and reuse of a consumed token revokes the whole family as presumed theft. *(Mechanism specified by ADR-017; the original single-column design could not deliver this and was replaced.)*
5. Sessions server-side and revocable; suspending an organization or expiring a subscription takes effect on the next request.
6. OIDC endpoints conformance-tested against the specification, in CI.
7. The module exposes an `IdentityProvider` interface; no other module imports its internals, so substitution stays mechanically possible.
8. MFA designed for from the start — the schema carries the fields and the login flow carries the step — even if the first release does not enable it.
9. Enterprise SAML/social federation, when a customer requires it, is added as an **upstream federation adapter** to this server rather than by replacing it. This is the pressure most likely to arrive, and this is the planned response.

### Trigger conditions for revisiting

This ADR should be reopened if any of the following becomes true — these are the honest failure conditions, written down now so the decision can be audited later rather than defended:

- Enterprise customers require SAML federation at a volume where maintaining adapters costs more than running Keycloak.
- A compliance regime (SOC 2 Type II, HIPAA) makes a certified third-party IdP materially cheaper to audit than first-party auth code.
- The team loses the capacity to review and patch authentication code promptly.
- Identity becomes a distinct scaling bottleneck from the rest of the Control Plane.

**Consequences accepted.** More code to own in the highest-stakes part of the system, and a standing obligation to review it as security code rather than ordinary feature work. In exchange: one source of truth for identity *and* authorization, immediate revocation, no new infrastructure against a Docker-less development environment, no per-user vendor cost, and a documented, tested, low-cost migration path out.

---

## ADR-004 — Token strategy: short-lived org-scoped JWT access tokens, opaque rotating refresh tokens

**Status:** Accepted

**Decision.** Access tokens are signed JWTs (RS256, rotatable keys via JWKS) with a 10–15 minute lifetime, carrying `sub`, `org_id`, `membership_id`, `branch_id`, and a permissions digest. Refresh tokens are opaque random strings, stored only as hashes, single-use, rotated on each use, scoped to one session family. **An access token's claims never substitute for a server-side entitlement check.**

**Reason.** Products are separately deployed (§32) and must validate tokens without a synchronous call to the Control Plane on every request — JWT with published JWKS achieves that. But a JWT is a snapshot, and entitlement is live state: an organization suspended thirty seconds ago must lose access now (§23). The resolution is that the token proves *who and which organization*, while *may they do this* is resolved against current state. Org-scoping the token is what enforces §26 — a token minted for Organization A is structurally incapable of addressing Organization B's data, so tenant isolation does not depend on a developer remembering a `WHERE` clause.

**Alternatives considered.** Opaque access tokens with introspection on every request — strongest revocation, but puts the Control Plane in the hot path of every product request, a single point of failure for the ecosystem. Long-lived JWTs — rejected outright: incompatible with immediate suspension. One token spanning all of a user's organizations — rejected: it makes cross-tenant leakage a one-line bug.

**Consequences.** Organization switching mints a new token rather than mutating one. Products must handle 401 and refresh. A permissions digest (hash, not the full list) keeps tokens small while letting a product detect staleness and re-fetch. Key rotation must be operational before launch, not after.

---

## ADR-005 — One `users` table; scope expressed through membership

**Status:** Accepted

**Decision.** Company staff and customer users are rows in the same `users` table. The distinction is carried by assignment scope: a company user holds a platform-scoped role assignment, a customer user holds organization-scoped memberships. One human, one credential, one identity.

**Reason.** Resolves ambiguity A3 from the audit. Two tables would mean two credential stores and two login flows, which §24 forbids; it would also break the real case of a company employee who is legitimately a member of a test organization. Scope-as-data also means the permission checking code has exactly one shape.

**Consequences.** Every authorization check must establish scope explicitly — platform-scoped or organization-scoped — and the default must be deny. A platform-scoped assignment is dangerous by construction, so its creation is audited, requires elevated permission, and is never self-grantable. "Is this user company staff?" is a query against assignments, never a boolean column that could drift.

---

## ADR-006 — Subscription is the single source of truth for product access

**Status:** Accepted

**Decision.** Entitlement is derived from the `subscriptions` table. `organization_products` is **not** a second writable table; where a flat view of an organization's products is useful, it is a derived read model or a view, never independently mutable state.

**Reason.** Resolves ambiguity A2. The baseline lists both (§35), but they encode the same fact. Two writable sources for "can this organization use this product" guarantees eventual disagreement, and the failure mode is a security one: an organization retaining access after its subscription lapsed.

**Consequences.** A single `(organization_id, product_id)` unique constraint over active subscriptions prevents duplicate entitlements. Launcher and entitlement queries read from the subscription state machine. Historical subscriptions are retained for audit, so "active" is a status predicate plus a period check, not row existence.

---

## ADR-007 — Trial is a subscription status, not a separate entity

**Status:** Accepted

**Decision.** A trial is a subscription in `trialing` status with `trial_ends_at` set. It traverses the same lifecycle and the same enforcement path as a paid subscription.

**Reason.** Resolves ambiguity A4. A separate trial entity would duplicate limit enforcement, entitlement evaluation and expiry handling — and duplicated enforcement paths diverge, with the weaker one becoming the bypass.

**Consequences.** Every entitlement check treats `active` and `trialing` as granting access, differing only in messaging and expiry handling. Trial-to-paid conversion is a status transition, preserving history and usage continuity.

---

## ADR-008 — PostgreSQL only at the start; no Redis until load justifies it

**Status:** Accepted

**Decision.** PostgreSQL is the only datastore for the initial build — including sessions, rate-limit counters and caching. Redis is deferred behind interfaces (`SessionStore`, `RateLimiter`, `Cache`) that permit a later swap without touching call sites.

**Reason.** Master prompt §38 forbids infrastructure without justification, and the baseline lists Redis as *may include*. Redis is not installed locally and Docker is absent, so requiring it would block development. Postgres handles session lookup and counter increments comfortably at early-platform scale, and one datastore means one backup story, one migration story and one consistency model.

**Consequences.** Session and rate-limit tables need deliberate index design and a scheduled purge of expired rows. The interfaces must be honored from the first commit — introducing Redis later is cheap only if nothing bypassed the abstraction. A documented metric threshold (session-lookup p99, rate-limiter contention) triggers revisiting.

---

## ADR-009 — Transactional outbox, not a message broker

**Status:** Accepted

**Decision.** Domain events are written to an `outbox` table inside the same transaction as the state change that produced them, then delivered by a poller to subscribers (webhooks to products, internal handlers). No Kafka, no RabbitMQ initially.

**Reason.** The events the baseline names (§20 of the master prompt: `SubscriptionActivated`, `OrganizationSuspended`, …) are low-volume and business-critical: losing one must be impossible, while delivering one a second late is harmless. An outbox gives exactly-once *production* with atomicity against the state change — a guarantee a broker cannot provide, since publishing to a broker and committing the transaction cannot be made atomic without this pattern anyway. Kafka's strengths (high throughput, replay, stream processing) address problems this system does not have, and §38 explicitly forbids adopting it for popularity.

**Consequences.** Delivery is at-least-once, so every consumer and webhook must be idempotent, keyed on event id. The poller needs its own monitoring — a stalled poller is a silent failure, and must alert. Latency is seconds, not milliseconds; acceptable for all identified events. If cross-product streaming volume later justifies a broker, the outbox becomes its producer, so the change is additive.

---

## ADR-010 — Plan limits are configuration data, never code

**Status:** Accepted

**Decision.** Every limit (users, branches, storage, usage, feature caps) is a row in `plan_features`, with per-subscription override support for commercially negotiated deals. No numeric limit appears in source code, and no limit is trusted from a client.

**Reason.** Confirmed directly with the product owner during the audit: the "2 users" in baseline §17–18 is illustrative, and real limits are decided per customer by the business. A hardcoded limit would make a routine commercial act — granting one customer an extra seat — into a code change and a deployment. Master prompt §34 and §32 both forbid it.

**Consequences.** Limit enforcement is always a query: resolve subscription → resolve effective limit (override, else plan) → count current usage → compare. Enforcement lives in one shared service so there is exactly one implementation to audit, and the counting side must be race-safe (see ADR-011). A limit of "unlimited" is represented explicitly (`NULL`), never as a sentinel like `-1` or `999999`.

**Amendment (review AR-004, finding R-7).** This ADR said limits are configuration, but did not say **who enforces which limit** — and the first cut of the schema let that omission become product coupling. A single free-text `unit` column mixed Control Plane resources (`users`, `branches`) with product-domain ones (`orders_per_month`, `gb`), so enforcement code would have had to recognize specific unit strings to know what it could act on. Recognizing `'orders_per_month'` means the Control Plane knows what an order is, violating baseline §4.2 and §41 by accident rather than by decision.

The boundary is now explicit in the schema: `features.enforced_by` is `control_plane` or `product`, and `features.countable_resource` is a **closed enum of resources the Control Plane actually stores**. The Control Plane enforces only its own resources. Every other limit is passed to the product as opaque data through the entitlement API, and the product enforces it in its own domain. A product with exotic metering needs no Control Plane change, because the Control Plane never interprets those units — it only carries them.

---

## ADR-011 — Limit enforcement is transactional and race-safe

**Status:** Accepted

**Decision.** Any operation consuming a limited resource (inviting a user, creating a branch) performs the count-and-insert inside a single transaction that locks the subscription row, or relies on a database constraint that makes the overage impossible. Check-then-act across separate transactions is forbidden.

**Reason.** "Count users, compare to limit, insert user" is a textbook race: two concurrent invitations each see 1 of 2 used and both proceed, producing 3 users on a 2-user plan. Since §18 and master prompt §34 require that limits cannot be bypassed *via the API*, and concurrency is an API-reachable bypass, the naive implementation would be a direct violation of the baseline.

**Consequences.** The enforcement service takes a row lock, which serializes membership creation per organization — acceptable, as this is a rare operation. Tests must include a concurrency case that fires simultaneous requests and asserts the limit holds; a single-threaded test would pass against the broken implementation and is therefore not sufficient evidence.

**Amendment (review AR-004; resolved 2026-10-01).** Two things this ADR assumed turned out to be undefined. Both are now settled, and this ADR is implementable.

- **Which row to lock** depends on the seat dimension, resolved by ADR-018. The rule: a **product-scoped** resource locks that product's subscription row; an **organization-scoped** resource (branches) locks the organization row, because its limit derives from several subscriptions at once and no single one is the authority. The target is selected from `features.countable_scope`, not hardcoded. A useful property falls out: invitations to different products never block each other, since they serialize on different rows.
- **What to count** is now defined authoritatively in `04-erd.md` §4.6. Seat occupancy spans two tables: accepted memberships (`active` or `suspended`) plus unexpired pending invitations. The original design tried to express a pending seat as `memberships.status = 'invited'`, which was structurally impossible — `user_id` is NOT NULL and an invitee usually has no user row yet — and simultaneously duplicated the `invitations` table's purpose. Counting only accepted members would leave an unlimited-invitation bypass; counting only live memberships would let suspension free a seat, enabling a suspend-add-unsuspend cycle that sits permanently over the limit.

---

## ADR-012 — Tenant isolation enforced structurally, not by convention

**Status:** Accepted

**Decision.** Organization context is resolved by middleware from the access token, never from a client-supplied body or query parameter. Repository methods for organization-owned entities require an organization id in their signature, so a query that omits tenant scoping does not type-check. Postgres row-level security is evaluated as defense in depth.

**Reason.** Baseline §26 makes isolation absolute, and master prompt §35 restates it. Convention-based isolation — "remember to add `WHERE organization_id = ?`" — fails eventually, and its failure is the worst outcome the platform can produce: one customer reading another's data. The defense must be structural so that the insecure version is unwriteable rather than merely discouraged.

**Consequences.** Repository signatures are more verbose, deliberately. Cross-organization queries (needed by company admins) go through an explicitly-named, platform-permission-gated path that is audited — so the dangerous capability exists in exactly one visible place. Tenant isolation tests are mandatory per resource, asserting that Organization A's token cannot reach Organization B's records (master prompt §26).

---

## ADR-013 — Product registry is data; the launcher renders whatever it returns

**Status:** Accepted

**Decision.** Products are rows in a `products` table. The launcher fetches products with per-product access state computed by the backend and renders generically. No product slug, name or id appears in a conditional anywhere in the frontend or backend.

**Reason.** Baseline §11, §14 and master prompt §33 all require this. Adding a product must be a registration, not a release — this is the property that makes the platform a platform.

**Consequences.** Product-specific presentation (icon, color, category, marketing copy, feature list for the discovery page) is registry data, not code. A reviewer rejecting a PR that compares a product slug is enforcing architecture, not style. A lint rule and a test assert the absence of hardcoded product identifiers.

---

## ADR-014 — Branch is an organizational dimension, not a separate tenant

**Status:** Accepted
**Resolves:** audit ambiguity A1, which the baseline (§10) explicitly deferred.

**Decision.** Membership is scoped to the organization. Branch access is an attribute of the membership: either all branches, or an explicit allowed set. The tenant boundary remains the organization; branch is a filter inside it.

**Reason.** Making branch a tenant boundary would double the isolation surface and force every query to carry two scopes, while the baseline treats branches as a structure *within* an organization (§6, §10). Keeping one tenant boundary keeps the isolation rule from ADR-012 simple enough to be reliably enforced — and a rule that is simple is a rule that holds.

**Consequences.** Branch-scoped queries filter by the membership's allowed branches after organization scoping. Products receive branch context in the session (§25) and are responsible for applying it to their own domain data, as specified in the integration contract. A membership with no branch restriction is the default, and restriction is additive.

---

## ADR-015 — Entitlement and permission are separate gates, both required

**Status:** Accepted

**Decision.** Access to a product action requires **both** an organization-level entitlement (is the subscription valid) **and** a user-level permission (does this membership's role allow this action). They are evaluated by separate, independently-testable services, and both must pass.

**Reason.** Baseline §23 states this directly, and its conjunction (organization active AND subscription active AND membership active AND permission valid AND limit valid) is the platform's central security invariant. Collapsing the two gates into one check would make it possible for a permission grant to accidentally imply entitlement — selling access for free — or for an entitlement to imply permission, letting a Viewer act as an Admin.

**Consequences.** Two services, two test suites, and tests that assert each gate independently blocks: an entitled organization whose user lacks permission is denied, and a permitted user whose organization lacks entitlement is denied. The second case is the one most likely to be missed, and is therefore explicitly required by `20-testing-strategy.md`.

---

## ADR-016 — Cross-tenant and cross-product integrity is enforced by composite keys

**Status:** Accepted
**Arose from:** architecture review AR-004, finding R-5

**Decision.** Wherever a row references two parents that must agree on their organization or their product, the reference is a **composite** foreign key against a `(id, scope)` unique index on the parent — not two independent single-column foreign keys. Where the agreement spans a grandparent (`plan_features`, `subscription_overrides`, `role_permissions`), it is enforced by a `DEFERRABLE INITIALLY IMMEDIATE` constraint trigger. The full list is `04-erd.md` §13.1.

**Reason.** A plain foreign key proves a parent exists; it cannot prove two parents belong to the same tenant or product. The review found this guard applied in exactly one table and missing everywhere else. Two of the omissions were serious: `memberships.default_branch_id` could reference another organization's branch — and that value is handed to products as the user's active branch (baseline §25), making the Control Plane itself the source of a cross-tenant leak — while `subscriptions` could reference a plan belonging to a *different product*, causing limit resolution to silently enforce the wrong product's ceilings. Neither fails loudly; both produce plausible wrong answers in the platform's commercial control path.

**Alternatives considered.** Application-level validation only — rejected: this is the class of invariant that must hold even when application code has a bug, and ADR-012 already commits to structural rather than conventional enforcement. Accepting the risk as unlikely — rejected: the cost of the constraints is a few unique indexes, and the failure mode is a cross-tenant data leak.

**Consequences.** Several redundant-looking unique indexes on `(id, scope)` pairs, which is the price of referenceability. Insert paths must supply the denormalized scope column, which the branded `OrgScope` of ADR-012 already carries. Trigger-based grandparent checks need their own tests, since a trigger that silently fails to fire is worse than no trigger.

---

## ADR-017 — Refresh token families are tracked per token, not per session

**Status:** Accepted
**Amends:** ADR-003 constraint 4, ADR-004
**Arose from:** architecture review AR-004, finding R-8

**Decision.** Every issued refresh token is a row in `refresh_tokens`, keyed to a session family, carrying `generation`, `consumed_at` and `replaced_by_id`. Presenting a token whose `consumed_at` is set revokes the **entire family** and raises a security alert. A partial unique index permits at most one live token per family.

**Reason.** ADR-003 constraint 4 promises that reuse of a consumed token revokes the family as presumed theft. The original schema tried to deliver this with a single `previous_token_hash` column on the session, which only detects reuse of the immediately preceding generation. A token stolen at generation *N* and presented after the legitimate user has rotated to *N+3* matches nothing, so it is rejected as merely invalid — the request fails, but the breach evidence is discarded and the session survives. The column could not implement the guarantee the ADR made, so either the ADR or the schema had to change, and the guarantee is the part worth keeping.

**Alternatives considered.** Keeping a short hash chain on the session — rejected: it still has a fixed detection window, just a wider one, and the attack simply waits. Accepting last-generation-only detection and weakening ADR-003 — rejected: silent reuse of an old token is the single clearest signal of credential theft available, and discarding it removes the only chance to react.

**Consequences.** One row per rotation, so the table grows with session activity and needs a purge job for consumed tokens past their expiry. `sessions.refresh_token_hash` and `previous_token_hash` are removed. The one-live-token index makes a double-refresh race resolve correctly: one branch wins, the other is treated as reuse — which is the right outcome, since the two are indistinguishable from theft.

---

## ADR-018 — Seat dimension: per-product seats

**Status:** **Accepted** (confirmed by the product owner, 2026-10-01)
**Arose from:** architecture review AR-004, finding R-9
**Unblocks:** ADR-011, Phase 2 migrations

**Decision.** A `users` limit counts **seats on a product subscription**, not members of an organization. `membership_products` grants a member access to a specific product; `invitation_products` reserves those seats at invitation time. Seats are counted per product and the ADR-011 lock is taken on that product's subscription row.

**Organization membership itself is uncapped.** A member holding no product grant consumes no seat. This follows directly from the decision — capacity is sold per product, so an account with no product access costs nothing to carry — and it is the behavior customers expect: adding a bookkeeper who only needs read access to one product should not require buying capacity in all of them.

**Reason.** The schema places `users` limits on a product's feature (`features.product_id`) while memberships are organization-wide, so when an organization holds several product subscriptions — the normal case under baseline §16 — nothing defines which subscription's limit applies to an invitation. ADR-011's row lock cannot be implemented without that answer. Per-product seats make baseline §17–18 mean literally what they say, let the business sell 2 POS seats and 10 Inventory seats to one customer, and close a second gap: baseline §23 separates "can the organization use this product" from "can **this user** use it", and only the first is currently represented. Today a user's product access is inferred from whether their roles happen to carry that product's permissions — derived state that is costly to count inside a lock and that changes silently when a role is edited.

**Alternative.** Org-wide cap, with the effective limit being the highest `users` value across active subscriptions. No new table, simpler enforcement, but a restrictive plan on one product cannot restrict that product, and the per-product limit stops meaning what it says. Cheaper now; expensive to unpick later with live subscriptions in flight.

**Why this was not decided unilaterally.** It changes the unit of sale, which is a business-model decision and therefore outside the range the master prompt (§37) permits an architect to assume. It was escalated, and confirmed.

**Consequences.**

1. Two new tables, `membership_products` and `invitation_products`, with tenant guards per ADR-016.
2. Granting and revoking product access become explicit, audited actions with a named grantor — not side effects of editing a role.
3. The launcher's per-user product visibility reads from the grant table rather than inferring access from whether a user's roles happen to carry that product's permissions. That inference was unusable as a seat model: counting it required a join across roles and permissions inside a lock, editing a role would silently change seat consumption for everyone holding it, and granting a read-only reporting permission would have consumed a paid seat.
4. **Not every limited resource is product-scoped.** Branches belong to the organization, so a branch limit cannot resolve against one subscription. `features.countable_scope` distinguishes the cases: product-scoped resources resolve against their subscription and lock that row; organization-scoped resources take the **MAX** across access-granting subscriptions and lock the organization row. The maximum, not the minimum — otherwise adding a cheap second product would silently reduce what a customer could already do, which no customer would accept as correct.
5. **Downgrades do not revoke seats.** An organization may hold more seats than its new plan allows; the state is permitted and visible, new grants are blocked until usage falls below the limit, and existing holders keep working. The alternative — a job that revokes access to satisfy new arithmetic — means the system removes a named person's access with no human decision, which damages trust in a platform far more than an overage report does (`04-erd.md` §4.7.2).

**Consequence accepted:** inviting a user is now a slightly richer operation, because it must say *which products* the invitee gets. That is inherent to selling capacity per product rather than per organization, and the admin console surfaces it as a product checklist on the invitation form.

---

## ADR-019 … ADR-032 — Frontend and design system

Recorded in **`docs/design/12-ui-decisions.md`**, continuing this numbering. Summary, with the two that amend decisions in this document:

| ADR | Decision |
|---|---|
| **ADR-019** | **Next.js 15 App Router — supersedes HLD §1's React + Vite.** Public discovery pages need server rendering |
| ADR-020 | Radix Primitives in a first-party `packages/ui`; React Aria for two named widgets |
| ADR-021 | Tailwind v4 + CSS custom properties; zero runtime |
| ADR-022 | Lucide for chrome icons; product icons stay registry data (ADR-013) |
| ADR-023 | React Hook Form + Zod, **sharing the API's schemas** |
| ADR-024 | TanStack Table, headless — required by cursor pagination |
| ADR-025 | TanStack Query for server state; Zustand for the little client state; no Redux |
| ADR-026 | Recharts under a validated, colorblind-safe palette |
| ADR-027 | date-fns v4 with timezone support |
| ADR-028 | CSS-first animation |
| ADR-029 | Vitest + RTL + Playwright + axe |
| ADR-030 | Inter + JetBrains Mono, **self-hosted — required by the CSP** |
| ADR-031 | Company console is desktop-first by decision |
| **ADR-032** | **Session in an httpOnly cookie behind a thin BFF** — amends HLD §8; tokens never reach JavaScript |

Both amendments are recorded in `22-change-log.md` AR-007, never applied silently.

---

## ADR-033 — argon2id via @node-rs/argon2; modules live inside apps/api

**Status:** Accepted (Phase 3)

**Decision.** Password hashing uses **argon2id** (ADR-003 constraint 1, unchanged) via the **`@node-rs/argon2`** package — a prebuilt Rust binary — rather than the node-gyp `argon2`. And the bounded modules (identity first) live at **`apps/api/src/modules/<name>/`**, not `packages/modules/`, keeping the backend a single self-contained deployable.

**Reason.** `@node-rs/argon2` installs reliably across platforms without a build toolchain (it shipped a working win32 binary immediately here), and argon2id is its default variant, so the algorithm requirement is met with less operational risk. Putting modules inside `apps/api` keeps the standalone Node.js backend one deployable unit — the user's explicit requirement — while preserving the module architecture: `domain/application/infrastructure/http` layering, the domain-purity lint rule (extended to `apps/api/src/modules/*/domain`), and the extraction path of ADR-001. Physical location does not change the logical module boundaries.

**Alternatives.** node-gyp `argon2` — rejected: native build fragility on Windows/CI. `packages/modules/identity` as a separate workspace package (HLD §4's sketch) — rejected for now: more wiring and a second build graph for no gain, and it would blur "one deployable backend"; a module can still be extracted to a package later along its existing interface.

**Consequences.** `verbatimModuleSyntax` forbids importing `@node-rs/argon2`'s `Algorithm` const enum, so the argon2id default is relied upon and documented. If a module is later extracted for independent deployment, it moves to `packages/modules/` unchanged in shape.

---

## Deferred decisions

Recorded so that their absence is a visible, deliberate choice rather than an oversight.

| ID | Decision | Deferred because | Revisit when |
|---|---|---|---|
| ADR-D1 | Payment/billing provider | Baseline §39 defers it; the platform stores billing *metadata* only, so the integration is additive | First paid conversion is in sight |
| ADR-D2 | Object storage | No confirmed requirement; nothing in the baseline needs blob storage on day one | Product logos or document attachments are required |
| ADR-D3 | Message broker | ADR-009 covers all identified events | Outbox throughput or cross-product streaming demands it |
| ADR-D4 | Kubernetes | Docker Compose suffices at the current scale, and Docker is not yet installed locally | Multi-instance orchestration or autoscaling is needed |
| ADR-D5 | MFA mechanism (TOTP vs WebAuthn) | Schema and flow accommodate both per ADR-003 constraint 8; choosing now would be premature | MFA is scheduled for release |
