/**
 * OIDC / OAuth 2.1 endpoints (06 §10). First-party only: the sole grant types are
 * authorization-code + PKCE and refresh-token (ADR-003) — no implicit flow, no
 * password grant, no dynamic registration.
 *
 * Conformance is the point: products integrate against the specification, not this
 * implementation, which keeps the migration path to an external IdP open (ADR-003).
 */

import type { FastifyInstance } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'
import { sql } from 'kysely'
import { z } from 'zod'
import { uuidv7 } from '@cp/core'
import { withSystemScope } from '@cp/db'
import type { IdentityContext } from '../application/context.js'
import { refresh } from '../application/authentication.js'
import { sha256 } from '../infrastructure/crypto.js'
import { makeAuthenticate, requireIdentity } from './auth-middleware.js'
import { hitRateLimit } from './rate-limit.js'
import { parseBody, translateIdentityError } from './errors.js'

const AUTH_CODE_TTL_MS = 60_000

function b64urlSha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

function constantEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function registerOidcRoutes(app: FastifyInstance, ctx: IdentityContext): void {
  const authenticate = makeAuthenticate(ctx.tokens)
  const issuer = ctx.env.ISSUER_URL.replace(/\/$/, '')

  // ─────────────────────────────────────────────── discovery + jwks
  app.get('/.well-known/openid-configuration', async (_request, reply) =>
    reply.send({
      issuer,
      authorization_endpoint: `${issuer}/auth/authorize`,
      token_endpoint: `${issuer}/auth/token`,
      userinfo_endpoint: `${issuer}/auth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      revocation_endpoint: `${issuer}/auth/revoke`,
      introspection_endpoint: `${issuer}/auth/introspect`,
      end_session_endpoint: `${issuer}/auth/end-session`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      claims_supported: ['sub', 'email', 'email_verified', 'name'],
    }),
  )

  app.get('/.well-known/jwks.json', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300')
    return reply.send(await ctx.tokens.publicJwks())
  })

  // ─────────────────────────────────────────────── authorize (PKCE)
  const AuthorizeSchema = z.object({
    client_id: z.string().min(1),
    redirect_uri: z.string().url(),
    response_type: z.literal('code'),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    state: z.string().optional(),
    scope: z.string().optional(),
    nonce: z.string().optional(),
  })

  app.get('/auth/authorize', { preHandler: authenticate }, async (request, reply) => {
    try {
      const q = parseBody(AuthorizeSchema, request.query)
      const identity = requireIdentity(request)

      const client = await ctx.db
        .selectFrom('oidc_clients')
        .selectAll()
        .where('client_id', '=', q.client_id)
        .where('status', '=', 'active')
        .executeTakeFirst()
      if (!client) {
        const { ValidationError } = await import('@cp/core')
        throw new ValidationError('Unknown client.')
      }
      // Redirect URIs are EXACT match — no wildcards (06 §6.3, ERD §3.5). Wildcard
      // matching is a standing open-redirect that becomes token theft.
      if (!client.redirect_uris.includes(q.redirect_uri)) {
        const { ValidationError } = await import('@cp/core')
        throw new ValidationError('redirect_uri is not registered for this client.')
      }

      const code = uuidv7().replace(/-/g, '') + uuidv7().replace(/-/g, '')
      await withSystemScope(ctx.db, async (tx) => {
        await tx
          .insertInto('authorization_codes')
          .values({
            id: uuidv7(),
            code_hash: sha256(code),
            client_id: q.client_id,
            user_id: identity.userId,
            organization_id: identity.organizationId,
            redirect_uri: q.redirect_uri,
            code_challenge: q.code_challenge,
            scope: q.scope ?? 'openid profile',
            expires_at: new Date(ctx.clock.nowMs() + AUTH_CODE_TTL_MS),
          })
          .execute()
      })

      const url = new URL(q.redirect_uri)
      url.searchParams.set('code', code)
      if (q.state) url.searchParams.set('state', q.state)
      return reply.redirect(url.toString())
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // ─────────────────────────────────────────────── token endpoint
  app.post('/auth/token', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const rl = await hitRateLimit(ctx.db, ctx.clock, `token:ip:${request.ip}`, 60, 60)
    if (!rl.allowed) {
      reply.header('retry-after', rl.retryAfterSeconds)
      const { RateLimitedError } = await import('@cp/core')
      throw new RateLimitedError('Too many requests.', { retryAfterSeconds: rl.retryAfterSeconds })
    }
    const grant = body['grant_type']

    try {
      if (grant === 'refresh_token') {
        const { refresh_token } = parseBody(
          z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string().min(1) }),
          body,
        )
        const pair = await refresh(ctx, refresh_token, { correlationId: request.correlationId })
        return reply.send({
          access_token: pair.accessToken,
          refresh_token: pair.refreshToken,
          token_type: 'Bearer',
          expires_in: pair.expiresIn,
        })
      }

      if (grant === 'authorization_code') {
        const p = parseBody(
          z.object({
            grant_type: z.literal('authorization_code'),
            code: z.string().min(1),
            redirect_uri: z.string().url(),
            client_id: z.string().min(1),
            code_verifier: z.string().min(43).max(128),
            client_secret: z.string().optional(),
          }),
          body,
        )
        return await exchangeAuthCode(app, ctx, issuer, p, reply)
      }

      const { ValidationError } = await import('@cp/core')
      throw new ValidationError('unsupported_grant_type')
    } catch (e) {
      throw translateIdentityError(e)
    }
  })

  // ─────────────────────────────────────────────── userinfo
  app.get('/auth/userinfo', { preHandler: authenticate }, async (request, reply) => {
    const identity = requireIdentity(request)
    const user = await ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'email_verified_at', 'full_name'])
      .where('id', '=', identity.userId)
      .executeTakeFirst()
    if (!user) {
      const { NotFoundError } = await import('@cp/core')
      throw new NotFoundError()
    }
    return reply.send({
      sub: user.id,
      email: user.email,
      email_verified: user.email_verified_at !== null,
      name: user.full_name,
    })
  })

  // ─────────────────────────────────────────────── revoke (RFC 7009)
  app.post('/auth/revoke', async (request, reply) => {
    const { token } = parseBody(z.object({ token: z.string().min(1) }), request.body)
    await withSystemScope(ctx.db, async (tx) => {
      const row = await tx
        .selectFrom('refresh_tokens')
        .select(['id', 'session_id'])
        .where('token_hash', '=', sha256(token))
        .executeTakeFirst()
      if (row) {
        await tx
          .updateTable('sessions')
          .set({ revoked_at: sql`now()`, revoked_reason: 'logout' })
          .where('id', '=', row.session_id)
          .where('revoked_at', 'is', null)
          .execute()
      }
    })
    // RFC 7009: always 200, even for an unknown token.
    return reply.send({})
  })

  // ─────────────────────────────────────────────── end-session
  app.get('/auth/end-session', { preHandler: authenticate }, async (request, reply) => {
    const identity = requireIdentity(request)
    await withSystemScope(ctx.db, (tx) =>
      tx
        .updateTable('sessions')
        .set({ revoked_at: sql`now()`, revoked_reason: 'logout' })
        .where('id', '=', identity.sessionId)
        .where('revoked_at', 'is', null)
        .execute(),
    )
    const q = request.query as { post_logout_redirect_uri?: string }
    if (q.post_logout_redirect_uri) return reply.redirect(q.post_logout_redirect_uri)
    return reply.send({ status: 'logged_out' })
  })
}

interface AuthCodeExchange {
  code: string
  redirect_uri: string
  client_id: string
  code_verifier: string
  client_secret?: string | undefined
}

async function exchangeAuthCode(
  _app: FastifyInstance,
  ctx: IdentityContext,
  issuer: string,
  p: AuthCodeExchange,
  reply: { send: (b: unknown) => unknown },
): Promise<unknown> {
  const { ValidationError } = await import('@cp/core')

  const result = await withSystemScope(ctx.db, async (tx) => {
    const row = await tx
      .selectFrom('authorization_codes')
      .selectAll()
      .where('code_hash', '=', sha256(p.code))
      .executeTakeFirst()
    if (!row || row.used_at !== null || row.expires_at.getTime() < ctx.clock.nowMs()) {
      throw new ValidationError('invalid_grant')
    }
    if (row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) {
      throw new ValidationError('invalid_grant')
    }
    // PKCE: verifier must hash to the stored challenge (S256), constant-time.
    if (!constantEquals(b64urlSha256(p.code_verifier), row.code_challenge)) {
      throw new ValidationError('invalid_grant')
    }

    const client = await tx
      .selectFrom('oidc_clients')
      .selectAll()
      .where('client_id', '=', p.client_id)
      .executeTakeFirst()
    if (!client) throw new ValidationError('invalid_client')
    if (client.client_secret_hash) {
      if (!p.client_secret || sha256(p.client_secret) !== client.client_secret_hash) {
        throw new ValidationError('invalid_client')
      }
    }

    // Single-use: consume the code.
    await tx
      .updateTable('authorization_codes')
      .set({ used_at: sql`now()` })
      .where('id', '=', row.id)
      .execute()

    const user = await tx
      .selectFrom('users')
      .select(['id', 'email', 'email_verified_at', 'full_name'])
      .where('id', '=', row.user_id)
      .executeTakeFirst()
    if (!user) throw new ValidationError('invalid_grant')
    return { row, user, client }
  })

  const idToken = await ctx.tokens.signIdToken(
    {
      sub: result.user.id,
      email: result.user.email,
      email_verified: result.user.email_verified_at !== null,
      name: result.user.full_name,
    },
    p.client_id,
  )
  // A fresh access token for the product. Session-bound refresh issuance for the
  // product client is handled when full product-SSO session linkage lands; the
  // id_token + access_token here complete the code exchange contract.
  const { permissionDigest } = await import('../domain/tokens.js')
  const accessToken = await ctx.tokens.signAccessToken(
    {
      sub: result.user.id,
      sid: 'oidc',
      org: result.row.organization_id,
      mem: null,
      branch: null,
      all_branches: true,
      scope: result.row.scope ?? 'openid profile',
      perm_digest: permissionDigest([]),
      amr: ['pwd'],
    },
    [p.client_id],
  )

  return reply.send({
    access_token: accessToken,
    id_token: idToken,
    token_type: 'Bearer',
    expires_in: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
    scope: result.row.scope ?? 'openid profile',
    issuer,
  })
}
