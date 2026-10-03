/**
 * Migration CLI: `up` | `status`.
 *
 * No `down`: migrations are forward-only in every environment (ERD §5). A reset
 * for local development is a deliberate, separate operation, not a flag away from
 * production use.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createDb } from '../kysely.js'
import { createMigrator } from '../migrator.js'

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
      if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim()
    }
  } catch {
    /* rely on ambient environment */
  }
}

async function main(): Promise<void> {
  loadDotEnv()
  const command = process.argv[2] ?? 'up'
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('[migrate] DATABASE_MIGRATION_URL / DATABASE_URL not set.')
    process.exit(1)
  }

  const db = createDb(url, 1)
  const migrator = createMigrator(db)
  try {
    if (command === 'status') {
      const all = await migrator.getMigrations()
      for (const m of all) {
        console.log(`${m.executedAt ? '✓' : '·'} ${m.name}`)
      }
      return
    }

    if (command === 'up') {
      const started = Date.now()
      const { error, results } = await migrator.migrateToLatest()
      for (const r of results ?? []) {
        const mark = r.status === 'Success' ? '✓' : r.status === 'Error' ? '✗' : '·'
        console.log(`${mark} ${r.migrationName} (${r.direction})`)
      }
      if (error) {
        console.error('[migrate] failed:', error instanceof Error ? error.message : error)
        process.exit(1)
      }
      const applied = (results ?? []).length
      console.log(
        applied === 0
          ? '[migrate] already up to date.'
          : `[migrate] applied ${applied} migration(s) in ${Date.now() - started}ms.`,
      )
      return
    }

    console.error(`[migrate] unknown command '${command}'. Use: up | status`)
    process.exit(1)
  } finally {
    await db.destroy()
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
