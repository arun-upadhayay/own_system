/**
 * Branches (10 §3, ADR-014). A branch is a dimension inside the tenant, not a
 * tenant itself. The branch LIMIT (resolved as the MAX across subscriptions) is
 * enforced in Phase 10 with the rest of limit enforcement; it is deliberately not
 * checked here yet (plan). The one-primary-per-organization rule IS enforced now,
 * by the partial unique index plus the unset-then-set handling below.
 */

import { sql } from 'kysely'
import { uuidv7 } from '@cp/core'
import { NotFoundError, ConflictError } from '@cp/core'
import { recordAudit, withOrgScope } from '@cp/db'
import type { OrgModuleContext } from './context.js'
import type { OrgContext } from '../http/org-context.js'

export interface BranchView {
  id: string
  name: string
  code: string | null
  status: string
  isPrimary: boolean
}

function toView(r: {
  id: string
  name: string
  code: string | null
  status: string
  is_primary: boolean
}): BranchView {
  return { id: r.id, name: r.name, code: r.code, status: r.status, isPrimary: r.is_primary }
}

export async function listBranches(ctx: OrgModuleContext, orgCtx: OrgContext): Promise<BranchView[]> {
  const rows = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('branches')
      .select(['id', 'name', 'code', 'status', 'is_primary'])
      .where('organization_id', '=', orgCtx.organizationId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute(),
  )
  return rows.map(toView)
}

export async function getBranch(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  branchId: string,
): Promise<BranchView> {
  const row = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('branches')
      .select(['id', 'name', 'code', 'status', 'is_primary'])
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', branchId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst(),
  )
  if (!row) throw new NotFoundError()
  return toView(row)
}

export interface CreateBranchInput {
  name: string
  code?: string | null | undefined
  isPrimary?: boolean | undefined
}

export async function createBranch(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  input: CreateBranchInput,
): Promise<BranchView> {
  const id = uuidv7()
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    // If this branch is to be primary, demote the current primary first so the
    // partial unique index (one primary per org) is never transiently violated.
    if (input.isPrimary) {
      await tx
        .updateTable('branches')
        .set({ is_primary: false })
        .where('organization_id', '=', orgCtx.organizationId)
        .where('is_primary', '=', true)
        .execute()
    }
    await tx
      .insertInto('branches')
      .values({
        id,
        organization_id: orgCtx.organizationId,
        name: input.name,
        code: input.code ?? null,
        status: 'active',
        is_primary: input.isPrimary ?? false,
      })
      .execute()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'branch.created',
      resourceType: 'branch',
      resourceId: id,
      resourceLabel: input.name,
      outcome: 'success',
    })
  }).catch(rethrowUnique('A branch with that code already exists.'))
  return getBranch(ctx, orgCtx, id)
}

export interface UpdateBranchInput {
  name?: string | undefined
  code?: string | null | undefined
  status?: 'active' | 'inactive' | undefined
  isPrimary?: boolean | undefined
}

export async function updateBranch(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  branchId: string,
  input: UpdateBranchInput,
): Promise<BranchView> {
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    const existing = await tx
      .selectFrom('branches')
      .select('id')
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', branchId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!existing) throw new NotFoundError()

    if (input.isPrimary === true) {
      await tx
        .updateTable('branches')
        .set({ is_primary: false })
        .where('organization_id', '=', orgCtx.organizationId)
        .where('is_primary', '=', true)
        .where('id', '!=', branchId)
        .execute()
    }

    const patch: Record<string, unknown> = { updated_at: sql`now()` }
    if (input.name !== undefined) patch.name = input.name
    if (input.code !== undefined) patch.code = input.code
    if (input.status !== undefined) patch.status = input.status
    if (input.isPrimary !== undefined) patch.is_primary = input.isPrimary

    await tx.updateTable('branches').set(patch).where('id', '=', branchId).execute()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'branch.updated',
      resourceType: 'branch',
      resourceId: branchId,
      outcome: 'success',
    })
  }).catch(rethrowUnique('A branch with that code already exists.'))
  return getBranch(ctx, orgCtx, branchId)
}

export async function deleteBranch(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  branchId: string,
): Promise<void> {
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    // A branch still set as a member's default cannot be removed — it flows into
    // session context, and orphaning it would break that member (10 §3).
    const inUse = await tx
      .selectFrom('memberships')
      .select('id')
      .where('organization_id', '=', orgCtx.organizationId)
      .where('default_branch_id', '=', branchId)
      .where('status', '<>', 'removed')
      .executeTakeFirst()
    if (inUse) throw new ConflictError('This branch is a member’s default and cannot be removed.')

    const res = await tx
      .updateTable('branches')
      .set({ deleted_at: sql`now()`, is_primary: false })
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', branchId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (res.numUpdatedRows === 0n) throw new NotFoundError()

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'branch.deleted',
      resourceType: 'branch',
      resourceId: branchId,
      outcome: 'success',
    })
  })
}

/** Map a Postgres unique-violation to a clean 409; rethrow anything else. */
function rethrowUnique(message: string): (e: unknown) => never {
  return (e: unknown) => {
    if ((e as { code?: string })?.code === '23505') throw new ConflictError(message)
    throw e
  }
}
