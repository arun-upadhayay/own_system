import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0014 — composite integrity guards (ERD §13.1). The worst class of defect this
 * schema can have is silent cross-tenant or cross-product corruption that no
 * application test would notice until it produced a wrong access decision. A plain
 * FK proves a parent exists; it cannot prove two parents AGREE.
 *
 * Implementation note (AR-009): the ERD sketched the referenceable pairs as
 * `CREATE UNIQUE INDEX`, but PostgreSQL requires a FK target to be a unique
 * CONSTRAINT (or PK), not a bare unique index. So these are UNIQUE constraints —
 * redundant with the PK, which is exactly what makes them referenceable.
 *
 * Grandparent agreements (plan↔feature product, override↔subscription product,
 * role↔permission product) span two hops a composite FK cannot express, so they
 * are CONSTRAINT TRIGGERs, DEFERRABLE INITIALLY IMMEDIATE, that participate in the
 * transaction.
 */
export const m0014_guards = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ── FKs deferred from earlier migrations (their parents exist now) ──────
      `ALTER TABLE permissions
         ADD CONSTRAINT permissions_product_fk FOREIGN KEY (product_id) REFERENCES products(id)`,
      `ALTER TABLE roles
         ADD CONSTRAINT roles_product_fk FOREIGN KEY (product_id) REFERENCES products(id)`,
      `ALTER TABLE oidc_clients
         ADD CONSTRAINT oidc_clients_product_fk FOREIGN KEY (product_id) REFERENCES products(id)`,
      // invitation_roles.role_id → roles, RESTRICT: a role still promised to a
      // pending invitation cannot be deleted out from under it (review R-4).
      `ALTER TABLE invitation_roles
         ADD CONSTRAINT invitation_roles_role_fk FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT`,

      // ── Referenceable (id, scope) unique constraints on the parents ────────
      `ALTER TABLE branches      ADD CONSTRAINT branches_id_org_uk      UNIQUE (id, organization_id)`,
      `ALTER TABLE memberships   ADD CONSTRAINT memberships_id_org_uk   UNIQUE (id, organization_id)`,
      `ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_id_org_uk UNIQUE (id, organization_id)`,
      `ALTER TABLE plans         ADD CONSTRAINT plans_id_product_uk     UNIQUE (id, product_id)`,
      `ALTER TABLE features      ADD CONSTRAINT features_id_product_uk  UNIQUE (id, product_id)`,

      // ── Tenant guards (a row in org A cannot reference org B) ──────────────
      // Nullable child columns use MATCH SIMPLE (the default): the FK is satisfied
      // when the nullable column is NULL, which is the intended behaviour.
      `ALTER TABLE memberships ADD CONSTRAINT memberships_default_branch_tenant_fk
         FOREIGN KEY (default_branch_id, organization_id)
         REFERENCES branches (id, organization_id)`,
      `ALTER TABLE membership_branches ADD CONSTRAINT membership_branches_membership_tenant_fk
         FOREIGN KEY (membership_id, organization_id)
         REFERENCES memberships (id, organization_id) ON DELETE CASCADE`,
      `ALTER TABLE membership_branches ADD CONSTRAINT membership_branches_branch_tenant_fk
         FOREIGN KEY (branch_id, organization_id)
         REFERENCES branches (id, organization_id) ON DELETE CASCADE`,
      `ALTER TABLE membership_products ADD CONSTRAINT membership_products_membership_tenant_fk
         FOREIGN KEY (membership_id, organization_id)
         REFERENCES memberships (id, organization_id) ON DELETE CASCADE`,
      `ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_subscription_tenant_fk
         FOREIGN KEY (subscription_id, organization_id)
         REFERENCES subscriptions (id, organization_id)`,
      `ALTER TABLE subscription_events ADD CONSTRAINT subscription_events_subscription_tenant_fk
         FOREIGN KEY (subscription_id, organization_id)
         REFERENCES subscriptions (id, organization_id) ON DELETE CASCADE`,
      `ALTER TABLE product_usage_reports ADD CONSTRAINT product_usage_branch_tenant_fk
         FOREIGN KEY (branch_id, organization_id)
         REFERENCES branches (id, organization_id)`,

      // ── Product guard: THE critical one (review R-5). Without it a subscription
      //    could point at another product's plan and silently resolve the wrong
      //    product's limits entirely. ───────────────────────────────────────────
      `ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_product_fk
         FOREIGN KEY (plan_id, product_id) REFERENCES plans (id, product_id)`,

      // ── Grandparent trigger guards ────────────────────────────────────────
      `CREATE OR REPLACE FUNCTION chk_plan_feature_same_product() RETURNS trigger AS $fn$
       BEGIN
         IF (SELECT product_id FROM plans WHERE id = NEW.plan_id)
            IS DISTINCT FROM
            (SELECT product_id FROM features WHERE id = NEW.feature_id) THEN
           RAISE EXCEPTION 'plan_features: plan % and feature % belong to different products',
             NEW.plan_id, NEW.feature_id;
         END IF;
         RETURN NEW;
       END; $fn$ LANGUAGE plpgsql`,
      `CREATE CONSTRAINT TRIGGER plan_features_same_product
         AFTER INSERT OR UPDATE ON plan_features
         DEFERRABLE INITIALLY IMMEDIATE
         FOR EACH ROW EXECUTE FUNCTION chk_plan_feature_same_product()`,

      `CREATE OR REPLACE FUNCTION chk_override_same_product() RETURNS trigger AS $fn$
       BEGIN
         IF (SELECT product_id FROM subscriptions WHERE id = NEW.subscription_id)
            IS DISTINCT FROM
            (SELECT product_id FROM features WHERE id = NEW.feature_id) THEN
           RAISE EXCEPTION 'subscription_overrides: feature % is not for subscription %''s product',
             NEW.feature_id, NEW.subscription_id;
         END IF;
         RETURN NEW;
       END; $fn$ LANGUAGE plpgsql`,
      `CREATE CONSTRAINT TRIGGER subscription_overrides_same_product
         AFTER INSERT OR UPDATE ON subscription_overrides
         DEFERRABLE INITIALLY IMMEDIATE
         FOR EACH ROW EXECUTE FUNCTION chk_override_same_product()`,

      // When BOTH the role and the permission are product-scoped, their products
      // must match — a POS role cannot grant Inventory permissions.
      `CREATE OR REPLACE FUNCTION chk_role_permission_same_product() RETURNS trigger AS $fn$
       DECLARE
         role_product uuid;
         perm_scope   text;
         perm_product uuid;
       BEGIN
         SELECT product_id INTO role_product FROM roles WHERE id = NEW.role_id;
         SELECT scope, product_id INTO perm_scope, perm_product FROM permissions WHERE id = NEW.permission_id;
         IF perm_scope = 'product' AND role_product IS NOT NULL
            AND role_product IS DISTINCT FROM perm_product THEN
           RAISE EXCEPTION 'role_permissions: role % and permission % belong to different products',
             NEW.role_id, NEW.permission_id;
         END IF;
         RETURN NEW;
       END; $fn$ LANGUAGE plpgsql`,
      `CREATE CONSTRAINT TRIGGER role_permissions_same_product
         AFTER INSERT OR UPDATE ON role_permissions
         DEFERRABLE INITIALLY IMMEDIATE
         FOR EACH ROW EXECUTE FUNCTION chk_role_permission_same_product()`,
    ])
  },
}
