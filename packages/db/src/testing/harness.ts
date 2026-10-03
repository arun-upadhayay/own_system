/**
 * Test harness: per-test transaction rollback (Phase 2 plan).
 *
 * Each test runs inside a transaction that is rolled back at the end, so tests are
 * fast and isolated and never pollute the database that later phases use. Setting
 * the RLS context (`app.*`) is done inside the transaction, so a single test can
 * seed under platform scope and then re-query under org scope to prove isolation.
 *
 * DB-dependent suites skip automatically when no DATABASE_URL is configured, so
 * `pnpm test` stays green in an environment without the database.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { sql, type Kysely, type Transaction } from 'kysely'
import { createDb } from '../kysely.js'
import type { DB } from '../schema.js'

export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  try {
    for (const line of readFileSync(resolve(here, '../../.env'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq > 0 && !(t.slice(0, eq).trim() in process.env)) {
        process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
      }
    }
  } catch {
    /* ambient env */
  }
}

loadDotEnv()

/**
 * Tests connect as app_role (APP_DATABASE_URL) — a role WITHOUT bypassrls — so RLS
 * is genuinely exercised. The Neon owner has bypassrls, which overrides even FORCE
 * ROW LEVEL SECURITY, so connecting as the owner would make the RLS tests
 * meaningless (AR-009). The DIRECT endpoint is used: a real session.
 */
export const TEST_DB_URL =
  process.env.APP_DATABASE_URL || process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL
export const HAS_DB = Boolean(TEST_DB_URL)
/** True when connected as the non-bypass app_role, so RLS actually applies. */
export const RLS_ENFORCED = Boolean(process.env.APP_DATABASE_URL)

let shared: Kysely<DB> | null = null
export function testDb(): Kysely<DB> {
  if (!TEST_DB_URL) throw new Error('No database configured for tests')
  shared ??= createDb(TEST_DB_URL, 3)
  return shared
}

export async function closeTestDb(): Promise<void> {
  if (shared) {
    await shared.destroy()
    shared = null
  }
}

class Rollback extends Error {}

/**
 * Run a test body inside a transaction that always rolls back. If the body throws
 * an assertion error, it propagates (the test fails) and the transaction still
 * rolls back. If the body succeeds, a sentinel forces the rollback.
 */
export async function inRolledBackTx(
  fn: (tx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  try {
    await testDb()
      .transaction()
      .execute(async (tx) => {
        await fn(tx)
        throw new Rollback()
      })
  } catch (err) {
    if (!(err instanceof Rollback)) throw err
  }
}

/** Set platform (cross-tenant) scope for the current transaction. */
export async function setPlatformScope(tx: Transaction<DB>): Promise<void> {
  await sql`select set_config('app.platform_scope', 'true', true)`.execute(tx)
}

/** Set tenant scope for the current transaction. */
export async function setOrgScope(tx: Transaction<DB>, organizationId: string): Promise<void> {
  await sql`select set_config('app.platform_scope', 'false', true)`.execute(tx)
  await sql`select set_config('app.current_organization_id', ${organizationId}, true)`.execute(tx)
}

/**
 * Clear all scope — simulates a query that forgot to establish tenant context.
 * The org id is reset to SQL NULL, never '': the RLS policies cast the setting to
 * uuid, and `''::uuid` would error whereas `NULL::uuid` yields NULL (no rows),
 * which is the behaviour under test.
 */
export async function clearScope(tx: Transaction<DB>): Promise<void> {
  await sql`select set_config('app.platform_scope', 'false', true)`.execute(tx)
  await sql`select set_config('app.current_organization_id', '', true)`.execute(tx)
}
