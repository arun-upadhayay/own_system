/**
 * Organization-module context: injected dependencies, so the use cases stay
 * testable and free of framework specifics.
 *
 * `revokeUserSessions` is provided by the identity module through its public
 * interface (HLD §4.1 — modules talk through index.ts, never internals). The
 * organizations module may depend on identity (it is lower in the graph), and
 * revoking a suspended/removed member's sessions is an identity concern the org
 * module requests rather than performs.
 */

import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import type { Clock } from '@cp/core'
import type { EmailPort } from '../../identity/index.js'

export interface OrgModuleContext {
  db: Kysely<DB>
  clock: Clock
  email: EmailPort
  log: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void
  /** Revoke every live session for a user — e.g. on membership suspend/remove. */
  revokeUserSessions: (userId: string, reason: 'admin' | 'org_suspended') => Promise<void>
}
