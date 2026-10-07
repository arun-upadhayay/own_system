/**
 * Authorization middleware (07 §4, §7, ADR-012). Resolves the caller's
 * organization context from the VERIFIED TOKEN (never the request body) and asserts
 * a required permission, resolved fresh from the database each request.
 *
 * This replaces Phase 4's owner-gating: a route declares the permission it needs,
 * and `requirePermission` is the real check. Reads and mutations alike go through
 * it. A cross-tenant path id yields 404, not 403 (07 §9).
 *
 * Depends on @cp/db and identity (for the token-derived identity); it does NOT
 * import the organizations module, so organizations → rbac is acyclic.
 */

import { ForbiddenError, NotFoundError, OrganizationId, OrgScope, type OrgScope as OrgScopeT } from '@cp/core'
import { withOrgScope, type DB } from '@cp/db'
import type { Kysely } from 'kysely'
import type { FastifyRequest } from 'fastify'
import { requireIdentity } from '../../identity/http/auth-middleware.js'
import { resolveMembershipPermissions, resolvePlatformPermissions } from '../application/resolver.js'

export interface OrgContext {
  scope: OrgScopeT
  organizationId: string
  userId: string
  membershipId: string
  isOwner: boolean
}

/** Resolve and verify the caller's active membership in the token's organization. */
export async function resolveOrgContext(
  db: Kysely<DB>,
  request: FastifyRequest,
  pathOrgId?: string,
): Promise<OrgContext> {
  const identity = requireIdentity(request)
  if (!identity.organizationId) throw new NotFoundError()
  if (pathOrgId && pathOrgId !== identity.organizationId) throw new NotFoundError()

  const scope = OrgScope.fromVerifiedToken(OrganizationId.of(identity.organizationId))
  const row = await withOrgScope(db, scope, async (tx) => {
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
 * Require an organization-scoped permission. Returns the resolved OrgContext so the
 * handler can proceed. An owner implicitly holds every `organization.*` permission;
 * everyone else is checked against the union of their role permissions.
 */
export async function requirePermission(
  db: Kysely<DB>,
  request: FastifyRequest,
  permission: string,
  pathOrgId?: string,
): Promise<OrgContext> {
  const orgCtx = await resolveOrgContext(db, request, pathOrgId)
  if (orgCtx.isOwner && permission.startsWith('organization.')) return orgCtx
  const perms = await resolveMembershipPermissions(db, orgCtx.membershipId, orgCtx.isOwner)
  if (!perms.has(permission)) {
    throw new ForbiddenError(`Requires permission: ${permission}`)
  }
  return orgCtx
}

/** Resolve the caller's full org permission set (for /me/permissions). */
export async function resolveOrgPermissionList(
  db: Kysely<DB>,
  orgCtx: OrgContext,
): Promise<string[]> {
  return [...(await resolveMembershipPermissions(db, orgCtx.membershipId, orgCtx.isOwner))].sort()
}

/** Require a platform (company-staff) permission — for /platform routes and grants. */
export async function requirePlatformPermission(
  db: Kysely<DB>,
  request: FastifyRequest,
  permission: string,
): Promise<{ userId: string }> {
  const identity = requireIdentity(request)
  const perms = await resolvePlatformPermissions(db, identity.userId)
  if (!perms.has(permission)) throw new ForbiddenError(`Requires platform permission: ${permission}`)
  return { userId: identity.userId }
}
