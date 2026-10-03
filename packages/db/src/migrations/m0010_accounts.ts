import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0010 — customer accounts and product requests (ERD §10).
 *
 * organization_product_requests captures the conversion flow (baseline §14, §39).
 * `source` is what makes it a sales queue rather than a lead list: a request from
 * 'limit_reached' is a customer blocked right now — the clearest buying signal.
 */
export const m0010_accounts = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `CREATE TABLE customer_accounts (
         id              uuid PRIMARY KEY,
         organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         account_tier    text,
         lifecycle_stage text NOT NULL DEFAULT 'prospect',
         health_score    int,
         mrr_amount      numeric(19,4),
         mrr_currency    text,
         renewal_date    date,
         churn_risk_note text,
         metadata        jsonb NOT NULL DEFAULT '{}',
         created_at      timestamptz NOT NULL DEFAULT now(),
         updated_at      timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT customer_accounts_stage_chk CHECK
           (lifecycle_stage IN ('prospect','trial','customer','at_risk','churned')),
         CONSTRAINT customer_accounts_health_chk CHECK
           (health_score IS NULL OR (health_score BETWEEN 0 AND 100))
       )`,
      `CREATE UNIQUE INDEX customer_accounts_org_unique ON customer_accounts (organization_id)`,

      `CREATE TABLE organization_product_requests (
         id                  uuid PRIMARY KEY,
         organization_id     uuid REFERENCES organizations(id) ON DELETE CASCADE,
         product_id          uuid NOT NULL REFERENCES products(id),
         requested_by_user_id uuid REFERENCES users(id),
         request_type        text NOT NULL,
         contact_name        text,
         contact_email       citext,
         contact_phone       text,
         message             text,
         status              text NOT NULL DEFAULT 'new',
         assigned_to_user_id uuid REFERENCES users(id),
         source              text,
         created_at          timestamptz NOT NULL DEFAULT now(),
         updated_at          timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT opr_request_type_chk CHECK (request_type IN ('demo','contact','upgrade','trial')),
         CONSTRAINT opr_status_chk CHECK (status IN ('new','contacted','qualified','converted','closed')),
         CONSTRAINT opr_source_chk CHECK
           (source IS NULL OR source IN ('launcher','discovery_page','limit_reached'))
       )`,
      `CREATE INDEX opr_status_idx ON organization_product_requests (status, created_at DESC)`,
      `CREATE INDEX opr_org_idx ON organization_product_requests (organization_id)`,
    ])
  },
}
