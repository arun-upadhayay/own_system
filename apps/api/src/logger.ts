/**
 * Structured logging (docs/architecture/16-observability.md §2).
 *
 * JSON always — never string-interpolated messages, because a log you cannot
 * query is a log you will not use at 3am.
 *
 * Redaction is implemented HERE, in the logger options, not at call sites. The
 * realistic way secrets reach logs is an incidental object spread, not a
 * deliberate decision, so relying on every log statement to remember is how S3
 * fields leak (docs/architecture/15-security-architecture.md §11).
 *
 * This module exports OPTIONS rather than a constructed Pino instance: injecting
 * an instance makes Fastify's `FastifyInstance` generic over that concrete logger
 * type, which then fails to unify with the plain `FastifyInstance` used in
 * signatures. Passing options lets Fastify build its own logger and keeps the
 * types aligned.
 */

import { stdSerializers, stdTimeFunctions, type LoggerOptions } from 'pino'
import type { ApiEnv } from './config.js'

/**
 * S3 (secret) and S2 (sensitive) paths, per the classification in
 * docs/architecture/05-data-dictionary.md §1.
 *
 * S3 must never appear at all. S2 appears as identifiers, never values.
 */
const REDACT_PATHS = [
  // ---- S3: credential material. No code path may serialize these.
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'tokenHash',
  '*.tokenHash',
  'clientSecret',
  '*.clientSecret',
  'secret',
  '*.secret',
  'privateKey',
  '*.privateKey',
  'req.headers.authorization',
  'req.headers.cookie',
  // ---- S2: personal data.
  'email',
  '*.email',
  'phone',
  '*.phone',
  'fullName',
  '*.fullName',
]

export function loggerOptions(env: ApiEnv): LoggerOptions {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: stdTimeFunctions.isoTime,
    base: { service: 'control-plane-api' },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      err: stdSerializers.err,
    },
  }
}
