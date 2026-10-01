/**
 * Health endpoints (docs/architecture/16-observability.md §5).
 *
 * The separation is load-bearing: if liveness checked the database, a brief
 * database blip would cause the orchestrator to KILL EVERY INSTANCE, turning a
 * recoverable dependency problem into a total outage.
 *
 *   /healthz — is this process wedged?        No dependencies. Ever.
 *   /readyz  — should traffic come here?      Checks dependencies.
 *
 * Neither reveals internal hostnames, credentials or dependency versions: both are
 * unauthenticated and readable by anyone who finds them.
 */

import type { FastifyInstance } from 'fastify'
import type { ApiEnv } from '../config.js'

const startedAt = Date.now()

export async function registerHealthRoutes(app: FastifyInstance, env: ApiEnv): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok' as const,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  }))

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, { status: 'ok' | 'skipped' | 'error'; detail?: string }> = {}

    // Phase 1 has no database (AR-003). Phase 2 replaces this with a real probe
    // plus a migration-version check.
    checks.database = env.DATABASE_URL
      ? { status: 'skipped', detail: 'probe arrives in Phase 2' }
      : { status: 'skipped', detail: 'not configured in Phase 1' }

    const failed = Object.values(checks).some((c) => c.status === 'error')
    return reply.status(failed ? 503 : 200).send({
      status: failed ? 'degraded' : 'ok',
      checks,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    })
  })
}
