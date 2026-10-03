/**
 * Identity integration tests (Phase 3). Exercises the real flows end-to-end through
 * Fastify inject against the live database. Focuses on the security-critical
 * properties ADR-003 makes non-negotiable: enumeration resistance, lockout,
 * refresh-token reuse detection, reset session revocation, and OIDC/PKCE.
 *
 * Skips automatically when no database is configured. Test data uses the
 * @p3test.invalid marker and is removed afterwards via the app_role connection.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withSystemScope } from '@cp/db'
import { buildApp } from '../../app.js'
import { parseConfig } from '../../config.js'
import { getDb, closeDb } from '../../db.js'
import type { EmailPort } from './application/context.js'

// ── load apps/api/.env ────────────────────────────────────────────────────────
;(function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  try {
    for (const line of readFileSync(resolve(here, '../../../.env'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq > 0 && !(t.slice(0, eq).trim() in process.env)) {
        process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
      }
    }
  } catch {
    /* ambient */
  }
})()

const HAS_DB = Boolean(process.env.DATABASE_URL && process.env.JWK_ENCRYPTION_KEY)
const d = HAS_DB ? describe : describe.skip

const MARKER = '@p3test.invalid'
const uniqueEmail = () => `u${randomBytes(6).toString('hex')}${MARKER}`

// Capturing email port so tests can read verification / reset tokens.
interface Sent {
  template: string
  data: Record<string, unknown>
}
const sent: Sent[] = []
const capturingEmail: EmailPort = {
  async send(_to, template, data) {
    sent.push({ template, data })
  },
}
function lastToken(template: string): string {
  for (let i = sent.length - 1; i >= 0; i--) {
    if (sent[i]!.template === template) return String(sent[i]!.data['token'])
  }
  throw new Error(`no ${template} email captured`)
}

let app: FastifyInstance

function randomIp(): string {
  return [10, rnd(), rnd(), rnd()].join(".")
  function rnd() { return 1 + Math.floor(Math.random() * 254) }
}
/** Inject with a fresh source IP unless one is provided. */
function call(opts: Parameters<FastifyInstance["inject"]>[0]): ReturnType<FastifyInstance["inject"]> {
  return app.inject({ remoteAddress: randomIp(), ...(opts as object) })
}

beforeAll(async () => {
  if (!HAS_DB) return
  const env = parseConfig(process.env)
  app = await buildApp(env, { email: capturingEmail })
})

afterAll(async () => {
  if (!HAS_DB) return
  // Remove test data via app_role under platform scope (cascades handle children).
  const db = getDb(parseConfig(process.env))
  await withSystemScope(db, async (tx) => {
    const users = await tx
      .selectFrom('users')
      .select('id')
      .where('email', 'like', `%${MARKER}`)
      .execute()
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await tx.deleteFrom('organizations').where('created_by_user_id', 'in', ids).execute()
      await tx.deleteFrom('users').where('id', 'in', ids).execute()
    }
  })
  if (app) await app.close()
  await closeDb()
})

async function registerAndVerify(email: string, password = 'correct-horse-battery'): Promise<void> {
  const reg = await call({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password, fullName: 'Test User', organizationName: 'Test Org' },
  })
  expect(reg.statusCode).toBe(202)
  const token = lastToken('verify_email')
  const verify = await call({ method: 'GET', url: `/auth/verify?token=${token}` })
  expect(verify.statusCode).toBe(200)
}

d('registration & verification', () => {
  it('registers, verifies, and then logs in', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'correct-horse-battery' },
    })
    expect(login.statusCode).toBe(200)
    const body = login.json()
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    // Single org → session is scoped immediately.
    expect(body.activeOrganizationId).toBeTruthy()
  })

  it('returns an identical 202 whether or not the email already exists', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const second = await call({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'another-strong-pass', fullName: 'X', organizationName: 'Y' },
    })
    expect(second.statusCode).toBe(202)
    expect(second.json()).toEqual({ status: 'verification_sent' })
  })

  it('rejects a weak password', async () => {
    const res = await call({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail(), password: 'short', fullName: 'X', organizationName: 'Y' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('does not let an unverified user log in', async () => {
    const email = uniqueEmail()
    await call({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct-horse-battery', fullName: 'X', organizationName: 'Y' },
    })
    const login = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'correct-horse-battery' },
    })
    expect(login.statusCode).toBe(401)
  })
})

