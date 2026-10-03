/**
 * Tenant scope — ADR-012, Layer 2 (structural tenant isolation).
 *
 * `OrgScope` is a branded wrapper around an OrganizationId that repository methods
 * require as their first parameter. Because it is branded, a bare string or a raw
 * OrganizationId cannot be passed in its place, and it can only be constructed by
 * `fromVerifiedToken` — which, by convention, is called ONLY by the middleware
 * that derived the organization from a verified access token.
 *
 * The effect: a query that omits tenant scoping does not type-check. "Remember to
 * scope your query" becomes a compiler error rather than a convention that fails
 * eventually and leaks one tenant's data to another.
 *
 * Cross-tenant reads for company staff do NOT use this type. They go through
 * explicitly-named, platform-permission-gated, audited repository methods
 * (ADR-012, Layer 3) — so the dangerous capability is visible in one place.
 */

import type { OrganizationId } from './ids.js'

declare const scopeBrand: unique symbol

export interface OrgScope {
  readonly organizationId: OrganizationId
  readonly [scopeBrand]: 'OrgScope'
}

export const OrgScope = {
  /**
   * Construct a scope from an organization id that has ALREADY been authenticated
   * and authorized by middleware. The name is the contract: never call this with
   * an organization id taken from a request body, query or path (ADR-012).
   */
  fromVerifiedToken(organizationId: OrganizationId): OrgScope {
    return { organizationId, [scopeBrand]: 'OrgScope' } as OrgScope
  },
} as const

/**
 * Platform (cross-tenant) scope marker, for company-staff operations and system
 * jobs. Distinct type from OrgScope so a function that accepts one cannot
 * silently accept the other.
 */
declare const platformBrand: unique symbol

export interface PlatformScope {
  readonly [platformBrand]: 'PlatformScope'
}

export const PlatformScope = {
  /** Construct only after a platform-scoped permission check has passed. */
  fromVerifiedPlatformGrant(): PlatformScope {
    return { [platformBrand]: 'PlatformScope' } as PlatformScope
  },
} as const
