import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0016 — privileges and audit append-only (ERD §11.1, §13; 15 §10).
 *
 * Two mechanisms, because the runtime currently connects as the database owner on
 * Neon (AR-009), and the owner bypasses table-privilege grants:
 *
 *   1. GRANTs define app_role's boundary for when the runtime switches to logging
 *      in as app_role — INSERT/SELECT on audit_logs, never UPDATE/DELETE.
 *   2. A BEFORE UPDATE/DELETE TRIGGER enforces append-only regardless of the
 *      connecting role (including the owner), unless an explicit maintenance flag
 *      is set. This is what actually makes the log unrewritable in our setup, and
 *      it is testable while connected as the owner.
 *
 * Retention (dropping old partitions, once partitioning exists) runs as
 * maintenance_role with the flag set — never from request-handling code.
 */
export const m0016_audit_privileges = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ── app_role privilege boundary ─────────────────────────────────────────
      `GRANT USAGE ON SCHEMA public TO app_role`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role`,
      `GRANT SELECT ON v_organization_products TO app_role`,
      // The log an application can rewrite proves nothing.
      `REVOKE UPDATE, DELETE ON audit_logs FROM app_role`,

      // ── maintenance_role: retention only ────────────────────────────────────
      `GRANT USAGE ON SCHEMA public TO maintenance_role`,
      `GRANT SELECT, DELETE ON audit_logs TO maintenance_role`,

      // ── append-only trigger (works regardless of connecting role) ───────────
      `CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $fn$
       BEGIN
         IF current_setting('app.allow_audit_maintenance', true) = 'true' THEN
           RETURN COALESCE(NEW, OLD);
         END IF;
         RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP
           USING ERRCODE = 'insufficient_privilege';
       END; $fn$ LANGUAGE plpgsql`,
      `CREATE TRIGGER audit_logs_no_update
         BEFORE UPDATE ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()`,
      `CREATE TRIGGER audit_logs_no_delete
         BEFORE DELETE ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()`,
    ])
  },
}
