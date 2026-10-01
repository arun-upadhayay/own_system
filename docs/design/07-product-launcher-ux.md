# 07 — Product Launcher UX

The platform's front door (baseline §12, §13, §14, §36, §37, §38). Implements the UX for `docs/architecture/11-product-launcher.md`.

The launcher is where the "one ecosystem" promise either reads as real or does not. It is also the surface most at risk of accumulating product-specific code, so every pattern here is built from registry data.

---

## 1. What the launcher must do

| Requirement | Baseline |
|---|---|
| Show the **complete** product ecosystem, including unbought products | §38 |
| Differentiate products visually by access state | §13 |
| Open subscribed products with no second login | §24, §37 |
| Send unsubscribed products to a **discovery page**, not a disabled button | §14 |
| Support search and categorization | §12 |
| Determine access **dynamically from the backend** | §36, ADR-013 |

Showing unbought products is a commercial decision, not clutter: the launcher is simultaneously a launcher and a marketplace (§14).

---

## 2. Two presentations

| Form | Trigger | Use |
|---|---|---|
| **Popover** | ⠿ in the header | Quick switch from anywhere |
| **Full page** | `/` or "View all products" | Browsing, search, discovery |

Both consume one `GET /me/products` call and render the same tile component. Two code paths rendering the same data would eventually disagree.

---

## 3. Full-page launcher

