/**
 * RBAC routes (13 §9.2 /me/permissions, §9.4 role assignment, §9.13 platform role
 * grants). Every route declares its authorization via `config.authz`; the boot
 * guard refuses to start if any route is left undeclared.
 */

import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import { makeAuthenticate, requireIdentity, type TokenService } from '../../identity/index.js'
import {
  requirePermission,
  requirePlatformPermission,
  resolveOrgContext,
  resolveOrgPermissionList,
} from './authorize.js'
import { resolvePlatformPermissions } from '../application/resolver.js'
import * as roleMgmt from '../application/roles.js'
import { parseBody, translateRbacError } from './errors.js'

const uuid = z.string().uuid()

export function registerRbacRoutes(app: FastifyInstance, db: Kysely<DB>, tokens: TokenService): void {
  const authenticate = makeAuthenticate(tokens)

  // /me/permissions — the caller's resolved org + platform permissions and a digest.
  app.get('/me/permissions', { preHandler: authenticate, config: { authz: 'authenticated' } }, async (request, reply) => {
    try {
      const identity = requireIdentity(request)
      let orgPermissions: string[] = []
      if (identity.organizationId) {
        const orgCtx = await resolveOrgContext(db, request)
        orgPermissions = await resolveOrgPermissionList(db, orgCtx)
      }
      const platformPermissions = [...(await resolvePlatformPermissions(db, identity.userId))].sort()
      const all = [...orgPermissions, ...platformPermissions].sort()
      const digest = 'sha256:' + createHash('sha256').update(all.join('\n')).digest('hex').slice(0, 32)
      return reply.send({ organizationId: identity.organizationId, permissions: all, digest })
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  // Roles available to assign in the caller's organization.
  app.get('/roles', { preHandler: authenticate, config: { authz: 'organization.roles.read' } }, async (request, reply) => {
    try {
      const orgCtx = await requirePermission(db, request, 'organization.roles.read')
      return reply.send({ roles: await roleMgmt.listAssignableRoles(db, orgCtx) })
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  app.post('/roles', { preHandler: authenticate, config: { authz: 'organization.roles.manage' } }, async (request, reply) => {
    try {
      const body = parseBody(
        z.object({ name: z.string().min(1).max(100), permissionKeys: z.array(z.string()).max(100) }),
        request.body,
      )
      const orgCtx = await requirePermission(db, request, 'organization.roles.manage')
      return reply.status(201).send(await roleMgmt.createCustomRole(db, orgCtx, body))
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  app.delete('/roles/:id', { preHandler: authenticate, config: { authz: 'organization.roles.manage' } }, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requirePermission(db, request, 'organization.roles.manage')
      await roleMgmt.deleteCustomRole(db, orgCtx, id)
      return reply.status(204).send()
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  // Replace a member's roles.
  app.put('/memberships/:id/roles', { preHandler: authenticate, config: { authz: 'organization.roles.assign' } }, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const body = parseBody(z.object({ roleIds: z.array(uuid).max(50) }), request.body)
      const orgCtx = await requirePermission(db, request, 'organization.roles.assign')
      await roleMgmt.setMembershipRoles(db, orgCtx, id, body.roleIds)
      return reply.send({ status: 'roles_set' })
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  // Platform role grants (company staff). Gated on platform.roles.grant (07 §6).
  app.post('/platform/role-assignments', { preHandler: authenticate, config: { authz: 'platform.roles.grant' } }, async (request, reply) => {
    try {
      const body = parseBody(
        z.object({ userId: uuid, roleId: uuid, expiresAt: z.coerce.date().nullable().optional() }),
        request.body,
      )
      const { userId: actorUserId } = await requirePlatformPermission(db, request, 'platform.roles.grant')
      await roleMgmt.grantPlatformRole(db, actorUserId, {
        targetUserId: body.userId,
        roleId: body.roleId,
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      })
      return reply.status(201).send({ status: 'granted' })
    } catch (e) {
      throw translateRbacError(e)
    }
  })

  app.delete('/platform/role-assignments/:id', { preHandler: authenticate, config: { authz: 'platform.roles.grant' } }, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const { userId: actorUserId } = await requirePlatformPermission(db, request, 'platform.roles.grant')
      await roleMgmt.revokePlatformRole(db, actorUserId, id)
      return reply.status(204).send()
    } catch (e) {
      throw translateRbacError(e)
    }
  })
}
