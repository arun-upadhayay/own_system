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

  /** OIDC issuer identity — the `iss` of every token and the base of discovery. */
  ISSUER_URL: z.string().url(),

  /**
   * The runtime connects as the non-bypass `app_role` so row-level security
   * applies (AR-009). Required from Phase 3 on. Optional only lets the pure-logic
   * tests run without a database; a server that actually boots validates it below.
   */
  DATABASE_URL: z.string().url().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /** Token lifetimes (ADR-004). Access tokens are short; refresh tokens rotate. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),

  /**
   * Encrypts JWT signing private keys at rest (AES-256-GCM). A 32+ char secret;
   * the KMS-held key of ADR-003/§15 §5 replaces this in production. Required when
   * the server boots (asserted in loadConfig).
   */
  JWK_ENCRYPTION_KEY: z.string().min(32).optional(),

  /** Trial/lockout tuning. Lockout is indistinguishable from a wrong password. */
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
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
    const env = parseConfig(process.env)
    // These are optional in the schema so pure-logic tests run without them, but a
    // server that actually boots must have them — fail at startup, not first use.
    const missing: string[] = []
    if (!env.DATABASE_URL) missing.push('DATABASE_URL')
    if (!env.JWK_ENCRYPTION_KEY) missing.push('JWK_ENCRYPTION_KEY')
    if (missing.length > 0) throw new ConfigError(missing.map((m) => `${m}: required to start the server`))
    return env
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
