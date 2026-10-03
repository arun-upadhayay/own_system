/**
 * Health endpoints (docs/architecture/16-observability.md §5).
 *
 * The separation is load-bearing: if liveness checked the database, a brief
 * database blip would cause the orchestrator to KILL EVERY INSTANCE, turning a
 * recoverable dependency problem into a total outage.
 *
 *   /healthz — is this process wedged?        No dependencies. Ever.
 *   /readyz  — should traffic come here?      Checks the database.
 *
 * Neither reveals internal hostnames, credentials or dependency versions.
 */

import { sql } from 'kysely'
import type { FastifyInstance } from 'fastify'
import type { ApiEnv } from '../config.js'
import { getDb } from '../db.js'

const startedAt = Date.now()

export async function registerHealthRoutes(app: FastifyInstance, env: ApiEnv): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok' as const,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }))

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, { status: 'ok' | 'skipped' | 'error'; detail?: string }> = {}

    if (env.DATABASE_URL) {
      try {
        await sql`select 1`.execute(getDb(env))
        checks.database = { status: 'ok' }
      } catch {
        // No internal detail in the response — just that it is not ready.
        checks.database = { status: 'error', detail: 'unreachable' }
      }
    } else {
      checks.database = { status: 'skipped', detail: 'not configured' }
    }

    const failed = Object.values(checks).some((c) => c.status === 'error')
    return reply.status(failed ? 503 : 200).send({
      status: failed ? 'degraded' : 'ok',
      checks,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    })
  })
}
