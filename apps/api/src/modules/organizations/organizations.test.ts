/**
 * Organizations integration tests (Phase 4). Exercises tenant management end-to-end
 * through Fastify inject against the live database. Focuses on the acceptance
 * criteria: tenant isolation per resource, 404-not-403 for cross-tenant access,
 * last-owner protection, multi-org membership, suspension revoking sessions, and
 * organization context coming only from the token.
 *
 * Skips when no database is configured. Test data uses @p4test.invalid and is
 * cleaned up afterwards.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { withSystemScope } from '@cp/db'
import { buildApp } from '../../app.js'
import { parseConfig } from '../../config.js'
import { getDb, closeDb } from '../../db.js'
import type { EmailPort } from '../identity/application/context.js'

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
const MARKER = '@p4test.invalid'
const PASSWORD = 'correct-horse-battery'
const uniqueEmail = () => `u${randomBytes(6).toString('hex')}${MARKER}`

const sent: { template: string; data: Record<string, unknown> }[] = []
const email: EmailPort = {
  async send(_to, template, data) {
    sent.push({ template, data })
  },
}
function lastToken(template: string): string {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i]!.template === template) return String(sent[i]!.data['token'])
  throw new Error(`no ${template} email`)
}

let app: FastifyInstance

function randomIp(): string {
  const r = () => 1 + Math.floor(Math.random() * 254)
  return `10.${r()}.${r()}.${r()}`
}
function call(opts: Parameters<FastifyInstance['inject']>[0]): ReturnType<FastifyInstance['inject']> {
  return app.inject({ remoteAddress: randomIp(), ...(opts as object) })
}

/** Register + verify, returning the access token and the owner's membership ids. */
async function newOwner(): Promise<{ email: string; token: string; orgId: string }> {
  const e = uniqueEmail()
  await call({
    method: 'POST',
    url: '/auth/register',
    payload: { email: e, password: PASSWORD, fullName: 'Owner', organizationName: 'Acme' },
  })
  const verify = lastToken('verify_email')
  await call({ method: 'GET', url: `/auth/verify?token=${verify}` })
  const login = (
    await call({ method: 'POST', url: '/auth/login', payload: { email: e, password: PASSWORD } })
  ).json()
  return { email: e, token: login.accessToken, orgId: login.activeOrganizationId }
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

beforeAll(async () => {
  if (!HAS_DB) return
  app = await buildApp(parseConfig(process.env), { email })
})

afterAll(async () => {
  if (!HAS_DB) return
  const db = getDb(parseConfig(process.env))
  await withSystemScope(db, async (tx) => {
    const users = await tx.selectFrom('users').select('id').where('email', 'like', `%${MARKER}`).execute()
    const ids = users.map((u) => u.id)
    if (ids.length) {
      await tx.deleteFrom('organizations').where('created_by_user_id', 'in', ids).execute()
      await tx.deleteFrom('users').where('id', 'in', ids).execute()
    }
  })
  if (app) await app.close()
  await closeDb()
})

d('organization self-service', () => {
  it('reads and updates descriptive settings', async () => {
    const o = await newOwner()
    const get = await call({ method: 'GET', url: `/organizations/${o.orgId}`, headers: bearer(o.token) })
    expect(get.statusCode).toBe(200)
    expect(get.json().id).toBe(o.orgId)

    const patch = await call({
      method: 'PATCH',
      url: `/organizations/${o.orgId}`,
      headers: bearer(o.token),
      payload: { name: 'Acme Renamed', timezone: 'Asia/Kolkata' },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().name).toBe('Acme Renamed')
    expect(patch.json().timezone).toBe('Asia/Kolkata')
  })

  it('cannot change its own status (no such field accepted)', async () => {
    const o = await newOwner()
    const patch = await call({
      method: 'PATCH',
      url: `/organizations/${o.orgId}`,
      headers: bearer(o.token),
      payload: { status: 'suspended' },
    })
    // status is not an accepted field; it is silently ignored, org stays active.
    expect(patch.statusCode).toBe(200)
    expect(patch.json().status).toBe('active')
  })
})

d('tenant isolation (ADR-012)', () => {
  it('org A cannot read org B, and gets 404 — not 403', async () => {
    const a = await newOwner()
    const b = await newOwner()
    // A presents A's token but asks for B's org id in the path.
    const res = await call({ method: 'GET', url: `/organizations/${b.orgId}`, headers: bearer(a.token) })
    expect(res.statusCode).toBe(404)
  })

  it('org A cannot see org B’s branches', async () => {
    const a = await newOwner()
    const b = await newOwner()
    await call({ method: 'POST', url: '/branches', headers: bearer(b.token), payload: { name: 'B Branch' } })

    const aList = (await call({ method: 'GET', url: '/branches', headers: bearer(a.token) })).json()
    expect(aList.branches.find((x: { name: string }) => x.name === 'B Branch')).toBeUndefined()
  })

  it('org context comes from the token: a branch is created in the caller’s org only', async () => {
    const a = await newOwner()
    const created = await call({
      method: 'POST',
      url: '/branches',
      headers: bearer(a.token),
      payload: { name: 'A Branch', isPrimary: true },
    })
    expect(created.statusCode).toBe(201)
    const list = (await call({ method: 'GET', url: '/branches', headers: bearer(a.token) })).json()
    expect(list.branches.map((x: { name: string }) => x.name)).toContain('A Branch')
  })
})

d('branches', () => {
  it('enforces at most one primary branch', async () => {
    const o = await newOwner()
    await call({ method: 'POST', url: '/branches', headers: bearer(o.token), payload: { name: 'First', isPrimary: true } })
    await call({ method: 'POST', url: '/branches', headers: bearer(o.token), payload: { name: 'Second', isPrimary: true } })
    const list = (await call({ method: 'GET', url: '/branches', headers: bearer(o.token) })).json()
    const primaries = list.branches.filter((b: { isPrimary: boolean }) => b.isPrimary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].name).toBe('Second')
  })

  it('requires ownership to create a branch', async () => {
    // Invite a brand-new user; they accept and become a non-owner member, then try
    // to create a branch — forbidden (Phase 4 gates management on ownership).
    const o = await newOwner()
    const memberEmail = uniqueEmail()
    await call({ method: 'POST', url: '/invitations', headers: bearer(o.token), payload: { email: memberEmail } })
    const inviteToken = lastToken('invitation')
    await call({
      method: 'POST',
      url: `/auth/invitations/${inviteToken}/accept`,
      payload: { fullName: 'Member', password: PASSWORD },
    })
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email: memberEmail, password: PASSWORD } })
    ).json()
    // Single membership (the invited org) → scoped token.
    const create = await call({
      method: 'POST',
      url: '/branches',
      headers: bearer(login.accessToken),
      payload: { name: 'Nope' },
    })
    expect(create.statusCode).toBe(403)
  })
})

