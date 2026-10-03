/**
 * Low-level crypto helpers. All random/compare/hash goes through node:crypto
 * (ADR-003): no hand-rolled primitives.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'

/** An opaque, high-entropy token (refresh tokens, reset/verification tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** SHA-256 hex. Tokens are stored hashed, never in plaintext (ERD §12.1). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * AES-256-GCM encryption for signing private keys at rest (§15 §5). The KMS-held
 * key of production replaces the env secret; the interface stays the same.
 * Output: base64url(salt).base64url(iv).base64url(tag).base64url(ciphertext)
 */
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32)
}

export function encryptSecret(plaintext: string, secret: string): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(secret, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [salt, iv, tag, ct].map((b) => b.toString('base64url')).join('.')
}

export function decryptSecret(encoded: string, secret: string): string {
  const parts = encoded.split('.')
  if (parts.length !== 4) throw new Error('malformed encrypted secret')
  const [salt, iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64url'))
  const key = deriveKey(secret, salt!)
  const decipher = createDecipheriv('aes-256-gcm', key, iv!)
  decipher.setAuthTag(tag!)
  return Buffer.concat([decipher.update(ct!), decipher.final()]).toString('utf8')
}
