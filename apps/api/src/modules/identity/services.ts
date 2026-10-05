/**
 * Identity services other modules may use, exposed through the module index.
 * See index.ts for the rationale (HLD §4.1).
 */
import { sql, type Kysely } from 'kysely'
import type { DB } from '@cp/db'
import { uuidv7, UserId } from '@cp/core'
import { withSystemScope } from '@cp/db'
import { PasswordHasher } from './infrastructure/password-hasher.js'
import { SessionRepository, type RevokeReason } from './infrastructure/session-repository.js'


/**
 * Provision a user from an accepted invitation. The user is created ACTIVE and
 * email-verified: receiving the invitation token at that address already proves
 * control of it (06 §2.2). Returns null if an account already exists for the email
 * (the caller tells the invitee to sign in instead).
 */
export async function provisionInvitedUser(
  db: Kysely<DB>,
  input: { email: string; password: string; fullName: string },
): Promise<string | null> {
  const email = input.email.trim().toLowerCase()
  const { hash, algorithm } = await PasswordHasher.hash(input.password)
  return withSystemScope(db, async (tx) => {
    const existing = await tx
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (existing) return null
    const userId = UserId.new()
    await tx
      .insertInto('users')
      .values({ id: userId, email, full_name: input.fullName, status: 'active', email_verified_at: sql`now()` })
      .execute()
    await tx
      .insertInto('user_credentials')
      .values({ id: uuidv7(), user_id: userId, password_hash: hash, algorithm })
      .execute()
    return userId
  })
}

/** Revoke every live session for a user (e.g. on membership suspend/remove). */
export async function revokeUserSessions(
  db: Kysely<DB>,
  userId: string,
  reason: RevokeReason,
): Promise<void> {
  await withSystemScope(db, (tx) => SessionRepository.revokeAllUserSessions(tx, userId, reason))
}
