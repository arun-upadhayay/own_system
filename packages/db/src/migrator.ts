/**
 * Migration runner.
 *
 * Forward-only (ERD §5): production migrations have no `down`. A down migration
 * that discards a column discards customer data; recovery is a new forward
 * migration plus a restore, which is slower but honest. Kysely's Migrator tracks
 * applied migrations in `kysely_migration`, so re-running is a no-op — which is
 * what makes "migrations are idempotent" (Phase 2 acceptance) hold.
 *
 * Migrations run against the DIRECT (non-pooled) endpoint: DDL, CREATE ROLE and
 * advisory locks need a real session, which a transaction pooler cannot give.
 */

import { Migrator } from 'kysely'
import type { Kysely, MigrationProvider, Migration } from 'kysely'
import { createDb } from './kysely.js'
import type { DB } from './schema.js'
import { migrations } from './migrations/index.js'

class StaticMigrationProvider implements MigrationProvider {
  constructor(private readonly registry: Record<string, Migration>) {}
  async getMigrations(): Promise<Record<string, Migration>> {
    return this.registry
  }
}

export function createMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: new StaticMigrationProvider(migrations),
    // Order is enforced by the sorted 0001_/0002_ keys; an out-of-order file is a
    // mistake, not a feature.
    allowUnorderedMigrations: false,
  })
}

export interface MigrationOutcome {
  readonly applied: string[]
  readonly error: unknown
}

export async function migrateToLatest(migrationUrl: string): Promise<MigrationOutcome> {
  const db = createDb(migrationUrl, 1)
  try {
    const migrator = createMigrator(db)
    const { error, results } = await migrator.migrateToLatest()
    return { applied: (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName), error }
  } finally {
    await db.destroy()
  }
}
