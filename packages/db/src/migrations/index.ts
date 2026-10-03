import type { Migration } from 'kysely'
import { m0001_extensions } from './m0001_extensions.js'
import { m0002_roles } from './m0002_roles.js'
import { m0003_identity } from './m0003_identity.js'
import { m0004_organizations } from './m0004_organizations.js'
import { m0005_rbac } from './m0005_rbac.js'
import { m0006_catalog } from './m0006_catalog.js'
import { m0007_billing } from './m0007_billing.js'
import { m0008_seats } from './m0008_seats.js'
import { m0009_usage } from './m0009_usage.js'
import { m0010_accounts } from './m0010_accounts.js'
import { m0011_audit } from './m0011_audit.js'
import { m0012_operational } from './m0012_operational.js'
import { m0013_views } from './m0013_views.js'
import { m0014_guards } from './m0014_guards.js'
import { m0015_rls } from './m0015_rls.js'
import { m0016_audit_privileges } from './m0016_audit_privileges.js'
import { m0017_rls_nullif } from './m0017_rls_nullif.js'

/**
 * Migration registry, in the mandated order (plan Phase 2):
 *   extensions → roles → tables → composite guards → RLS → audit privileges.
 * The numeric prefix fixes order; Kysely sorts by key.
 */
export const migrations: Record<string, Migration> = {
  '0001_extensions': m0001_extensions,
  '0002_roles': m0002_roles,
  '0003_identity': m0003_identity,
  '0004_organizations': m0004_organizations,
  '0005_rbac': m0005_rbac,
  '0006_catalog': m0006_catalog,
  '0007_billing': m0007_billing,
  '0008_seats': m0008_seats,
  '0009_usage': m0009_usage,
  '0010_accounts': m0010_accounts,
  '0011_audit': m0011_audit,
  '0012_operational': m0012_operational,
  '0013_views': m0013_views,
  '0014_guards': m0014_guards,
  '0015_rls': m0015_rls,
  '0016_audit_privileges': m0016_audit_privileges,
  '0017_rls_nullif': m0017_rls_nullif,
}
