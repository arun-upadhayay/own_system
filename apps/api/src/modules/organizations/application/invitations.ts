/**
 * Invitations (10 §5, 06 §2.2). The organization invites people by email; they
 * accept and become members. A pending invitation is unique per (org, email).
 *
 * Seat reservation (invitation_products) is deferred to Phase 10 with limit
 * enforcement (plan). Role assignment via invitation_roles is wired but inert until
 * RBAC (Phase 5) seeds roles. Acceptance creates the membership; a new invitee also
 * gets a verified account (invite proves the email).
 */

import { randomBytes, createHash } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import { uuidv7, NotFoundError, ConflictError, ValidationError } from '@cp/core'
import type { DB } from '@cp/db'
import { recordAudit, enqueueOutbox, withOrgScope, withSystemScope } from '@cp/db'
import { provisionInvitedUser } from '../../identity/index.js'
import type { OrgModuleContext } from './context.js'
import type { OrgContext } from '../http/org-context.js'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex')
}

export interface CreateInvitationInput {
  email: string
  roleIds?: string[] | undefined
}

export interface InvitationView {
  id: string
  email: string
  status: string
  expiresAt: Date
  createdAt: Date
}

export async function createInvitation(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationView; token: string }> {
  const email = input.email.trim().toLowerCase()
  const token = randomBytes(32).toString('base64url')
  const id = uuidv7()

  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    // Already a member? Then there is nothing to invite.
    const member = await tx
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select('m.id')
      .where('m.organization_id', '=', orgCtx.organizationId)
      .where('u.email', '=', email)
      .where('m.status', '<>', 'removed')
      .executeTakeFirst()
    if (member) throw new ConflictError('That person is already a member of this organization.')

    await tx
      .insertInto('invitations')
      .values({
        id,
        organization_id: orgCtx.organizationId,
        email,
        token_hash: sha256(token),
        invited_by_user_id: orgCtx.userId,
        status: 'pending',
        expires_at: new Date(ctx.clock.nowMs() + INVITE_TTL_MS),
      })
      .execute()

    if (input.roleIds && input.roleIds.length > 0) {
      await tx
        .insertInto('invitation_roles')
        .values(input.roleIds.map((roleId) => ({ invitation_id: id, role_id: roleId })))
        .execute()
    }

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'invitation.created',
      resourceType: 'invitation',
      resourceId: id,
      outcome: 'success',
    })
    await enqueueOutbox(tx, {
      eventType: 'UserInvited',
      aggregateType: 'invitation',
      aggregateId: id,
      organizationId: orgCtx.organizationId,
      payload: { invitationId: id, email },
    })
  }).catch((e: unknown) => {
    // One pending invitation per (org, email) — the partial unique index.
    if ((e as { code?: string })?.code === '23505') {
      throw new ConflictError('There is already a pending invitation for that email.')
    }
    throw e
  })

  // The transactional email carries the accept link/token (as registration does);
  // the outbox UserInvited event is for other consumers. Sent after commit so a
  // mail failure cannot roll back the invitation.
  await ctx.email.send(email, 'invitation', { token })

  const invitation = await getInvitation(ctx, orgCtx, id)
  return { invitation, token }
}

async function getInvitation(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  id: string,
): Promise<InvitationView> {
  const row = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('invitations')
      .select(['id', 'email', 'status', 'expires_at', 'created_at'])
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', id)
      .executeTakeFirst(),
  )
  if (!row) throw new NotFoundError()
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

export async function listInvitations(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
): Promise<InvitationView[]> {
  const rows = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('invitations')
      .select(['id', 'email', 'status', 'expires_at', 'created_at'])
      .where('organization_id', '=', orgCtx.organizationId)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'desc')
      .execute(),
  )
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    status: r.status,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  }))
}

export async function revokeInvitation(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  id: string,
): Promise<void> {
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    const res = await tx
      .updateTable('invitations')
      .set({ status: 'revoked', updated_at: sql`now()` })
      .where('organization_id', '=', orgCtx.organizationId)
      .where('id', '=', id)
      .where('status', '=', 'pending')
      .executeTakeFirst()
    if (res.numUpdatedRows === 0n) throw new NotFoundError()
    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'invitation.revoked',
      resourceType: 'invitation',
      resourceId: id,
      outcome: 'success',
    })
  })
}

// ─────────────────────────────────── public: preview + accept (no org context) ──

export interface InvitationPreview {
  organizationName: string
  email: string
  invitedBy: string
}

