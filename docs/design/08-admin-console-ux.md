# 08 — Admin Console UX

The interaction patterns for `docs/architecture/18-admin-console-architecture.md`, plus the organization-admin surface. This is the highest-privilege interface in the platform, so two assumptions govern every pattern: **nothing here trusts the client**, and **an operator acting on wrong information harms a real customer**.

---

## 1. What makes this console different

| Property | Design consequence |
|---|---|
| Staff act on **other people's** data | Every cross-tenant action is visible and audited |
| Actions are **commercially consequential** | Suspension and limits need confirmation, not just a click |
| **Density matters** — hundreds of customers | Compact mode by default (`02` §2.1) |
| Operators are **repeat users** | Keyboard parity, command palette, saved views |
| Permissions vary widely | Navigation and actions are permission-filtered (`06` §3.1) |
| Values carry money and access | Tabular figures; never truncate a number (`03` §5, §7) |

---

## 2. Screen archetypes

Five patterns cover every screen. A new screen picks one rather than inventing a layout.

| Archetype | Used for |
|---|---|
| **Dashboard** | Metric tiles + charts + attention list |
| **List** | Filterable, cursor-paginated table |
| **Detail** | Header + tabs + panels (the Organization Detail model) |
| **Form** | Create or edit, with validation |
| **Settings** | Grouped controls, mostly immediate-apply |

---

## 3. Dashboard

```text
┌────────────────────────────────────────────────────────────┐
│ Dashboard                                                  │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ Organizations│ Active subs  │ MRR          │ Trials ending │
│ 1,284        │ 2,106        │ $284,500     │ 14            │
│ ▲ 32 (30d)   │ ▲ 54         │ ▲ 4.2%       │ next 7 days   │
├──────────────┴──────────────┴──────────────┴───────────────┤
│ Subscriptions by product          │ MRR trend             │
│ [bar chart]                       │ [line chart]          │
├───────────────────────────────────┴───────────────────────┤
│ NEEDS ATTENTION                                            │
│ ⚠ 3 subscriptions over seat limit                          │
│ ⚠ 7 unassigned product requests                            │
│ ⚠ 2 overrides expiring this week                           │
│ ⛔ 1 dead event in the dispatch queue                       │
└────────────────────────────────────────────────────────────┘
```

### 3.1 The attention list is the point

A dashboard nobody acts on is decoration. This one leads with states that **require a decision**, each linking to a filtered list:

| Item | Why it is here |
|---|---|
| Over seat limit | Permitted after a downgrade (`09` §5.2) and otherwise invisible — a renewal conversation |
| Unassigned requests | An unowned lead is a lost lead |
| Overrides expiring | A customer's capacity is about to drop; the account manager should know first |
| **Dead events** | A stalled dispatcher is silent; the first business symptom is a missing invitation email (`14` §7) |
| Product health failures | A broken product reads to customers as a broken platform |

Dead events and product health are operational, not commercial, and they are here because **nobody checks a dashboard they do not already open.**

### 3.2 Metric tiles

Value in `--text-metric-value` with tabular figures; label beneath; optional delta with an arrow **and** a sign — never color alone (`10` §3). Charts follow the validated palette and the no-dual-axis rule (`04` §6.5).

---

## 4. List screens

The DataTable from `05` §4.1. Conventions:

| Element | Convention |
|---|---|
| Search | Debounced 300ms, server-side, allowlisted fields |
| Filters | Inline chips above the table; active filters always visible |
| Sort | Server-side, allowlisted, ties on `id` |
| Pagination | **Cursor** — Prev/Next, never page numbers (`13` §3.1) |
| Row click | Navigates to detail; actions in a `⋯` menu |
| Bulk | Checkbox selection → sticky action bar |
| Saved views | Filter sets persisted per user |

### 4.1 Filters must be visible

Active filters appear as removable chips, and the empty state distinguishes **"no data"** from **"no matches"** with different copy and a "Clear filters" action.