d('login: enumeration resistance & lockout', () => {
  it('returns the same generic 401 for unknown email and wrong password', async () => {
    const unknown = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email: uniqueEmail(), password: 'whatever-strong-pass' },
    })
    const email = uniqueEmail()
    await registerAndVerify(email)
    const wrong = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password-here' },
    })
    expect(unknown.statusCode).toBe(401)
    expect(wrong.statusCode).toBe(401)
    // Identical body shape — no field distinguishes the two cases.
    expect(unknown.json().error.code).toBe(wrong.json().error.code)
    expect(unknown.json().error.message).toBe(wrong.json().error.message)
  })

  it('locks after repeated failures, still returning the generic 401', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    for (let i = 0; i < 5; i++) {
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'nope-nope-nope' } })
    }
    // Now locked: even the CORRECT password is refused, with the same generic error.
    const locked = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'correct-horse-battery' },
    })
    expect(locked.statusCode).toBe(401)
    expect(locked.json().error.code).toBe('unauthenticated')
  })
})

d('refresh rotation & reuse detection (ADR-017)', () => {
  it('rotates the refresh token and revokes the family on reuse', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct-horse-battery' } })
    ).json()

    // First rotation works.
    const r1 = await call({
      method: 'POST',
      url: '/auth/token',
      payload: { grant_type: 'refresh_token', refresh_token: login.refreshToken },
    })
    expect(r1.statusCode).toBe(200)
    const next = r1.json().refresh_token
    expect(next).toBeTruthy()
    expect(next).not.toBe(login.refreshToken)

    // Reusing the ORIGINAL (now consumed) token is detected → 401.
    const reuse = await call({
      method: 'POST',
      url: '/auth/token',
      payload: { grant_type: 'refresh_token', refresh_token: login.refreshToken },
    })
    expect(reuse.statusCode).toBe(401)

    // And the family is revoked: the rotated token no longer works either.
    const afterRevoke = await call({
      method: 'POST',
      url: '/auth/token',
      payload: { grant_type: 'refresh_token', refresh_token: next },
    })
    expect(afterRevoke.statusCode).toBe(401)
  })
})

d('password reset', () => {
  it('always returns 202, is single-use, and revokes sessions', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct-horse-battery' } })
    ).json()

    // Unknown address still returns 202 (no enumeration).
    const unknown = await call({ method: 'POST', url: '/auth/password/forgot', payload: { email: uniqueEmail() } })
    expect(unknown.statusCode).toBe(202)

    const forgot = await call({ method: 'POST', url: '/auth/password/forgot', payload: { email } })
    expect(forgot.statusCode).toBe(202)
    const token = lastToken('password_reset')

    const reset = await call({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, newPassword: 'brand-new-strong-pass' },
    })
    expect(reset.statusCode).toBe(200)

    // Single-use: the same token fails the second time.
    const again = await call({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token, newPassword: 'yet-another-strong-pass' },
    })
    expect(again.statusCode).toBe(400)

    // The pre-reset session's refresh token was revoked.
    const stale = await call({
      method: 'POST',
      url: '/auth/token',
      payload: { grant_type: 'refresh_token', refresh_token: login.refreshToken },
    })
    expect(stale.statusCode).toBe(401)

    // The new password works.
    const relogin = await call({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'brand-new-strong-pass' },
    })
    expect(relogin.statusCode).toBe(200)
  })
})

d('/me', () => {
  it('requires a bearer token and returns the profile', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct-horse-battery' } })
    ).json()

    const noAuth = await call({ method: 'GET', url: '/me' })
    expect(noAuth.statusCode).toBe(401)

    const me = await call({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${login.accessToken}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().email).toBe(email)
  })
})

