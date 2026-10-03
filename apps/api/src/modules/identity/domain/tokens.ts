/**
 * Token claim shapes and the permission-digest contract (ADR-004). Pure types and
 * helpers — no crypto here; signing lives in infrastructure.
 */

import { createHash } from 'node:crypto'

/** Claims carried in an access token (ADR-004 §5.1). */
export interface AccessTokenClaims {
  sub: string
  sid: string
  org: string | null
  mem: string | null
  branch: string | null
  all_branches: boolean
  scope: string
  perm_digest: string
  amr: string[]
}

/**
 * A hash of the resolved permission set, NOT the set itself (ADR-004): it keeps the
 * token small and lets a product detect staleness and re-fetch, while making clear
 * the token is not the authority. RBAC (Phase 5) fills the real permission list;
 * for now the digest is computed over whatever set is resolved (empty today).
 */
export function permissionDigest(permissions: readonly string[]): string {
  const canonical = [...permissions].sort().join('\n')
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

/** OIDC id_token standard claims subset. */
export interface IdTokenClaims {
  sub: string
  email: string
  email_verified: boolean
  name: string
  nonce?: string
}
