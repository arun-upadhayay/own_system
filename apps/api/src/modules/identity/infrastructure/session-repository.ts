/**
 * Sessions and refresh-token families (ADR-004, ADR-017).
 *
 * Sessions are server-side and revocable — the mechanism that makes immediate
 * suspension and logout real. Refresh tokens are stored only as SHA-256 hashes
 * (ERD §3.3.1); the plaintext is returned once and never persisted, so a database
 * dump is not a set of working credentials.
 */

import { sql, type Transaction } from 'kysely'
import type { DB } from '@cp/db'
import { uuidv7 } from '@cp/core'
import { randomToken, sha256 } from './crypto.js'

export type RevokeReason =
  | 'logout'
  | 'rotation_reuse'
  | 'org_suspended'
  | 'password_changed'
  | 'admin'

export interface NewSession {
  userId: string
  organizationId: string | null
  expiresAt: Date
  ip?: string | null
  userAgent?: string | null
}

export const SessionRepository = {
  async createSession(tx: Transaction<DB>, input: NewSession): Promise<string> {
    const id = uuidv7()
    await tx
      .insertInto('sessions')
      .values({
        id,
        user_id: input.userId,
        organization_id: input.organizationId,
        issued_at: sql`now()`,
        expires_at: input.expiresAt,
        last_used_at: sql`now()`,
        ip_address: input.ip ?? null,
        user_agent: input.userAgent ?? null,
      })
      .execute()
    return id
  },

  /** Issue a refresh token for a session family. Returns the PLAINTEXT once. */
  async issueRefreshToken(
    tx: Transaction<DB>,
    sessionId: string,
    generation: number,
    expiresAt: Date,
  ): Promise<string> {
    const token = randomToken(32)
    await tx
      .insertInto('refresh_tokens')
      .values({
        id: uuidv7(),
        session_id: sessionId,
        token_hash: sha256(token),
        generation,
        issued_at: sql`now()`,
        expires_at: expiresAt,
      })
      .execute()
    return token
  },

  async findRefreshByHash(tx: Transaction<DB>, tokenHash: string) {
    return tx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst()
  },

  async consumeRefreshToken(
    tx: Transaction<DB>,
    id: string,
    replacedById: string | null,
  ): Promise<void> {
    await tx
      .updateTable('refresh_tokens')
      .set({ consumed_at: sql`now()`, replaced_by_id: replacedById })
      .where('id', '=', id)
      .execute()
  },

  /**
   * Consume every live token for a session. Used before issuing a fresh token for an
   * existing session (e.g. organization switch), so the one-live-token-per-family
   * unique index is never violated.
   */
  async consumeLiveTokens(tx: Transaction<DB>, sessionId: string): Promise<void> {
    await tx
      .updateTable('refresh_tokens')
      .set({ consumed_at: sql`now()` })
      .where('session_id', '=', sessionId)
      .where('consumed_at', 'is', null)
      .execute()
  },

  async maxGeneration(tx: Transaction<DB>, sessionId: string): Promise<number> {
    const row = await tx
      .selectFrom('refresh_tokens')
      .select((eb) => eb.fn.max('generation').as('g'))
      .where('session_id', '=', sessionId)
      .executeTakeFirst()
    return Number(row?.g ?? -1)
  },

  async getSession(tx: Transaction<DB>, sessionId: string) {
    return tx.selectFrom('sessions').selectAll().where('id', '=', sessionId).executeTakeFirst()
  },

  async setSessionOrganization(
    tx: Transaction<DB>,
    sessionId: string,
    organizationId: string,
  ): Promise<void> {
    await tx
      .updateTable('sessions')
      .set({ organization_id: organizationId, last_used_at: sql`now()` })
      .where('id', '=', sessionId)
      .execute()
  },

  async revokeSession(tx: Transaction<DB>, sessionId: string, reason: RevokeReason): Promise<void> {
    await tx
      .updateTable('sessions')
      .set({ revoked_at: sql`now()`, revoked_reason: reason })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute()
  },

  /** Revoke every live session for a user — used on password change (06 §8). */
  async revokeAllUserSessions(
    tx: Transaction<DB>,
    userId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await tx
      .updateTable('sessions')
      .set({ revoked_at: sql`now()`, revoked_reason: reason })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute()
  },
}

export { sha256 }
