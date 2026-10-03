/**
 * Password hashing — argon2id (ADR-003 constraint 1). No alternative, no fallback.
 *
 * Implemented with @node-rs/argon2 (prebuilt Rust binary) rather than the node-gyp
 * `argon2`, so it installs reliably across platforms without a build toolchain. The
 * algorithm is argon2id either way.
 *
 * `needsRehash` compares the stored parameters to the current policy so the next
 * successful login transparently upgrades a stale hash (the reason the `algorithm`
 * column exists, ERD §3.2).
 */

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

// OWASP-aligned parameters (15 §4). @node-rs/argon2 defaults to the argon2id
// variant, so it is not set explicitly here — importing the `Algorithm` const enum
// is incompatible with `verbatimModuleSyntax`, and argon2id is the default and the
// only variant this platform uses (ADR-003). Tuneable; recorded per credential.
const PARAMS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const

/** A human-readable parameter fingerprint stored in user_credentials.algorithm. */
export const ALGORITHM_TAG = `argon2id:m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}`

/**
 * A fixed valid hash used to equalize timing when a user does not exist, so the
 * login endpoint is not an account-enumeration oracle via response time
 * (06 §3.1). Generated once at module load.
 */
let dummyHash: string | null = null
async function getDummyHash(): Promise<string> {
  dummyHash ??= await argonHash('cp-timing-equalizer-not-a-real-password', PARAMS)
  return dummyHash
}

export const PasswordHasher = {
  async hash(password: string): Promise<{ hash: string; algorithm: string }> {
    return { hash: await argonHash(password, PARAMS), algorithm: ALGORITHM_TAG }
  },

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(storedHash, password)
    } catch {
      // A malformed stored hash must not crash login; it simply fails to verify.
      return false
    }
  },

  /**
   * Verify against a throwaway hash. Call this when the user does not exist so the
   * timing of a failed login matches a real verification.
   */
  async verifyDummy(password: string): Promise<void> {
    await argonVerify(await getDummyHash(), password).catch(() => undefined)
  },

  needsRehash(storedAlgorithm: string): boolean {
    return storedAlgorithm !== ALGORITHM_TAG
  },
}