/** Public preview of an invitation by its raw token. */
export async function previewInvitation(
  ctx: OrgModuleContext,
  rawToken: string,
): Promise<InvitationPreview> {
  const row = await withSystemScope(ctx.db, (tx) =>
    tx
      .selectFrom('invitations as i')
      .innerJoin('organizations as o', 'o.id', 'i.organization_id')
      .innerJoin('users as u', 'u.id', 'i.invited_by_user_id')
      .select([
        'i.email as email',
        'i.status as status',
        'i.expires_at as expiresAt',
        'o.name as organizationName',
        'u.full_name as invitedBy',
      ])
      .where('i.token_hash', '=', sha256(rawToken))
      .executeTakeFirst(),
  )
  if (!row || row.status !== 'pending' || row.expiresAt.getTime() < ctx.clock.nowMs()) {
    throw new NotFoundError('This invitation is invalid or has expired.')
  }
  return { organizationName: row.organizationName, email: row.email, invitedBy: row.invitedBy }
}

export interface AcceptInvitationInput {
  /** For a brand-new account: set a name and password. Omitted when the acceptor is
   *  already authenticated (an existing user joining another organization). */
  fullName?: string
  password?: string
  /** The authenticated acceptor, when there is one. */
  authenticatedUserId?: string
}

export interface AcceptResult {
  organizationId: string
  membershipId: string
  userId: string
  createdAccount: boolean
}

export async function acceptInvitation(
  ctx: OrgModuleContext,
  rawToken: string,
  input: AcceptInvitationInput,
): Promise<AcceptResult> {
  const tokenHash = sha256(rawToken)

  // Look up the invitation (system scope — the acceptor may not belong to the org
  // yet, and may not even have an account).
  const inv = await withSystemScope(ctx.db, (tx) =>
    tx
      .selectFrom('invitations')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst(),
  )
  if (!inv || inv.status !== 'pending' || inv.expires_at.getTime() < ctx.clock.nowMs()) {
    throw new NotFoundError('This invitation is invalid or has expired.')
  }

  // Resolve the accepting user: either the authenticated one, an existing account
  // for the invited email, or a new account provisioned here.
  let userId: string
  let createdAccount = false
  if (input.authenticatedUserId) {
    userId = input.authenticatedUserId
  } else {
    const existing = await withSystemScope(ctx.db, (tx) =>
      tx
        .selectFrom('users')
        .select('id')
        .where('email', '=', inv.email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    )
    if (existing) {
      // The address has an account — require them to sign in rather than silently
      // binding the invitation to it.
      throw new ValidationError('An account already exists for this email. Please sign in to accept.')
    }
    if (!input.password || !input.fullName) {
      throw new ValidationError('A name and password are required to create your account.')
    }
    const newId = await provisionInvitedUser(ctx.db, {
      email: inv.email,
      password: input.password,
      fullName: input.fullName,
    })
    if (!newId) throw new ValidationError('An account already exists for this email. Please sign in to accept.')
    userId = newId
    createdAccount = true
  }

  const membershipId = uuidv7()
  await withSystemScope(ctx.db, async (tx) => {
    // Not already a member (idempotency / race).
    const already = await tx
      .selectFrom('memberships')
      .select('id')
      .where('organization_id', '=', inv.organization_id)
      .where('user_id', '=', userId)
      .where('status', '<>', 'removed')
      .executeTakeFirst()
    if (already) throw new ConflictError('You are already a member of this organization.')

    await tx
      .insertInto('memberships')
      .values({
        id: membershipId,
        user_id: userId,
        organization_id: inv.organization_id,
        status: 'active',
        invited_by_user_id: inv.invited_by_user_id,
        joined_at: sql`now()`,
      })
      .execute()

    // Assign the invitation's roles (inert until Phase 5 seeds roles).
    const roles = await tx
      .selectFrom('invitation_roles')
      .select('role_id')
      .where('invitation_id', '=', inv.id)
      .execute()
    if (roles.length > 0) {
      await tx
        .insertInto('membership_roles')
        .values(roles.map((r) => ({ membership_id: membershipId, role_id: r.role_id })))
        .execute()
    }

    await tx
      .updateTable('invitations')
      .set({ status: 'accepted', accepted_at: sql`now()`, accepted_user_id: userId })
      .where('id', '=', inv.id)
      .execute()

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: userId,
      organizationId: inv.organization_id,
      action: 'invitation.accepted',
      resourceType: 'membership',
      resourceId: membershipId,
      outcome: 'success',
    })
    await enqueueOutbox(tx, {
      eventType: 'MembershipCreated',
      aggregateType: 'membership',
      aggregateId: membershipId,
      organizationId: inv.organization_id,
      payload: { membershipId, userId, organizationId: inv.organization_id, viaInvitation: inv.id },
    })
  })

  return { organizationId: inv.organization_id, membershipId, userId, createdAccount }
}

export type { Kysely, DB }
