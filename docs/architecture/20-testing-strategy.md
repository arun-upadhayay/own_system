# 20 — Testing Strategy

Master prompt §26 names three assertions the platform must be able to prove:

```text
Organization A cannot access Organization B's data.
A user cannot bypass subscription limits.
A user cannot access an unsubscribed product.
```

Each is a **security property**, and each has a failure mode that produces no error — the system continues and gives a wrong answer. That shapes everything below: the tests that matter most are the ones distinguishing "works" from "works but is exploitable".

---

## 1. Shape of the suite

| Layer | Scope | Database | Count | Speed |
|---|---|---|---|---|
| **Unit** | Domain logic, pure functions, state machines | no | many | ms |
| **Integration** | Repositories, use cases, transactions, constraints | yes | many | tens of ms |
| **API** | HTTP contract, middleware chain, status codes | yes | moderate | tens of ms |
| **E2E** | Critical user journeys through the browser | yes | few | seconds |
| **Security** | Isolation, escalation, bypass — cross-cutting | yes | moderate | varies |

**Security tests are a category, not a layer.** They cut across the others and are non-optional: a failure there is a vulnerability, not a regression.

### 1.1 The unit layer works without a database

A deliberate consequence of the dependency inversion in HLD §3, and practically important because Postgres is not installed on the development machine (AR-003). Entitlement state derivation, limit resolution order, subscription transitions, seat counting arithmetic and permission union are all pure and testable immediately.

Time is injected via the `Clock` port, so "what happens the instant a trial expires" is an assertion rather than a wait.

---

## 2. The three required properties

### 2.1 Organization A cannot access Organization B's data

Tested **per resource**, not once. A single generic test proves one endpoint is scoped and says nothing about the next one added.

```ts
describe.each(ORG_OWNED_RESOURCES)('tenant isolation: %s', (resource) => {
  test('A cannot read B', async () => {
    const r = await api.as(orgA.admin).get(`/api/v1/${resource}/${bResourceId}`)
    expect(r.status).toBe(404)              // 404, never 403
  })
  test('A cannot write B', async () => {
    expect((await api.as(orgA.admin).patch(`/api/v1/${resource}/${bResourceId}`, {}))
      .status).toBe(404)
  })
  test('A cannot delete B', async () => { /* 404 */ })
  test('A cannot enumerate B', async () => {
    const r = await api.as(orgA.admin).get(`/api/v1/${resource}`)
    expect(r.body.data.map((x) => x.id)).not.toContain(bResourceId)
  })
  test('A cannot reach B by supplying an organization id', async () => {
    const r = await api.as(orgA.admin)
      .post(`/api/v1/${resource}`, { organizationId: orgB.id, ...valid })
    expect([400, 404]).toContain(r.status)   // rejected, never silently honored
  })
})
```

`ORG_OWNED_RESOURCES` is derived from the route table, so **a new organization-owned endpoint is automatically covered** — the test cannot be forgotten, which is the usual way isolation decays.

**404, not 403.** A 403 confirms the resource exists, leaking cross-tenant existence through the status code (`07` §9).

Additional required cases:

| Case | Assertion |
|---|---|
| Token scope | An Org-A token cannot address Org B even with B's ids everywhere |
| Organization switch | The old token cannot reach the newly selected organization |
| RLS | A repository call bypassing scope returns zero rows |
| Type level | A scope-less repository call **does not compile** |
| Multi-org user | Being a member of both does not merge their data |
| Branch | A branch id from B is not reachable from A (ADR-016 guards) |
| Audit | A cannot read B's audit log |

### 2.2 A user cannot bypass subscription limits

**The concurrency test is the one that matters.** A sequential test passes against the broken implementation and is therefore not evidence (ADR-011).

```ts
test('concurrent seat grants cannot exceed the limit', async () => {
  await seed.subscription({ product: 'pos', plan: 'pro', userLimit: 2 })
  await seed.seatGranted({ product: 'pos', count: 1 })       // 1 of 2 used

  const results = await Promise.allSettled(
    [userB, userC].map((u) =>
      api.as(orgA.admin).post(`/api/v1/memberships/${u.membershipId}/products`,
        { productId: posId })),
  )

  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201)
  expect(ok).toHaveLength(1)                                  // exactly one wins
  expect(await countSeats(orgA.id, posId)).toBe(2)            // never 3
})
```

Every bypass route, each a distinct test:

| Bypass attempt | Expected |
|---|---|
| **Concurrent grants** | Exactly one succeeds |
| **Invitation flooding** | Pending invitations occupy seats; the limit holds |
| **Suspension cycling** | Suspend → add → unsuspend cannot exceed (suspended members keep seats) |
| Direct API call skipping the UI | Rejected server-side |
| Client-supplied limit in the body | Field rejected; server value used |
| Expired-invitation seats | Released, so a legitimate grant succeeds |
| Deactivated branches | Still counted; no capacity freed |
| Cross-product confusion | A POS grant counts against POS only |
| Override expiry | Capacity reverts to the plan |
| Downgrade below usage | New grants blocked; existing untouched; overage reported |
| **Crossed multi-product invitations** | Complete without deadlock (deterministic lock order) |

