/**
 * Bearer-token authentication (ADR-004). Verifies the access-token signature and
 * standard claims via the token service, and attaches the identity context to the
 * request. The access token proves WHO and WHICH ORGANIZATION; it is never the sole
 * basis for an authorization decision — entitlement and permission are resolved
 * server-side in later phases.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { UnauthenticatedError } from '@cp/core'
import type { TokenService } from '../infrastructure/token-service.js'

export interface Identity {
  userId: string
  sessionId: string
  organizationId: string | null
  membershipId: string | null
  branchId: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity
  }
}

export function makeAuthenticate(tokens: TokenService) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthenticatedError('A bearer token is required.')
    }
    const token = header.slice('Bearer '.length).trim()
    try {
      const payload = await tokens.verify(token)
      request.identity = {
        userId: String(payload.sub),
        sessionId: String(payload['sid'] ?? ''),
        organizationId: (payload['org'] as string | null) ?? null,
        membershipId: (payload['mem'] as string | null) ?? null,
        branchId: (payload['branch'] as string | null) ?? null,
      }
    } catch {
      // Any verification failure (bad signature, expired, wrong issuer) is 401.
      throw new UnauthenticatedError('The access token is invalid or has expired.')
    }
  }
}

export function requireIdentity(request: FastifyRequest): Identity {
  if (!request.identity) throw new UnauthenticatedError()
  return request.identity
}
