# 13 — API Specification

Standards every endpoint follows, and the complete endpoint inventory. Per master prompt §19, **no undocumented API may be implemented** — an endpoint not in this document does not get built, and an endpoint built must be added here first.

---

## 1. Conventions

| Aspect | Rule |
|---|---|
| Base path | `/api/v1` |
| Versioning | URL path. A breaking change makes `/api/v2`; both run during migration |
| Resources | Plural nouns, kebab-case: `/customer-accounts` |
| Identifiers | UUID v7 in paths. **Never a sequential integer** — those leak customer counts and invite enumeration |
| Payloads | JSON, `camelCase` keys (the database is `snake_case`; mapping is explicit at the boundary) |
| Timestamps | ISO 8601 with offset, always UTC: `2026-10-01T11:30:00Z` |
| Money | String amount + ISO 4217 code: `{"amount":"99.0000","currency":"USD"}`. Never a float |
| Verbs | GET read · POST create/action · PATCH partial update · DELETE remove. No PUT — full-replacement semantics invite accidental field clearing |
| Actions | `POST /{resource}/{id}/{action}` for state transitions: `/subscriptions/{id}/suspend` |

### 1.1 Why state transitions are actions, not PATCH

`PATCH /subscriptions/{id} {"status":"active"}` would let a client assert a state rather than request a transition, bypassing the state machine (`09` §4). `POST /subscriptions/{id}/reinstate` names the transition, so the server validates legality, writes the right audit entry, and emits the right event. Status fields are never directly writable.

---

## 2. Authentication and authorization

| Caller | Mechanism |
|---|---|
| Browser / user | `Authorization: Bearer <access_token>` |
| Product server | Client credentials token |
| Webhook (inbound to products) | HMAC-SHA256 signature, not a bearer token |

Every route declares its requirements, and a route with no declaration **fails at server startup** (HLD §5):

```ts
config: {
  auth: 'required',
  scope: 'organization',                       // 'platform' | 'organization' | 'public'
  permission: 'organization.members.invite',
  consumesLimit: { resource: 'users', scope: 'product' },
}
```

Organization context comes from the token's `org` claim — **never** from a path, query or body (ADR-012). Where a path appears to contain an organization id (company-console routes), it is compared against the caller's platform scope and audited.

---

## 3. Pagination, filtering, sorting

### 3.1 Cursor pagination

```http
GET /api/v1/organizations?limit=50&cursor=eyJpZCI6IjAxOTMy...
```

```json
{ "data": [ ... ],
  "pageInfo": { "hasNextPage": true, "endCursor": "eyJpZCI6...", "limit": 50 } }
```

Cursors, not offsets. Offset pagination over a mutating table skips and duplicates rows as items are inserted — and the admin console lists exactly the tables that mutate most. The cursor encodes the last row's sort key and id; it is opaque to clients and must not be constructed by them.

`limit` defaults to 50, caps at 200. No endpoint returns an unbounded collection, because the first large customer turns an unbounded list into an outage.

### 3.2 Filtering and sorting

```http
GET /api/v1/subscriptions?status=active&productId=01932b...&sort=-createdAt
```

Filters are an explicit allowlist per endpoint — never a generic query language, which would let a client construct expensive or unindexed queries. `sort` accepts allowlisted fields, `-` for descending, and resolves ties on `id` so paging is stable.

---

## 4. Validation

Every request body, path and query parameter is validated by a Zod schema before a handler runs. Unknown fields are **rejected**, not stripped: a client sending `organizationId` in a body where it is not accepted gets a 400 rather than silently having it ignored, which surfaces a misunderstanding that would otherwise become a latent tenant-scoping assumption.

System-owned fields (data dictionary §2) are **absent from request schemas**, so supplying one is a validation error rather than a dropped attempt.

---

## 5. Errors

One shape, always:

```json
{
  "error": {
    "code": "limit_reached",
    "message": "Your POS Pro plan includes 2 user seats.",
    "details": { "resource": "users", "limit": 2, "used": 2 },
    "requestId": "01932f90-...",
    "docsUrl": "https://docs.company.com/errors/limit_reached"
  }
}
```

