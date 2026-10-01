/**
 * Configuration, validated by Zod at startup.
 *
 * The process REFUSES TO START on invalid or missing configuration
 * (docs/architecture/17-deployment-architecture.md §3). A server that boots with
 * a missing secret and fails on first use fails at the worst possible moment —
 * in front of a user — rather than at deploy time in front of an engineer.
 *
 * No `NODE_ENV` branching in business logic: environment-dependent behaviour is
 * untestable, so differences belong in configuration values.
 */

import { z } from 'zod'

export const ApiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  /** OIDC issuer identity. Phase 3 builds the endpoints; the value is needed now
   *  so the CSP and discovery document agree from the start. */
  ISSUER_URL: z.string().url(),

  // Phase 2 adds DATABASE_URL as required. It is optional here because Phase 1
  // has no database and must run without one (AR-003).
  DATABASE_URL: z.string().url().optional(),
})

export type ApiEnv = z.infer<typeof ApiEnvSchema>

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

/** Pure, so it is testable without mutating `process.env`. */
export function parseConfig(source: Record<string, string | undefined>): ApiEnv {
  const result = ApiEnvSchema.safeParse(source)
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    )
  }
  return result.data
}

export function loadConfig(): ApiEnv {
  try {
    return parseConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      // Written to stderr directly: the logger is not configured yet, and this
      // must be legible in a container log before anything else exists.
      console.error(`\n[FATAL] ${error.message}\n`)
      process.exit(1)
    }
    throw error
  }
}