### 2.3 A user cannot access an unsubscribed product

```ts
describe('entitlement enforcement', () => {
  const denied = ['not_subscribed', 'expired', 'suspended', 'cancelled', 'org_inactive']

  test.each(denied)('state %s denies access', async (state) => {
    await seed.subscriptionInState(state)
    expect((await api.as(user).get('/api/v1/entitlements/pos')).body.entitled).toBe(false)
    expect((await api.as(user).post('/api/v1/me/products/pos/open')).status).toBe(403)
  })

  test('expiry is evaluated, not awaited', async () => {
    await seed.subscription({ status: 'trialing', trialEndsAt: daysAgo(1) })
    // Deliberately do NOT run the expiry job.
    expect((await api.as(user).get('/api/v1/entitlements/pos')).body.entitled).toBe(false)
  })

  test('suspension takes effect on token refresh', async () => {
    const { refreshToken } = await api.login(user)
    await admin.suspendOrganization(orgA.id)
    const r = await api.post('/api/v1/auth/token', { grant_type: 'refresh_token', refreshToken })
    expect([401, 403]).toContain(r.status)
  })
})
```

The second and third tests target the two defects most likely to ship unnoticed: expiry that depends on a background job, and a refresh path that does not re-validate. Both let a suspended or expired customer keep working while every visible signal says access was revoked.

---

## 3. Gate independence

ADR-015 requires entitlement, seat and permission to be independent. The test matrix asserts each blocks alone:

| Entitled | Seat | Permission | Expected |
|---|---|---|---|
| ✓ | ✓ | ✓ | **allow** |
| ✗ | ✓ | ✓ | deny — `product_not_entitled` |
| ✓ | ✗ | ✓ | deny — `product_seat_required` |
| ✓ | ✓ | ✗ | deny — `forbidden` |
| ✗ | ✗ | ✗ | deny |

Row 2 is the one most often missed, because it only appears when a subscription lapses while permissions remain intact — the normal path to it is time passing, not a user action, so it is invisible in manual testing.

---

## 4. Authorization and escalation

| Test | Assertion |
|---|---|
| Default deny | A route with no permission declaration **fails at startup** |
| Resolution | Union across roles; no deny semantics |
| Immediacy | A demoted user loses access on the **next request**, not at token expiry |
| **Superset rule** | A granter cannot assign permissions they lack |
| No self-grant | A user cannot assign a role to their own membership |
| Platform grants | Require `platform.roles.grant`; not self-grantable |
| System roles | `is_system` roles are immutable |
| Last owner | Cannot be removed, suspended or demoted |
| Scoped staff | See only assigned organizations, server-enforced |
| Custom roles | Cannot include permissions outside the organization's delegable set |

The superset rule test matters because without it the ability to *create roles* silently becomes the ability to hold *any* permission.

---

## 5. Identity and session

| Area | Tests |
|---|---|
| Passwords | argon2id verification; rehash on parameter change; breached-list rejection |
| **Token families** | Reuse of **any** consumed generation revokes the family and alerts — including a token several generations old, the case the original design missed (ADR-017) |
| Refresh | Single-use; one live token per family; concurrent refresh resolves as one winner and one reuse |
| **Enumeration** | Identical responses **and comparable timing** for known vs unknown email, on login, register and reset |
| Lockout | Indistinguishable from a wrong password |
| **OIDC conformance** | Full suite against the specification (ADR-003 constraint 6) |
| PKCE | Required; `plain` refused |
| Redirect URIs | Exact match; wildcard and prefix rejected |
| `state` / `nonce` | Required and verified; a missing or mismatched value fails |
| Key rotation | A `retiring` key still verifies; rotation breaks no live token |
| Reset | Single-use; revokes all sessions; prior tokens invalidated |
| Session fixation | A new session id is issued on authentication |

Timing-equality tests are statistical rather than exact — they assert the distributions are not separable, since a strict equality assertion on timing would be flaky.

---

## 6. Database-level tests

Constraints are the last line of defense (`04-erd.md` §1), so they are tested directly rather than only through the application.

| Test | Assertion |
|---|---|
| **Every composite guard in §13.1** | Each tested individually — cross-tenant and cross-product rows rejected at the database |
| `subscriptions` → `plans` | **A plan from another product is rejected** (review R-5) |
| `memberships.default_branch_id` | Another tenant's branch is rejected |
| One live subscription | Second live row for `(org, product)` rejected |
| One primary branch | Second primary rejected |
| Seat uniqueness | Duplicate live grant for `(membership, product)` rejected |
| Pending invitation uniqueness | Second pending for `(org, email)` rejected |
| `roles` coherence | `platform` scope with `organization_id` rejected (review R-11) |
| `features` coherence | `control_plane` without `countable_resource`/`countable_scope` rejected |
| `plan_features` | Negative limit rejected |
| Audit immutability | `UPDATE` and `DELETE` rejected for `app_role` |
| Migrations | Apply cleanly to empty; idempotent; run within budget on seeded data |
| RLS | Unscoped query returns zero rows; views honor `security_invoker` |

