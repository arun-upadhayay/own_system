/**
 * Identity use-case context: the dependencies every use case needs, injected so the
 * application layer stays testable and free of framework specifics.
 */

import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import type { Clock } from '@cp/core'
import type { ApiEnv } from '../../../config.js'
import type { TokenService } from '../infrastructure/token-service.js'

/** Where transactional emails go. Stubbed in dev to log the link; a real provider
 *  is wired in a later phase. Delivery itself runs off the outbox (14 §4.1). */
export interface EmailPort {
  send(to: string, template: string, data: Record<string, unknown>): Promise<void>
}

export interface RequestMeta {
  ip?: string | null
  userAgent?: string | null
  correlationId?: string | null
}

export interface IdentityContext {
  db: Kysely<DB>
  tokens: TokenService
  clock: Clock
  env: ApiEnv
  email: EmailPort
  /** Structured log sink (correlation id already bound by the caller). */
  log: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void
}

/** Dev email adapter: logs the action and any link so flows are followable locally. */
export const ConsoleEmail: EmailPort = {
  async send(_to, template, data) {
    console.warn(`[email:${template}] to=<redacted> ${JSON.stringify(data)}`)
  },
}
