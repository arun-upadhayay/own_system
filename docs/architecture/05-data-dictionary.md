# 05 — Data Dictionary

Field-level semantics for every column whose meaning, allowed values, ownership or sensitivity is not self-evident from its name. Where `04-erd.md` specifies *shape*, this document specifies *meaning* — what a value is permitted to be, who is allowed to write it, and what must never be logged.

---

## 1. Sensitivity classification

Every field carries one of four classifications. The classification is not advisory: it determines log redaction, API exposure and audit handling, and those behaviors are implemented from this table.

| Class | Meaning | Logging | API exposure |
|---|---|---|---|
| **S0 — Public** | Safe anywhere | Freely | Any authenticated caller in scope |
| **S1 — Internal** | Business data, tenant-scoped | Identifiers only, never values | Scope-permitted callers |
| **S2 — Sensitive** | Personal or commercially confidential | Never logged | Explicit permission required |
| **S3 — Secret** | Credential material | **Never logged, never returned, never in an error message** | Never returned under any circumstances |

**S3 is absolute.** A field classified S3 has no code path that serializes it into a response, a log line, an exception message, or an audit `changes` payload. This is verified by a test that walks response schemas and asserts no S3 field appears, because the usual way secrets leak is not a deliberate decision but an incidental `SELECT *` reaching a generic serializer.

---

## 2. Ownership

Who may write a field. Enforcement is server-side; a field being editable in a UI is not authority.

| Owner | Meaning |
|---|---|
| **System** | Written only by application logic. No API accepts it, including from company staff |
| **Company** | Internal staff with the relevant platform permission |
| **Organization** | Organization admins/owners within their own tenant |
| **User** | The individual, about themselves |
| **Product** | An integrated product via its API credentials |
| **Derived** | Computed from other data; never written directly |

The distinction between **System** and **Company** is a security boundary, not a convenience. `memberships.joined_at`, `audit_logs.*` and `subscriptions.status` are System-owned: no endpoint accepts them as input, because accepting them would let a caller rewrite history or grant themselves access by asserting a state rather than causing it.

---

## 3. Identity

### 3.1 `users`

| Field | Class | Owner | Allowed values & meaning |
|---|---|---|---|
| `id` | S0 | System | UUID v7, generated in the application (§1.0 of the ERD). Immutable; appears in tokens and audit records |
| `email` | S2 | User | RFC 5322, case-insensitive (`citext`). **The login identifier.** Changing it requires re-verification, and the old address is notified — an unnotified email change is a silent account takeover |
| `email_verified_at` | S1 | System | Null until the verification token is consumed. Null blocks login |
| `full_name` | S2 | User | Personal data. Copied into `audit_logs.actor_label` at write time so the trail survives deletion |
| `phone` | S2 | User | E.164 preferred. Optional; a future MFA channel |
| `locale`, `timezone` | S1 | User | IETF language tag; IANA zone name. Presentation only — never used in an authorization decision |
| `status` | S1 | Company/System | `pending_verification` → `active` → (`suspended` ⇄ `active`) → `deactivated`. **Only `active` may authenticate.** `suspended` is reversible and company-initiated; `deactivated` is terminal |
| `last_login_at` | S1 | System | Successful authentication only. Failed attempts go to `audit_logs` |
| `failed_login_count` | S1 | System | Consecutive failures. Reset to 0 on success |
| `locked_until` | S1 | System | Set when `failed_login_count` crosses the threshold. While in the future, authentication is refused **with the same response as a wrong password** — distinguishing them tells an attacker which accounts exist and which they have successfully locked |
| `deleted_at` | S1 | Company | Soft delete. Releases the email for re-registration via the partial unique index |

**No `password` field exists on this table.** Credentials live in `user_credentials` (§3.2) specifically so that an ordinary user query cannot return them.