This is a correctness issue, not polish. An operator who forgets a filter is active concludes a customer does not exist, and then tells them so.

### 4.2 Key columns

| Screen | Columns |
|---|---|
| Organizations | Name · Status · Products · Members · MRR · Account manager · Created |
| Subscriptions | Organization · Product · Plan · Status · Seats · Period end · MRR |
| Users | Name · Email · Status · Organizations · Platform roles · Last login |
| Audit logs | Time · Actor · Action · Resource · Outcome · Correlation id |

Status columns render `AccessStateBadge`. Seat columns render `SeatCounter`, so "3 of 2 · over limit" and "7 · Unlimited" are formatted identically everywhere (`05` §5.2).

---

## 5. Organization Detail — the primary view

Baseline §28 calls this the company's primary customer management view. Most staff work starts here, so every other screen links into it rather than duplicating its data.

```text
┌──────────────────────────────────────────────────────────────┐
│ ← Organizations                                              │
│ ABC Restaurant Group        ● Active   Customer              │
│ abc-restaurant · Created 12 Mar 2026 · AM: Rahul Sharma      │
│                                   [Suspend] [⋯]              │
├──────────────────────────────────────────────────────────────┤
│ ⚠ POS: 3 seats used of 2 — over limit since 28 Sep           │
├──────────────────────────────────────────────────────────────┤
│ Overview │ Products │ Members │ Branches │ Usage │ Billing │ │
│          │          │         │          │       │ Account │ │
│          │          │         │          │       │ Audit   │ │
└──────────────────────────────────────────────────────────────┘
```

Tabs are URL-synced, so a link to the Subscriptions tab lands a colleague on that tab.

### 5.1 States that must be surfaced, not hidden

| State | Treatment |
|---|---|
| Suspended | Banner with reason and who suspended |
| **Seats over limit** | Per-product warning banner |
| Trial ending ≤7 days | Highlighted with the conversion action |
| `past_due` | Payment warning, **visually distinct from suspension** |
| Override active | Badge showing the value, reason and grantor |
| Override expiring | Warning |
| No account manager | Warning — an unowned account |

`past_due` must look different from `suspended` because they mean opposite things for access: `past_due` still grants it (`08` §2.1). An operator who confuses them either reassures a cut-off customer or ignores a live one.

### 5.2 Products tab — per-product seat management

```text
┌─ POS ──────────────────────────── ● Active ─┐
│ Plan: Pro        Period ends 1 Nov 2026     │
│ Seats: ███████████░ 3 of 2  ⚠ over limit    │
│ Override: users = 2 → 5  (Rahul, "Q4 deal") │
│ [Change plan] [Add override] [Suspend]      │
└─────────────────────────────────────────────┘
```

One card per product, each showing its **own** seat count — because seats are per-product (ADR-018). An organization-wide seat figure would be meaningless here.

Unlimited renders as the word; not-included is visually distinct from zero (C9, C10).

### 5.3 Members tab

Members with status, roles, **product seats**, last active — plus pending invitations, which occupy seats (`04-erd.md` §4.6).

Pending invitations are shown **in the same list**, visually distinguished. A separate tab would hide the reason a seat count is higher than the member count, which is the most common support question about seats.

Staff actions here are audited as **acting on behalf** (`10` §8.1), and those entries appear in the customer's own audit view.

---

## 6. Forms

| Convention | Detail |
|---|---|
| One column | Two columns slow scanning and break on narrow viewports |
| Labels above | Shortest eye path; works when text expands |
| Required marked in text | `*` plus `aria-required` — not color alone |
| Validate on blur and submit | Not per keystroke |
| Errors inline + summary | Summary focused on submit failure (`10` §6) |
| Destructive submit = `danger` | After confirmation |
| Disabled submit explains why | Never a bare disabled button |
| Unsaved-change guard | On navigate away |

### 6.1 Server errors are surfaced, not swallowed

