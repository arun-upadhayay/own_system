import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0007 — plans, limits, subscriptions (ERD §7). The commercial core.
 *
 * `plan_features.limit_value` is where ADR-010 becomes real: every limit is a row,
 * none is a constant in code. NULL means unlimited — explicitly, never a sentinel.
 * `subscriptions` is the single source of truth for product access (ADR-006): the
 * partial unique index permits one live subscription per (org, product), and
 * includes suspended/past_due so a suspended one cannot be bypassed by a fresh row.
 */
export const m0007_billing = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ─────────────────────────────────────────────────────────── plans
      `CREATE TABLE plans (
         id               uuid PRIMARY KEY,
         product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
         key              text NOT NULL,
         name             text NOT NULL,
         description      text,
         tier             int NOT NULL,
         price_amount     numeric(19,4),
         price_currency   text,
         billing_interval text,
         trial_days       int NOT NULL DEFAULT 0,
         support_level    text,
         status           text NOT NULL DEFAULT 'draft',
         is_public        boolean NOT NULL DEFAULT true,
         sort_order       int NOT NULL DEFAULT 0,
         created_at       timestamptz NOT NULL DEFAULT now(),
         updated_at       timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT plans_interval_chk CHECK
           (billing_interval IS NULL OR billing_interval IN ('month','year','one_time')),
         CONSTRAINT plans_status_chk CHECK
           (status IN ('draft','active','grandfathered','retired'))
       )`,
      `CREATE UNIQUE INDEX plans_product_key_unique ON plans (product_id, key)`,
      `CREATE INDEX plans_product_public_idx
         ON plans (product_id, tier) WHERE status = 'active' AND is_public`,

      // ──────────────────────────── plan_features — the limit store (ADR-010)
      `CREATE TABLE plan_features (
         id          uuid PRIMARY KEY,
         plan_id     uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
         feature_id  uuid NOT NULL REFERENCES features(id),
         is_enabled  boolean NOT NULL DEFAULT true,
         limit_value bigint,
         created_at  timestamptz NOT NULL DEFAULT now(),
         updated_at  timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT plan_features_limit_nonneg CHECK (limit_value IS NULL OR limit_value >= 0)
       )`,
      `CREATE UNIQUE INDEX plan_features_unique ON plan_features (plan_id, feature_id)`,

      // ─────────────────────────────────────────────────── subscriptions
      `CREATE TABLE subscriptions (
         id                   uuid PRIMARY KEY,
         organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         product_id           uuid NOT NULL REFERENCES products(id),
         plan_id              uuid NOT NULL REFERENCES plans(id),
         status               text NOT NULL,
         started_at           timestamptz NOT NULL DEFAULT now(),
         current_period_start timestamptz,
         current_period_end   timestamptz,
         trial_ends_at        timestamptz,
         cancel_at_period_end boolean NOT NULL DEFAULT false,
         cancelled_at         timestamptz,
         ended_at             timestamptz,
         suspended_at         timestamptz,
         suspension_reason    text,
         external_billing_ref text,
         created_by_user_id   uuid REFERENCES users(id),
         notes                text,
         created_at           timestamptz NOT NULL DEFAULT now(),
         updated_at           timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT subscriptions_status_chk CHECK
           (status IN ('trialing','active','past_due','suspended','cancelled','expired'))
       )`,
      // The most important index in the schema: one live subscription per
      // (org, product). suspended/past_due occupy the slot, so a suspended
      // subscription cannot be bypassed by creating a fresh one beside it.
      `CREATE UNIQUE INDEX subscriptions_org_product_live
         ON subscriptions (organization_id, product_id)
         WHERE status IN ('trialing','active','past_due','suspended')`,
      `CREATE INDEX subscriptions_org_idx ON subscriptions (organization_id)`,
      `CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id)`,
      `CREATE INDEX subscriptions_expiry_idx
         ON subscriptions (current_period_end) WHERE status IN ('trialing','active')`,
      `CREATE INDEX subscriptions_trial_idx
         ON subscriptions (trial_ends_at) WHERE status = 'trialing'`,

      // ──────────────────── subscription_overrides — per-customer limits
      // reason + granted_by are NOT NULL: a customer whose limits differ from their
      // plan with no record of who/why is a support and revenue problem.
      `CREATE TABLE subscription_overrides (
         id                 uuid PRIMARY KEY,
         subscription_id    uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
         feature_id         uuid NOT NULL REFERENCES features(id),
         is_enabled         boolean,
         limit_value        bigint,
         is_unlimited       boolean NOT NULL DEFAULT false,
         reason             text NOT NULL,
         granted_by_user_id uuid NOT NULL REFERENCES users(id),
         expires_at         timestamptz,
         superseded_at      timestamptz,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now()
       )`,
      // Uniqueness keyed on superseded_at (review R-2): expiry is a read-time
      // condition, not an index predicate, so now() is never used here.
      `CREATE UNIQUE INDEX subscription_overrides_unique
         ON subscription_overrides (subscription_id, feature_id) WHERE superseded_at IS NULL`,

      // ─────────────────────────────────────────────── subscription_events
      `CREATE TABLE subscription_events (
         id              uuid PRIMARY KEY,
         subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
         organization_id uuid NOT NULL,
         event_type      text NOT NULL,
         from_plan_id    uuid REFERENCES plans(id),
         to_plan_id      uuid REFERENCES plans(id),
         from_status     text,
         to_status       text,
         actor_user_id   uuid REFERENCES users(id),
         metadata        jsonb NOT NULL DEFAULT '{}',
         created_at      timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX subscription_events_sub_idx ON subscription_events (subscription_id, created_at DESC)`,
    ])
  },
}
