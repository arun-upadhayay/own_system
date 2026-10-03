/**
 * Prerequisite gate for Phase 2 (AR-003): is PostgreSQL 16+ reachable, and is the
 * `citext` extension available?
 *
 * The ERD depends on both — `citext` for case-insensitive email uniqueness
 * (04-erd.md §1.0), and PostgreSQL 16+ because the schema uses partial unique
 * indexes and other modern features. If either is missing, the plan changes, so
 * this runs before any migration is written against the instance.
 *
 * Loads packages/db/.env manually (no dotenv dependency in this leaf package).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const envPath = resolve(here, '../../.env')
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* no .env file — rely on the ambient environment */
  }
}

async function main(): Promise<void> {
  loadDotEnv()
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('[probe] No DATABASE_URL / DATABASE_MIGRATION_URL set.')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const version = await client.query<{ server_version: string; full: string }>(
      "SELECT current_setting('server_version') AS server_version, version() AS full",
    )
    const major = Number.parseInt(version.rows[0]!.server_version, 10)

    const citext = await client.query<{ name: string; installed: string | null }>(
      `SELECT name, installed_version AS installed
         FROM pg_available_extensions WHERE name = 'citext'`,
    )

    const whoami = await client.query<{ user: string; db: string }>(
      'SELECT current_user AS user, current_database() AS db',
    )

    const createRole = await client.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
      'SELECT rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user',
    )

    const row = whoami.rows[0]!
    const perms = createRole.rows[0]!
    const ext = citext.rows[0]

    console.log('── Phase 2 prerequisite probe ─────────────────────────────')
    console.log(`  connected as     : ${row.user} @ ${row.db}`)
    console.log(`  server version   : ${version.rows[0]!.server_version}`)
    console.log(`  citext available : ${ext ? 'yes' : 'NO'}${ext?.installed ? ` (installed ${ext.installed})` : ''}`)
    console.log(`  can CREATE ROLE  : ${perms.rolcreaterole}`)
    console.log(`  is superuser     : ${perms.rolsuper}`)
    console.log('───────────────────────────────────────────────────────────')

    const problems: string[] = []
    if (major < 16) problems.push(`PostgreSQL ${major} < 16 required`)
    if (!ext) problems.push('citext extension is not available on this instance')

    if (problems.length > 0) {
      console.error('\n[probe] PREREQUISITE FAILED:')
      for (const p of problems) console.error(`  - ${p}`)
      process.exit(1)
    }
    console.log('\n[probe] OK — Phase 2 prerequisites satisfied.')
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  console.error('[probe] connection failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
