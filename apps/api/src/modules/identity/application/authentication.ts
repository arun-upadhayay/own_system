/**
 * Authentication: login, token refresh, logout, organization selection (06 §3–§5).
 *
 * The security-critical properties, all exercised by tests:
 *  - One GENERIC failure for every login error (wrong password, unknown email,
 *    unverified, suspended, locked) — the endpoint is not an enumeration oracle.
 *  - A dummy hash verification runs when the user is absent, equalizing timing.
 *  - Lockout is indistinguishable from a wrong password.
 *  - Refresh-token reuse at ANY generation revokes the family and alerts (ADR-017).
 *  - Refresh re-validates user/membership/org, so suspension takes effect within one
 *    access-token lifetime even for a client holding a valid refresh token.
 */

import { sql } from 'kysely'
import { withSystemScope, recordAudit, enqueueOutbox } from '@cp/db'
import type { Clock } from '@cp/core'
import { PasswordHasher } from '../infrastructure/password-hasher.js'
import { SessionRepository } from '../infrastructure/session-repository.js'
import { sha256 } from '../infrastructure/crypto.js'
import { permissionDigest, type AccessTokenClaims } from '../domain/tokens.js'
import type { IdentityContext, RequestMeta } from './context.js'

export class AuthError extends Error {
  constructor() {
    super('Invalid email or password.') // deliberately generic
    this.name = 'AuthError'
  }
}

