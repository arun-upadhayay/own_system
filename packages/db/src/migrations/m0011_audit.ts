import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0011 — audit log (ERD §11). Append-only: UPDATE and DELETE are revoked from
 * app_role in 0016, because an audit log the application can rewrite proves
 * nothing.
 *
 * Denormalized labels (actor_label, resource_label) are captured at write time so
 * the entry stays readable after its subjects are deleted — the entries that
 * matter most in an investigation are often the ones whose subjects are gone.
 * `outcome` includes 'denied': failed authorization is the signal for probing, and
 * a log of only successes cannot show an attack that failed.
 */
export const m0011_audit = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `CREATE TABLE audit_logs (
         id              uuid PRIMARY KEY,
         actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
         actor_type      text NOT NULL,
         actor_label     text,
         organization_id uuid,
         action          text NOT NULL,
         resource_type   text NOT NULL,
         resource_id     uuid,
         resource_label  text,
         outcome         text NOT NULL,
         changes         jsonb,
         metadata        jsonb NOT NULL DEFAULT '{}',
         ip_address      inet,
         user_agent      text,
         correlation_id  uuid,
         created_at      timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT audit_actor_type_chk CHECK (actor_type IN ('user','system','product','api_client')),
         CONSTRAINT audit_outcome_chk CHECK (outcome IN ('success','failure','denied'))
       )`,
      `CREATE INDEX audit_logs_org_time_idx ON audit_logs (organization_id, created_at DESC)`,
      `CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC)`,
      `CREATE INDEX audit_logs_action_time_idx ON audit_logs (action, created_at DESC)`,
      `CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id)`,
    ])
  },
}
