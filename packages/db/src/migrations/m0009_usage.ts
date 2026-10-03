import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0009 — usage (ERD §9). Two kinds, kept strictly apart (audit item A5):
 *
 *   usage_counters         authoritative, entitlement-bearing. Serves periodic
 *                          quotas; concurrent-count resources (users, branches)
 *                          are counted LIVE during enforcement, not read here.
 *   product_usage_reports  informational, self-reported by products. These values
 *                          MUST NEVER influence an access decision — trusting a
 *                          self-reported figure would let a product grant itself
 *                          entitlement. They power analytics and the admin console.
 */
export const m0009_usage = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // period_key is NOT NULL text ('lifetime' | 'YYYY-MM' | ...), so uniqueness
      // needs no index expression (review R-1): no COALESCE/cast in the index.
      `CREATE TABLE usage_counters (
         id              uuid PRIMARY KEY,
         organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         subscription_id uuid REFERENCES subscriptions(id),
         feature_id      uuid NOT NULL REFERENCES features(id),
         period_key      text NOT NULL,
         period_start    timestamptz,
         period_end      timestamptz,
         used_value      bigint NOT NULL DEFAULT 0,
         updated_at      timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX usage_counters_unique
         ON usage_counters (organization_id, feature_id, period_key)`,

      `CREATE TABLE product_usage_reports (
         id              uuid PRIMARY KEY,
         organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         product_id      uuid NOT NULL REFERENCES products(id),
         branch_id       uuid,
         metric_key      text NOT NULL,
         metric_value    bigint NOT NULL,
         period_start    timestamptz NOT NULL,
         period_end      timestamptz NOT NULL,
         reported_at     timestamptz NOT NULL DEFAULT now(),
         idempotency_key text NOT NULL
       )`,
      // Reporting is at-least-once, so duplicates must collapse.
      `CREATE UNIQUE INDEX product_usage_idempotency ON product_usage_reports (idempotency_key)`,
      `CREATE INDEX product_usage_org_product_idx
         ON product_usage_reports (organization_id, product_id, period_start DESC)`,
    ])
  },
}
