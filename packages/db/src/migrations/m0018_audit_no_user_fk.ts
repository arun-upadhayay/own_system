import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0018 — drop the FK from audit_logs.actor_user_id to users (AR-010).
 *
 * The FK's ON DELETE SET NULL is an UPDATE on audit_logs, which the append-only
 * trigger (0016) correctly forbids — so deleting a user would fail. An append-only,
 * long-retention log should have no referential coupling INTO it: actor_user_id
 * stays a plain uuid, and the denormalized actor_label (captured at write time, ERD
 * §11) already preserves readability after the user is gone.
 */
export const m0018_audit_no_user_fk = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey`,
    ])
  },
}
