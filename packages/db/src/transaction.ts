/**
 * RLS-aware transaction helpers (ERD §14, ADR-012 Layer 4).
 *
 * Every tenant-scoped unit of work runs inside a transaction that sets
 * `app.current_organization_id` as a TRANSACTION-LOCAL setting (`set_config(...,
 * true)`). Transaction-local, not connection-level, is essential on a pooled
 * endpoint: a connection-level setting would leak across pooled requests, which
 * would be a tenant leak created by the isolation mechanism itself.
 *
 * Row-level security on the base tables then filters every query to the scope's
 * organization, OR to platform scope for staff/system operations — so even a
 * query that forgot its `WHERE organization_id = ?` returns nothing instead of
 * another tenant's rows.
 */

import { sql, type Kysely, type Transaction } from 'kysely'
import type { OrgScope, PlatformScope } from '@cp/core'
import type { DB } from './schema.js'

/**
 * Run work scoped to one organization. Sets the RLS tenant key for the
 * transaction; every statement inside is filtered to that organization.
 */
export async function withOrgScope<T>(
  db: Kysely<DB>,
  scope: OrgScope,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.current_organization_id', ${scope.organizationId}, true)`.execute(
      tx,
    )
    await sql`select set_config('app.platform_scope', 'false', true)`.execute(tx)
    return fn(tx)
  })
}

/**
 * Run work with cross-tenant (platform) visibility — company-staff operations and
 * system jobs. Only reachable after a platform-permission check has produced a
 * PlatformScope (ADR-012 Layer 3). Every such use is audited by its caller.
 */
export async function withPlatformScope<T>(
  db: Kysely<DB>,
  _scope: PlatformScope,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.platform_scope', 'true', true)`.execute(tx)
    return fn(tx)
  })
}

/**
 * System scope — migrations, seeds, and background jobs that run without a user.
 * Equivalent to platform visibility; separated by name so a grep for
 * `withPlatformScope` finds only staff-initiated cross-tenant work.
 */
export async function withSystemScope<T>(
  db: Kysely<DB>,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.platform_scope', 'true', true)`.execute(tx)
    return fn(tx)
  })
}