### 3.2 `user_credentials`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `password_hash` | **S3** | User | Argon2id encoded string, including salt and parameters. ADR-003 permits no alternative |
| `algorithm` | S1 | System | e.g. `argon2id:v19:m=65536,t=3,p=4`. Recorded so a parameter hardening can detect stale rows and rehash on next login |
| `password_changed_at` | S1 | System | Changing it revokes every session for the user (`revoked_reason = 'password_changed'`). A password change that leaves old sessions alive does not actually end an intrusion |
| `must_change_password` | S1 | Company | Forces a change on next login. Set after an admin-initiated reset |

### 3.3 `sessions` and `refresh_tokens`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `sessions.id` | S1 | System | The **session family** identifier (ADR-017) |
| `sessions.organization_id` | S1 | System | Active organization context. Null until selection. Mutated by organization switching; access tokens are minted org-scoped from it (ADR-004) |
| `sessions.revoked_at` / `revoked_reason` | S1 | System | `logout` \| `rotation_reuse` \| `org_suspended` \| `password_changed` \| `admin`. `rotation_reuse` is a **security event** and alerts |
| `sessions.ip_address`, `user_agent` | S2 | System | Captured for the user's own session list and for investigation. Personal data under GDPR; retention-bounded |
| `refresh_tokens.token_hash` | **S3** | System | SHA-256 of the opaque token. The token itself is returned once, at issue, and never stored |
| `refresh_tokens.generation` | S1 | System | 0-based position in the family. Diagnostic |
| `refresh_tokens.consumed_at` | S1 | System | Non-null = spent. **Presentation of a consumed token revokes the entire family** (ADR-017) |

Why the plaintext token is never stored: a database dump must not be a set of working credentials. Hashing means a leaked table yields nothing usable, and since the server only ever needs to *compare*, it never needs the original.

### 3.4 `oidc_clients`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `client_id` | S0 | Company | Public identifier |
| `client_secret_hash` | **S3** | System | Null for public PKCE clients. The secret is shown once at creation and is unrecoverable thereafter |
| `redirect_uris` | S1 | Company | **Exact-match allowlist. No wildcards, no prefix matching.** Wildcard redirect matching is a standing open-redirect that converts directly into token theft, and is the most common OAuth misconfiguration in production systems |
| `require_pkce` | S1 | Company | Default **true**. Setting it false requires a documented justification and is audited |

---

## 4. Organizations

### 4.1 `organizations`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `slug` | S0 | Company | Lowercase, `[a-z0-9-]`, immutable once issued. Appears in URLs, so changing it breaks customer bookmarks and integrations |
| `status` | S1 | Company | `pending` \| `active` \| `suspended` \| `cancelled`. **The master access switch.** Anything other than `active` denies access to every product immediately, which is why entitlement is re-checked server-side per request rather than trusted from a token |
| `suspension_reason` | S2 | Company | Internal. **Never exposed to the customer** — it may contain commercial or legal notes. The customer sees a generic suspension notice with a support contact |
| `industry` | S1 | Organization | **Descriptive metadata only.** Any code branching on this value violates baseline §41 and must be rejected in review. It exists for reporting, not behavior |
| `currency` | S1 | Company | ISO 4217. Billing presentation |
| `billing_email` | S2 | Organization | Billing notices. May differ from any member's address |
| `metadata` | S1 | Company | Open `jsonb`. **Never used in authorization or limit decisions** — unvalidated, unindexed, and not a place to grow a shadow schema |

### 4.2 `branches`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `code` | S1 | Organization | Customer-defined, unique per organization. Often their own system's identifier, so products may join on it |
| `address` | S2 | Organization | `jsonb` because postal formats vary by country and the platform must not impose one. Never queried structurally |
| `is_primary` | S1 | Organization | At most one per organization, enforced by partial unique index. The fallback when a membership has no default branch |
| `status` | S1 | Organization | `active` \| `inactive`. **Inactive branches still count toward the branch limit** — the resource exists and is recoverable, so freeing capacity requires deletion |

