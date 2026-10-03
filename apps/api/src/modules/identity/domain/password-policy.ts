/**
 * Password policy (docs/architecture/15-security-architecture.md §4).
 *
 * Minimum 12 characters; NO composition rules — they push users toward
 * predictable substitutions without adding entropy. A small embedded list of the
 * most common/breached passwords is rejected; a full breach-list check (k-anonymity
 * against a service) is a later enhancement, noted here as the seam.
 *
 * Pure: no I/O, so it is unit-testable and lives in the domain layer.
 */

const MIN_LENGTH = 12
const MAX_LENGTH = 256

/** A tiny sample of the most common passwords. The real check is a breach list. */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '123456789012',
  'qwertyuiop',
  'administrator',
  'letmein12345',
  'iloveyou1234',
])

export interface PolicyResult {
  ok: boolean
  message?: string
}

export function checkPasswordPolicy(password: string): PolicyResult {
  if (password.length < MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_LENGTH} characters.` }
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, message: `Password must be at most ${MAX_LENGTH} characters.` }
  }
  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, message: 'That password is too common. Choose a less predictable one.' }
  }
  return { ok: true }
}
