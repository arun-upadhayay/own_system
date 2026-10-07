/**
 * Identity module public surface. The rest of the API registers it through
 * `registerIdentityModule`; it never reaches into the module's internals (HLD §4).
 *
 * The module is a bounded unit inside the standalone backend (apps/api), not a
 * separate deployable — the backend ships as one Node.js service.
 */

import type { FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import { systemClock, type Clock } from '@cp/core'
import type { ApiEnv } from '../../config.js'
import { TokenService } from './infrastructure/token-service.js'
import { ConsoleEmail, type EmailPort, type IdentityContext } from './application/context.js'
import { registerAuthRoutes } from './http/routes.js'
import { registerOidcRoutes } from './http/oidc-routes.js'

export interface IdentityModuleOptions {
  db: Kysely<DB>
  env: ApiEnv
  clock?: Clock
  email?: EmailPort
}

export interface IdentityModule {
  tokens: TokenService
  context: IdentityContext
}

export async function registerIdentityModule(
  app: FastifyInstance,
  opts: IdentityModuleOptions,
): Promise<IdentityModule> {
  const clock = opts.clock ?? systemClock
  const tokens = new TokenService(opts.db, opts.env, clock)
  // Ensure a signing key exists before any token is minted (06 §5.3).
  await tokens.ensureSigningKey()

  const context: IdentityContext = {
    db: opts.db,
    tokens,
    clock,
    env: opts.env,
    email: opts.email ?? ConsoleEmail,
    log: (level, msg, data) => app.log[level]({ ...data }, msg),
  }

  registerAuthRoutes(app, context, { db: opts.db, clock, env: opts.env })
  registerOidcRoutes(app, context)

  return { tokens, context }
}

export { TokenService } from './infrastructure/token-service.js'
export type { IdentityContext, EmailPort } from './application/context.js'
export { ConsoleEmail } from './application/context.js'
// Authentication middleware, exposed so other modules gate routes without reaching
// into identity's internals (HLD §4.1).
export { makeAuthenticate, requireIdentity, type Identity } from './http/auth-middleware.js'

export { provisionInvitedUser, revokeUserSessions } from './services.js'
