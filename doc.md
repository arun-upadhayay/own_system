
# Company Central Control Plane
## System Baseline & Product Ecosystem Architecture
### Version 1.2

---

## 1. Document Purpose

This document defines the baseline architecture, product vision, system boundaries, business rules, user model, subscription model, access model, and responsibilities of the Company's **Central Control Plane**.

This document is the **Source of Truth** for all future architecture and implementation decisions related to the central platform.

Future HLD, LLD, ERD, API contracts, UI/UX specifications, authentication architecture, subscription architecture, and development prompts must remain consistent with this baseline unless this document is explicitly revised.

---

# 2. Product Vision

The company is building multiple independent software products for different business needs.

The Central Control Plane will provide a unified platform through which organizations can:

- Create/manage their company account
- Authenticate using a single account
- Discover all company products
- See which products they currently own
- Access subscribed products
- Discover products they have not purchased
- Request demos or contact the company for unavailable products
- Manage their organization's users
- Assign roles and permissions
- Operate within subscription-defined limits
- Upgrade their subscriptions
- Manage organization-level settings

The company's internal team will use the same Control Plane to:

- Manage organizations
- Manage customers
- Manage products
- Manage plans
- Manage subscriptions
- Control product entitlements
- Manage customer account ownership
- Monitor usage
- Manage support
- Review audit activity
- Handle upgrades/downgrades
- Control system-level access

---

# 3. Core Concept

The fundamental architecture is:

**One Company Account → One Central Identity → One Control Plane → Product Launcher → Multiple Independent Products**

The platform should provide a Google-like product ecosystem experience while being designed specifically for the company's SaaS business model.

The company should not build a separate account system for every product.

Instead:

```text
                    CENTRAL CONTROL PLANE
                             |
                      CENTRAL IDENTITY
                             |
                  PRODUCT LAUNCHER
                             |
          +------------------+------------------+
          |                  |                  |
         POS             Inventory             KDS
          |                  |                  |
       Product A          Product B          Product C
```

Each individual product remains an independent application with its own domain/business logic, while identity, organization context, subscription entitlement, and product access are centrally managed.

---

# 4. Important Scope Definition

## 4.1 In Scope

This project includes:

- Central authentication
- SSO
- Organizations
- Users
- Organization memberships
- Roles
- Permissions
- Products
- Product registry
- Product features
- Product entitlements
- Plans
- Subscriptions
- Subscription limits
- Product launcher
- Product discovery
- Upgrade/contact flows
- Customer account management
- Organization-level user management
- Usage overview
- Billing metadata
- Audit logs
- Internal company administration
- Support/account ownership
- Product access control

## 4.2 Out of Scope

The Control Plane does NOT own the internal business logic of individual products.

For example:

POS owns:

- Orders
- Tables
- Payments
- Receipts
- POS-specific workflows

Inventory owns:

- Stock
- Purchase
- Suppliers
- Inventory workflows

KDS owns:

- Kitchen queues
- Stations
- Preparation workflow

These systems are owned by their respective product teams.

The Control Plane only manages their ecosystem-level:

- Identity
- Organization
- Product registration
- Subscription
- Entitlement
- Access
- User/role context
- Product discovery
- Platform administration

---

# 5. Primary Users

The platform has two major user categories.

## 5.1 Company/Internal Users

These are employees or authorized people from the company.

Examples:

- Platform Administrator
- Super Administrator
- Sales/Account Manager
- Customer Success Manager
- Support Agent
- Billing Administrator
- Operations Administrator

They manage customer organizations and the company's product ecosystem.

## 5.2 Organization/Customer Users

These are users belonging to a customer organization.

Examples:

- Organization Owner
- Organization Admin
- Product Admin
- Manager
- Staff
- Viewer

They use subscribed products and manage their organization's users according to their permissions.

---

# 6. Core Hierarchy

The system hierarchy is:

```text
Company
   |
   └── Organizations
          |
          ├── Branches
          |
          ├── Users
          |
          ├── Roles
          |
          ├── Products
          |
          ├── Subscriptions
          |
          └── Product Usage
```

A customer organization can represent:

- Restaurant
- Restaurant Group
- School
- Hotel
- Retail Business
- Enterprise
- Any future supported business

