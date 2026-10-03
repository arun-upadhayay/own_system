import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0001 — extensions. First migration (ERD §1.0): tables depend on `citext` for
 * case-insensitive email uniqueness.
 */
export const m0001_extensions = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, ['CREATE EXTENSION IF NOT EXISTS citext'])
  },
}
