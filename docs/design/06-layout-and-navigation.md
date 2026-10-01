# 06 — Layout and Navigation

The application shell: how the four surfaces are framed, how a user moves between organizations and products, and how navigation is driven by permissions rather than by a hardcoded menu.

---

## 1. Shells

Four surfaces, three shells:

| Surface | Shell | Why |
|---|---|---|
| Product Launcher | **Minimal** — header only | The launcher *is* the content; a sidebar would compete with it |
| Organization Admin | **Sidebar** | Many sections, persistent context |
| Company Console | **Sidebar** (dense) | Most sections; highest information density |
| Product Discovery | **Public** — marketing header, no sidebar | Anonymous visitors; no app chrome to show |

```text
┌──────────────────────────────────────────────────────────┐
│  [≡] Logo    ⠿ Launcher   [Org ▾]      ⌘K  🔔  [Avatar]  │  56px header
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  Sidebar   │   Page content                              │
│  260px     │   max-width 1440px, 24px gutter             │
│            │                                             │
└────────────┴─────────────────────────────────────────────┘
```

---

## 2. Header

56px, sticky, `--z-header`.

| Slot | Content |
|---|---|
| Left | Sidebar toggle (mobile), logo → home |
| Left-center | **Product launcher trigger** (⠿) — baseline §12 |
| Center | **Organization switcher** — only when the user has >1 membership |
| Right | Command palette (⌘K), notifications, account menu |

### 2.1 The launcher trigger

Baseline §12 specifies a Google-style grid icon in the central navigation, present on **every authenticated surface** — the ecosystem is always one click away. It opens a popover (not a route change), so a user checking which products they have does not lose their place.

### 2.2 Account menu

Profile · Theme (Light / Dark / System) · Sessions · Organization settings (if permitted) · Sign out.

**"Sessions" is user-facing by design.** `GET /me/sessions` and `DELETE /me/sessions/{id}` exist (`13` §9.2), and surfacing them lets a user revoke a session they do not recognize — a self-service security control that costs nothing to expose.

---

## 3. Sidebar

260px expanded, 64px collapsed, state persisted per user.

### 3.1 Navigation is generated from permissions

**Nothing in the sidebar is hardcoded.** Items are declared with their required permission and filtered against the resolved permission set.

```ts
const NAV: NavSection[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', href: '/admin', icon: LayoutDashboard,
      permission: 'platform.dashboard.read' },
  ]},
  { label: 'Customers', items: [
    { label: 'Organizations', href: '/admin/organizations', icon: Building2,
      permission: 'platform.organizations.read' },
    { label: 'Users', href: '/admin/users', icon: Users,
      permission: 'platform.users.read' },
  ]},
  // …
]
```

| Rule | Reason |
|---|---|
| An item with no permission is **not rendered** | A link to a 403 is a dead end |
| A section with no visible items is **not rendered** | An empty section header is noise |
| **Filtering is usability, not security** | C3 — the server authorizes the route regardless |
| Permissions come from `GET /me/permissions` | Resolved server-side (`07` §4.1) |

The second rule matters for scoped staff roles: a support agent sees a much shorter sidebar than a super admin, and that is correct — but it is *not* what protects the routes.

### 3.2 Sections

Organization admin and company console have different trees, mirroring `18` §1:

**Company console** — Overview · Customers (Organizations, Users, Accounts, Support) · Catalog (Products, Features, Plans) · Commercial (Subscriptions, Billing, Usage) · System (Audit, Settings).

**Organization admin** — Overview · Members (Members, Invitations, Roles) · Products (My Products, Seats) · Organization (Branches, Settings) · Billing (Subscriptions, Usage) · Audit.

### 3.3 Behavior

| Property | Detail |
|---|---|
| Active state | Left 2px indicator in `--action-primary` + `aria-current="page"` |
| Collapsed | Icon only, label in a tooltip, 64px |
| Groups | Collapsible, state persisted |
| Scroll | Independent of page content |
| Footer | Collapse toggle, version, help |
| Mobile | Off-canvas drawer, `--z-sidebar` above header |

Collapsed mode relies on tooltips for labels, which is the one acceptable tooltip-carries-information case — because the label is still in the accessible name of the link, so screen reader users are unaffected.

---

## 4. Page layout

```text
┌─ PageHeader ──────────────────────────────────┐
│ Breadcrumb                                    │
│ Title                        [Secondary][CTA] │
│ Status badges / metadata                      │
├───────────────────────────────────────────────┤
│ Optional: Banner (suspended, past due, …)     │
├───────────────────────────────────────────────┤
│ Optional: Tabs                                │
├───────────────────────────────────────────────┤
│ Content — max 1440px                          │
└───────────────────────────────────────────────┘
```

| Element | Rule |
|---|---|
| Breadcrumb | On detail pages; last item is the current page, not a link |
| Title | One `h1` per page (`03` §6) |
| Actions | At most one `primary`; the rest `secondary`/`ghost` |
| **Banners** | Account-level conditions — suspended, past due, over limit. Persistent, not toasts (`05` §6.2) |
| Tabs | URL-synced so a tab is linkable and survives reload |

URL-synced tabs matter operationally: a support agent sharing a link to a customer's Subscriptions tab should land their colleague on that tab, not on Overview.