The API returns a user-safe `message`, structured `details` and a `requestId` (`13` §5). Field-level errors map back to fields; the rest appears as a form-level error **with the request id shown**, so a customer or operator quoting it lets support find the exact request (`16` §7).

### 6.2 Forms that depend on server state

Some forms cannot be validated client-side at all (C4):

| Form | Server-only constraint |
|---|---|
| Invite member | Seat availability per named product |
| Grant seat | That product's limit |
| Create branch | Branch limit, MAX across subscriptions |
| Change plan | Must be the same product |

These show **current usage as context** — "POS: 2 of 2 seats used" — and let the user submit. The server decides. Pre-emptively disabling based on a client-side count would be wrong under concurrency: two admins inviting simultaneously is exactly the race ADR-011 handles server-side.

---

## 7. Dangerous actions

Per `18` §13 and C11 — the UI reads `permissions.is_dangerous` rather than maintaining its own list.

| Severity | Pattern |
|---|---|
| Reversible, low impact | Direct action + toast + undo where feasible |
| Reversible, high impact | ConfirmDialog stating the consequence |
| **Dangerous** | ConfirmDialog + **typed confirmation of the subject's name** |

```text
┌─ Suspend organization ───────────────────────┐
│ ⚠ This immediately blocks access to ALL      │
│   products for all 14 members.               │
│                                              │
│   Reason (required, internal)                │
│   ┌────────────────────────────────────────┐ │
│   └────────────────────────────────────────┘ │
│                                              │
│   Type ABC Restaurant Group to confirm:      │
│   ┌────────────────────────────────────────┐ │
│   └────────────────────────────────────────┘ │
│                    [Cancel] [Suspend]        │
└──────────────────────────────────────────────┘
```

Typed confirmation applies to: suspending an organization or subscription, cancelling a subscription, removing a member, revoking a platform role, retiring a plan with active subscribers.

The dialog states the **blast radius** — "all 14 members", "3 organizations affected" — because the operator cannot otherwise know. A mis-clicked suspension takes a customer offline and is not undoable by a toast.

### 7.1 Reasons are required where the schema requires them

`subscription_overrides.reason` and `suspension_reason` are NOT NULL (`09` §8). The form cannot submit without them, and the help text says the reason is **internal and never shown to the customer** (`05` §4.1 of the data dictionary) — otherwise operators write customer-facing prose into an internal field.

---

## 8. Plans and limits — the highest-risk editing surface

Editing a plan changes limits for every current subscriber immediately, since limits resolve per request (`09` §2).

```text
┌─ POS · Pro ─────────────────────────────────┐
│ ⚠ 142 organizations use this plan.          │
│   Limit changes take effect immediately.    │
├─────────────────────────────────────────────┤
│ Feature            Included   Limit         │
│ Users              ☑          [    2 ]      │
│ Branches           ☑          [    3 ]      │
│ Split bill         ☑          —             │
│ Offline mode       ☐          — not incl.   │
│ Orders / month     ☑          [ 50000 ] ⓘ   │
│                                 enforced by │
│                                 the product │
└─────────────────────────────────────────────┘
```

| Requirement | Source |
|---|---|
| Subscriber count shown before editing | Blast radius |
| **"Unlimited" is an explicit control**, not a blank field | C9 — a blank that means unlimited gives away entitlement |
| **Not-included visually distinct from zero** | C10 — they mean different things |
| `enforced_by` shown | The platform carries product limits; it does not enforce them (`04-erd.md` §6.2) |
| Retiring with subscribers offers `grandfathered` | Honors existing customers (`09` §7.1) |

The unlimited-versus-blank distinction is the single most consequential detail on this screen. A field left blank that silently means "unlimited" is how a plan accidentally gives away a paid entitlement.

---

## 9. Roles and permissions

