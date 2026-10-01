/**
 * Fastify application assembly.
 *
 * Phase 1 registers only the correlation-id plumbing, the error mapper and the
 * health endpoints. No business routes exist yet, and none may be added before
 * they are documented in docs/architecture/13-api-specification.md
 * (master prompt §19).
 */

import Fastify, { type FastifyInstance } from 'fastify'
import { isAppError, isUuid, newCorrelationId, type CorrelationId } from '@cp/core'
import type { ApiEnv } from './config.js'
import { loggerOptions } from './logger.js'
import { registerHealthRoutes } from './routes/health.js'

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: CorrelationId
  }
}

/** Fastify attaches `validation` to errors raised by schema validation. */
function isValidationError(error: unknown): error is { validation: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray((error as { validation: unknown }).validation)
  )
}

export async function buildApp(env: ApiEnv): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(env),
    /**
     * The correlation id is resolved HERE, in `genReqId`, not in a hook.
     *
     * `genReqId` runs before any hook, so if the id were decided later Fastify's
     * own "incoming request" line would carry a different value from the response
     * header and the audit record — which defeats the whole point of having one
     * identifier thread logs, traces, audit entries and emitted events
     * (16-observability.md §7).
     *
     * A client-supplied id is accepted only when it is a valid UUID. An
     * unvalidated value would let a caller poison log aggregation, or inject
     * arbitrary text into every log line for that request.
     */
    genReqId: (req) => {
      const incoming = req.headers['x-request-id']
      return typeof incoming === 'string' && isUuid(incoming) ? incoming : newCorrelationId()
    },
    // One field name for this value across every log line. Fastify's default is
    // `reqId`; aligning it to `requestId` keeps log queries consistent with the
    // audit log's `correlation_id` and the response header.
    requestIdLogLabel: 'requestId',
    trustProxy: true,
    bodyLimit: 1_048_576,
  })

  // ------------------------------------------------- correlation id (13 §8)
  // `request.id` was resolved by genReqId above and is already on every log line,
  // so this hook only exposes it under a domain name and returns it to the client.
  // No child logger is created: that would duplicate the field.
  app.addHook('onRequest', async (request, reply) => {
    request.correlationId = request.id as CorrelationId
    reply.header('x-request-id', request.correlationId)
  })

  // ------------------------------------------------- security headers (15 §7)
  // The API serves JSON only, so it needs the hardening headers but not the CSP
  // nonce machinery, which belongs to the web tier that renders HTML.
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'strict-origin-when-cross-origin')
    reply.header('cross-origin-opener-policy', 'same-origin')
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
    if (env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload')
    }
    return payload
  })

  // ------------------------------------------------- error mapping (13 §5)
  // Fastify 5 types the handler's error as `unknown`, which is correct — anything
  // can be thrown. Narrowing is explicit rather than cast away.
  app.setErrorHandler((error: unknown, request, reply) => {
    if (isAppError(error)) {
      request.log.warn({ code: error.code, status: error.status }, 'request failed')
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId: request.correlationId,
        },
      })
    }

    // Fastify attaches `validation` to schema-validation failures.
    if (isValidationError(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'The request could not be validated.',
          details: { issues: error.validation },
          requestId: request.correlationId,
        },
      })
    }

    // Unexpected: log the detail, return nothing internal. No stack trace, no
    // SQL, no internal paths in a response (15 §11).
    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        requestId: request.correlationId,
      },
    })
  })

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: 'Not found.',
        requestId: request.correlationId,
      },
    }),
  )

  await registerHealthRoutes(app, env)

  return app
}
