/**
 * Organization context resolution — the tenant-isolation gate for this module
 * (ADR-012, 07 §7).
 *
 * The acting organization comes ONLY from the verified access token's `org` claim,
 * never from a request body, query or path. Where a route carries an org id in the
 * path (`/organizations/:id`), it must EQUAL the token's org, and a mismatch is a
 * 404 — never a 403, because 403 would confirm the other organization exists
 * (07 §9). Everything else (`/memberships`, `/branches`, `/invitations`) operates
 * on the token's org with no id in the path, so it is tenant-safe by construction.
 *
 * Membership and organization status are re-verified against the database on every
 * request (ADR-004): a token minted before a suspension must not keep working.
 */

import { sql } from 'kysely'
import { NotFoundError, ForbiddenError, OrganizationId, OrgScope, type OrgScope as OrgScopeT } from '@cp/core'
import { withOrgScope } from '@cp/db'
import type { FastifyRequest } from 'fastify'
import { requireIdentity } from '../../identity/http/auth-middleware.js'
import type { OrgModuleContext } from '../application/context.js'

export interface OrgContext {
  scope: OrgScopeT
  organizationId: string
  userId: string
  membershipId: string
  isOwner: boolean
}

/**
 * Resolve and verify the caller's active membership in the token's organization.
 * Throws 404 if there is no active org context (indistinguishable from "no such
 * organization"), matching the cross-tenant non-disclosure rule.
 */
export async function requireMember(
  ctx: OrgModuleContext,
  request: FastifyRequest,
  pathOrgId?: string,
): Promise<OrgContext> {
  const identity = requireIdentity(request)
  if (!identity.organizationId) throw new NotFoundError()
  // A path org id, when present, must match the token's org.
  if (pathOrgId && pathOrgId !== identity.organizationId) throw new NotFoundError()

  const scope = OrgScope.fromVerifiedToken(OrganizationId.of(identity.organizationId))

  const row = await withOrgScope(ctx.db, scope, async (tx) => {
    // Organization must be active (a suspended org loses all access, 08 §2.3).
    const org = await tx
      .selectFrom('organizations')
      .select(['id', 'status'])
      .where('id', '=', identity.organizationId!)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!org || org.status !== 'active') return null
    const m = await tx
      .selectFrom('memberships')
      .select(['id', 'is_owner', 'status'])
      .where('user_id', '=', identity.userId)
      .where('organization_id', '=', identity.organizationId!)
      .executeTakeFirst()
    if (!m || m.status !== 'active') return null
    return m
  })

  if (!row) throw new NotFoundError()
  return {
    scope,
    organizationId: identity.organizationId,
    userId: identity.userId,
    membershipId: row.id,
    isOwner: row.is_owner,
  }
}

/**
 * Require management rights. Phase 4 gates on ownership; Phase 5 extends this to the
 * `organization.*` permission set and the org_admin role (the route-declared
 * permission becomes the real check). Reads use `requireMember`; mutations use this.
 */
export async function requireManage(
  ctx: OrgModuleContext,
  request: FastifyRequest,
  pathOrgId?: string,
): Promise<OrgContext> {
  const orgCtx = await requireMember(ctx, request, pathOrgId)
  if (!orgCtx.isOwner) {
    throw new ForbiddenError('You do not have permission to manage this organization.')
  }
  return orgCtx
}

export { sql }