### 4.3 `memberships`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `status` | S1 | Organization | `active` \| `suspended` \| `removed`. **No `invited` value** — an invitation is not a membership (ERD §4.3). `active` and `suspended` both occupy seats |
| `is_owner` | S1 | Organization | Organization Owner. An organization must retain at least one active owner; the last one cannot be removed or demoted, or the tenant becomes unadministrable and needs company intervention to recover |
| `all_branches` | S1 | Organization | `true` = every branch, including future ones. `false` = restricted to `membership_branches` (ADR-014) |
| `default_branch_id` | S1 | Organization | Flows into session context and is handed to products as active branch (baseline §25). **Composite-FK guarded** so it cannot reference another tenant's branch (ADR-016) |
| `joined_at` | S1 | System | Set on acceptance. Not client-writable |
| `last_active_at` | S1 | System | Updated on authenticated activity. Feeds inactive-seat reporting — the data an account manager needs to discuss right-sizing |

### 4.4 `invitations`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `email` | S2 | Organization | Target. Need not correspond to an existing user |
| `token_hash` | **S3** | System | Hash only. The raw token exists solely inside the emailed link |
| `status` | S1 | System | `pending` \| `accepted` \| `expired` \| `revoked` |
| `expires_at` | S1 | System | **Expiry is evaluated at read time**, so a lapsed invitation frees its seat immediately without waiting for the sweeper job (ERD §4.6) |
| `accepted_user_id` | S1 | System | The user who accepted. May differ from the invited address if the person signed in with a pre-existing account at a different address — recorded rather than prevented, because it is legitimate and needs to be visible |

### 4.5 `membership_products` — seat grants

| Field | Class | Owner | Notes |
|---|---|---|---|
| `product_id` | S1 | Organization | The product this seat is for. Counted against that product's subscription limit (ADR-018) |
| `granted_by_user_id` | S1 | System | NOT NULL. **Every seat traces to a person** — needed when a customer disputes a charge |
| `revoked_at` | S1 | Organization | Timestamp, not a delete. Revocation frees the seat; history survives |

A grant is **entitlement to occupy a seat**, distinct from **what the user may do once seated** (which is RBAC). Keeping them separate is what stops a read-only reporting permission from consuming paid capacity.

---

## 5. RBAC

### 5.1 `permissions`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `key` | S0 | System | `<domain>.<resource>.<action>`, e.g. `organization.members.create`. **Seeded by migration, never user-created** — a permission is a contract with code, and a key with no enforcing code is a false promise |
| `scope` | S0 | System | `platform` \| `organization` \| `product`. CHECK-tied to `product_id` |
| `is_dangerous` | S0 | System | Forces confirmation in the UI and emphasis in audit. Applied to suspension, platform-role granting, and cross-tenant reads |

### 5.2 `roles`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `organization_id` | S1 | System | **Null = system template** available to all organizations; **set = that organization's custom role.** One table, so permission resolution has exactly one path |
| `is_system` | S0 | System | Immutable roles the platform's own logic depends on. Protects them from being edited into something harmless |
| `scope` | S0 | System | Coherence-checked against `product_id` and `organization_id` (ERD §5.2). `platform` scope is the cross-tenant privilege |

### 5.3 `platform_role_assignments`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `role_id` | S1 | Company | Must be a `platform`-scoped role. **The most dangerous grant in the system** |
| `granted_by_user_id` | S1 | System | NOT NULL. Every platform privilege traces to a person. **Never self-grantable** |
| `expires_at` | S1 | Company | Time-boxed elevation — e.g. a support agent granted access for one investigation. The mechanism that keeps standing privilege low, and the preferred form of grant |

---

## 6. Catalog

### 6.1 `products`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `slug` | S0 | Company | Stable identifier. **Must never appear in a code branch** (ADR-013). A PR comparing a slug is rejected as an architecture violation, not a style preference |
| `status` | S0 | Company | `draft` \| `beta` \| `active` \| `deprecated` \| `retired`. `retired` is excluded from the launcher view entirely |
| `visibility` | S0 | Company | `public` = discoverable by all (baseline §38); `private` = visible only to subscribers; `hidden` = company staff only. Honored in `v_organization_products` |
| `app_url` | S0 | Company | Launcher destination. Must be HTTPS and must match a registered OIDC redirect host — otherwise the launcher becomes an open redirect |
| `accent_color`, `icon_url` | S0 | Company | **Presentation as data.** Exists so product styling never becomes a frontend conditional |
| `health_check_url` | S1 | Company | Polled for integration monitoring (`16-observability.md`) |