`message` is safe to show a user. `details` carries structured data for the client. `requestId` matches the response header and the server logs — so a customer quoting it lets support find the exact request.

| Status | Code | Use |
|---|---|---|
| 400 | `validation_failed` | Malformed input; `details` lists field errors |
| 401 | `unauthenticated` | Missing, invalid or expired token |
| 403 | `forbidden` | Permission missing |
| 403 | `organization_suspended` | Tenant disabled |
| 403 | `product_not_entitled` | No valid subscription |
| 403 | `product_seat_required` | No seat on the product |
| 404 | `not_found` | Absent **or another tenant's** |
| 409 | `conflict` | State conflict, e.g. duplicate slug |
| 409 | `limit_reached` | Plan limit hit; carries upgrade options |
| 422 | `invalid_transition` | Illegal state-machine move |
| 429 | `rate_limited` | With `Retry-After` |
| 500 | `internal_error` | Generic; **never** a stack trace or SQL |

**404 for another tenant's resource, never 403.** A 403 confirms existence, which is a cross-tenant leak through the status code (`07` §9). Because repositories are organization-scoped, the row genuinely is not found — so 404 is both safe and honest.

**409 for a limit, not 403.** The user is permitted; the plan is the constraint. Conflating them sends users to their administrator instead of the upgrade page.

---

## 6. Idempotency

Required on every unsafe operation with an external effect:

```http
POST /api/v1/invitations
Idempotency-Key: 7f3a9c2e-...
```

The key, the endpoint and a hash of the body are stored with the response. A replay with the same key returns the stored response without re-executing. A replay with the same key and a *different* body is a 409 — that combination means a client bug, and silently honoring either interpretation would be worse than refusing.

Keys are retained 24 hours. Applies to invitations, seat grants, subscription changes and usage reports — anything that sends an email, charges, or consumes a limit.

---

## 7. Rate limiting

| Scope | Limit | Why |
|---|---|---|
| `POST /auth/login` | 5 / 15 min per IP **and** per email | Credential stuffing |
| `POST /auth/password/forgot` | 3 / hour per email, 10 / hour per IP | Mail bombing, enumeration |
| `POST /auth/register` | 5 / hour per IP | Spam tenants |
| `POST /auth/token` (refresh) | 60 / min per session | Token grinding |
| Authenticated general | 1000 / min per user | Runaway clients |
| Product server-to-server | 10000 / min per client | Bulk reporting |

Responses carry `X-RateLimit-Limit`, `-Remaining`, `-Reset`, and `Retry-After` on 429.

Counters live in Postgres initially (ADR-008). **Only the auth endpoints are rate-limited at first** — a counter write on every authenticated request would make the limiter the hottest table in the database, which is the write amplification the ADR flagged. General limiting is enabled when Redis arrives.

---

## 8. Request correlation

Every request carries `X-Request-Id` — accepted from the client if a valid UUID, generated otherwise — returned in the response, attached to every log line, trace span and `audit_logs.correlation_id`. This is what turns "something failed" into "here is the exact request, its logs, its trace and its audit entry" (`16-observability.md`).

---

## 9. Endpoint inventory

### 9.1 `/auth` — public and session

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Self-service organization + owner |
| GET | `/auth/verify` | Consume email verification token |
| POST | `/auth/login` | Authenticate |
| POST | `/auth/logout` | Revoke session |
| POST | `/auth/token` | Code exchange, refresh, client credentials |
| POST | `/auth/revoke` | RFC 7009 |
| POST | `/auth/introspect` | RFC 7662, confidential clients |
| GET | `/auth/authorize` | Authorization code + PKCE |
| GET | `/auth/end-session` | RP-initiated logout |
| POST | `/auth/password/forgot` | Request reset; always 202 |
| POST | `/auth/password/reset` | Consume reset token |
| POST | `/auth/password/change` | Authenticated change |
| GET | `/auth/invitations/{token}` | Preview an invitation |
| POST | `/auth/invitations/{token}/accept` | Accept |
| POST | `/auth/organizations/{id}/select` | Set organization context |
| GET | `/.well-known/openid-configuration` | Discovery |
| GET | `/.well-known/jwks.json` | Public keys |