---

## 5. Organization switcher

The UI for baseline §8 — one identity, many organizations, different roles in each.

```text
┌──────────────────────────────┐
│ ABC Restaurant Group      ▾  │
├──────────────────────────────┤
│ 🔍 Search organizations      │
│ ✓ ABC Restaurant · Admin     │
│   XYZ Cafe · Viewer          │
│   Delta Hotels · Staff       │
├──────────────────────────────┤
│ + Create organization        │
└──────────────────────────────┘
```

| Rule | Source |
|---|---|
| Hidden entirely when the user has one membership | No reason to show a chooser with one option |
| Each row shows the **role in that organization** | The same person has different authority in each |
| Search appears past ~7 organizations | |
| **Switching calls `POST /auth/organizations/{id}/select`** | `06` §4 of the architecture |
| A new org-scoped token is minted; the old cannot reach the new tenant | ADR-004 |
| **All server state is invalidated on switch** | Otherwise Org A's cached data renders under Org B's heading |
| Navigates to that organization's home, not the current route | The current route may not exist or may be unpermitted there |

The cache invalidation rule is the one most likely to be missed and the most damaging: a stale TanStack Query cache after an organization switch displays the previous tenant's data to the user. It looks like a cross-tenant leak even though the server behaved correctly, and a user cannot tell the difference.

---

## 6. Command palette (⌘K)

A genuine productivity feature for staff working across hundreds of customers.

| Group | Contents |
|---|---|
| Navigation | Any permitted page |
| Search | Organizations, users, products — async |
| Actions | Permitted actions, e.g. "Suspend organization…" |
| Theme | Light / Dark / System |
| Recent | Last visited records |

| Rule | Reason |
|---|---|
| Only permitted destinations and actions appear | Same filtering as the sidebar (§3.1) |
| **Dangerous actions open their ConfirmDialog**, never execute directly | A fuzzy-matched suspension is exactly the accident to prevent |
| Search is debounced and cancellable | |
| Full keyboard operation; Escape closes | |
| `--z-palette` (100), above everything | |

---

## 7. Product launcher popover

The compact form of baseline §12; the full experience is `07-product-launcher-ux.md`.

```text
┌─────────────────────────────────┐
│ OUR PRODUCTS            [⌕]     │
├─────────────────────────────────┤
│ MY PRODUCTS                     │
│ ┌────┐ ┌────┐ ┌────┐            │
│ │POS │ │Inv │ │CRM │            │
│ │●Act│ │●Act│ │Trial│           │
│ └────┘ └────┘ └────┘            │
│ EXPLORE                         │
│ ┌────┐ ┌────┐                   │
│ │KDS │ │Anly│                   │
│ │Learn│ │Expd│                  │
│ └────┘ └────┘                   │
├─────────────────────────────────┤
│ View all products →             │
└─────────────────────────────────┘
```

Grouping derives from `accessState` (`11` §3 of the architecture), not from two separate fetches. Both groups come from one `GET /me/products` call.

---

## 8. Public shell — discovery

Anonymous visitors see no app chrome:

```text
┌────────────────────────────────────────────┐
│ Logo        Products  Pricing   [Sign in]  │
├────────────────────────────────────────────┤
│ Content — prose max 72ch, sections full    │
├────────────────────────────────────────────┤
│ Footer                                     │
└────────────────────────────────────────────┘
```

Server-rendered (ADR-019) for SEO. An authenticated visitor sees "Go to dashboard" instead of "Sign in" — but the page itself is identical, so it stays cacheable.

---

## 9. Scroll and sticky behavior

| Element | Behavior |
|---|---|
| Header | Sticky always |
| Sidebar | Fixed, independently scrollable |
| Page content | The scroll container |
| Table header | Sticky within its container |
| Bulk action bar | Sticky to the bottom while rows are selected |
| Modal | Body scrolls; header and footer fixed |

**Only one scroll container at a time.** Nested scroll areas are disorienting with a trackpad and worse with a keyboard. Scroll position is restored on back-navigation; Next.js App Router handles this, and it must not be defeated by a custom scroll container.

---

## 10. Responsive summary

Full detail in `09-responsive-design.md`.

| Breakpoint | Shell |
|---|---|
| `< 768px` | Sidebar → off-canvas drawer; single column; launcher full-screen |
| `768–1024px` | Sidebar collapsed to icons; two columns |
| `≥ 1024px` | Full sidebar; multi-column |
| `≥ 1440px` | Content capped; centered |

---

## 11. Layout anti-patterns

| Forbidden | Why |
|---|---|
| Hardcoded nav items without a permission | Produces links to 403s |
| Rendering an empty section header | Noise |
| Nested scroll containers | Disorienting |
| **Keeping cached data across an organization switch** | Appears as a cross-tenant leak |
| Modals that open modals | Focus management becomes unreliable |
| Breadcrumbs that lie about hierarchy | |
| A sidebar wider than 280px | Steals content width at laptop sizes |
| Full-page spinners for partial loads | Skeletons preserve layout |
| Hiding the launcher on any authenticated surface | Baseline §12 requires it in central navigation |

---

Next: `07-product-launcher-ux.md`.
