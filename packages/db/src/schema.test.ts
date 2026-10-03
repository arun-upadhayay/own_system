/**
 * Phase 2 integration tests — the schema's security invariants, against the real
 * database, each in a rolled-back transaction (plan Phase 2 acceptance).
 *
 * Every test here maps to an acceptance criterion: composite guards reject
 * cross-tenant and cross-product rows, partial unique indexes hold, audit is
 * append-only at the database level, and RLS isolates tenants.
 *
 * Skips automatically when no database is configured, so `pnpm test` stays green
 * without one.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { sql, type Transaction } from 'kysely'
import { uuidv7 } from '@cp/core'
import type { OrgScope } from '@cp/core'
import type { DB } from './schema.js'
import {
  clearScope,
  closeTestDb,
  HAS_DB,
  inRolledBackTx,
  setOrgScope,
  setPlatformScope,
} from './testing/harness.js'
import { recordAudit } from './audit.js'
import { enqueueOutbox } from './outbox.js'
import { BranchRepository } from './repositories/branch-repository.js'

afterAll(async () => {
  await closeTestDb()
})

// ─────────────────────────────────────────────────────────── seed helpers

async function seedUser(tx: Transaction<DB>): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('users')
    .values({ id, email: `u-${id}@example.test`, full_name: 'Test User', status: 'active' })
    .execute()
  return id
}

async function seedOrg(tx: Transaction<DB>, status = 'active'): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('organizations')
    .values({ id, name: `Org ${id.slice(0, 8)}`, slug: `org-${id}`, status })
    .execute()
  return id
}

async function seedProduct(tx: Transaction<DB>): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('products')
    .values({ id, slug: `prod-${id}`, name: 'Product', status: 'active', visibility: 'public' })
    .execute()
  return id
}

async function seedPlan(tx: Transaction<DB>, productId: string, tier = 1): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('plans')
    .values({ id, product_id: productId, key: `plan-${id}`, name: 'Plan', tier, status: 'active' })
    .execute()
  return id
}

async function seedBranch(tx: Transaction<DB>, orgId: string, primary = false): Promise<string> {
  const id = uuidv7()
  await tx
    .insertInto('branches')
    .values({ id, organization_id: orgId, name: `Branch ${id.slice(0, 8)}`, is_primary: primary })
    .execute()
  return id
}

const describeDb = HAS_DB ? describe : describe.skip

// ───────────────────────────────────────────────── composite guards (§13.1)

describeDb('composite integrity guards', () => {
  it('rejects a subscription whose plan belongs to another product (review R-5)', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const productA = await seedProduct(tx)
      const productB = await seedProduct(tx)
      const planB = await seedPlan(tx, productB)

      // Subscription claims productA but points at productB's plan.
      await expect(
        tx
          .insertInto('subscriptions')
          .values({
            id: uuidv7(),
            organization_id: org,
            product_id: productA,
            plan_id: planB,
            status: 'active',
          })
          .execute(),
      ).rejects.toThrow()
    })
  })

  it('rejects a membership defaulting to another tenant’s branch', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const orgA = await seedOrg(tx)
      const orgB = await seedOrg(tx)
      const user = await seedUser(tx)
      const branchB = await seedBranch(tx, orgB)

      await expect(
        tx
          .insertInto('memberships')
          .values({
            id: uuidv7(),
            user_id: user,
            organization_id: orgA,
            status: 'active',
            default_branch_id: branchB, // belongs to orgB — must be rejected
          })
          .execute(),
      ).rejects.toThrow()
    })
  })

  it('rejects a plan_feature whose feature belongs to another product (grandparent trigger)', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const productA = await seedProduct(tx)
      const productB = await seedProduct(tx)
      const planA = await seedPlan(tx, productA)
      const featureB = uuidv7()
      await tx
        .insertInto('features')
        .values({
          id: featureB,
          product_id: productB,
          key: 'f',
          name: 'F',
          type: 'boolean',
          enforced_by: 'product',
        })
        .execute()

      await expect(
        tx
          .insertInto('plan_features')
          .values({ id: uuidv7(), plan_id: planA, feature_id: featureB })
          .execute(),
      ).rejects.toThrow(/different products/)
    })
  })
})

// ───────────────────────────────────────────── partial unique indexes

describeDb('partial unique indexes', () => {
  it('allows only one primary branch per organization', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      await seedBranch(tx, org, true)
      await expect(seedBranch(tx, org, true)).rejects.toThrow()
    })
  })

  it('allows only one live subscription per (organization, product)', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const product = await seedProduct(tx)
      const plan = await seedPlan(tx, product)
      const base = {
        organization_id: org,
        product_id: product,
        plan_id: plan,
        status: 'active' as const,
      }
      await tx.insertInto('subscriptions').values({ id: uuidv7(), ...base }).execute()
      await expect(
        tx.insertInto('subscriptions').values({ id: uuidv7(), ...base }).execute(),
      ).rejects.toThrow()
    })
  })

  it('allows only one live seat per (membership, product)', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const user = await seedUser(tx)
      const product = await seedProduct(tx)
      const membership = uuidv7()
      await tx
        .insertInto('memberships')
        .values({ id: membership, user_id: user, organization_id: org, status: 'active' })
        .execute()
      const granter = await seedUser(tx)
      const seat = {
        membership_id: membership,
        organization_id: org,
        product_id: product,
        granted_by_user_id: granter,
      }
      await tx.insertInto('membership_products').values({ id: uuidv7(), ...seat }).execute()
      await expect(
        tx.insertInto('membership_products').values({ id: uuidv7(), ...seat }).execute(),
      ).rejects.toThrow()
    })
  })
})

// ───────────────────────────────────────────── audit append-only (§11.1)

describeDb('audit log is append-only at the database level', () => {
  it('rejects UPDATE and DELETE', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const id = await recordAudit(tx, {
        actorType: 'system',
        action: 'test.performed',
        resourceType: 'test',
        outcome: 'success',
      })

      // As app_role the REVOKE denies UPDATE/DELETE before the trigger is reached
      // ('permission denied'); the trigger is the owner/retention backstop. Either
      // way the write is rejected — the property that matters is that the
      // application cannot rewrite the audit log.
      await expect(
        tx.updateTable('audit_logs').set({ action: 'tampered' }).where('id', '=', id).execute(),
      ).rejects.toThrow()

      await expect(
        tx.deleteFrom('audit_logs').where('id', '=', id).execute(),
      ).rejects.toThrow()
    })
  })

  it('records denied outcomes — the probing signal', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const id = await recordAudit(tx, {
        actorType: 'user',
        action: 'organization.read',
        resourceType: 'organization',
        outcome: 'denied',
      })
      const row = await tx
        .selectFrom('audit_logs')
        .select('outcome')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
      expect(row.outcome).toBe('denied')
    })
  })
})

// ───────────────────────────────────────────── row-level security (§14)

describeDb('row-level security', () => {
  it('returns nothing for a query that never established tenant scope', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      await seedBranch(tx, org)
      // Now pretend a handler forgot to set scope.
      await clearScope(tx)
      const rows = await tx.selectFrom('branches').selectAll().execute()
      expect(rows).toHaveLength(0)
    })
  })

  it('isolates tenants: org A cannot see org B’s branch', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const orgA = await seedOrg(tx)
      const orgB = await seedOrg(tx)
      const branchA = await seedBranch(tx, orgA)
      await seedBranch(tx, orgB)

      await setOrgScope(tx, orgA)
      const rows = await tx.selectFrom('branches').selectAll().execute()
      expect(rows.map((r) => r.id)).toEqual([branchA])
    })
  })

  it('blocks writing a row for another organization under tenant scope', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const orgA = await seedOrg(tx)
      const orgB = await seedOrg(tx)

      await setOrgScope(tx, orgA)
      // WITH CHECK on the tenant policy rejects inserting into orgB while scoped to A.
      await expect(
        tx
          .insertInto('branches')
          .values({ id: uuidv7(), organization_id: orgB, name: 'X' })
          .execute(),
      ).rejects.toThrow()
    })
  })
})

// ───────────────────────────────────────────── outbox atomicity (ADR-009)

describeDb('transactional outbox', () => {
  it('writes an event row in the same transaction', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const id = await enqueueOutbox(tx, {
        eventType: 'OrganizationCreated',
        aggregateType: 'organization',
        aggregateId: org,
        organizationId: org,
        payload: { organizationId: org },
      })
      const row = await tx
        .selectFrom('outbox_events')
        .select(['status', 'event_type'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
      expect(row.status).toBe('pending')
      expect(row.event_type).toBe('OrganizationCreated')
    })
  })
})

// ───────────────────────────────────────────── view (ERD §8, review R-6)

describeDb('v_organization_products', () => {
  it('reports not_subscribed for a public product with no subscription', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const product = await seedProduct(tx)
      const row = await tx
        .selectFrom('v_organization_products')
        .select(['access_state'])
        .where('organization_id', '=', org)
        .where('product_id', '=', product)
        .executeTakeFirstOrThrow()
      expect(row.access_state).toBe('not_subscribed')
    })
  })

  it('reports expired for a lapsed trial — not not_subscribed (review R-6)', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx)
      const product = await seedProduct(tx)
      const plan = await seedPlan(tx, product)
      await tx
        .insertInto('subscriptions')
        .values({
          id: uuidv7(),
          organization_id: org,
          product_id: product,
          plan_id: plan,
          status: 'trialing',
          trial_ends_at: sql`now() - interval '1 day'`,
        })
        .execute()
      const row = await tx
        .selectFrom('v_organization_products')
        .select(['access_state'])
        .where('organization_id', '=', org)
        .where('product_id', '=', product)
        .executeTakeFirstOrThrow()
      expect(row.access_state).toBe('expired')
    })
  })

  it('reports org_inactive for a suspended organization regardless of subscription', async () => {
    await inRolledBackTx(async (tx) => {
      await setPlatformScope(tx)
      const org = await seedOrg(tx, 'suspended')
      const product = await seedProduct(tx)
      const plan = await seedPlan(tx, product)
      await tx
        .insertInto('subscriptions')
        .values({
          id: uuidv7(),
          organization_id: org,
          product_id: product,
          plan_id: plan,
          status: 'active',
        })
        .execute()
      const row = await tx
        .selectFrom('v_organization_products')
        .select(['access_state'])
        .where('organization_id', '=', org)
        .where('product_id', '=', product)
        .executeTakeFirstOrThrow()
      expect(row.access_state).toBe('org_inactive')
    })
  })
})

// ─────────────────────────── type-level: OrgScope is required (ADR-012 Layer 2)
// Never executed — validated by `pnpm typecheck`. If a repository method could be
// called without an OrgScope, the structural tenant guard would be broken.
export function _scopeEnforcementTypeAssertions(): void {
  const tx = null as unknown as Transaction<DB>
  const scope = null as unknown as OrgScope

  // Correct: scope first.
  void BranchRepository.list(scope, tx)

  // @ts-expect-error — a scope-less list() must not compile.
  void BranchRepository.list(tx)

  // @ts-expect-error — a bare string cannot stand in for a branded OrgScope.
  void BranchRepository.list('org-123', tx)
}