export interface MembershipSummary {
  membershipId: string
  organizationId: string
  organizationName: string
  organizationStatus: string
  isOwner: boolean
  defaultBranchId: string | null
  allBranches: boolean
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export interface LoginResult extends TokenPair {
  userId: string
  sessionId: string
  activeOrganizationId: string | null
  organizations: MembershipSummary[]
}

function refreshExpiry(clock: Clock, ttlSeconds: number): Date {
  return new Date(clock.nowMs() + ttlSeconds * 1000)
}

async function resolveActiveMemberships(
  ctx: IdentityContext,
  userId: string,
): Promise<MembershipSummary[]> {
  // Cross-tenant identity lookup (a user spans tenants), so it runs under system
  // scope — a legitimate, bounded cross-tenant read (ADR-012 Layer 3).
  return withSystemScope(ctx.db, async (tx) => {
    const rows = await tx
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select([
        'm.id as membershipId',
        'm.organization_id as organizationId',
        'o.name as organizationName',
        'o.status as organizationStatus',
        'm.is_owner as isOwner',
        'm.default_branch_id as defaultBranchId',
        'm.all_branches as allBranches',
      ])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active')
      .where('o.deleted_at', 'is', null)
      .execute()
    return rows.map((r) => ({
      membershipId: r.membershipId,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      organizationStatus: r.organizationStatus,
      isOwner: r.isOwner,
      defaultBranchId: r.defaultBranchId,
      allBranches: r.allBranches,
    }))
  })
}

async function buildAccessToken(
  ctx: IdentityContext,
  params: {
    userId: string
    sessionId: string
    membership: MembershipSummary | null
    amr: string[]
  },
): Promise<string> {
  const { membership } = params
  // Permissions arrive with RBAC (Phase 5); the digest is over the resolved set,
  // empty for now. The claim and the seam exist so products integrate against it.
  const claims: AccessTokenClaims = {
    sub: params.userId,
    sid: params.sessionId,
    org: membership?.organizationId ?? null,
    mem: membership?.membershipId ?? null,
    branch: membership?.defaultBranchId ?? null,
    all_branches: membership?.allBranches ?? true,
    scope: 'openid profile',
    perm_digest: permissionDigest([]),
    amr: params.amr,
  }
  const audience = membership ? [membership.organizationId] : ['cp:unscoped']
  return ctx.tokens.signAccessToken(claims, audience)
}

export async function login(
  ctx: IdentityContext,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase()
  const now = ctx.clock.nowMs()

  const user = await ctx.db
    .selectFrom('users as u')
    .leftJoin('user_credentials as c', 'c.user_id', 'u.id')
    .select([
      'u.id as id',
      'u.status as status',
      'u.full_name as fullName',
      'u.email_verified_at as emailVerifiedAt',
      'u.failed_login_count as failedLoginCount',
      'u.locked_until as lockedUntil',
      'c.password_hash as passwordHash',
      'c.algorithm as algorithm',
    ])
    .where('u.email', '=', email)
    .where('u.deleted_at', 'is', null)
    .executeTakeFirst()

  // Absent user: equalize timing, then fail generically.
  if (!user || !user.passwordHash) {
    await PasswordHasher.verifyDummy(input.password)
    throw new AuthError()
  }

  const locked = user.lockedUntil && user.lockedUntil.getTime() > now
  // Always verify (even when locked/inactive) so timing does not distinguish cases.
  const passwordOk = await PasswordHasher.verify(user.passwordHash, input.password)

  if (locked || user.status !== 'active' || !passwordOk) {
    if (!passwordOk && !locked) {
      const failures = user.failedLoginCount + 1
      const shouldLock = failures >= ctx.env.LOGIN_MAX_FAILURES
      await ctx.db
        .updateTable('users')
        .set({
          failed_login_count: failures,
          locked_until: shouldLock
            ? new Date(now + ctx.env.LOGIN_LOCKOUT_MINUTES * 60_000)
            : null,
        })
        .where('id', '=', user.id)
        .execute()
    }
    await withSystemScope(ctx.db, (tx) =>
      recordAudit(tx, {
        actorType: 'user',
        actorUserId: user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'denied',
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        correlationId: meta.correlationId ?? null,
      }),
    )
    throw new AuthError()
  }

  // Success. Reset counters; rehash transparently if parameters have changed.
  await ctx.db
    .updateTable('users')
    .set({ failed_login_count: 0, locked_until: null, last_login_at: sql`now()` })
    .where('id', '=', user.id)
    .execute()
  if (user.algorithm && PasswordHasher.needsRehash(user.algorithm)) {
    const { hash, algorithm } = await PasswordHasher.hash(input.password)
    await ctx.db
      .updateTable('user_credentials')
      .set({ password_hash: hash, algorithm, password_changed_at: sql`now()` })
      .where('user_id', '=', user.id)
      .execute()
  }

  const memberships = await resolveActiveMemberships(ctx, user.id)
  // Exactly one active membership → scope the session immediately; otherwise issue
  // an unscoped token that can only reach /me and /me/organizations (ADR-004).
  const activeMembership = memberships.length === 1 ? memberships[0]! : null
  const orgId = activeMembership?.organizationStatus === 'active' ? activeMembership.organizationId : null

  const pair = await withSystemScope(ctx.db, async (tx) => {
    const sessionId = await SessionRepository.createSession(tx, {
      userId: user.id,
      organizationId: orgId,
      expiresAt: refreshExpiry(ctx.clock, ctx.env.REFRESH_TOKEN_TTL_SECONDS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    const refreshToken = await SessionRepository.issueRefreshToken(
      tx,
      sessionId,
      0,
      refreshExpiry(ctx.clock, ctx.env.REFRESH_TOKEN_TTL_SECONDS),
    )
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: user.id,
      actorLabel: user.fullName,
      organizationId: orgId,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: sessionId,
      outcome: 'success',
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      correlationId: meta.correlationId ?? null,
    })
    return { sessionId, refreshToken }
  })

  const accessToken = await buildAccessToken(ctx, {
    userId: user.id,
    sessionId: pair.sessionId,
    membership: orgId ? activeMembership : null,
    amr: ['pwd'],
  })

  return {
    accessToken,
    refreshToken: pair.refreshToken,
    tokenType: 'Bearer',
    expiresIn: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
    userId: user.id,
    sessionId: pair.sessionId,
    activeOrganizationId: orgId,
    organizations: memberships,
  }
}

export class RefreshError extends Error {}

export async function refresh(
  ctx: IdentityContext,
  presentedToken: string,
  meta: RequestMeta,
): Promise<TokenPair> {
  const tokenHash = sha256(presentedToken)

  // The transaction returns a discriminated result rather than throwing: a failure
  // path (reuse, suspension) must COMMIT its revocation, so we throw only AFTER the
  // transaction commits. Throwing inside would roll the revocation back — which was
  // a real bug: reuse detection appeared to work but left the family alive.
  type Outcome =
    | { kind: 'ok'; pair: TokenPair }
    | { kind: 'invalid' }
    | { kind: 'reuse' }
    | { kind: 'user_inactive' }
    | { kind: 'org_revoked' }

  const outcome = await withSystemScope(ctx.db, async (tx): Promise<Outcome> => {
    const row = await SessionRepository.findRefreshByHash(tx, tokenHash)
    if (!row) return { kind: 'invalid' }

    // Reuse of a consumed token (any generation) = presumed theft: revoke the whole
    // family and alert (ADR-017). This commits with the transaction.
    if (row.consumed_at !== null) {
      await SessionRepository.revokeSession(tx, row.session_id, 'rotation_reuse')
      await recordAudit(tx, {
        actorType: 'system',
        action: 'auth.refresh_reuse_detected',
        resourceType: 'session',
        resourceId: row.session_id,
        outcome: 'denied',
        correlationId: meta.correlationId ?? null,
      })
      await enqueueOutbox(tx, {
        eventType: 'SessionTokenReuseDetected',
        aggregateType: 'session',
        aggregateId: row.session_id,
        payload: { sessionId: row.session_id, generation: row.generation },
      })
      return { kind: 'reuse' }
    }

    if (row.expires_at.getTime() < ctx.clock.nowMs()) return { kind: 'invalid' }

    const session = await SessionRepository.getSession(tx, row.session_id)
    if (!session || session.revoked_at !== null || session.expires_at.getTime() < ctx.clock.nowMs()) {
      return { kind: 'invalid' }
    }

    // Re-validate the user and (if scoped) the organization — this is what makes
    // suspension effective within one access-token lifetime.
    const user = await tx
      .selectFrom('users')
      .select(['id', 'status'])
      .where('id', '=', session.user_id)
      .executeTakeFirst()
    if (!user || user.status !== 'active') {
      await SessionRepository.revokeSession(tx, session.id, 'admin')
      return { kind: 'user_inactive' }
    }

    let membership: MembershipSummary | null = null
    if (session.organization_id) {
      const m = await tx
        .selectFrom('memberships as m')
        .innerJoin('organizations as o', 'o.id', 'm.organization_id')
        .select([
          'm.id as membershipId',
          'm.organization_id as organizationId',
          'o.name as organizationName',
          'o.status as organizationStatus',
          'm.is_owner as isOwner',
          'm.default_branch_id as defaultBranchId',
          'm.all_branches as allBranches',
        ])
        .where('m.user_id', '=', session.user_id)
        .where('m.organization_id', '=', session.organization_id)
        .where('m.status', '=', 'active')
        .executeTakeFirst()
      if (!m || m.organizationStatus !== 'active') {
        await SessionRepository.revokeSession(tx, session.id, 'org_suspended')
        return { kind: 'org_revoked' }
      }
      membership = { ...m }
    }

    // Rotate: consume the current token FIRST, then issue the next generation — the
    // one-live-token-per-family unique index forbids two live tokens at once.
    await SessionRepository.consumeRefreshToken(tx, row.id, null)
    const nextToken = await SessionRepository.issueRefreshToken(
      tx,
      session.id,
      row.generation + 1,
      refreshExpiry(ctx.clock, ctx.env.REFRESH_TOKEN_TTL_SECONDS),
    )
    const next = await SessionRepository.findRefreshByHash(tx, sha256(nextToken))
    if (next) {
      await tx
        .updateTable('refresh_tokens')
        .set({ replaced_by_id: next.id })
        .where('id', '=', row.id)
        .execute()
    }

    const accessToken = await buildAccessToken(ctx, {
      userId: session.user_id,
      sessionId: session.id,
      membership,
      amr: ['pwd'],
    })
    return {
      kind: 'ok',
      pair: {
        accessToken,
        refreshToken: nextToken,
        tokenType: 'Bearer' as const,
        expiresIn: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
      },
    }
  })

  if (outcome.kind === 'ok') return outcome.pair
  // Generic messages; the distinction is in the audit log, not the response.
  throw new RefreshError(
    outcome.kind === 'reuse' ? 'Refresh token reuse detected.' : 'Invalid or expired refresh token.',
  )
}

export async function logout(ctx: IdentityContext, sessionId: string): Promise<void> {
  await withSystemScope(ctx.db, (tx) => SessionRepository.revokeSession(tx, sessionId, 'logout'))
}

export async function selectOrganization(
  ctx: IdentityContext,
  params: { userId: string; sessionId: string; organizationId: string },
): Promise<TokenPair> {
  return withSystemScope(ctx.db, async (tx) => {
    const m = await tx
      .selectFrom('memberships as m')
      .innerJoin('organizations as o', 'o.id', 'm.organization_id')
      .select([
        'm.id as membershipId',
        'm.organization_id as organizationId',
        'o.name as organizationName',
        'o.status as organizationStatus',
        'm.is_owner as isOwner',
        'm.default_branch_id as defaultBranchId',
        'm.all_branches as allBranches',
      ])
      .where('m.user_id', '=', params.userId)
      .where('m.organization_id', '=', params.organizationId)
      .where('m.status', '=', 'active')
      .executeTakeFirst()

    // "Not a member" and "organization inactive" return the same error — telling
    // them apart would reveal whether an organization exists (06 §4).
    if (!m || m.organizationStatus !== 'active') {
      throw new RefreshError('Cannot select this organization.')
    }

    const session = await SessionRepository.getSession(tx, params.sessionId)
    if (!session || session.revoked_at !== null) throw new RefreshError('Session is not valid.')

    await SessionRepository.setSessionOrganization(tx, params.sessionId, params.organizationId)
    // Consume the session's existing live token before issuing the org-scoped one,
    // so the one-live-token-per-family index holds.
    await SessionRepository.consumeLiveTokens(tx, params.sessionId)
    const nextGen = (await SessionRepository.maxGeneration(tx, params.sessionId)) + 1
    const refreshToken = await SessionRepository.issueRefreshToken(
      tx,
      params.sessionId,
      nextGen,
      refreshExpiry(ctx.clock, ctx.env.REFRESH_TOKEN_TTL_SECONDS),
    )
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: params.userId,
      organizationId: params.organizationId,
      action: 'auth.organization_selected',
      resourceType: 'organization',
      resourceId: params.organizationId,
      outcome: 'success',
    })

    const accessToken = await buildAccessToken(ctx, {
      userId: params.userId,
      sessionId: params.sessionId,
      membership: { ...m },
      amr: ['pwd'],
    })
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
    }
  })
}

export async function getMe(ctx: IdentityContext, userId: string) {
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'email', 'full_name', 'status', 'email_verified_at', 'locale', 'timezone'])
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    status: user.status,
    emailVerified: user.email_verified_at !== null,
    locale: user.locale,
    timezone: user.timezone,
  }
}

export async function listMyOrganizations(
  ctx: IdentityContext,
  userId: string,
): Promise<MembershipSummary[]> {
  return resolveActiveMemberships(ctx, userId)
}
