/**
 * Membership management (10 §4). The organization manages its own members, within
 * the company-set subscription limits (enforced in Phase 10). Role assignment lands
 * with RBAC (Phase 5); Phase 4 covers status, branch scope, and ownership.
 *
 * Two invariants are enforced here and tested:
 *  - LAST-OWNER protection: the last active owner cannot be suspended, removed or
 *    demoted — ownership must be transferred first, or the tenant becomes
 *    unadministrable (10 §4.1).
 *  - Suspending or removing a member REVOKES that member's sessions immediately
 *    (10 §4): an admin expects access to end now, not within a token lifetime.
 *    Removal also releases the member's product seats (full enforcement in Phase 10).
 */

import { sql } from 'kysely'
import { NotFoundError } from '@cp/core'
import { recordAudit, enqueueOutbox, withOrgScope } from '@cp/db'
import { canTransitionMembership } from '../domain/state-machines.js'
import { LastOwnerError, IllegalTransitionError, OrgRuleError } from '../domain/errors.js'
import type { OrgModuleContext } from './context.js'
import type { OrgContext } from '../http/org-context.js'

export interface MemberView {
  membershipId: string
  userId: string
  email: string
  fullName: string
  status: string
  isOwner: boolean
  allBranches: boolean
  defaultBranchId: string | null
  joinedAt: Date | null
}

export async function listMembers(ctx: OrgModuleContext, orgCtx: OrgContext): Promise<MemberView[]> {
  const rows = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.id as membershipId',
        'm.user_id as userId',
        'u.email as email',
        'u.full_name as fullName',
        'm.status as status',
        'm.is_owner as isOwner',
        'm.all_branches as allBranches',
        'm.default_branch_id as defaultBranchId',
        'm.joined_at as joinedAt',
      ])
      .where('m.organization_id', '=', orgCtx.organizationId)
      .where('m.status', '<>', 'removed')
      .orderBy('u.full_name')
      .execute(),
  )
  return rows
}

async function loadMembership(ctx: OrgModuleContext, orgCtx: OrgContext, membershipId: string) {
  const m = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('memberships')
      .select(['id', 'user_id', 'status', 'is_owner'])
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', membershipId)
      .executeTakeFirst(),
  )
  if (!m) throw new NotFoundError()
  return m
}

/** Count active owners OTHER than the given membership — for last-owner checks. */
async function otherActiveOwnerCount(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  exceptMembershipId: string,
): Promise<number> {
  const row = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('organization_id', '=', orgCtx.organizationId)
      .where('is_owner', '=', true)
      .where('status', '=', 'active')
      .where('id', '<>', exceptMembershipId)
      .executeTakeFirstOrThrow(),
  )
  return Number(row.n)
}

async function transitionMembership(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  membershipId: string,
  to: 'suspended' | 'active' | 'removed',
  revokeReason: 'admin' | 'org_suspended' | null,
): Promise<void> {
  const m = await loadMembership(ctx, orgCtx, membershipId)
  if (!canTransitionMembership(m.status as never, to)) {
    throw new IllegalTransitionError('membership', m.status, to)
  }
  // Last-owner protection: cannot suspend/remove the last active owner.
  if (m.is_owner && (to === 'suspended' || to === 'removed')) {
    if ((await otherActiveOwnerCount(ctx, orgCtx, membershipId)) === 0) throw new LastOwnerError()
  }

  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    const patch: Record<string, unknown> = { status: to, updated_at: sql`now()` }
    if (to === 'removed') patch.removed_at = sql`now()`
    await tx.updateTable('memberships').set(patch).where('id', '=', membershipId).execute()

    // Removal releases the member's product seats (10 §4; full enforcement Phase 10).
    if (to === 'removed') {
      await tx
        .updateTable('membership_products')
        .set({ revoked_at: sql`now()`, revoked_by_user_id: orgCtx.userId })
        .where('membership_id', '=', membershipId)
        .where('revoked_at', 'is', null)
        .execute()
    }

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: `membership.${to === 'active' ? 'reinstated' : to}`,
      resourceType: 'membership',
      resourceId: membershipId,
      outcome: 'success',
    })
    await enqueueOutbox(tx, {
      eventType: to === 'removed' ? 'MembershipRemoved' : `Membership${to === 'active' ? 'Reinstated' : 'Suspended'}`,
      aggregateType: 'membership',
      aggregateId: membershipId,
      organizationId: orgCtx.organizationId,
      payload: { membershipId, userId: m.user_id, status: to },
    })
  })

  // Session revocation happens AFTER the status change commits (identity owns
  // sessions; the org module requests it through the injected revoker).
  if (revokeReason) await ctx.revokeUserSessions(m.user_id, revokeReason)
}

