import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0017 — make RLS tenant policies tolerate an unset/empty tenant setting.
 *
 * Implementation finding (AR-009): `set_config('app.current_organization_id', NULL)`
 * stores an EMPTY STRING, not NULL, and `''::uuid` raises string_to_uuid — so a
 * request that cleared its scope would error instead of returning no rows. Wrapping
 * the setting in NULLIF(..., '') makes both the unset case (NULL) and the cleared
 * case ('') resolve to NULL, so `organization_id = NULL` is false and the query
 * correctly returns nothing.
 *
 * Only the tenant policies need this — the platform policies compare a text setting
 * to 'true' and never cast to uuid. Forward-only: ALTER POLICY in place.
 */

const EXPR = `NULLIF(current_setting('app.current_organization_id', true), '')::uuid`

// Tables whose tenant policy keys on organization_id.
const ORG_KEYED = [
  'branches',
  'memberships',
  'membership_branches',
  'invitations',
  'subscriptions',
  'subscription_events',
  'membership_products',
  'usage_counters',
  'product_usage_reports',
  'customer_accounts',
  'customer_account_assignments',
  'audit_logs',
]

export const m0017_rls_nullif = {
  async up(db: Kysely<unknown>): Promise<void> {
    const statements: string[] = []

    for (const table of ORG_KEYED) {
      statements.push(
        `ALTER POLICY ${table}_tenant ON ${table}
           USING (organization_id = ${EXPR})
           WITH CHECK (organization_id = ${EXPR})`,
      )
    }

    // organizations is keyed on id.
    statements.push(
      `ALTER POLICY organizations_tenant ON organizations
         USING (id = ${EXPR})
         WITH CHECK (id = ${EXPR})`,
    )

    // roles: system roles (NULL org) readable by all; custom roles tenant-scoped.
    statements.push(
      `ALTER POLICY roles_tenant ON roles
         USING (organization_id IS NULL OR organization_id = ${EXPR})
         WITH CHECK (organization_id = ${EXPR})`,
    )

    // organization_product_requests tenant policy (policy name is opr_tenant).
    statements.push(
      `ALTER POLICY opr_tenant ON organization_product_requests
         USING (organization_id = ${EXPR})
         WITH CHECK (organization_id = ${EXPR})`,
    )

    await run(db, statements)
  },
}
