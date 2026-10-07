import type { Kysely } from 'kysely'
import { uuidv7 } from '@cp/core'
import { run } from './helpers.js'

/**
 * 0019 — seed the permission catalog and the system roles (ERD §5; 07 §2, §3).
 *
 * Permissions are a contract with code: seeded by migration, never user-created
 * (07 §5.1). System roles are immutable templates (organization_id NULL) available
 * to every organization, plus the platform (company-staff) roles. Idempotent via
 * ON CONFLICT DO NOTHING, so re-running is a no-op.
 *
 * Grants are additive: a role's effective permissions are the union of its
 * role_permissions rows (07 §2.2). org_owner and super_admin are defined as "all
 * permissions of that scope" by an INSERT…SELECT, so new permissions of a scope
 * extend them automatically on re-seed.
 */

interface Perm {
  key: string
  scope: 'organization' | 'platform'
  dangerous?: boolean
  desc: string
}

const PERMISSIONS: Perm[] = [
  // ── organization scope ──────────────────────────────────────────────
  { key: 'organization.read', scope: 'organization', desc: 'View the organization' },
  { key: 'organization.update', scope: 'organization', desc: 'Edit organization settings' },
  { key: 'organization.members.read', scope: 'organization', desc: 'View members' },
  { key: 'organization.members.invite', scope: 'organization', desc: 'Invite members' },
  { key: 'organization.members.update', scope: 'organization', desc: 'Edit members' },
  { key: 'organization.members.suspend', scope: 'organization', desc: 'Suspend/reinstate members' },
  { key: 'organization.members.remove', scope: 'organization', dangerous: true, desc: 'Remove members' },
  { key: 'organization.roles.read', scope: 'organization', desc: 'View roles' },
  { key: 'organization.roles.assign', scope: 'organization', desc: 'Assign roles to members' },
  { key: 'organization.roles.manage', scope: 'organization', desc: 'Create/edit custom roles' },
  { key: 'organization.branches.read', scope: 'organization', desc: 'View branches' },
  { key: 'organization.branches.create', scope: 'organization', desc: 'Create branches' },
  { key: 'organization.branches.update', scope: 'organization', desc: 'Edit branches' },
  { key: 'organization.branches.delete', scope: 'organization', desc: 'Delete branches' },
  { key: 'organization.ownership.transfer', scope: 'organization', dangerous: true, desc: 'Transfer ownership' },
  { key: 'organization.subscriptions.read', scope: 'organization', desc: 'View subscriptions' },
  { key: 'organization.subscriptions.manage', scope: 'organization', desc: 'Change plan / cancel' },
  { key: 'organization.product_seats.read', scope: 'organization', desc: 'View product seats' },
  { key: 'organization.product_seats.grant', scope: 'organization', desc: 'Grant product access' },
  { key: 'organization.product_seats.revoke', scope: 'organization', desc: 'Revoke product access' },
  { key: 'organization.usage.read', scope: 'organization', desc: 'View usage' },
  { key: 'organization.audit.read', scope: 'organization', desc: 'View the audit log' },
  // ── platform scope (company staff) ──────────────────────────────────
  { key: 'platform.dashboard.read', scope: 'platform', desc: 'View the company dashboard' },
  { key: 'platform.organizations.read', scope: 'platform', desc: 'View any organization' },
  { key: 'platform.organizations.create', scope: 'platform', desc: 'Create organizations' },
  { key: 'platform.organizations.suspend', scope: 'platform', dangerous: true, desc: 'Suspend/reinstate organizations' },
  { key: 'platform.users.read', scope: 'platform', desc: 'View any user' },
  { key: 'platform.users.suspend', scope: 'platform', dangerous: true, desc: 'Suspend users' },
  { key: 'platform.roles.read', scope: 'platform', desc: 'View platform role assignments' },
  { key: 'platform.roles.grant', scope: 'platform', dangerous: true, desc: 'Grant/revoke platform roles' },
  { key: 'platform.subscriptions.manage', scope: 'platform', desc: 'Manage subscriptions' },
  { key: 'platform.subscriptions.override', scope: 'platform', dangerous: true, desc: 'Grant limit overrides' },
  { key: 'platform.audit.read', scope: 'platform', desc: 'View cross-tenant audit' },
  { key: 'platform.accounts.read', scope: 'platform', desc: 'View customer accounts' },
  { key: 'platform.accounts.assign', scope: 'platform', desc: 'Assign account ownership' },
  { key: 'platform.products.read', scope: 'platform', desc: 'View products' },
  { key: 'platform.products.create', scope: 'platform', desc: 'Create products' },
  { key: 'platform.products.update', scope: 'platform', desc: 'Edit products' },
  { key: 'platform.plans.read', scope: 'platform', desc: 'View plans' },
  { key: 'platform.plans.create', scope: 'platform', desc: 'Create plans' },
  { key: 'platform.plans.update', scope: 'platform', desc: 'Edit plans' },
  { key: 'platform.features.read', scope: 'platform', desc: 'View features' },
  { key: 'platform.features.create', scope: 'platform', desc: 'Create features' },
  { key: 'platform.features.update', scope: 'platform', desc: 'Edit features' },
  { key: 'platform.health.read', scope: 'platform', desc: 'View product integration health' },
]

