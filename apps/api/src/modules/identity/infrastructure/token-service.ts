/**
 * Token service (ADR-004, 06 §5). All JWT/JWKS work goes through `jose` — no
 * hand-written token parsing anywhere (ADR-003 constraint 2).
 *
 * Signing keys live in `jwks_keys`: the private key is AES-256-GCM encrypted at
 * rest, the public key is stored as a JWK. Rotation keeps a `retiring` overlap so a
 * key stops signing before it stops verifying — a key removed the instant it stops
 * signing would invalidate every token it already signed (06 §5.3).
 */

import {
  SignJWT,
  jwtVerify,
  exportJWK,
  exportPKCS8,
  importPKCS8,
  generateKeyPair,
  createLocalJWKSet,
  type JWK,
  type JWTPayload,
  type CryptoKey,
} from 'jose'
import type { Kysely } from 'kysely'
import type { DB } from '@cp/db'
import { uuidv7, type Clock } from '@cp/core'
import type { ApiEnv } from '../../../config.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import type { AccessTokenClaims, IdTokenClaims } from '../domain/tokens.js'

const ALG = 'RS256'

interface SigningKey {
  kid: string
  privateKey: CryptoKey
}

export class TokenService {
  #signing: SigningKey | null = null

  constructor(
    private readonly db: Kysely<DB>,
    private readonly env: ApiEnv,
    private readonly clock: Clock,
  ) {}

  private get encKey(): string {
    if (!this.env.JWK_ENCRYPTION_KEY) throw new Error('JWK_ENCRYPTION_KEY is required')
    return this.env.JWK_ENCRYPTION_KEY
  }

  /** Ensure an active signing key exists; generate one on first boot. */
  async ensureSigningKey(): Promise<void> {
    const active = await this.db
      .selectFrom('jwks_keys')
      .selectAll()
      .where('status', '=', 'active')
      .orderBy('activated_at', 'desc')
      .executeTakeFirst()

    if (active) {
      this.#signing = {
        kid: active.kid,
        privateKey: await importPKCS8(decryptSecret(active.private_key_encrypted, this.encKey), ALG),
      }
      return
    }
    await this.rotate()
  }

  /**
   * Generate a new active key. Any currently-active key moves to `retiring` and
   * keeps verifying for at least one access-token lifetime before it may be retired.
   */
  async rotate(): Promise<string> {
    const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true })
    const kid = uuidv7()
    const jwk = await exportJWK(publicKey)
    jwk.kid = kid
    jwk.alg = ALG
    jwk.use = 'sig'
    const pkcs8 = await exportPKCS8(privateKey)
    const retiresAt = new Date(this.clock.nowMs() + this.env.ACCESS_TOKEN_TTL_SECONDS * 1000 * 2)

    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('jwks_keys')
        .set({ status: 'retiring', retires_at: retiresAt })
        .where('status', '=', 'active')
        .execute()
      await tx
        .insertInto('jwks_keys')
        .values({
          kid,
          public_key: JSON.stringify(jwk),
          private_key_encrypted: encryptSecret(pkcs8, this.encKey),
          algorithm: ALG,
          status: 'active',
        })
        .execute()
    })

    this.#signing = { kid, privateKey }
    return kid
  }

  private async signing(): Promise<SigningKey> {
    if (!this.#signing) await this.ensureSigningKey()
    if (!this.#signing) throw new Error('no signing key available')
    return this.#signing
  }

  /** The public JWK set: active + retiring keys (06 §5.3). */
  async publicJwks(): Promise<{ keys: JWK[] }> {
    const rows = await this.db
      .selectFrom('jwks_keys')
      .select('public_key')
      .where('status', 'in', ['active', 'retiring'])
      .execute()
    return { keys: rows.map((r) => JSON.parse(r.public_key) as JWK) }
  }

  async signAccessToken(claims: AccessTokenClaims, audience: string[]): Promise<string> {
    const { kid, privateKey } = await this.signing()
    const now = Math.floor(this.clock.nowMs() / 1000)
    return new SignJWT({ ...claims } as unknown as JWTPayload)
      .setProtectedHeader({ alg: ALG, kid, typ: 'at+jwt' })
      .setIssuer(this.env.ISSUER_URL)
      .setSubject(claims.sub)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.env.ACCESS_TOKEN_TTL_SECONDS)
      .setJti(uuidv7())
      .sign(privateKey)
  }

  async signIdToken(claims: IdTokenClaims, audience: string, ttlSeconds = 300): Promise<string> {
    const { kid, privateKey } = await this.signing()
    const now = Math.floor(this.clock.nowMs() / 1000)
    const payload: JWTPayload = {
      email: claims.email,
      email_verified: claims.email_verified,
      name: claims.name,
      ...(claims.nonce ? { nonce: claims.nonce } : {}),
    }
    return new SignJWT(payload)
      .setProtectedHeader({ alg: ALG, kid, typ: 'JWT' })
      .setIssuer(this.env.ISSUER_URL)
      .setSubject(claims.sub)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(privateKey)
  }

  /** Verify a token against the current active+retiring keys. */
  async verify(token: string): Promise<JWTPayload> {
    const jwks = createLocalJWKSet(await this.publicJwks())
    const { payload } = await jwtVerify(token, jwks, { issuer: this.env.ISSUER_URL })
    return payload
  }
}
