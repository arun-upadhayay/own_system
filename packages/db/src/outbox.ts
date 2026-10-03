/**
 * Transactional outbox writer (ERD §12, ADR-009).
 *
 * `enqueueOutbox` takes a Transaction, never the pool: the event row is written in
 * the SAME transaction as the state change, so the event exists if and only if the
 * change committed. A separate dispatcher (a later phase) delivers pending rows.
 * Delivery is at-least-once, so every consumer must be idempotent on the event id.
 *
 * Payloads carry ids, not full entities, and never S2/S3 fields: an event is
 * delivered to external systems and logged by them, outside this platform's
 * control (14 §6).
 */

import { sql, type Transaction } from 'kysely'
import { uuidv7 } from '@cp/core'
import type { DB } from './schema.js'

export interface OutboxEvent {
  eventType: string
  aggregateType: string
  aggregateId: string
  payload: Record<string, unknown>
  eventVersion?: number
  organizationId?: string | null
  correlationId?: string | null
}

export async function enqueueOutbox(tx: Transaction<DB>, event: OutboxEvent): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('outbox_events')
    .values({
      id,
      event_type: event.eventType,
      event_version: event.eventVersion ?? 1,
      organization_id: event.organizationId ?? null,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      payload: sql`${JSON.stringify(event.payload)}::jsonb`,
      status: 'pending',
      correlation_id: event.correlationId ?? null,
    })
    .execute()
  return id
}
