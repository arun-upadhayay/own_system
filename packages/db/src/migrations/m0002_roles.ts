import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0002 — database roles (ERD §11.1, §13.1; 15 §3).
 *
 *   app_role          the application's privilege boundary. Gets INSERT/SELECT on
 *                     audit_logs but NEVER update/delete (revoked in 0016), so the
 *                     log an application can rewrite cannot exist.
 *   maintenance_role  retention only: DROP of old audit partitions, which needs
 *                     DDL rights the application role must not hold.
 *
 * Both are NOLOGIN privilege-defining roles here. On Neon the runtime currently
 * connects as the database owner with FORCE ROW LEVEL SECURITY making the RLS
 * policies apply regardless (see 0015 and the change-log note for AR-009). A later
 * phase can switch the runtime to log in as app_role once app endpoints exist.
 */
export const m0002_roles = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
           CREATE ROLE app_role NOLOGIN;
         END IF;
       END $$`,
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maintenance_role') THEN
           CREATE ROLE maintenance_role NOLOGIN;
         END IF;
       END $$`,
    ])
  },
}