```text
┌─ Role: Organization Admin ──────────────────┐
│ System role — not editable                  │
├─────────────────────────────────────────────┤
│ ORGANIZATION                                │
│ ☑ organization.members.read                 │
│ ☑ organization.members.invite               │
│ ⚠ organization.members.remove    dangerous  │
│ ☐ organization.ownership.transfer           │
└─────────────────────────────────────────────┘
```

| Rule | Source |
|---|---|
| Grouped by scope, then domain | Flat lists of 100+ keys are unusable |
| `is_dangerous` visually marked | C11 |
| **Permissions the granter lacks are disabled**, with an explanation | The superset rule (`07` §6) |
| `is_system` roles read-only | |
| Platform-role granting is a separate, heavily confirmed flow | The most dangerous grant in the system |

Showing permissions the granter cannot assign — disabled and explained — is better than hiding them. Hiding makes the escalation rule invisible and generates "why can't I see that permission" tickets.

---

## 10. Audit log

```text
┌──────────────────────────────────────────────────────────────┐
│ [Org ▾] [Actor ▾] [Action ▾] [Outcome: denied ▾] [Range ▾]   │
├──────────────────────────────────────────────────────────────┤
│ 11:30:02  Rahul S.  subscription.suspended  ✓  POS / ABC…  ⋯ │
│ 11:28:44  arun@…    membership.created      ✓  Member      ⋯ │
│ 11:27:10  arun@…    organization.read       ⊘  XYZ Cafe    ⋯ │
└──────────────────────────────────────────────────────────────┘
```

| Feature | Reason |
|---|---|
| **Filter by `outcome = denied`** | The probing-detection view; a log of only successes cannot show an attack |
| Correlation id displayed and copyable | Links to logs, trace and events (`16` §7) |
| Expandable `changes` with before/after | S2 redacted, S3 absent |
| Read-only — no actions | Append-only (`15` §10) |
| Actor shown from the denormalized label | Survives subject deletion |

The organization-facing audit view uses the same component and **includes staff actions** (`10` §8.1). Hiding vendor actions from the customer would make the trail untrustworthy for exactly the events most worth checking.

---

## 11. Organization admin surface

Same component system, narrower scope, **comfortable** density — these are customers, not operators, and they use it occasionally rather than all day.

| Difference from the console | Reason |
|---|---|
| Only their own organization | Tenant scope |
| **No limit editing anywhere** | Raising a ceiling is a commercial act (baseline §20) |
| Seat management, within limits | Their responsibility |
| Limit-reached leads to upgrade, not to a plan editor | `09` §7 |
| Their own audit log, including staff actions | Transparency |

The absence of limit-editing endpoints at organization scope (`13` §9.8) means this is structurally enforced, not just hidden.

---

## 12. Keyboard and efficiency

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Focus search |
| `g` then `o` | Go to organizations |
| `j` / `k` | Move table selection |
| `Enter` | Open selected row |
| `Escape` | Close overlay, clear selection |
| `⌘Enter` | Submit form |

Full keyboard parity is required (`10` §4) — every action reachable without a mouse. For staff processing dozens of records a day this is the difference between a tool and a chore.

---

## 13. Anti-patterns

| Forbidden | Why |
|---|---|
| Destructive action without confirmation | Mis-clicks take customers offline |
| Blank field meaning "unlimited" | Gives away entitlement (C9) |
| Not-included rendered as zero | Different meanings (C10) |
| Truncating a limit, amount or seat count | A wrong number, not a cosmetic issue |
| Numbered pagination | Impossible with cursors |
| Empty table on error | Reads as "no customers" |
| Client-side limit checks | C4; wrong under concurrency |
| Hiding staff actions from the customer's audit | Makes the trail untrustworthy |
| Impersonation | Not implemented, by decision (`10` §8) |
| Editing a plan without showing subscriber count | Operator cannot see the blast radius |
| Confusing `past_due` with `suspended` | Opposite access consequences |
| Limit-editing UI at organization scope | Baseline §20 |

---

Next: `09-responsive-design.md`.
