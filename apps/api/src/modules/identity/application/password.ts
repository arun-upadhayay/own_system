/**
 * Password reset and change (06 §8).
 *
 * `requestPasswordReset` ALWAYS returns success, regardless of whether the address
 * exists — any difference in response, timing or wording is an account-existence
 * oracle. A reset consumes a single-use token and REVOKES EVERY SESSION: a reset is
 * often the response to a suspected compromise, so leaving the attacker's session
 * alive would make it theatre.
 */

import { sql } from 'kysely'
import { uuidv7 } from '@cp/core'
import { withSystemScope, recordAudit } from '@cp/db'
import { checkPasswordPolicy } from '../domain/password-policy.js'
import { PasswordHasher } from '../infrastructure/password-hasher.js'
import { SessionRepository } from '../infrastructure/session-repository.js'
import { randomToken, sha256 } from '../infrastructure/crypto.js'
import { InvalidTokenError, WeakPasswordError } from './registration.js'
import type { IdentityContext } from './context.js'

const RESET_TTL_MS = 30 * 60 * 1000

export async function requestPasswordReset(ctx: IdentityContext, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase()
  const user = await ctx.db
    .selectFrom('users')
    .select(['id', 'status'])
    .where('email', '=', email)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()

  // Silent no-op for unknown or inactive accounts — the caller always gets 202.
  if (!user || user.status !== 'active') return

  const token = randomToken(32)
  await ctx.db.transaction().execute(async (tx) => {
    // Invalidate any prior unused tokens — several live tokens widen the window for
    // whichever one leaked.
    await tx
      .updateTable('password_reset_tokens')
      .set({ used_at: sql`now()` })
      .where('user_id', '=', user.id)
      .where('used_at', 'is', null)
      .execute()
    await tx
      .insertInto('password_reset_tokens')
      .values({
        id: uuidv7(),
        user_id: user.id,
        token_hash: sha256(token),
        expires_at: new Date(ctx.clock.nowMs() + RESET_TTL_MS),
      })
      .execute()
  })
  await ctx.email.send(email, 'password_reset', { token })
}

export async function resetPassword(
  ctx: IdentityContext,
  input: { token: string; newPassword: string },
): Promise<void> {
  const policy = checkPasswordPolicy(input.newPassword)
  if (!policy.ok) throw new WeakPasswordError(policy.message ?? 'Password does not meet the policy.')

  const tokenHash = sha256(input.token)
  await withSystemScope(ctx.db, async (tx) => {
    const row = await tx
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .executeTakeFirst()
    if (!row || row.expires_at.getTime() < ctx.clock.nowMs()) {
      throw new InvalidTokenError('This reset link is invalid or has expired.')
    }

    const { hash, algorithm } = await PasswordHasher.hash(input.newPassword)
    await tx
      .updateTable('password_reset_tokens')
      .set({ used_at: sql`now()` })
      .where('id', '=', row.id)
      .execute()
    await tx
      .updateTable('user_credentials')
      .set({ password_hash: hash, algorithm, password_changed_at: sql`now()`, must_change_password: false })
      .where('user_id', '=', row.user_id)
      .execute()
    // A reset ends every session (06 §8).
    await SessionRepository.revokeAllUserSessions(tx, row.user_id, 'password_changed')
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: row.user_id,
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: row.user_id,
      outcome: 'success',
    })
  })
}

export async function changePassword(
  ctx: IdentityContext,
  input: { userId: string; currentPassword: string; newPassword: string; keepSessionId?: string },
): Promise<void> {
  const policy = checkPasswordPolicy(input.newPassword)
  if (!policy.ok) throw new WeakPasswordError(policy.message ?? 'Password does not meet the policy.')

  const cred = await ctx.db
    .selectFrom('user_credentials')
    .select(['password_hash'])
    .where('user_id', '=', input.userId)
    .executeTakeFirst()
  if (!cred || !(await PasswordHasher.verify(cred.password_hash, input.currentPassword))) {
    throw new InvalidTokenError('Current password is incorrect.')
  }

  const { hash, algorithm } = await PasswordHasher.hash(input.newPassword)
  await withSystemScope(ctx.db, async (tx) => {
    await tx
      .updateTable('user_credentials')
      .set({ password_hash: hash, algorithm, password_changed_at: sql`now()` })
      .where('user_id', '=', input.userId)
      .execute()
    await SessionRepository.revokeAllUserSessions(tx, input.userId, 'password_changed')
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: input.userId,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: input.userId,
      outcome: 'success',
    })
  })
}
