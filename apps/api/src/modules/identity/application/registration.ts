/**
 * Registration and email verification (06 §2).
 *
 * Self-service registration creates user + credentials + organization + owner
 * membership + verification token in ONE transaction (06 §2.1): a partial failure
 * here is the worst onboarding outcome available — an organization with no owner, or
 * a user who can neither log in nor re-register.
 *
 * The response is IDENTICAL whether or not the email already exists (06 §2.1): the
 * endpoint must not be an account-existence oracle. An existing user is notified
 * instead that someone tried to register with their address.
 */

import { randomBytes } from 'node:crypto'
import { sql } from 'kysely'
import { uuidv7, OrganizationId, UserId } from '@cp/core'
import { withSystemScope, recordAudit, enqueueOutbox } from '@cp/db'
import { checkPasswordPolicy } from '../domain/password-policy.js'
import { PasswordHasher } from '../infrastructure/password-hasher.js'
import { randomToken, sha256 } from '../infrastructure/crypto.js'
import type { IdentityContext, RequestMeta } from './context.js'

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  organizationName: string
}

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  // A RANDOM suffix, not a uuidv7 prefix: v7's leading bytes are the timestamp, so
  // slicing them collides for registrations in the same moment.
  return `${base || 'org'}-${randomBytes(5).toString('hex')}`
}

export interface RegisterResult {
  status: 'verification_sent'
}

export async function register(
  ctx: IdentityContext,
  input: RegisterInput,
  _meta: RequestMeta,
): Promise<RegisterResult> {
  const policy = checkPasswordPolicy(input.password)
  if (!policy.ok) {
    // A weak password is a genuine client error and safe to report — it reveals
    // nothing about account existence.
    throw new WeakPasswordError(policy.message ?? 'Password does not meet the policy.')
  }

  const email = input.email.trim().toLowerCase()

  await withSystemScope(ctx.db, async (tx) => {
    const existing = await tx
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    if (existing) {
      // Do not reveal existence. Tell the real owner someone tried.
      await ctx.email.send(email, 'registration_attempt_existing', {})
      return
    }

    const { hash, algorithm } = await PasswordHasher.hash(input.password)
    const userId = UserId.new()
    const orgId = OrganizationId.new()
    const token = randomToken(32)

    await tx
      .insertInto('users')
      .values({ id: userId, email, full_name: input.fullName, status: 'pending_verification' })
      .execute()
    await tx
      .insertInto('user_credentials')
      .values({ id: uuidv7(), user_id: userId, password_hash: hash, algorithm })
      .execute()
    await tx
      .insertInto('organizations')
      .values({
        id: orgId,
        name: input.organizationName,
        slug: slugify(input.organizationName),
        status: 'pending',
        created_by_user_id: userId,
      })
      .execute()
    const membershipId = uuidv7()
    await tx
      .insertInto('memberships')
      .values({
        id: membershipId,
        user_id: userId,
        organization_id: orgId,
        status: 'active',
        is_owner: true,
        joined_at: sql`now()`,
      })
      .execute()
    await tx
      .insertInto('email_verification_tokens')
      .values({
        id: uuidv7(),
        user_id: userId,
        email,
        token_hash: sha256(token),
        expires_at: new Date(ctx.clock.nowMs() + VERIFICATION_TTL_MS),
      })
      .execute()

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: userId,
      actorLabel: input.fullName,
      organizationId: orgId,
      action: 'organization.registered',
      resourceType: 'organization',
      resourceId: orgId,
      resourceLabel: input.organizationName,
      outcome: 'success',
    })
    await enqueueOutbox(tx, {
      eventType: 'OrganizationCreated',
      aggregateType: 'organization',
      aggregateId: orgId,
      organizationId: orgId,
      payload: { organizationId: orgId, ownerUserId: userId },
    })

    await ctx.email.send(email, 'verify_email', { token })
  })

  return { status: 'verification_sent' }
}

export async function verifyEmail(ctx: IdentityContext, rawToken: string): Promise<void> {
  const tokenHash = sha256(rawToken)
  await withSystemScope(ctx.db, async (tx) => {
    const row = await tx
      .selectFrom('email_verification_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .executeTakeFirst()

    if (!row || row.expires_at.getTime() < ctx.clock.nowMs()) {
      throw new InvalidTokenError('This verification link is invalid or has expired.')
    }

    await tx
      .updateTable('email_verification_tokens')
      .set({ used_at: sql`now()` })
      .where('id', '=', row.id)
      .execute()
    await tx
      .updateTable('users')
      .set({ email_verified_at: sql`now()`, status: 'active' })
      .where('id', '=', row.user_id)
      .where('status', '=', 'pending_verification')
      .execute()
    // Activate the owner's organization(s) that are still pending.
    await tx
      .updateTable('organizations')
      .set({ status: 'active' })
      .where('created_by_user_id', '=', row.user_id)
      .where('status', '=', 'pending')
      .execute()

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: row.user_id,
      action: 'user.email_verified',
      resourceType: 'user',
      resourceId: row.user_id,
      outcome: 'success',
    })
  })
}

export class WeakPasswordError extends Error {}
export class InvalidTokenError extends Error {}