export function suspendMembership(ctx: OrgModuleContext, orgCtx: OrgContext, id: string) {
  return transitionMembership(ctx, orgCtx, id, 'suspended', 'admin')
}
export function reinstateMembership(ctx: OrgModuleContext, orgCtx: OrgContext, id: string) {
  return transitionMembership(ctx, orgCtx, id, 'active', null)
}
export function removeMembership(ctx: OrgModuleContext, orgCtx: OrgContext, id: string) {
  return transitionMembership(ctx, orgCtx, id, 'removed', 'admin')
}

export interface UpdateBranchScopeInput {
  allBranches?: boolean | undefined
  defaultBranchId?: string | null | undefined
  branchIds?: string[] | undefined
}

export async function updateMembershipBranchScope(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  membershipId: string,
  input: UpdateBranchScopeInput,
): Promise<void> {
  await loadMembership(ctx, orgCtx, membershipId)
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    const patch: Record<string, unknown> = { updated_at: sql`now()` }
    if (input.allBranches !== undefined) patch.all_branches = input.allBranches
    if (input.defaultBranchId !== undefined) patch.default_branch_id = input.defaultBranchId
    if (Object.keys(patch).length > 1) {
      await tx.updateTable('memberships').set(patch).where('id', '=', membershipId).execute()
    }
    // Explicit branch set only applies when all_branches is false.
    if (input.branchIds) {
      await tx.deleteFrom('membership_branches').where('membership_id', '=', membershipId).execute()
      if (input.allBranches === false && input.branchIds.length > 0) {
        await tx
          .insertInto('membership_branches')
          .values(
            input.branchIds.map((branchId) => ({
              membership_id: membershipId,
              branch_id: branchId,
              organization_id: orgCtx.organizationId,
            })),
          )
          .execute()
      }
    }
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'membership.branch_scope_updated',
      resourceType: 'membership',
      resourceId: membershipId,
      outcome: 'success',
    })
  })
}

/**
 * Transfer ownership: promote the target to owner and demote the caller. Net owners
 * never drop to zero (the target is an owner before the caller is demoted), so the
 * last-owner invariant holds throughout.
 */
export async function transferOwnership(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  toMembershipId: string,
): Promise<void> {
  if (toMembershipId === orgCtx.membershipId) {
    throw new OrgRuleError('You already own this organization.')
  }
  const target = await loadMembership(ctx, orgCtx, toMembershipId)
  if (target.status !== 'active') throw new OrgRuleError('The new owner must be an active member.')

  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    await tx
      .updateTable('memberships')
      .set({ is_owner: true, updated_at: sql`now()` })
      .where('id', '=', toMembershipId)
      .execute()
    await tx
      .updateTable('memberships')
      .set({ is_owner: false, updated_at: sql`now()` })
      .where('id', '=', orgCtx.membershipId)
      .execute()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'organization.ownership_transferred',
      resourceType: 'membership',
      resourceId: toMembershipId,
      outcome: 'success',
      changes: { from: orgCtx.membershipId, to: toMembershipId },
    })
  })
}
