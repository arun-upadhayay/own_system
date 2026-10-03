import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0015 — row-level security (ERD §14, ADR-012 Layer 4; 15 §3).
 *
 * Defense in depth behind the type-level OrgScope. Each tenant table gets two
 * permissive policies, OR'd: a platform policy (staff/system, keyed on
 * app.platform_scope) and a tenant policy (keyed on app.current_organization_id).
 * A query that forgot its tenant filter returns NOTHING instead of another
 * tenant's rows.
 *
 * FORCE ROW LEVEL SECURITY (AR-009): on Neon the runtime currently connects as the
 * database owner, and a table owner BYPASSES RLS unless FORCE is set. FORCE makes
 * the policies apply regardless of connecting role, which is also strictly more
 * defensive. The transaction helpers set app.* as transaction-LOCAL settings, so
 * nothing leaks across pooled connections.
 *
 * Settings are read with `current_setting(name, true)` (missing_ok): unset returns
 * NULL, NULL::uuid is NULL, and `organization_id = NULL` is false — so an unscoped
 * query sees no rows and never errors.
 */

// Tenant tables whose organization_id is NOT NULL — the standard pattern applies.
const TENANT_TABLES = [
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
]

function standardPolicies(table: string): string[] {
  return [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${table}_platform ON ${table} FOR ALL
       USING (current_setting('app.platform_scope', true) = 'true')
       WITH CHECK (current_setting('app.platform_scope', true) = 'true')`,
    `CREATE POLICY ${table}_tenant ON ${table} FOR ALL
       USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
       WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid)`,
  ]
}

export const m0015_rls = {
  async up(db: Kysely<unknown>): Promise<void> {
    const statements: string[] = []

    for (const table of TENANT_TABLES) statements.push(...standardPolicies(table))

    // organizations — the tenant boundary row itself, keyed on id.
    statements.push(
      `ALTER TABLE organizations ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE organizations FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY organizations_platform ON organizations FOR ALL
         USING (current_setting('app.platform_scope', true) = 'true')
         WITH CHECK (current_setting('app.platform_scope', true) = 'true')`,
      `CREATE POLICY organizations_tenant ON organizations FOR ALL
         USING (id = current_setting('app.current_organization_id', true)::uuid)
         WITH CHECK (id = current_setting('app.current_organization_id', true)::uuid)`,
    )

    // roles — system roles (organization_id NULL) are global templates readable by
    // all; custom roles are tenant-scoped. A new custom role can only be written
    // under a matching org scope (or platform).
    statements.push(
      `ALTER TABLE roles ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE roles FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY roles_platform ON roles FOR ALL
         USING (current_setting('app.platform_scope', true) = 'true')
         WITH CHECK (current_setting('app.platform_scope', true) = 'true')`,
      `CREATE POLICY roles_tenant ON roles FOR ALL
         USING (organization_id IS NULL
                OR organization_id = current_setting('app.current_organization_id', true)::uuid)
         WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid)`,
    )

    // audit_logs — org-scoped read for customers, platform for staff/system. Writes
    // under org scope must carry that org; cross-tenant/system writes go through
    // platform scope. (Append-only is enforced separately in 0016.)
    statements.push(
      `ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY audit_logs_platform ON audit_logs FOR ALL
         USING (current_setting('app.platform_scope', true) = 'true')
         WITH CHECK (current_setting('app.platform_scope', true) = 'true')`,
      `CREATE POLICY audit_logs_tenant ON audit_logs FOR ALL
         USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
         WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid)`,
    )

    // organization_product_requests — anonymous requests (organization_id NULL) are
    // created under system/platform scope; authenticated org requests under org
    // scope. Only platform sees the NULL-org rows (staff triage the queue).
    statements.push(
      `ALTER TABLE organization_product_requests ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE organization_product_requests FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY opr_platform ON organization_product_requests FOR ALL
         USING (current_setting('app.platform_scope', true) = 'true')
         WITH CHECK (current_setting('app.platform_scope', true) = 'true')`,
      `CREATE POLICY opr_tenant ON organization_product_requests FOR ALL
         USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
         WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid)`,
    )

    await run(db, statements)
  },
}
