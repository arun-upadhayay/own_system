/**
 * Role management with escalation prevention (07 §6). The controls, each tested:
 *  - NO SELF-GRANT: a user cannot assign a role to their own membership.
 *  - SUPERSET RULE: a granter may only assign/create roles whose permissions are a
 *    subset of their own effective permissions — otherwise the ability to create
 *    roles silently becomes the ability to hold any permission.
 *  - PLATFORM grants require platform.roles.grant (checked at the route) and record
 *    a mandatory grantor.
 *  - is_system roles are immutable (cannot be edited or deleted).
 *  - Custom roles are capped by what the organization may delegate.
 */

import { sql, type Kysely } from 'kysely'
import { uuidv7, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@cp/core'
import { withSystemScope, recordAudit, type DB } from '@cp/db'
import { resolveMembershipPermissions, resolvePlatformPermissions } from './resolver.js'
import type { OrgContext } from '../http/authorize.js'

async function permKeysOfRole(db: Kysely<DB>, roleId: string): Promise<string[]> {
  return withSystemScope(db, async (tx) => {
    const rows = await tx
      .selectFrom('role_permissions as rp')
      .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select('p.key')
      .where('rp.role_id', '=', roleId)
      .execute()
    return rows.map((r) => r.key)
  })
}

function assertSubset(roleKeys: readonly string[], actorPerms: ReadonlySet<string>): void {
  const missing = roleKeys.filter((k) => !actorPerms.has(k))
  if (missing.length > 0) {
    throw new ForbiddenError(
      `You cannot grant permissions you do not hold: ${missing.slice(0, 3).join(', ')}` +
        (missing.length > 3 ? '…' : ''),
    )
  }
}

export interface RoleView {
  id: string
  key: string | null
  name: string
  isSystem: boolean
  permissionKeys: string[]
}

export async function listAssignableRoles(db: Kysely<DB>, orgCtx: OrgContext): Promise<RoleView[]> {
  return withSystemScope(db, async (tx) => {
    const roles = await tx
      .selectFrom('roles')
      .select(['id', 'key', 'name', 'is_system'])
      .where('scope', '=', 'organization')
      .where('is_assignable', '=', true)
      .where((eb) =>
        eb.or([eb('organization_id', 'is', null), eb('organization_id', '=', orgCtx.organizationId)]),
      )
      .orderBy('name')
      .execute()
    const result: RoleView[] = []
    for (const r of roles) {
      const keys = await tx
        .selectFrom('role_permissions as rp')
        .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
        .select('p.key')
        .where('rp.role_id', '=', r.id)
        .execute()
      result.push({ id: r.id, key: r.key, name: r.name, isSystem: r.is_system, permissionKeys: keys.map((k) => k.key).sort() })
    }
    return result
  })
}

/** Replace a member's roles (PUT semantics, 13 §9.4). */
export async function setMembershipRoles(
  db: Kysely<DB>,
  actor: OrgContext,
  targetMembershipId: string,
  roleIds: string[],
): Promise<void> {
  // No self-grant: cannot change your own role set.
  if (targetMembershipId === actor.membershipId) {
    throw new ForbiddenError('You cannot change your own roles.')
  }

  const actorPerms = await resolveMembershipPermissions(db, actor.membershipId, actor.isOwner)

  await withSystemScope(db, async (tx) => {
    const target = await tx
      .selectFrom('memberships')
      .select(['id', 'organization_id'])
      .where('id', '=', targetMembershipId)
      .where('organization_id', '=', actor.organizationId)
      .where('status', '<>', 'removed')
      .executeTakeFirst()
    if (!target) throw new NotFoundError()

    for (const roleId of roleIds) {
      const role = await tx
        .selectFrom('roles')
        .select(['id', 'scope', 'organization_id', 'is_assignable'])
        .where('id', '=', roleId)
        .executeTakeFirst()
      if (
        !role ||
        role.scope !== 'organization' ||
        !role.is_assignable ||
        (role.organization_id !== null && role.organization_id !== actor.organizationId)
      ) {
        throw new ValidationError('One or more roles are not assignable in this organization.')
      }
      const keys = await tx
        .selectFrom('role_permissions as rp')
        .innerJoin('permissions as p', 'p.id', 'rp.permission_id')
        .select('p.key')
        .where('rp.role_id', '=', roleId)
        .execute()
      // Superset: cannot assign a role carrying a permission the actor lacks.
      assertSubset(keys.map((k) => k.key), actorPerms)
    }

    await tx.deleteFrom('membership_roles').where('membership_id', '=', targetMembershipId).execute()
    if (roleIds.length > 0) {
      await tx
        .insertInto('membership_roles')
        .values(roleIds.map((roleId) => ({ membership_id: targetMembershipId, role_id: roleId, granted_by_user_id: actor.userId })))
        .execute()
    }
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: actor.userId,
      organizationId: actor.organizationId,
      action: 'membership.roles_set',
      resourceType: 'membership',
      resourceId: targetMembershipId,
      outcome: 'success',
      changes: { roleIds },
    })
  })
}