### 9.2 `/me` — the caller

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | Profile + active context |
| PATCH | `/me` | Own profile |
| GET | `/me/organizations` | Memberships, for the switcher |
| GET | `/me/permissions` | Resolved permissions + digest |
| GET | `/me/products` | **Launcher payload** (`11` §2) |
| POST | `/me/products/{slug}/open` | Re-authorize and redirect |
| GET | `/me/sessions` | Own active sessions |
| DELETE | `/me/sessions/{id}` | Revoke one |
| GET | `/me/mfa/factors` | MFA enrolment (when enabled) |

### 9.3 `/organizations` — tenant self-management

Organization scope. `{id}` must match the token's `org` unless the caller holds platform scope.

| Method | Path | Permission |
|---|---|---|
| GET | `/organizations/{id}` | `organization.read` |
| PATCH | `/organizations/{id}` | `organization.update` |
| GET | `/organizations/{id}/usage` | `organization.usage.read` |
| GET | `/organizations/{id}/audit-logs` | `organization.audit.read` |

### 9.4 `/memberships` and `/invitations`

| Method | Path | Permission |
|---|---|---|
| GET | `/memberships` | `organization.members.read` |
| GET | `/memberships/{id}` | `organization.members.read` |
| PATCH | `/memberships/{id}` | `organization.members.update` |
| POST | `/memberships/{id}/suspend` | `organization.members.suspend` |
| POST | `/memberships/{id}/reinstate` | `organization.members.suspend` |
| DELETE | `/memberships/{id}` | `organization.members.remove` |
| POST | `/memberships/{id}/transfer-ownership` | `organization.ownership.transfer` |
| GET | `/memberships/{id}/roles` | `organization.members.read` |
| PUT | `/memberships/{id}/roles` | `organization.roles.assign` |
| GET | `/memberships/{id}/products` | `organization.product_seats.read` |
| POST | `/memberships/{id}/products` | `organization.product_seats.grant` |
| DELETE | `/memberships/{id}/products/{productId}` | `organization.product_seats.revoke` |
| GET | `/invitations` | `organization.members.read` |
| POST | `/invitations` | `organization.members.invite` |
| POST | `/invitations/{id}/resend` | `organization.members.invite` |
| DELETE | `/invitations/{id}` | `organization.members.invite` |

`PUT` on roles is the one exception to §1's no-PUT rule: role assignment is a set, and replacing it wholesale is the honest semantic — a PATCH would need add/remove operations that are easy to get wrong.

### 9.5 `/branches`

| Method | Path | Permission |
|---|---|---|
| GET | `/branches` | `organization.branches.read` |
| POST | `/branches` | `organization.branches.create` — consumes the branch limit |
| GET/PATCH | `/branches/{id}` | read / `organization.branches.update` |
| DELETE | `/branches/{id}` | `organization.branches.delete` |

### 9.6 `/products`, `/features` — registry

| Method | Path | Permission |
|---|---|---|
| GET | `/products` | Authenticated — registry, launcher-independent |
| GET | `/products/{slug}` | **Public** — discovery page |
| POST | `/products` | `platform.products.create` |
| PATCH | `/products/{id}` | `platform.products.update` |
| GET | `/products/{slug}/plans` | Public |
| POST | `/products/{slug}/requests` | Public — demo/contact/upgrade |
| GET | `/features?productId=` | Authenticated |
| POST | `/features` | `platform.features.create` |
| PATCH | `/features/{id}` | `platform.features.update` |

### 9.7 `/plans`

| Method | Path | Permission |
|---|---|---|
| GET | `/plans?productId=` | Authenticated (public plans) |
| POST | `/plans` | `platform.plans.create` |
| PATCH | `/plans/{id}` | `platform.plans.update` |
| GET/PUT | `/plans/{id}/features` | read / `platform.plans.update` |
| POST | `/plans/{id}/retire` | `platform.plans.update` |

### 9.8 `/subscriptions`

