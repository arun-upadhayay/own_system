/**
 * /auth and /me routes (13 §9.1, §9.2). Validation is Zod (ADR-023). Every error
 * is translated to the platform's error shape; success responses never leak whether
 * an account exists.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Clock } from '@cp/core'
import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import type { ApiEnv } from '../../../config.js'
import type { IdentityContext, RequestMeta } from '../application/context.js'
import * as registration from '../application/registration.js'
import * as auth from '../application/authentication.js'
import * as password from '../application/password.js'
import { parseBody, translateIdentityError } from './errors.js'
import { makeAuthenticate, requireIdentity } from './auth-middleware.js'
import { hitRateLimit } from './rate-limit.js'

const emailSchema = z.string().email().max(320)
const passwordSchema = z.string().min(1).max(256)

const RegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().min(1).max(200),
  organizationName: z.string().min(1).max(200),
})
const LoginSchema = z.object({ email: emailSchema, password: passwordSchema })
const ForgotSchema = z.object({ email: emailSchema })
const ResetSchema = z.object({ token: z.string().min(1), newPassword: passwordSchema })
const ChangePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
})

function metaOf(request: { ip: string; headers: Record<string, unknown>; correlationId: string }): RequestMeta {
  return {
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    correlationId: request.correlationId,
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  ctx: IdentityContext,
  deps: { db: Kysely<DB>; clock: Clock; env: ApiEnv },
): void {
  const authenticate = makeAuthenticate(ctx.tokens)

  /** Per-IP + optional per-identifier rate limit; throws 429 with Retry-After. */
  async function limit(
    request: { ip: string },
    reply: { header: (k: string, v: string | number) => unknown },
    bucket: string,
    opts: { perIp: number; windowSeconds: number; identifier?: string; perIdentifier?: number },
  ): Promise<void> {
    const ipDecision = await hitRateLimit(deps.db, deps.clock, `${bucket}:ip:${request.ip}`, opts.perIp, opts.windowSeconds)
    let blocked = !ipDecision.allowed
    let retry = ipDecision.retryAfterSeconds
    if (!blocked && opts.identifier && opts.perIdentifier) {
      const idDecision = await hitRateLimit(
        deps.db,
        deps.clock,
        `${bucket}:id:${opts.identifier.toLowerCase()}`,
        opts.perIdentifier,
        opts.windowSeconds,
      )
      blocked = !idDecision.allowed
      retry = idDecision.retryAfterSeconds
    }
    if (blocked) {
      reply.header('retry-after', retry)
      const { RateLimitedError } = await import('@cp/core')
      throw new RateLimitedError('Too many requests. Please slow down.', { retryAfterSeconds: retry })
    }
  }

  // ─────────────────────────────────────────────────────── registration
  app.post('/auth/register', async (request, reply) => {
    try {
      const body = parseBody(RegisterSchema, request.body)
      await limit(request, reply, 'register', { perIp: 5, windowSeconds: 3600 })
      await registration.register(ctx, body, metaOf(request as never))
      // 202 + identical message whether or not the email existed.
      return reply.status(202).send({ status: 'verification_sent' })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  app.get('/auth/verify', async (request, reply) => {
    try {
      const { token } = parseBody(z.object({ token: z.string().min(1) }), request.query)
      await registration.verifyEmail(ctx, token)
      return reply.send({ status: 'verified' })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // ────────────────────────────────────────────────────────────── login
  app.post('/auth/login', async (request, reply) => {
    try {
      const body = parseBody(LoginSchema, request.body)
      // Per-IP only: account lockout (05 §3) is the per-account defense, so a
      // per-email rate limit here would merely collide with it. The per-IP limit
      // catches one source hammering many accounts.
      await limit(request, reply, 'login', { perIp: 20, windowSeconds: 900 })
      const result = await auth.login(ctx, body, metaOf(request as never))
      return reply.send({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        activeOrganizationId: result.activeOrganizationId,
        organizations: result.organizations,
      })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // NOTE: POST /auth/token is the OIDC token endpoint (oidc-routes.ts); it handles
  // both grant_type=refresh_token and authorization_code. It is not duplicated here.

  app.post('/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    try {
      const id = requireIdentity(request)
      await auth.logout(ctx, id.sessionId)
      return reply.send({ status: 'logged_out' })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  app.post('/auth/organizations/:id/select', { preHandler: authenticate }, async (request, reply) => {
    try {
      const id = requireIdentity(request)
      const { id: orgId } = parseBody(z.object({ id: z.string().uuid() }), request.params)
      const pair = await auth.selectOrganization(ctx, {
        userId: id.userId,
        sessionId: id.sessionId,
        organizationId: orgId,
      })
      return reply.send(pair)
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // ──────────────────────────────────────────────────────── password
  app.post('/auth/password/forgot', async (request, reply) => {
    try {
      const { email } = parseBody(ForgotSchema, request.body)
      await limit(request, reply, 'forgot', {
        perIp: 10,
        perIdentifier: 3,
        identifier: email,
        windowSeconds: 3600,
      })
      await password.requestPasswordReset(ctx, email)
    } catch (e) {
      // Even a rate-limit error is fine to surface; anything else still returns 202
      // to avoid revealing account existence.
      if ((e as { code?: string })?.code === 'rate_limited') throw translateIdentityError(e)
    }
    return reply.status(202).send({ status: 'reset_requested' })
  })

  app.post('/auth/password/reset', async (request, reply) => {
    try {
      const body = parseBody(ResetSchema, request.body)
      await password.resetPassword(ctx, body)
      return reply.send({ status: 'password_reset' })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  app.post('/auth/password/change', { preHandler: authenticate }, async (request, reply) => {
    try {
      const id = requireIdentity(request)
      const body = parseBody(ChangePasswordSchema, request.body)
      await password.changePassword(ctx, { userId: id.userId, ...body })
      return reply.send({ status: 'password_changed' })
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // ────────────────────────────────────────────────────────────── /me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const id = requireIdentity(request)
    const me = await auth.getMe(ctx, id.userId)
    if (!me) {
      const { NotFoundError } = await import('@cp/core')
      throw new NotFoundError()
    }
    return reply.send({ ...me, activeOrganizationId: id.organizationId })
  })

  app.get('/me/organizations', { preHandler: authenticate }, async (request, reply) => {
    const id = requireIdentity(request)
    return reply.send({ organizations: await auth.listMyOrganizations(ctx, id.userId) })
  })
}