```text
┌──────────────────────────────────────────────────────────────┐
│  Products                                    [⌕ Search    ]  │
│  Everything your organization can use                        │
├──────────────────────────────────────────────────────────────┤
│  MY PRODUCTS                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│  │ ▌ [icon] │ │ ▌ [icon] │ │ ▌ [icon] │                      │
│  │   POS    │ │Inventory │ │   CRM    │                      │
│  │ Point of │ │ Stock &  │ │ Customer │                      │
│  │ sale…    │ │ supply…  │ │ records… │                      │
│  │ ● Active │ │ ● Active │ │ ◐ Trial · 6 days │              │
│  └──────────┘ └──────────┘ └──────────┘                      │
│                                                              │
│  EXPLORE PRODUCTS                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                      │
│  │   KDS    │ │Analytics │ │ Billing  │                      │
│  │ Kitchen… │ │ Reports… │ │ Invoic…  │                      │
│  │ Learn →  │ │ ○ Expired│ │ Learn →  │                      │
│  └──────────┘ └──────────┘ └──────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

`▌` is the product's own accent stripe from `products.accent_color`, scoped to the tile (`04` §5).

### 3.1 Grouping

Baseline §38 keeps "My Products" and "Explore Products" conceptually distinct while allowing one visual surface.

| Group | States |
|---|---|
| **My Products** | `active`, `trialing`, `past_due` — and `expired`, `suspended` for products the organization *has* held |
| **Explore Products** | `not_subscribed` |

A product that has lapsed stays in **My Products**, not Explore. It is part of the customer's history and its renewal path is more valuable than a cold marketing pitch — which is exactly why the `expired` state had to be reachable at all (architecture review R-6).

Within groups: category, then `sort_order`, then name — all registry data.

---

## 4. Tile anatomy and states

```text
┌─────────────────┐
│ ▌  [icon]       │   accent stripe + registry icon
│                 │
│  Product Name   │   --text-h3
│  Tagline, two   │   --text-sm, clamped to 2 lines
│  lines maximum  │
│                 │
│  ● Active       │   AccessStateBadge
└─────────────────┘
```

| `accessState` | Badge | Tile | Click |
|---|---|---|---|
| `active` | ● Active (`good`) | Full color, hover lift | **Opens product** |
| `trialing` | ◐ Trial · N days (`info`) | Full color | **Opens product** |
| `active` + `paymentAttentionRequired` | ● Active + ⚠ (`warning`) | Full color | Opens; banner warns |
| `expired` | ○ Expired (`serious`) | Desaturated | **Renewal page** |
| `suspended` | ⊘ Unavailable (`critical`) | Desaturated | Explanation + support |
| `not_subscribed` | Learn more → (**neutral**) | Muted, accent retained | **Discovery page** |
| `active`, no seat | ● Active · No access | Muted | "Ask your administrator" |
| `org_inactive` | — | Whole grid replaced by an account notice | — |

### 4.1 Rules the tile must honor

| Rule | Source |
|---|---|
| **No branch on slug, name or id** | C1, ADR-013 |
| Icon from `iconUrl`; accent from `accentColor` | Registry data |
| `canOpen` comes from the backend | C5 |
| **No `appUrl` in the payload when denied** | C5 — absence, not CSS hiding |
| `not_subscribed` is **neutral, never an error** | `04` §4.1 |
| Trial days remaining computed from `trialEndsAt` | Display only |

### 4.2 Entitled but no seat

A product the organization pays for, which this user has not been granted (ADR-018). The tile says **"Ask your administrator"** rather than hiding the product.

Hiding it would be worse: the user would not know the capability exists and would raise a support ticket instead of asking the person who can actually grant the seat in one click.

---

## 5. Opening a product

```text
Click → POST /me/products/{slug}/open → 302 → product → OIDC SSO → lands
```

The open is **re-authorized server-side** (`11` §4 of the architecture). The launcher payload is a snapshot; a subscription can lapse or a seat be revoked between render and click, so a stale tab must not be a bypass.

| UX detail | Behavior |
|---|---|
| Tile shows a loading state on click | The redirect is not instant |
| Opens in the same tab by default | Products are destinations, not popups |
| ⌘-click / middle-click opens a new tab | Standard link behavior preserved |
| Denied on re-check | Toast with the reason + path forward, tile state refreshed |

The last row is the honest case: the user clicked something the UI said was available, and the server disagreed. The response explains rather than failing silently.

---

## 6. Discovery page

Baseline §14 is explicit that a non-subscribed product must not behave like a disabled button. Route: `/products/{slug}`, **server-rendered, publicly reachable** (ADR-019).

```text
┌──────────────────────────────────────────────┐
│ ▌ [icon]  Inventory Management               │
│           Stock, suppliers and purchasing    │
│           [ Request demo ] [ Contact team ]  │
├──────────────────────────────────────────────┤
│ What it does                                 │
│ Prose from products.description — 72ch       │
├──────────────────────────────────────────────┤
│ Features                                     │
│ ✓ Stock management      ✓ Supplier records   │
│ ✓ Purchase orders       ✓ Inventory reports  │
├──────────────────────────────────────────────┤
│ Discovery sections (repeatable, ordered)     │
├──────────────────────────────────────────────┤
│ Plans                                        │
│ Basic / Pro / Enterprise — public plans only │
├──────────────────────────────────────────────┤
│ Interested?                                  │
│ [ Request demo ] [ Contact team ] [ Trial ]  │
└──────────────────────────────────────────────┘
```

**Every element is data.** `products`, public `features` (`is_public`), `product_discovery_sections`, public `plans`. Marketing changes copy without a deployment — and if this content lived in the frontend, every positioning change would need an engineer and a release.

| Variant | Difference |
|---|---|
| Anonymous | "Sign in" in the header; requests capture contact fields |
| Authenticated, not subscribed | Prefilled contact details; "Start trial" if a plan offers one |
| Authenticated, subscribed | Banner: "Your organization uses this" + Open |

---

## 7. Conversion

```text
POST /products/{slug}/requests
{ requestType, message, source }
```

| `source` | Set when | Intent |
|---|---|---|
| `launcher` | From a tile | Browsing |
| `discovery_page` | From the page | Interested |
| **`limit_reached`** | From a 409 upgrade prompt | **Highest** |

`limit_reached` is a customer blocked **right now** by a limit (baseline §39). It is the clearest buying signal the platform produces, and `18` §10 sorts the support queue by it. Treating it as an ordinary lead wastes it.

| UX detail | Behavior |
|---|---|
| Modal, not a route change | The visitor keeps their place on the page |
| Contact fields prefilled when authenticated | |
| Confirmation names the next step | "Our team will contact you within one business day" |
| Idempotency key on submit | Double-submit does not create two leads (`13` §6) |
| Failure keeps the form filled | Re-typing a message after an error is the fastest way to lose a lead |

---

## 8. Search

Client-side filtering over the already-fetched product list — the set is tens of items, so a server round trip would be slower and worse.

Matches name, tagline, description and category — all registry fields. Keyboard: `/` focuses, arrows move, Enter activates, Escape clears. No results shows a message plus a "contact us about something else" path, because a search miss is still interest.

---

## 9. Required states

| State | Treatment |
|---|---|
| Loading | **Skeleton tiles** in the final grid — the layout is known, so it must not shift |
| No products registered | "Products are being set up" — only possible pre-launch |
| No subscriptions | Explore-only, framed as discovery rather than emptiness |
| Organization suspended | Account notice replaces the grid, with support contact |
| No organization selected | Organization chooser (`06` §3.1 of the architecture) |
| Membership suspended | Access notice directing to their administrator |
| **Fetch failed** | Error + Retry. **Never an empty grid** |
| Open denied | Toast with reason, tile refreshed |

**"Never an empty grid" is the critical one.** An empty launcher implies the company has no products — a worse and more confusing lie than an honest error message.

---

## 10. Motion

| Interaction | Treatment |
|---|---|
| Popover open | Fade + 4px rise, 180ms `ease-out` |
| Tile hover | Border and shadow only, 120ms. **No scale** |
| Tile click | Subtle press, then loading |
| Group reveal | Fade, no stagger |

No scale on hover: a grid of scaling tiles reads as consumer-playful, against `00` §4. No stagger: staggered entry delays the last tile, and a launcher is a thing people want *immediately*.

---

## 11. Anti-patterns

| Forbidden | Why |
|---|---|
| Branching on product slug | ADR-013; lint-enforced |
| An icon map keyed by product | Icons are registry data |
| Hiding unsubscribed products | Baseline §38 requires discoverability |
| A disabled button for unsubscribed | Baseline §14 requires a discovery page |
| Coloring `not_subscribed` as an error | It is an opportunity |
| Computing `canOpen` client-side | C5 |
| Trusting the payload on click | State changes between render and click |
| `appUrl` present but hidden | One devtools inspection from being tried |
| Hardcoded categories | Registry data |
| Discovery copy in the frontend | Marketing cannot edit a deployment |

---

Next: `08-admin-console-ux.md`.