### 6.2 `features`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `key` | S0 | Company | Unique per product, e.g. `pos.split_bill` |
| `type` | S0 | Company | `boolean` (on/off) \| `limit` (ceiling on a concurrent count) \| `quota` (consumable per period). Enforced differently; conflating them produces wrong enforcement |
| `enforced_by` | S0 | Company | `control_plane` \| `product`. **The domain boundary.** The Control Plane enforces only its own resources; product limits are passed through as opaque data |
| `countable_resource` | S0 | Company | Closed enum: `users` \| `branches`. Adding a value requires Control Plane code that can count it — which is precisely why it is closed |
| `countable_scope` | S0 | Company | `product` (resolve against one subscription, lock that row) \| `organization` (MAX across subscriptions, lock the org row). ERD §4.6.1 |
| `unit` | S0 | Company | **Display only.** The Control Plane never interprets `orders_per_month` — interpreting it would mean knowing what an order is (baseline §4.2, §41) |
| `is_public` | S0 | Company | Shown on the discovery page |

---

## 7. Plans and subscriptions

### 7.1 `plans`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `tier` | S0 | Company | Integer ordering for upgrade/downgrade comparison. **Not price** — price comparison breaks for custom-quoted plans, and name comparison is not comparison |
| `price_amount` | S0 | Company | `numeric(19,4)`. **Null = contact sales**, which is distinct from zero (free) |
| `trial_days` | S0 | Company | 0 = no trial |
| `status` | S0 | Company | `draft` \| `active` \| `grandfathered` \| `retired`. **`grandfathered` = withdrawn from sale but honored for existing customers.** Without it, retiring a plan means either breaking customers or never retiring anything |
| `is_public` | S0 | Company | False for negotiated plans that should not appear in self-serve pricing |

### 7.2 `plan_features` — the limit store

| Field | Class | Owner | Notes |
|---|---|---|---|
| `is_enabled` | S0 | Company | For boolean features |
| `limit_value` | S0 | Company | **NULL means unlimited.** Explicitly, never a sentinel like `-1` or `999999` — a magic number eventually meets code that compares it without knowing it is magic, producing either an unenforceable limit or an unreachable one. CHECK enforces `>= 0` |

**A missing row means the feature is NOT included** — not unlimited. Absence must be the restrictive case, so that a plan which forgot to list a feature does not accidentally grant it without bound (ADR-010).

### 7.3 `subscriptions`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `status` | S1 | Company/System | `trialing` \| `active` \| `past_due` \| `suspended` \| `cancelled` \| `expired`. **Only `trialing`, `active` and `past_due` grant access.** This list exists in exactly one place in the code — the entitlement service |
| `trial_ends_at` | S1 | Company | Set when `trialing`. Past this instant, access ends even if a sweeper has not yet changed the status — so expiry is evaluated, not awaited |
| `current_period_end` | S1 | Company | Billing period boundary. Drives renewal and expiry jobs |
| `cancel_at_period_end` | S1 | Organization | Customer-initiated non-renewal. Access continues until the period ends — cancellation is not immediate revocation |
| `suspended_at` / `suspension_reason` | S2 | Company | Company-initiated. Reason is **internal**, like the organization equivalent |
| `external_billing_ref` | S1 | System | Payment provider identifier. Deferred (ADR-D1) |
| `notes` | S2 | Company | Internal commercial notes. Never customer-visible |

### 7.4 `subscription_overrides` — per-customer limits

