/**
 * Organization self-management routes (13 §9.3–9.5) plus the public invitation
 * preview/accept (§9.1). Everything authenticated here operates on the caller's own
 * organization, resolved from the verified token — never from the request body.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireIdentity, type Identity } from '../../identity/http/auth-middleware.js'
import type { TokenService } from '../../identity/index.js'
import { makeAuthenticate } from '../../identity/http/auth-middleware.js'
import type { OrgModuleContext } from '../application/context.js'
import { requireMember, requireManage } from './org-context.js'
import { parseBody, translateOrgError } from './errors.js'
import * as orgs from '../application/organizations.js'
import * as branches from '../application/branches.js'
import * as members from '../application/memberships.js'
import * as invites from '../application/invitations.js'

const uuid = z.string().uuid()

export function registerOrganizationRoutes(
  app: FastifyInstance,
  ctx: OrgModuleContext,
  tokens: TokenService,
): void {
  const authenticate = makeAuthenticate(tokens)
  const auth = { preHandler: authenticate }

  // ───────────────────────────────────────────────────── organization
  app.get('/organizations/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireMember(ctx, request, id)
      return reply.send(await orgs.getOrganization(ctx, orgCtx))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.patch('/organizations/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(200).optional(),
          legalName: z.string().max(200).nullable().optional(),
          industry: z.string().max(100).nullable().optional(),
          country: z.string().length(2).nullable().optional(),
          timezone: z.string().max(64).optional(),
          currency: z.string().length(3).optional(),
          billingEmail: z.string().email().max(320).nullable().optional(),
        }),
        request.body,
      )
      const orgCtx = await requireManage(ctx, request, id)
      return reply.send(await orgs.updateOrganization(ctx, orgCtx, body))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  // ────────────────────────────────────────────────────────── branches
  app.get('/branches', auth, async (request, reply) => {
    try {
      const orgCtx = await requireMember(ctx, request)
      return reply.send({ branches: await branches.listBranches(ctx, orgCtx) })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/branches', auth, async (request, reply) => {
    try {
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(200),
          code: z.string().max(64).nullable().optional(),
          isPrimary: z.boolean().optional(),
        }),
        request.body,
      )
      const orgCtx = await requireManage(ctx, request)
      return reply.status(201).send(await branches.createBranch(ctx, orgCtx, body))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.get('/branches/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireMember(ctx, request)
      return reply.send(await branches.getBranch(ctx, orgCtx, id))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.patch('/branches/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(200).optional(),
          code: z.string().max(64).nullable().optional(),
          status: z.enum(['active', 'inactive']).optional(),
          isPrimary: z.boolean().optional(),
        }),
        request.body,
      )
      const orgCtx = await requireManage(ctx, request)
      return reply.send(await branches.updateBranch(ctx, orgCtx, id, body))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.delete('/branches/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await branches.deleteBranch(ctx, orgCtx, id)
      return reply.status(204).send()
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  // ───────────────────────────────────────────────────────── memberships
  app.get('/memberships', auth, async (request, reply) => {
    try {
      const orgCtx = await requireMember(ctx, request)
      return reply.send({ members: await members.listMembers(ctx, orgCtx) })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/memberships/:id/suspend', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await members.suspendMembership(ctx, orgCtx, id)
      return reply.send({ status: 'suspended' })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/memberships/:id/reinstate', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await members.reinstateMembership(ctx, orgCtx, id)
      return reply.send({ status: 'active' })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.delete('/memberships/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await members.removeMembership(ctx, orgCtx, id)
      return reply.status(204).send()
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.patch('/memberships/:id/branch-scope', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const body = parseBody(
        z.object({
          allBranches: z.boolean().optional(),
          defaultBranchId: uuid.nullable().optional(),
          branchIds: z.array(uuid).optional(),
        }),
        request.body,
      )
      const orgCtx = await requireManage(ctx, request)
      await members.updateMembershipBranchScope(ctx, orgCtx, id, body)
      return reply.send({ status: 'updated' })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/memberships/:id/transfer-ownership', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await members.transferOwnership(ctx, orgCtx, id)
      return reply.send({ status: 'ownership_transferred' })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  // ───────────────────────────────────────────────────────── invitations
  app.get('/invitations', auth, async (request, reply) => {
    try {
      const orgCtx = await requireMember(ctx, request)
      return reply.send({ invitations: await invites.listInvitations(ctx, orgCtx) })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/invitations', auth, async (request, reply) => {
    try {
      const body = parseBody(
        z.object({ email: z.string().email().max(320), roleIds: z.array(uuid).optional() }),
        request.body,
      )
      const orgCtx = await requireManage(ctx, request)
      const { invitation } = await invites.createInvitation(ctx, orgCtx, body)
      // The token itself is delivered by email, never in the API response.
      return reply.status(201).send({ invitation })
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.delete('/invitations/:id', auth, async (request, reply) => {
    try {
      const { id } = parseBody(z.object({ id: uuid }), request.params)
      const orgCtx = await requireManage(ctx, request)
      await invites.revokeInvitation(ctx, orgCtx, id)
      return reply.status(204).send()
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  // Public preview + accept (token-authenticated, no org context yet).
  app.get('/auth/invitations/:token', async (request, reply) => {
    try {
      const { token } = parseBody(z.object({ token: z.string().min(1) }), request.params)
      return reply.send(await invites.previewInvitation(ctx, token))
    } catch (e) {
      throw translateOrgError(e)
    }
  })

  app.post('/auth/invitations/:token/accept', async (request, reply) => {
    try {
      const { token } = parseBody(z.object({ token: z.string().min(1) }), request.params)
      const body = parseBody(
        z.object({
          fullName: z.string().min(1).max(200).optional(),
          password: z.string().min(1).max(256).optional(),
        }),
        request.body ?? {},
      )
      // If a bearer token is present, treat it as an existing user joining.
      let identity: Identity | undefined
      const authz = request.headers.authorization
      if (authz?.startsWith('Bearer ')) {
        await authenticate(request, reply)
        identity = requireIdentity(request)
      }
      const result = await invites.acceptInvitation(ctx, token, {
        ...(body.fullName ? { fullName: body.fullName } : {}),
        ...(body.password ? { password: body.password } : {}),
        ...(identity ? { authenticatedUserId: identity.userId } : {}),
      })
      return reply.status(201).send(result)
    } catch (e) {
      throw translateOrgError(e)
    }
  })
}
