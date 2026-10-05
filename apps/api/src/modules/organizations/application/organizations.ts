/**
 * Organization self-service (10 §1, §2). An organization can edit its own
 * descriptive settings; it CANNOT change its own status — suspend/cancel/reinstate
 * are company-controlled (platform) actions (baseline §20), so `status` is not an
 * accepted field here. The organization never raises its own limits either.
 */

import { sql } from 'kysely'
import { recordAudit, withOrgScope } from '@cp/db'
import type { OrgModuleContext } from './context.js'
import type { OrgContext } from '../http/org-context.js'

export interface OrganizationView {
  id: string
  name: string
  slug: string
  legalName: string | null
  status: string
  industry: string | null
  country: string | null
  timezone: string
  currency: string
  billingEmail: string | null
  createdAt: Date
}

export async function getOrganization(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
): Promise<OrganizationView> {
  const row = await withOrgScope(ctx.db, orgCtx.scope, (tx) =>
    tx
      .selectFrom('organizations')
      .selectAll()
      .where('id', '=', orgCtx.organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
  )
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    status: row.status,
    industry: row.industry,
    country: row.country,
    timezone: row.timezone,
    currency: row.currency,
    billingEmail: row.billing_email,
    createdAt: row.created_at,
  }
}

export interface UpdateOrganizationInput {
  name?: string | undefined
  legalName?: string | null | undefined
  industry?: string | null | undefined
  country?: string | null | undefined
  timezone?: string | undefined
  currency?: string | undefined
  billingEmail?: string | null | undefined
}

export async function updateOrganization(
  ctx: OrgModuleContext,
  orgCtx: OrgContext,
  input: UpdateOrganizationInput,
): Promise<OrganizationView> {
  await withOrgScope(ctx.db, orgCtx.scope, async (tx) => {
    const patch: Record<string, unknown> = { updated_at: sql`now()` }
    if (input.name !== undefined) patch.name = input.name
    if (input.legalName !== undefined) patch.legal_name = input.legalName
    if (input.industry !== undefined) patch.industry = input.industry
    if (input.country !== undefined) patch.country = input.country
    if (input.timezone !== undefined) patch.timezone = input.timezone
    if (input.currency !== undefined) patch.currency = input.currency
    if (input.billingEmail !== undefined) patch.billing_email = input.billingEmail

    await tx
      .updateTable('organizations')
      .set(patch)
      .where('id', '=', orgCtx.organizationId)
      .execute()

    await recordAudit(tx, {
      actorType: 'user',
      actorUserId: orgCtx.userId,
      organizationId: orgCtx.organizationId,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: orgCtx.organizationId,
      outcome: 'success',
      changes: { fields: Object.keys(patch).filter((k) => k !== 'updated_at') },
    })
  })
  return getOrganization(ctx, orgCtx)
}