The Control Plane must therefore remain domain-agnostic.

---

# 7. Organization Model

An Organization represents a customer/business using the company's platform.

Example:

```text
ABC Restaurant Group

Branches:
- Delhi
- Noida
- Gurgaon

Users:
- Owner
- Manager
- Staff
```

An organization can subscribe to multiple products.

Example:

```text
ABC Restaurant

POS        → Pro
Inventory  → Basic
KDS        → Enterprise
CRM        → Not subscribed
```

---

# 8. User Model

A User represents a human identity.

A user is NOT permanently tied to one organization.

A user may belong to multiple organizations.

Example:

```text
Arun

Organization A
→ Admin

Organization B
→ Viewer
```

This requires a Membership model.

```text
User
 |
 └── Membership
       |
       ├── Organization
       └── Role
```

---

# 9. Organization Membership

Membership connects a user to an organization.

Example:

```text
Arun
   |
   └── Membership
          |
          ├── ABC Restaurant
          ├── Role: Admin
          └── Status: Active
```

This allows:

- Multi-organization users
- Different roles per organization
- Different permissions per organization

---

# 10. Branch Model

An organization may contain multiple branches.

```text
Organization
   |
   ├── Branch A
   ├── Branch B
   └── Branch C
```

Branch context can later be used for product-specific access.

Example:

```text
Arun
Organization: ABC Restaurant
Active Branch: Noida
```

The exact branch-level permission model will be defined later during RBAC design.

---

# 11. Product Registry

The Control Plane maintains a global registry of company products.

Example:

```text
Products

POS
Inventory
KDS
CRM
Billing
Analytics
HR
```

Each product has platform metadata such as:

- ID
- Name
- Slug
- Description
- Icon
- Application URL
- Status
- Category
- Version
- Product owner/team
- Availability status

The product registry must be global.

Products should NOT be duplicated for every organization.

Correct model:

```text
PRODUCTS

POS
Inventory
KDS

ORGANIZATION_PRODUCTS

ABC → POS
XYZ → POS
ABC → Inventory
```

---

# 12. Product Launcher

The platform will provide a Google-inspired Product Launcher.

The launcher will be available from the central navigation.

Example:

```text
                    Company Logo

Dashboard        ⠿       Notifications       User
                 |
                 ↓

        +-----------------------------+
        |       OUR PRODUCTS          |
        |                             |
        | 🟢 POS       ⚪ Inventory    |
        | ⚪ KDS        ⚪ CRM          |
        | ⚪ Billing    ⚪ Analytics    |
        +-----------------------------+
```

The launcher shows the complete company product ecosystem.

Products are visually differentiated based on access status.

---

# 13. Product Access States

A product can have multiple states.

### Active

The organization has an active subscription and the user has access.

```text
🟢 POS
```

### Not Subscribed

The product exists but the organization has not purchased it.

```text
⚪ Inventory
```

### Trial

The organization has temporary access.

```text
🟡 CRM
```

### Expired

Subscription expired.

```text
🔴 Analytics
```

### Suspended

Company has disabled access.

```text
🔴 Billing
```

Exact UI colors are implementation details; the underlying states must remain explicit in the data model.

---

# 14. Non-Subscribed Product Experience

A non-subscribed product should NOT simply behave like a disabled button.

If a user clicks it, they should see a product discovery page.

Example:

```text
Inventory Management

Manage your inventory efficiently.

Features:
✓ Stock management
✓ Purchase management
✓ Supplier management
✓ Inventory reports

--------------------------------

Interested in Inventory?

[ Request Demo ]
[ Contact Our Team ]
```

This makes the Control Plane both:

- Product launcher
- Product discovery/marketplace

---

# 15. Product Subscription Model

A subscription determines what an organization has purchased.

Basic relationship:

```text
Organization
      |
      ↓
Subscription
      |
      ↓
Plan
      |
      ↓
Product / Features / Limits
```

Example:

```text
ABC Restaurant
       |
       ↓
POS Pro
       |
       ├── POS
       ├── 2 Users
       ├── Standard Features
       └── Subscription Active
```

---

# 16. Product-Level Subscription

