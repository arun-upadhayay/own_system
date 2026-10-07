/**
 * Permission resolution (07 §4). Resolves a caller's effective permissions from the
 * DATABASE on every request — never from a token claim — so a role edit takes
 * effect on the next request, not at token expiry (07 §4.1, the immediacy rule).
 *
 * Grants only, unioned across roles; there are no deny rows, so there is exactly
 * one answer to "why could this user do that" (07 §2.2). An organization OWNER
 * holds every org-scoped permission by virtue of ownership (baseline §22), without
 * needing the org_owner role assigned — the role is a template, ownership is the
 * fact.
 *
 * Depends only on @cp/db, so it is usable by any module without a dependency cycle.
 */

import { sql, type Kysely } from 'kysely'
import { withSystemScope, type DB } from '@cp/db'

/** Union of a membership's role permissions (org scope). */
export async function resolveMembershipPermissions(
  db: Kysely<DB>,
  membershipId: string,
  isOwner: boolean,
): Promise<Set<string>> {
  return withSystemScope(db, async (tx) => {
    if (isOwner) {
      const all = await tx
        .selectFrom('permissions')
        .select('key')
        .where('scope', '=', 'organization')
        .execute()
      return new Set(all.map((r) => r.key))
    }
    const rows = await tx
      .selectFrom('membership_roles as mr')
      .innerJoin('role_permissions as rp', 'rp.role_id', 'mr.role_id')
      .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select('p.key')
      .where('mr.membership_id', '=', membershipId)
      .execute()
    return new Set(rows.map((r) => r.key))
  })
}

/**
 * Union of a user's PLATFORM permissions, from active (unexpired, unrevoked)
 * platform role assignments.
 */
export async function resolvePlatformPermissions(
  db: Kysely<DB>,
  userId: string,
): Promise<Set<string>> {
  return withSystemScope(db, async (tx) => {
    const rows = await tx
      .selectFrom('platform_role_assignments as pra')
      .innerJoin('role_permissions as rp', 'rp.role_id', 'pra.role_id')
      .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select('p.key')
      .where('pra.user_id', '=', userId)
      .where('pra.revoked_at', 'is', null)
      .where((eb) => eb.or([eb('pra.expires_at', 'is', null), eb('pra.expires_at', '>', sql`now()`)]))
      .execute()
    return new Set(rows.map((r) => r.key))
  })
}

/** The organizations a staff user is assigned to (for assignment-scoped roles). */
export async function assignedOrganizationIds(db: Kysely<DB>, userId: string): Promise<string[]> {
  return withSystemScope(db, async (tx) => {
    const rows = await tx
      .selectFrom('customer_account_assignments')
      .select('organization_id')
      .where('user_id', '=', userId)
      .where('ended_at', 'is', null)
      .execute()
    return rows.map((r) => r.organization_id)
  })
}
