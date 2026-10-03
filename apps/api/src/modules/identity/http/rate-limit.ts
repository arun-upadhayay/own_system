/**
 * Rate limiting in PostgreSQL (ADR-008; limits per 13 §7, 15 §9).
 *
 * A fixed-window counter in `rate_limit_counters`. Auth endpoints are limited per IP
 * AND per identifier: IP-only is defeated by a botnet, identifier-only by spraying
 * many accounts. Only auth endpoints are limited initially — a counter write on
 * every authenticated request would make the limiter the hottest table in the
 * database. Moves to Redis behind this same interface when load justifies it.
 */

import { sql, type Kysely } from 'kysely'
import type { DB } from '@cp/db'
import type { Clock } from '@cp/core'

export interface RateDecision {
  allowed: boolean
  retryAfterSeconds: number
}

export async function hitRateLimit(
  db: Kysely<DB>,
  clock: Clock,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateDecision> {
  const windowStart = new Date(Math.floor(clock.nowMs() / (windowSeconds * 1000)) * windowSeconds * 1000)
  // Atomic upsert-and-increment; the returned count includes this hit.
  const row = await db
    .insertInto('rate_limit_counters')
    .values({ key, window_start: windowStart, count: 1 })
    .onConflict((oc) =>
      oc.columns(['key', 'window_start']).doUpdateSet({
        count: sql`rate_limit_counters.count + 1`,
      }),
    )
    .returning('count')
    .executeTakeFirstOrThrow()

  if (row.count > limit) {
    const resetMs = windowStart.getTime() + windowSeconds * 1000 - clock.nowMs()
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}
