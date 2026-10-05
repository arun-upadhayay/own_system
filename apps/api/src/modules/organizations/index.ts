/**
 * Organizations module public surface. Registered by the API; it depends on the
 * identity module only through identity's public interface (HLD §4.1).
 */

import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import { systemClock, type Clock } from '@cp/core'
import { ConsoleEmail, revokeUserSessions, type EmailPort, type TokenService } from '../identity/index.js'
import type { OrgModuleContext } from './application/context.js'
import { registerOrganizationRoutes } from './http/routes.js'

export interface OrganizationsModuleOptions {
  db: Kysely<DB>
  tokens: TokenService
  clock?: Clock
  email?: EmailPort
  log?: OrgModuleContext['log']
}

export function registerOrganizationsModule(
  app: FastifyInstance,
  opts: OrganizationsModuleOptions,
): void {
  const ctx: OrgModuleContext = {
    db: opts.db,
    clock: opts.clock ?? systemClock,
    email: opts.email ?? ConsoleEmail,
    log: opts.log ?? ((level, msg, data) => app.log[level]({ ...data }, msg)),
    // Session revocation is an identity concern the org module requests through the
    // identity public interface, never by touching the sessions table directly.
    revokeUserSessions: (userId, reason) => revokeUserSessions(opts.db, userId, reason),
  }
  registerOrganizationRoutes(app, ctx, opts.tokens)
}
