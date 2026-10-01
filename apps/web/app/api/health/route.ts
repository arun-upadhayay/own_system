import { NextResponse } from 'next/server'

/**
 * Web tier liveness (docs/architecture/16-observability.md §5).
 *
 * Deliberately DEPENDENCY-FREE — it must not call the API. A liveness probe that
 * fails when a dependency is down causes the orchestrator to kill every web
 * instance, turning a recoverable API problem into a total outage.
 */
export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok', tier: 'web' })
}
