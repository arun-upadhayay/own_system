/**
 * Database configuration.
 *
 * Two connection strings, by design (see packages/db/.env):
 *
 *   DATABASE_URL           pooled endpoint (PgBouncer, transaction mode) — the
 *                          application runtime. RLS uses transaction-local
 *                          settings (`set_config(..., true)`), which transaction
 *                          pooling supports, so this is safe (ERD §14).
 *
 *   DATABASE_MIGRATION_URL direct endpoint — migrations. DDL, advisory locks,
 *                          CREATE ROLE and CREATE INDEX CONCURRENTLY need a real
 *                          session, which a transaction pooler cannot provide.
 *
 * Validated with a small hand-rolled check rather than Zod: this package is a
 * leaf that the API and migration scripts both load, and keeping it dependency-
 * light avoids pulling a validator into the migration runtime.
 */

export interface DbConfig {
  readonly url: string
  readonly migrationUrl: string
  readonly maxPool: number
}

function require_(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `[db config] ${name} is required but was empty. ` +
        `Set it in packages/db/.env (gitignored) or the environment.`,
    )
  }
  return value
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  const url = require_('DATABASE_URL', env.DATABASE_URL)
  // Migrations fall back to the runtime URL only if no direct endpoint is given;
  // a warning is the caller's responsibility, since on a pooled-only host some
  // migrations (advisory locks, CONCURRENTLY) will fail loudly rather than
  // silently misbehave.
  const migrationUrl = env.DATABASE_MIGRATION_URL?.trim() || url
  const maxPool = Number(env.DATABASE_POOL_MAX ?? '10')
  return { url, migrationUrl, maxPool: Number.isFinite(maxPool) ? maxPool : 10 }
}
