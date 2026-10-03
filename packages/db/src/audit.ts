/**
 * Audit writer (ERD §11, ADR-009, §7).
 *
 * `recordAudit` takes a Transaction, never the pool: an audit entry is written in
 * the SAME transaction as the state change it describes, so an action cannot occur
 * unaudited and an entry cannot survive a rolled-back change. The table is
 * append-only (0016), so there is deliberately no update or delete here.
 *
 * Denormalized labels are captured at write time so the entry stays readable after
 * its subjects are deleted. Outcome includes 'denied' — the signal for probing.
 */

import { sql, type Transaction } from 'kysely'
import { uuidv7 } from '@cp/core'
import type { DB } from './schema.js'

export type AuditOutcome = 'success' | 'failure' | 'denied'
export type AuditActorType = 'user' | 'system' | 'product' | 'api_client'

export interface AuditEntry {
  actorType: AuditActorType
  action: string
  resourceType: string
  outcome: AuditOutcome
  actorUserId?: string | null
  actorLabel?: string | null
  organizationId?: string | null
  resourceId?: string | null
  resourceLabel?: string | null
  /** Before/after. Callers must omit S2/S3 fields or pass them already redacted. */
  changes?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
  correlationId?: string | null
}

export async function recordAudit(tx: Transaction<DB>, entry: AuditEntry): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('audit_logs')
    .values({
      id,
      actor_user_id: entry.actorUserId ?? null,
      actor_type: entry.actorType,
      actor_label: entry.actorLabel ?? null,
      organization_id: entry.organizationId ?? null,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId ?? null,
      resource_label: entry.resourceLabel ?? null,
      outcome: entry.outcome,
      changes: entry.changes ? sql`${JSON.stringify(entry.changes)}::jsonb` : null,
      metadata: sql`${JSON.stringify(entry.metadata ?? {})}::jsonb`,
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      correlation_id: entry.correlationId ?? null,
    })
    .execute()
  return id
}
