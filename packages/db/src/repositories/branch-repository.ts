/**
 * Branch repository — the canonical example of ADR-012 Layer 2.
 *
 * Every method that touches an organization-owned entity REQUIRES an `OrgScope` as
 * its first parameter. Because OrgScope is branded and constructible only from a
 * verified token, a query that omits tenant scoping does not type-check — the
 * insecure version is unwriteable, not merely discouraged.
 *
 * The explicit `.where('organization_id', '=', scope.organizationId)` is kept even
 * though RLS (0015) also filters: two independent layers, so no single mistake
 * breaches isolation. Cross-tenant reads for staff are NOT here — they live in
 * separate, platform-gated, audited methods (Layer 3).
 */

import type { Transaction } from 'kysely'
import type { OrgScope } from '@cp/core'
import { uuidv7 } from '@cp/core'
import type { DB, Branch } from '../schema.js'

export interface CreateBranchInput {
  name: string
  code?: string | null
  isPrimary?: boolean
}

export const BranchRepository = {
  async list(scope: OrgScope, tx: Transaction<DB>): Promise<Branch[]> {
    return tx
      .selectFrom('branches')
      .selectAll()
      .where('organization_id', '=', scope.organizationId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute()
  },

  async findById(scope: OrgScope, tx: Transaction<DB>, id: string): Promise<Branch | null> {
    const row = await tx
      .selectFrom('branches')
      .selectAll()
      .where('organization_id', '=', scope.organizationId)
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    return row ?? null
  },

  async create(scope: OrgScope, tx: Transaction<DB>, input: CreateBranchInput): Promise<Branch> {
    return tx
      .insertInto('branches')
      .values({
        id: uuidv7(),
        organization_id: scope.organizationId,
        name: input.name,
        code: input.code ?? null,
        status: 'active',
        is_primary: input.isPrimary ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  },
}