d('memberships & last-owner protection', () => {
  it('prevents suspending or removing the last active owner', async () => {
    const o = await newOwner()
    // Find the owner's own membership id.
    const members = (await call({ method: 'GET', url: '/memberships', headers: bearer(o.token) })).json()
    const ownerM = members.members.find((m: { isOwner: boolean }) => m.isOwner)
    expect(ownerM).toBeTruthy()

    const suspend = await call({
      method: 'POST',
      url: `/memberships/${ownerM.membershipId}/suspend`,
      headers: bearer(o.token),
    })
    expect(suspend.statusCode).toBe(409) // LastOwnerError

    const remove = await call({ method: 'DELETE', url: `/memberships/${ownerM.membershipId}`, headers: bearer(o.token) })
    expect(remove.statusCode).toBe(409)
  })
})

d('invitations & multi-org membership (baseline §8)', () => {
  it('previews, then a new user accepts — creating an account and membership', async () => {
    const o = await newOwner()
    const inviteEmail = uniqueEmail()
    const create = await call({
      method: 'POST',
      url: '/invitations',
      headers: bearer(o.token),
      payload: { email: inviteEmail },
    })
    expect(create.statusCode).toBe(201)
    const token = lastToken('invitation')

    const preview = await call({ method: 'GET', url: `/auth/invitations/${token}` })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().email).toBe(inviteEmail)

    const accept = await call({
      method: 'POST',
      url: `/auth/invitations/${token}/accept`,
      payload: { fullName: 'Invitee', password: PASSWORD },
    })
    expect(accept.statusCode).toBe(201)
    expect(accept.json().createdAccount).toBe(true)

    // The new member can log in and sees the org.
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email: inviteEmail, password: PASSWORD } })
    ).json()
    expect(login.activeOrganizationId).toBe(o.orgId)
  })

  it('an existing user accepts and belongs to two orgs with independent context', async () => {
    const a = await newOwner() // owns org A
    const b = await newOwner() // owns org B

    // B invites A's email; A accepts while authenticated → joins B, keeps A.
    await call({ method: 'POST', url: '/invitations', headers: bearer(b.token), payload: { email: a.email } })
    const token = lastToken('invitation')
    const accept = await call({
      method: 'POST',
      url: `/auth/invitations/${token}/accept`,
      headers: bearer(a.token),
      payload: {},
    })
    expect(accept.statusCode).toBe(201)
    expect(accept.json().createdAccount).toBe(false)

    // A now has two memberships; logging in offers both and scopes neither yet.
    const login = (
      await call({ method: 'POST', url: '/auth/login', payload: { email: a.email, password: PASSWORD } })
    ).json()
    expect(login.organizations.length).toBe(2)
    expect(login.activeOrganizationId).toBeNull()
  })

  it('rejects a duplicate pending invitation for the same email', async () => {
    const o = await newOwner()
    const e = uniqueEmail()
    const first = await call({ method: 'POST', url: '/invitations', headers: bearer(o.token), payload: { email: e } })
    expect(first.statusCode).toBe(201)
    const dup = await call({ method: 'POST', url: '/invitations', headers: bearer(o.token), payload: { email: e } })
    expect(dup.statusCode).toBe(409)
  })
})

d('authentication required', () => {
  it('rejects unauthenticated access to org routes', async () => {
    const res = await call({ method: 'GET', url: '/branches' })
    expect(res.statusCode).toBe(401)
  })
})