export async function createCustomRole(
  db: Kysely<DB>,
  actor: OrgContext,
  input: { name: string; permissionKeys: string[] },
): Promise<RoleView> {
  const actorPerms = await resolveMembershipPermissions(db, actor.membershipId, actor.isOwner)
  // Can only create a role from permissions you hold (07 §6).
  assertSubset(input.permissionKeys, actorPerms)

  const id = uuidv7()
  await withSystemScope(db, async (tx) => {
    const perms = await tx
      .selectFrom('permissions')
      .select(['id', 'key', 'scope'])
      .where('key', 'in', input.permissionKeys.length ? input.permissionKeys : ['__none__'])
      .execute()
    if (perms.length !== input.permissionKeys.length || perms.some((p) => p.scope !== 'organization')) {
      throw new ValidationError('All permissions must be valid organization permissions.')
    }
    await tx
      .insertInto('roles')
      .values({
        id,
        key: null,
        name: input.name,
        scope: 'organization',
        organization_id: actor.organizationId,
        is_system: false,
        is_assignable: true,
      })
      .execute()
    if (perms.length > 0) {
      await tx
        .insertInto('role_permissions')
        .values(perms.map((p) => ({ role_id: id, permission_id: p.id })))
        .execute()
    }
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: actor.userId,
      organizationId: actor.organizationId,
      action: 'role.created',
      resourceType: 'role',
      resourceId: id,
      resourceLabel: input.name,
      outcome: 'success',
    })
  }).catch((e: unknown) => {
    if ((e as { code?: string })?.code === '23505') throw new ConflictError('A role with that name already exists.')
    throw e
  })

  return { id, key: null, name: input.name, isSystem: false, permissionKeys: [...input.permissionKeys].sort() }
}

export async function deleteCustomRole(db: Kysely<DB>, actor: OrgContext, roleId: string): Promise<void> {
  await withSystemScope(db, async (tx) => {
    const role = await tx
      .selectFrom('roles')
      .select(['id', 'is_system', 'organization_id'])
      .where('id', '=', roleId)
      .executeTakeFirst()
    if (!role || role.organization_id !== actor.organizationId) throw new NotFoundError()
    // is_system roles are immutable.
    if (role.is_system) throw new ForbiddenError('System roles cannot be modified.')
    await tx.deleteFrom('roles').where('id', '=', roleId).execute()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: actor.userId,
      organizationId: actor.organizationId,
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: roleId,
      outcome: 'success',
    })
  })
}

// ───────────────────────────────────────────────── platform role grants ────────

export async function grantPlatformRole(
  db: Kysely<DB>,
  actorUserId: string,
  input: { targetUserId: string; roleId: string; expiresAt?: Date | null },
): Promise<void> {
  if (input.targetUserId === actorUserId) throw new ForbiddenError('You cannot grant a platform role to yourself.')
  const actorPerms = await resolvePlatformPermissions(db, actorUserId)
  const roleKeys = await permKeysOfRole(db, input.roleId)

  await withSystemScope(db, async (tx) => {
    const role = await tx
      .selectFrom('roles')
      .select(['id', 'scope'])
      .where('id', '=', input.roleId)
      .executeTakeFirst()
    if (!role || role.scope !== 'platform') throw new ValidationError('Not a platform role.')
    // Superset: cannot grant a platform role carrying a permission you lack.
    assertSubset(roleKeys, actorPerms)
    await tx
      .insertInto('platform_role_assignments')
      .values({
        id: uuidv7(),
        user_id: input.targetUserId,
        role_id: input.roleId,
        granted_by_user_id: actorUserId, // mandatory grantor (ADR-005)
        expires_at: input.expiresAt ?? null,
      })
      .onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing())
      .execute()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId,
      action: 'platform_role.granted',
      resourceType: 'user',
      resourceId: input.targetUserId,
      outcome: 'success',
      changes: { roleId: input.roleId },
    })
  })
}

export async function revokePlatformRole(
  db: Kysely<DB>,
  actorUserId: string,
  assignmentId: string,
): Promise<void> {
  await withSystemScope(db, async (tx) => {
    const res = await tx
      .updateTable('platform_role_assignments')
      .set({ revoked_at: sql`now()` })
      .where('id', '=', assignmentId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    if (res.numUpdatedRows === 0n) throw new NotFoundError()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId,
      action: 'platform_role.revoked',
      resourceType: 'platform_role_assignment',
      resourceId: assignmentId,
      outcome: 'success',
    })
  })
}