Subscriptions must support multiple products.

Example:

```text
ABC Restaurant

POS
→ Pro

Inventory
→ Basic

KDS
→ Enterprise
```

Therefore the architecture should not assume:

```text
Organization → One Plan
```

Instead it should support:

```text
Organization
   |
   ├── Product Subscription A
   ├── Product Subscription B
   └── Product Subscription C
```

A future bundled subscription model can be introduced without redesigning the core architecture.

---

# 17. Plans

Plans define what a customer receives.

> **Clarification (v1.1, 2026-10-01):** Every numeric limit shown in this section and in §18 is an **illustrative example only**. Real limits are commercial configuration, decided by the company per plan and, where a deal requires it, per individual customer. Limits are therefore stored as configuration data (plan feature rows, with per-subscription overrides) and must never appear as constants in source code. Changing a customer's limit is a configuration change, not a code change or a deployment. See ADR-010.

Example:

```text
POS

Basic
Pro
Enterprise
```

A plan can define:

- Product
- Features
- User limits
- Branch limits
- Storage limits
- Usage limits
- Support level
- Other product-specific entitlements

Example:

```text
POS Pro

Users: 2
Branches: 3
Features:
- Orders
- Tables
- Payments
- Reports
```

---

# 18. Subscription Limits

Subscription limits are critical.

> **Clarification (v1.1, 2026-10-01):** The "Maximum Users = 2" below is an example value, not a platform rule. The architectural requirements are that a limit is (a) configurable per plan and overridable per subscription, (b) resolved server-side at the moment of the action, and (c) enforced race-safely so concurrent requests cannot together exceed it. See ADR-010 and ADR-011.
>
> **Clarification (v1.2, 2026-10-01) — what a user limit counts.** Confirmed as the business model: a user limit is a count of **seats on a product subscription**, not of members of an organization. "POS Pro → Maximum Users = 2" means two members may be granted POS access; the same organization may simultaneously hold ten Inventory seats. Organization membership itself is uncapped — a member granted no product consumes no seat. Branch limits are organization-scoped instead, resolved as the maximum across the organization's access-granting subscriptions. See ADR-018.

Example:

```text
POS Pro
Maximum Users = 2
```

Organization currently:

```text
Users:

1. Owner
2. Manager
```

Attempt to add a third user:

```text
User limit reached.

Your current plan allows 2 users.

[ Upgrade Plan ]
```

The organization cannot bypass the limit through the UI or API.

Limits must be enforced server-side.

---

# 19. Organization User Management

Organization administrators can create and manage users.

Example:

```text
ABC Restaurant
      |
      └── Organization Admin
              |
              ├── Owner
              ├── Manager
              └── Staff
```

The organization can:

- Invite users
- Remove users
- Assign roles
- Disable users
- Change permissions where allowed

However, the organization's ability to create users is constrained by the active subscription.

---

# 20. Company vs Organization Responsibility

This boundary is fundamental.

```text
YOUR COMPANY
      |
      | controls
      ↓
Organization
      |
      | manages
      ↓
Organization Users
```

### Company controls:

- Products
- Plans
- Subscription
- Product activation
- Product suspension
- Customer account
- Billing
- User limits
- Organization status
- Support
- Account ownership

### Organization controls:

- Its own users
- Its own roles
- User invitations
- Product-specific internal access
- Branches where permitted
- Internal organization settings

---

# 21. Customer Account Management

Each organization may have an internal company-side account owner.

Example:

```text
ABC Restaurant

Account Manager:
Rahul

Support Owner:
Neha

Customer Status:
Active

Subscription:
POS Pro
```

The company's internal team can manage the relationship with the customer.

This allows the Control Plane to support:

- Sales
- Customer success
- Support
- Renewals
- Upgrades
- Account ownership

---

# 22. RBAC

Authorization follows:

```text
User
 ↓
Membership
 ↓
Role
 ↓
Permissions
```

Example:

```text
Inventory Manager

inventory.stock.read
inventory.stock.update
inventory.purchase.read
inventory.purchase.create
```

Roles can be:

### Company-level

```text
Super Admin
Platform Admin
Support Agent
Account Manager
Billing Admin
```