interface RoleDef {
  key: string
  name: string
  scope: 'organization' | 'platform'
  /** Explicit permission keys, or 'ALL' meaning every permission of the role's scope. */
  perms: string[] | 'ALL'
}

const ROLES: RoleDef[] = [
  // organization templates
  { key: 'org_owner', name: 'Organization Owner', scope: 'organization', perms: 'ALL' },
  {
    key: 'org_admin',
    name: 'Organization Admin',
    scope: 'organization',
    perms: [
      'organization.read',
      'organization.update',
      'organization.members.read',
      'organization.members.invite',
      'organization.members.update',
      'organization.members.suspend',
      'organization.members.remove',
      'organization.roles.read',
      'organization.roles.assign',
      'organization.roles.manage',
      'organization.branches.read',
      'organization.branches.create',
      'organization.branches.update',
      'organization.branches.delete',
      'organization.subscriptions.read',
      'organization.subscriptions.manage',
      'organization.product_seats.read',
      'organization.product_seats.grant',
      'organization.product_seats.revoke',
      'organization.usage.read',
      'organization.audit.read',
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    scope: 'organization',
    perms: [
      'organization.read',
      'organization.members.read',
      'organization.branches.read',
      'organization.product_seats.read',
      'organization.usage.read',
    ],
  },
  {
    key: 'staff',
    name: 'Staff',
    scope: 'organization',
    perms: ['organization.read', 'organization.members.read', 'organization.branches.read'],
  },
  {
    key: 'viewer',
    name: 'Viewer',
    scope: 'organization',
    perms: [
      'organization.read',
      'organization.members.read',
      'organization.branches.read',
      'organization.usage.read',
      'organization.audit.read',
    ],
  },
  // platform roles
  { key: 'super_admin', name: 'Super Administrator', scope: 'platform', perms: 'ALL' },
  {
    key: 'platform_admin',
    name: 'Platform Administrator',
    scope: 'platform',
    perms: [
      'platform.dashboard.read',
      'platform.organizations.read',
      'platform.users.read',
      'platform.audit.read',
      'platform.products.read',
      'platform.products.create',
      'platform.products.update',
      'platform.plans.read',
      'platform.plans.create',
      'platform.plans.update',
      'platform.features.read',
      'platform.features.create',
      'platform.features.update',
      'platform.health.read',
    ],
  },
  {
    key: 'support_agent',
    name: 'Support Agent',
    scope: 'platform',
    perms: ['platform.organizations.read', 'platform.users.read', 'platform.audit.read', 'platform.accounts.read'],
  },
  {
    key: 'billing_admin',
    name: 'Billing Administrator',
    scope: 'platform',
    perms: ['platform.organizations.read', 'platform.subscriptions.manage', 'platform.subscriptions.override'],
  },
  {
    key: 'account_manager',
    name: 'Account Manager',
    scope: 'platform',
    perms: ['platform.organizations.read', 'platform.accounts.read', 'platform.accounts.assign', 'platform.subscriptions.manage'],
  },
  {
    key: 'operations_admin',
    name: 'Operations Administrator',
    scope: 'platform',
    perms: ['platform.dashboard.read', 'platform.audit.read', 'platform.health.read', 'platform.organizations.read'],
  },
]

function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export const m0019_rbac_seed = {
  async up(db: Kysely<unknown>): Promise<void> {
    const statements: string[] = []

    // Permissions (one multi-row insert, idempotent on key).
    const permValues = PERMISSIONS.map(
      (p) =>
        `(${q(uuidv7())}, ${q(p.key)}, ${q(p.scope)}, NULL, ${q(p.desc)}, ${p.dangerous ? 'true' : 'false'})`,
    ).join(',\n')
    statements.push(
      `INSERT INTO permissions (id, key, scope, product_id, description, is_dangerous)
       VALUES ${permValues}
       ON CONFLICT (key) DO NOTHING`,
    )

    // System roles (idempotent on the partial unique index over key).
    const roleValues = ROLES.map(
      (r) =>
        `(${q(uuidv7())}, ${q(r.key)}, ${q(r.name)}, ${q(r.scope)}, NULL, NULL, true, true)`,
    ).join(',\n')
    statements.push(
      `INSERT INTO roles (id, key, name, scope, product_id, organization_id, is_system, is_assignable)
       VALUES ${roleValues}
       ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING`,
    )

    // role_permissions by key join.
    for (const r of ROLES) {
      if (r.perms === 'ALL') {
        statements.push(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT ro.id, pe.id FROM roles ro, permissions pe
           WHERE ro.key = ${q(r.key)} AND pe.scope = ${q(r.scope)}
           ON CONFLICT DO NOTHING`,
        )
      } else {
        const inList = r.perms.map(q).join(', ')
        statements.push(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT ro.id, pe.id FROM roles ro, permissions pe
           WHERE ro.key = ${q(r.key)} AND pe.key IN (${inList})
           ON CONFLICT DO NOTHING`,
        )
      }
    }

    await run(db, statements)
  },
}