| Field | Class | Owner | Notes |
|---|---|---|---|
| `limit_value` | S1 | Company | Overrides the plan's value for this customer only |
| `is_unlimited` | S1 | Company | Explicit, because NULL `limit_value` already means "no numeric override". Two different meanings cannot share one NULL |
| `reason` | S2 | Company | **NOT NULL.** A customer whose limits differ from their plan with no record of why is a support and revenue problem waiting to surface |
| `granted_by_user_id` | S1 | System | **NOT NULL.** Accountability for a commercial concession |
| `expires_at` | S1 | Company | Time-boxed concession. Evaluated at resolution time |
| `superseded_at` | S1 | System | Set when replaced. Preserves history and carries the uniqueness predicate (ERD §7.5) |

**Resolution order, implemented once in the limits service:**

```text
active, unexpired override for (subscription, feature)
  → else plan_features row for (plan, feature)
    → else feature not included → deny
```

---

## 8. Usage

### 8.1 `usage_counters` — authoritative

| Field | Class | Owner | Notes |
|---|---|---|---|
| `period_key` | S1 | System | `'lifetime'` or `'YYYY-MM'` / `'YYYY-MM-DD'`. NOT NULL, so uniqueness needs no index expression (ERD §9.1) |
| `used_value` | S1 | System | For **periodic quotas**. Concurrent-count resources (`users`, `branches`) are counted **live** from source tables during enforcement — a cached count can drift, and a drifted seat count is either a blocked legitimate invitation or a bypassed limit |

### 8.2 `product_usage_reports` — informational

| Field | Class | Owner | Notes |
|---|---|---|---|
| `metric_key` | S1 | Product | Product-defined. The Control Plane stores it without interpreting it |
| `metric_value` | S1 | Product | **Must never influence an access decision.** Self-reported by an external system, so trusting it for enforcement would let a product grant itself entitlement |
| `idempotency_key` | S1 | Product | Unique. Reporting is at-least-once, so duplicates must collapse |

---

## 9. Audit

### `audit_logs`

| Field | Class | Owner | Notes |
|---|---|---|---|
| `actor_label` | S2 | System | Actor's name **captured at write time**. An entry reading "user 7f3a… deleted organization 9c2b…" is useless once those rows are gone — and the entries that matter most in an investigation are often exactly the ones whose subjects were deleted |
| `action` | S1 | System | `<resource>.<verb>`, past tense: `subscription.suspended` |
| `outcome` | S1 | System | `success` \| `failure` \| **`denied`**. Denied authorization attempts are the signal for detecting probing; a log of only successes cannot show an attack that failed |
| `changes` | S2 | System | Before/after. **Every S3 field is omitted and every S2 field is redacted to a change marker** — the audit log records that a password changed, never what it changed to |
| `correlation_id` | S1 | System | Joins the entry to request logs and traces, turning "this happened" into "here is exactly what happened" |

The table is **append-only**: `UPDATE` and `DELETE` are revoked from the application role. Retention runs as a separate maintenance role dropping partitions (ERD §11.1). An audit log the application can rewrite proves nothing.

---

## 10. Cross-cutting rules

These apply to every field in the platform and are each verified by a test rather than trusted to review.

1. **No S3 field is ever serialized.** Not in responses, logs, errors, or audit payloads. Verified by a schema-walking test.
2. **S2 fields are redacted in logs.** Emails, names, addresses, IPs appear in logs as identifiers, never values.
3. **`metadata` jsonb never drives behavior.** Not in authorization, not in limit resolution. It is unvalidated and unindexed; using it for decisions grows a shadow schema with no constraints.
4. **`industry`, `category` and `unit` never drive Control Plane behavior.** Branching on any of them couples the platform to a domain (baseline §41).
5. **System-owned fields are absent from every request schema.** Not ignored if supplied — absent, so that supplying one is a validation error rather than a silently dropped attempt.
6. **`organization_id` is never read from a request body.** It comes from the verified token (ADR-012). A client-supplied tenant id is the classic escape vector precisely because it looks like ordinary input.
7. **Every status transition is validated against its state machine.** A status is never set by direct assignment from input; the transition is requested and the machine decides whether it is legal.

---

Next: `06-identity-and-sso.md`.
