/**
 * Kysely instance and pool.
 *
 * Kysely rather than an ORM (HLD §1.1): the two hardest requirements in this
 * platform — race-safe limit enforcement (ADR-011) and structural tenant scoping
 * (ADR-012) — depend on knowing exactly what SQL runs. `SELECT ... FOR UPDATE`,
 * partial unique indexes and the guarantee that no query omits `organization_id`
 * are all things an ORM's lazy loading makes harder to verify.
 */

import pg from 'pg'
import { Kysely, PostgresDialect, type Transaction } from 'kysely'
import type { DB } from './schema.js'

/**
 * Neon serves a valid certificate, so TLS is verified (verify-full). We set this
 * explicitly rather than relying on the connection string's `sslmode`, which pg
 * is deprecating as an alias.
 */
function sslFor(url: string): pg.PoolConfig['ssl'] {
  return url.includes('sslmode=disable') ? false : { rejectUnauthorized: true }
}

export function createPool(url: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    ssl: sslFor(url),
    max,
    // A pooled Neon endpoint closes idle server connections; keep the client
    // pool modest and let it recycle.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

export function createDb(url: string, max = 10): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: createPool(url, max) }) })
}

export type DbOrTx = Kysely<DB> | Transaction<DB>
export type { Transaction }
