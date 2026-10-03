/**
 * One-off: give app_role a login so the runtime and the RLS tests connect as a
 * role WITHOUT bypassrls (the Neon owner has bypassrls, which overrides FORCE RLS).
 * Run as the owner. Reads APP_ROLE_PASSWORD from the environment; never hardcodes.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
const here = dirname(fileURLToPath(import.meta.url))
for (const l of readFileSync(resolve(here, '../../.env'), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i > 0 && !(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const pw = process.env.APP_ROLE_PASSWORD
if (!pw) { console.error('APP_ROLE_PASSWORD not set'); process.exit(1) }
const c = new pg.Client({ connectionString: process.env.DATABASE_MIGRATION_URL })
await c.connect()
// Parameterised role DDL isn't allowed; the password is validated to hex below and
// quoted. It is a generated secret, not user input.
if (!/^[0-9a-f]{32,}$/.test(pw)) { console.error('password must be hex'); process.exit(1) }
await c.query(`ALTER ROLE app_role WITH LOGIN PASSWORD '${pw}'`)
const r = await c.query("select rolcanlogin, rolbypassrls from pg_roles where rolname='app_role'")
console.log('app_role:', r.rows[0])
await c.end()