### Organization-level

```text
Organization Owner
Organization Admin
Product Manager
Staff
Viewer
```

---

# 23. Product Access vs User Permission

These are separate concepts.

### Product entitlement

Determines:

> Can this organization use the product?

### User authorization

Determines:

> Can this particular user use this product and perform this action?

Final access requires both.

```text
Organization Active
        AND
Product Subscription Active
        AND
User Membership Active
        AND
User Permission Valid
        AND
Subscription Limit Valid
```

Only then should access be granted.

---

# 24. Central Authentication / SSO

Authentication is centralized.

```text
                    CENTRAL IDENTITY
                           |
            +--------------+--------------+
            |              |              |
           POS         Inventory          KDS
```

A user should authenticate once.

If already logged in:

```text
Control Plane
      ↓
Click POS
      ↓
POS
      ↓
No Login Required
```

If directly visiting a product:

```text
POS
 ↓
No Session
 ↓
Central Authentication
 ↓
Login
 ↓
Return to POS
```

Products must not maintain separate independent customer credentials unless a future technical requirement explicitly requires it.

---

# 25. Organization Context

Every relevant request must understand:

```text
Who?
What Organization?
What Role?
What Product?
What Permissions?
What Branch?
```

Example:

```text
User:
Arun

Organization:
ABC Restaurant

Role:
Inventory Manager

Product:
Inventory

Branch:
Noida

Permissions:
stock.read
stock.update
```

This context is essential for tenant isolation.

---

# 26. Multi-Tenant Security Principle

Organization-owned resources must always be scoped to the organization.

The system must never rely only on:

```text
user_id
```

It must also verify:

```text
organization_id
```

Conceptually:

```text
Resource.organization_id
==
CurrentContext.organization_id
```

This rule must be applied throughout the platform and integrated product architecture.

---

# 27. Internal Company Admin Console

The company requires a separate administrative experience.

Primary navigation:

```text
Dashboard

Organizations
Users

Products
Features

Plans & Pricing
Subscriptions

Billing

Usage & Analytics

Customer Accounts
Support

Audit Logs

System Settings
```

---

# 28. Organization Detail Page

The internal team should be able to see:

```text
ABC Restaurant
────────────────────────────

Status:
Active

Account Manager:
Rahul

Products:
✓ POS
✓ Inventory
○ KDS
○ CRM

Subscriptions:
POS Pro
Inventory Basic

Users:
2 / 2

Branches:
3

Usage:
...

Billing:
...

Recent Activity:
...
```

This becomes the company's primary customer management view.

---

# 29. Internal Product Management

The company can manage the product registry.

Example:

```text
POS
Status: Active
URL: pos.company.com

Inventory
Status: Active
URL: inventory.company.com

KDS
Status: Beta
URL: kds.company.com
```

The Control Plane should be able to register future products without architectural changes.

---

# 30. Usage

The platform may maintain product-level usage information.

Examples:

```text
POS
Orders: 12,430

Inventory
Items: 2,300

Users:
2 / 2

Branches:
3 / 5
```

Usage can later support:

- Analytics
- Billing
- Limits
- Customer success
- Upgrade recommendations

---

# 31. Audit Logs

Important platform actions must be auditable.

Examples:

```text
Rahul
→ Activated POS Pro
→ ABC Restaurant

Admin
→ Suspended Organization

Neha
→ Added user

Billing Admin
→ Changed subscription
```

Audit records should include:

- Actor
- Organization
- Action
- Resource
- Resource ID
- Timestamp
- Metadata
- IP/user-agent where appropriate

---

# 32. Product Integration Boundary

Individual products remain independent.

Example:

```text
                 CONTROL PLANE

        Identity
        Organization
        Subscription
        Entitlement
        RBAC
             |
      +------+------+
      |      |      |
     POS  Inventory KDS
      |      |      |
   Own DB  Own DB  Own DB
   Own API Own API Own API
   Own Logic Own Logic
```

The Control Plane should not become a giant database containing every product's business tables.

Each product team owns its domain.

---

# 33. Recommended Initial Architecture

The initial system should be modular rather than prematurely distributed.

Conceptually:

```text
                    API / BFF
                       |
              +--------+--------+
              |                 |
         Identity/Auth     Control Plane Core
                                |
             +------------------+----------------+
             |          |        |       |       |
        Organizations Products Plans Subs Access Audit
```

Shared infrastructure may include:

```text
PostgreSQL
Redis
Object Storage
Message Broker
Observability
```

Kafka/event-driven architecture can be introduced wherever asynchronous cross-product events are required.

---

# 34. Future Service Extraction

The architecture must allow future extraction:

```text
Control Plane
     |
     +── Identity Service
     +── Organization Service
     +── Product Service
     +── Subscription Service
     +── Billing Service
     +── Usage Service
     +── Audit Service
```

However, services should only be separated when there is a real need based on:

- Scale
- Team ownership
- Deployment independence
- Reliability
- Performance
- Domain boundaries

---

# 35. Core Database Entities

Initial central database model should contain concepts around:

```text
users

organizations
branches
memberships

roles
permissions
role_permissions

products
features

plans
plan_features

subscriptions
organization_products

usage_records

customer_accounts

audit_logs
```

Exact columns, constraints, indexes, normalization and database technology details will be finalized during the ERD phase.

---

# 36. Product Launcher Flow

```text
User Login
     ↓
Central Identity
     ↓
Organization Context
     ↓
Fetch Organization Products
     ↓
Evaluate Subscription
     ↓
Evaluate User Permissions
     ↓
Render Product Launcher
```

Example:

```text
POS          → Active
Inventory    → Not Subscribed
KDS          → Not Subscribed
CRM          → Trial
```

---

# 37. Product Opening Flow

### Purchased Product

```text
Launcher
   ↓
POS
   ↓
SSO Context
   ↓
Validate Access
   ↓
Open POS
```

### Non-Purchased Product

```text
Launcher
   ↓
Inventory
   ↓
Product Information Page
   ↓
Request Demo / Contact Team
```

### Direct URL

```text
inventory.company.com
       ↓
Authenticate
       ↓
Resolve Organization
       ↓
Check Subscription
       ↓
Check User Permission
       ↓
Allow / Deny
```

---

# 38. Product Discovery Model

The platform should intentionally expose the broader company ecosystem.

This creates two separate experiences:

### My Products

Products the organization currently uses.

### Explore Products

Products available for discovery/purchase.

Example:

```text
MY PRODUCTS

POS
Inventory


EXPLORE PRODUCTS

KDS
CRM
Analytics
HR
```

The UI may combine these into a single launcher using visual states, but the underlying concepts should remain distinct.

---

# 39. Upgrade Flow

Example:

```text
User reaches limit
       ↓
"User limit reached"
       ↓
View available plans
       ↓
Upgrade
       ↓
Subscription updated
       ↓
New entitlement activated
       ↓
New user/product feature available
```

The exact payment provider and billing implementation will be defined later.

---

# 40. Core Business Rules

These rules should remain stable unless explicitly changed.

### Rule 1

One central identity can access multiple company products.

### Rule 2

Products remain independently owned applications.

### Rule 3

An organization can subscribe to multiple products.

### Rule 4

Product access is subscription/entitlement based.

### Rule 5

User access is role/permission based.

### Rule 6

Subscription limits must be enforced server-side.

### Rule 7

Organization users cannot exceed subscription limits.

### Rule 8

Non-subscribed products remain discoverable.

### Rule 9

Non-subscribed products open a product information/conversion page.

### Rule 10

Company admins manage customer organizations and subscriptions.

### Rule 11

Organization admins manage their organization's users within company-defined limits.

### Rule 12

Organization-owned data must be tenant-isolated.

### Rule 13

The Control Plane must not own individual product business logic.

### Rule 14

New products should be addable through the Product Registry without redesigning the Control Plane.

### Rule 15

The architecture must support future expansion beyond restaurants.

---

# 41. Future-Proofing Principle

The Control Plane must NOT be named or designed internally as a "Restaurant Management System."

It is a:

**Company Product Ecosystem Platform**

Restaurant products are simply the first major product ecosystem.

Future:

```text
Company Platform
│
├── Restaurant Products
│   ├── POS
│   ├── Inventory
│   └── KDS
│
├── Education Products
│   ├── School Management
│   └── LMS
│
├── Retail Products
│   └── Retail Management
│
└── Future Products
```

The Control Plane remains common.

---

# 42. Architectural North Star

The entire system should follow this principle:

```text
                    ONE ACCOUNT
                         |
                    ONE IDENTITY
                         |
                  ONE CONTROL PLANE
                         |
                  ONE PRODUCT LAUNCHER
                         |
        +----------------+----------------+
        |                |                |
       POS           INVENTORY            KDS
        |                |                |
   Independent       Independent      Independent
    Product            Product          Product
```

The company owns the ecosystem.

Each product owns its business domain.

The organization owns its users.

The subscription determines entitlement.

RBAC determines user authorization.

The Control Plane connects everything together.

---

# 43. Source-of-Truth Rule

This document is the baseline architecture.

Before implementing any future component, the following questions must be answered:

1. Does this belong to the Control Plane?
2. Does this belong to an individual product?
3. Is this an organization-level concern?
4. Is this a user-level concern?
5. Is this subscription/entitlement logic?
6. Is this authorization logic?
7. Does this violate product independence?
8. Does this preserve multi-tenant isolation?
9. Can a future product use the same architecture?
10. Does the change require updating this baseline?

If a major architectural decision changes these principles, this document must be updated to a new version.

---

# 44. Current Architecture Status

### Confirmed

- Central Control Plane
- Central Identity
- SSO
- Multi-tenant Organizations
- Multiple Products
- Product Launcher
- Product Discovery
- Product Subscription
- Product-level Entitlements
- Plan-based Limits
- Organization User Management
- RBAC
- Customer Account Management
- Usage
- Audit Logs
- Future Product Extensibility
- Independent Product Ownership

### Intentionally Not Finalized Yet

- Exact database columns
- Exact ERD
- Authentication provider
- OAuth/OIDC implementation
- Token strategy
- Billing provider
- Payment architecture
- Kafka event contracts
- API gateway implementation
- Deployment architecture
- Exact frontend architecture
- Exact UI design system
- Detailed product integration contracts

These will be designed in subsequent architecture phases.

---

# 45. Planned Next Architecture Phases

The recommended sequence is:

```text
PHASE 1
System Baseline
        ↓
PHASE 2
Detailed ERD
        ↓
PHASE 3
HLD
        ↓
PHASE 4
Identity + SSO Architecture
        ↓
PHASE 5
RBAC + Entitlement Architecture
        ↓
PHASE 6
Subscription + Plan + Limit Architecture
        ↓
PHASE 7
Product Integration Contract
        ↓
PHASE 8
API Architecture
        ↓
PHASE 9
Admin Console Information Architecture
        ↓
PHASE 10
UI/UX Design System
        ↓
PHASE 11
LLD
        ↓
PHASE 12
Implementation Master Prompt
        ↓
PHASE 13
Development
        ↓
PHASE 14
Testing + Security + Deployment
```

---

# Final Definition

The product being built is a **central SaaS Control Plane for the company's entire software ecosystem**.

It provides a single identity and central account for organizations, exposes all company products through a Google-inspired Product Launcher, distinguishes subscribed and non-subscribed products, provides product discovery and conversion flows for unavailable products, manages product subscriptions and plan-based limits, allows organizations to manage their own users, provides RBAC and SSO, and gives the company's internal team a complete administrative system for organizations, customers, products, subscriptions, access, usage, support, and auditing.

The Control Plane does not replace the individual products. It sits above them and provides the common platform capabilities that allow multiple independent products to operate as one unified company ecosystem.

**North Star:**

> **One Account. One Identity. One Control Plane. Multiple Products. Centralized Entitlements. Organization-Level Management. Independent Product Domains.**

**Document Version:** 1.2 (v1.0 baseline + limit-configurability and seat-dimension clarifications; see docs/architecture/22-change-log.md)  
**Status:** Baseline / Architecture Source of Truth  
**Scope:** Company Central Control Plane  
**Primary Product Ecosystem:** Multi-product SaaS  
**Initial Domain:** Restaurant products, with domain-agnostic architecture for future expansion.