| Method | Path | Permission |
|---|---|---|
| GET | `/subscriptions` | `organization.subscriptions.read` or platform |
| GET | `/subscriptions/{id}` | as above |
| POST | `/subscriptions` | `platform.subscriptions.manage` |
| POST | `/subscriptions/{id}/change-plan` | `organization.subscriptions.manage` or platform |
| POST | `/subscriptions/{id}/start-trial` | `platform.subscriptions.manage` |
| POST | `/subscriptions/{id}/cancel` | `organization.subscriptions.manage` |
| POST | `/subscriptions/{id}/reactivate` | `organization.subscriptions.manage` |
| POST | `/subscriptions/{id}/suspend` | `platform.subscriptions.manage` |
| POST | `/subscriptions/{id}/reinstate` | `platform.subscriptions.manage` |
| GET | `/subscriptions/{id}/events` | read |
| GET | `/subscriptions/{id}/overrides` | `platform.subscriptions.override` |
| POST | `/subscriptions/{id}/overrides` | `platform.subscriptions.override` |
| DELETE | `/subscriptions/{id}/overrides/{featureId}` | `platform.subscriptions.override` |

Creation and suspension are **platform-only**. A customer cannot create their own subscription or lift their own suspension — selling is a company act (baseline §20).

### 9.9 `/entitlements`

| Method | Path | Caller |
|---|---|---|
| GET | `/entitlements` | All products for the current organization |
| GET | `/entitlements/{productSlug}` | **The product integration endpoint** (`12` §5) |

### 9.10 `/usage`

| Method | Path | Permission |
|---|---|---|
| GET | `/usage` | `organization.usage.read` — entitlement counters |
| POST | `/products/{slug}/usage` | Client credentials — product reporting |
| GET | `/usage/reports` | `platform.usage.read` — cross-tenant |

### 9.11 `/customer-accounts` — company only

| Method | Path | Permission |
|---|---|---|
| GET | `/customer-accounts` | `platform.accounts.read` |
| GET/PATCH | `/customer-accounts/{orgId}` | read / `platform.accounts.update` |
| GET | `/customer-accounts/{orgId}/assignments` | `platform.accounts.read` |
| POST | `/customer-accounts/{orgId}/assignments` | `platform.accounts.assign` |
| DELETE | `/customer-accounts/{orgId}/assignments/{id}` | `platform.accounts.assign` |
| GET | `/product-requests` | `platform.requests.read` |
| PATCH | `/product-requests/{id}` | `platform.requests.update` |

### 9.12 `/audit-logs`

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-logs` | `platform.audit.read` — cross-tenant |
| GET | `/organizations/{id}/audit-logs` | `organization.audit.read` — own tenant |

Read-only. There is no write endpoint — audit entries are produced by the actions they describe, inside the same transaction (ADR-009). An API that could write audit entries would make the log forgeable.

### 9.13 Platform administration

| Method | Path | Permission |
|---|---|---|
| GET | `/platform/organizations` | `platform.organizations.read` |
| POST | `/platform/organizations` | `platform.organizations.create` |
| POST | `/platform/organizations/{id}/suspend` | `platform.organizations.suspend` |
| POST | `/platform/organizations/{id}/reinstate` | `platform.organizations.suspend` |
| GET | `/platform/users` | `platform.users.read` |
| POST | `/platform/users/{id}/suspend` | `platform.users.suspend` |
| GET | `/platform/role-assignments` | `platform.roles.read` |
| POST | `/platform/role-assignments` | `platform.roles.grant` |
| DELETE | `/platform/role-assignments/{id}` | `platform.roles.grant` |
| GET | `/platform/oidc-clients` | `platform.clients.read` |
| POST | `/platform/oidc-clients` | `platform.clients.create` |
| GET | `/platform/dashboard` | `platform.dashboard.read` |
| GET | `/platform/product-health` | `platform.health.read` |

### 9.14 Operational

| Method | Path | Auth |
|---|---|---|
| GET | `/healthz` | none — liveness |
| GET | `/readyz` | none — readiness, checks the database |
| GET | `/metrics` | internal only |

---

## 10. OpenAPI generation

The specification is generated from the Zod schemas that validate requests, so documentation cannot drift from behavior — the usual failure of hand-maintained API docs. Served at `/api/v1/openapi.json`. CI fails if the committed spec differs from the generated one, which makes an undocumented endpoint a build failure rather than an oversight (master prompt §19).

---

Next: `14-event-architecture.md`.