---

## 7. Event tests

| Test | Assertion |
|---|---|
| Atomicity | A rolled-back transaction leaves **no** outbox row |
| Atomicity | A committed change always has its event |
| Idempotency | Re-delivering an event is a no-op for every consumer |
| Retry | Exponential backoff with jitter; exhaustion → `dead` |
| Dead-letter | A `dead` event alerts |
| Leader election | Only one dispatcher delivers; leadership transfers on failure |
| Webhook signing | Valid signature accepted; tampered body rejected |
| **Out-of-order** | Consumers behave correctly when events arrive reversed (they re-read state) |
| Payload hygiene | **No S2 or S3 field appears in any event payload** |

The atomicity pair is the whole justification for ADR-009 and must be proven, not assumed.

---

## 8. Launcher and registry

| Test | Assertion |
|---|---|
| **New product, no code** | A fictional product registered via API appears in the launcher, renders discovery, accepts a request — **zero code changes**. This is the acceptance test for ADR-013 |
| No hardcoding | Lint + a test assert no product slug appears in a conditional |
| `canOpen` | The full conjunction; computed server-side |
| **`appUrl` absence** | Null when access is denied — not merely hidden in the UI |
| Re-authorization | The open is re-checked, not trusted from the launcher payload |
| Visibility | `hidden` never reaches a customer; `private` only reaches subscribers |
| **Lapsed trial** | Reports `expired`, not `not_subscribed` |
| States | Every state in `11` §8 renders; a fetch failure never shows an empty grid |

---

## 9. E2E journeys

Few, high value, through a real browser.

| Journey | Covers |
|---|---|
| Register → verify → first login → launcher | Onboarding |
| Invite → accept → seat granted → open product | Membership + seats |
| Hit a seat limit → see upgrade → request → convert | Baseline §39 end to end |
| Login → open product via SSO (no second login) | Baseline §24 |
| **Direct product URL → authenticate → land on the deep link** | Baseline §37, the path most often broken |
| Switch organizations → correct data in each | Baseline §8 |
| Staff: suspend organization → customer loses access | Baseline §13 |
| Discover unsubscribed product → request demo | Baseline §14 |

The direct-URL journey is called out because it exercises the full chain — no session, authorization server login, organization resolution, entitlement check, and `state` round-trip returning the user to their original destination.

---

## 10. Test data

| Principle | Reason |
|---|---|
| Builders, not fixtures | A fixture file becomes a shared mutable dependency |
| Each test seeds its own tenants | No cross-test contamination |
| **Two organizations always present** | Isolation can be asserted anywhere, cheaply |
| Transaction rollback per test | Fast, isolated |
| Injected clock | Expiry is asserted, not waited for |
| No production data | Staging uses anonymized data |

```ts
const { orgA, orgB } = await seed.twoOrganizations()
await seed.subscription(orgA, { product: 'pos', plan: 'pro', limits: { users: 2 } })
```

Seeding two organizations by default is a small decision with a large effect: it makes writing an isolation assertion as cheap as writing a happy-path one, which is what gets them written.

---

## 11. CI gates

Blocking a merge (`17` §6):

| Gate | Blocks on |
|---|---|
| Typecheck | Any error |
| Lint | Any error, including architecture rules |
| Unit | Any failure |
| Integration | Any failure |
| **Tenant isolation** | Any failure — treated as a vulnerability |
| **Concurrency** | Any failure |
| **OIDC conformance** | Any failure |
| Security suite | Any failure |
| OpenAPI drift | Spec differs from generated |
| Dependency audit | High or critical |
| Secret scan | Any detection |

E2E runs against staging post-merge; a failure blocks production promotion.

---

## 12. Coverage

Coverage is a diagnostic, not a target — chasing a percentage produces tests that execute code without asserting behavior.

| Area | Expectation |
|---|---|
| Domain logic, state machines | Near-complete; it is pure and cheap to test |
| Authorization, entitlement, limits | **Every branch**, because every branch is a security decision |
| Repositories | Every method, including the isolation case |
| UI components | Behavior and states, not snapshots |

What is measured instead: **is every security property in §2–§4 asserted by a named test?** That list is the real coverage metric, and it is reviewed when a phase completes.

---

## 13. The non-negotiable set

If only these ran, the platform's core guarantees would still be verified:

1. Org A cannot read, write, list or enumerate Org B — **per resource**
2. Cross-tenant access returns 404, not 403
3. **Concurrent seat grants cannot exceed the limit**
4. Pending invitations occupy seats; suspension does not free them
5. Entitlement, seat and permission block **independently**
6. Expiry is evaluated, not awaited
7. Suspension takes effect on token refresh
8. Refresh reuse revokes the family, at any generation
9. A route without a declared permission fails at startup
10. A granter cannot assign permissions they lack
11. A rolled-back transaction leaves no event
12. A new product needs no code change
13. No S3 field appears in any response, log, error or event

---

Next: the architecture validation gate (master prompt §29).