d('OIDC', () => {
  it('serves a discovery document with the required fields', async () => {
    const res = await call({ method: 'GET', url: '/.well-known/openid-configuration' })
    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.issuer).toBeTruthy()
    expect(doc.authorization_endpoint).toContain('/auth/authorize')
    expect(doc.token_endpoint).toContain('/auth/token')
    expect(doc.jwks_uri).toContain('/.well-known/jwks.json')
    expect(doc.code_challenge_methods_supported).toContain('S256')
    expect(doc.grant_types_supported).toContain('authorization_code')
  })

  it('publishes verifiable signing keys', async () => {
    const res = await call({ method: 'GET', url: '/.well-known/jwks.json' })
    expect(res.statusCode).toBe(200)
    const jwks = res.json()
    expect(Array.isArray(jwks.keys)).toBe(true)
    expect(jwks.keys.length).toBeGreaterThan(0)
    expect(jwks.keys[0].kty).toBe('RSA')
    expect(jwks.keys[0]).not.toHaveProperty('d') // never the private component
  })

  it('completes an authorization-code + PKCE round trip and rejects a bad verifier', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct-horse-battery' } })
    ).json()

    // Register a public PKCE client for this product.
    const clientId = `test-client-${randomBytes(4).toString('hex')}`
    const redirectUri = 'https://pos.example.test/callback'
    const db = getDb(parseConfig(process.env))
    await withSystemScope(db, (tx) =>
      tx
        .insertInto('oidc_clients')
        .values({
          id: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
          client_id: clientId,
          name: 'Test Client',
          redirect_uris: [redirectUri],
          require_pkce: true,
          status: 'active',
        })
        .execute(),
    )

    const verifier = randomBytes(40).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')

    const authorize = await call({
      method: 'GET',
      url: `/auth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`,
      headers: { authorization: `Bearer ${login.accessToken}` },
    })
    expect(authorize.statusCode).toBe(302)
    const location = new URL(authorize.headers.location as string)
    expect(location.searchParams.get('state')).toBe('xyz')
    const code = location.searchParams.get('code')!
    expect(code).toBeTruthy()

    // Wrong verifier → invalid_grant.
    const bad = await call({
      method: 'POST',
      url: '/auth/token',
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: randomBytes(40).toString('base64url'),
      },
    })
    expect(bad.statusCode).toBe(400)

    // Correct verifier → tokens. (The code was consumed by the bad attempt? No —
    // PKCE fails before consumption only if we consume after check. We consume on
    // success; the bad attempt did not consume, so this still works.)
    const good = await call({
      method: 'POST',
      url: '/auth/token',
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      },
    })
    expect(good.statusCode).toBe(200)
    expect(good.json().id_token).toBeTruthy()
    expect(good.json().access_token).toBeTruthy()

    // Cleanup the client.
    await withSystemScope(db, (tx) => tx.deleteFrom('oidc_clients').where('client_id', '=', clientId).execute())
  })

  it('rejects an unregistered redirect_uri (no wildcards)', async () => {
    const email = uniqueEmail()
    await registerAndVerify(email)
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email, password: 'correct-horse-battery' } })
    ).json()
    const clientId = `test-client-${randomBytes(4).toString('hex')}`
    const db = getDb(parseConfig(process.env))
    await withSystemScope(db, (tx) =>
      tx
        .insertInto('oidc_clients')
        .values({
          id: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
          client_id: clientId,
          name: 'Test Client',
          redirect_uris: ['https://pos.example.test/callback'],
          status: 'active',
        })
        .execute(),
    )
    const res = await call({
      method: 'GET',
      url: `/auth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example.test/callback')}&response_type=code&code_challenge=${'a'.repeat(43)}&code_challenge_method=S256`,
      headers: { authorization: `Bearer ${login.accessToken}` },
    })
    expect(res.statusCode).toBe(400)
    await withSystemScope(db, (tx) => tx.deleteFrom('oidc_clients').where('client_id', '=', clientId).execute())
  })
})
