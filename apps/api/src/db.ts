/**
 * The API's database handle. Connects as the non-bypass `app_role` (DATABASE_URL),
 * so row-level security applies to everything the running backend does (AR-009).
 * Migrations run separately as the owner; the backend never does.
 */
import { createDb, type DbOrTx } from '@cp/db'
import type { ApiEnv } from './config.js'

export type { DbOrTx }

let instance: ReturnType<typeof createDb> | null = null

export function getDb(env: ApiEnv): ReturnType<typeof createDb> {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to use the database')
  instance ??= createDb(env.DATABASE_URL, env.DATABASE_POOL_MAX)
  return instance
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.destroy()
    instance = null
  }
}
