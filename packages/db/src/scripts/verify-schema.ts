/**
 * Post-migration schema verification. Confirms the objects the architecture
 * depends on actually exist, so a silently-skipped statement is caught.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

function loadDotEnv(): void {
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

async function main(): Promise<void> {
  loadDotEnv()
  const client = new pg.Client({
    connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  })
  await client.connect()
  try {
    const tables = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
    const rls = await client.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relrowsecurity ORDER BY relname`,
    )
    const forced = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relforcerowsecurity`,
    )
    const critFk = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'subscriptions_plan_product_fk'`,
    )
    const view = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_views WHERE viewname = 'v_organization_products'`,
    )
    const triggers = await client.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
       WHERE tgname IN ('audit_logs_no_update','audit_logs_no_delete',
                        'plan_features_same_product','subscription_overrides_same_product',
                        'role_permissions_same_product') ORDER BY tgname`,
    )

    console.log('── schema verification ──────────────────────────────')
    console.log(`  base tables         : ${tables.rows[0]!.n}`)
    console.log(`  RLS-enabled tables  : ${rls.rows.length}`)
    console.log(`  FORCE-RLS tables    : ${forced.rows[0]!.n}`)
    console.log(`  critical plan/product guard present : ${critFk.rows.length === 1}`)
    console.log(`  v_organization_products present     : ${view.rows[0]!.n === 1}`)
    console.log(`  guard/append-only triggers (of 5)   : ${triggers.rows.length}`)
    console.log('─────────────────────────────────────────────────────')

    const ok =
      Number(tables.rows[0]!.n) >= 25 &&
      rls.rows.length >= 15 &&
      critFk.rows.length === 1 &&
      view.rows[0]!.n === 1 &&
      triggers.rows.length === 5
    if (!ok) {
      console.error('[verify] schema is INCOMPLETE')
      process.exit(1)
    }
    console.log('[verify] OK')
  } finally {
    await client.end()
  }
}

main().catch((e: unknown) => {
  console.error('[verify]', e instanceof Error ? e.message : e)
  process.exit(1)
})
