import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0005 — RBAC (ERD §5). permissions, roles, role_permissions, membership_roles,
 * platform_role_assignments, customer_account_assignments.
 *
 * product_id FKs point at products, which are created in 0006, so those FK
 * constraints are added in 0014. Coherence CHECKs (scope ⇄ scoping columns) live
 * here, since they are the integrity rules for the privilege tables (review R-11).
 */
export const m0005_rbac = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ─────────────────────────────────────────────────── permissions
      `CREATE TABLE permissions (
         id           uuid PRIMARY KEY,
         key          text NOT NULL,
         scope        text NOT NULL,
         product_id   uuid,
         description  text NOT NULL,
         is_dangerous boolean NOT NULL DEFAULT false,
         created_at   timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT permissions_scope_chk CHECK (scope IN ('platform','organization','product')),
         CONSTRAINT permissions_product_scope_chk CHECK ((scope = 'product') = (product_id IS NOT NULL))
       )`,
      `CREATE UNIQUE INDEX permissions_key_unique ON permissions (key)`,

      // ───────────────────────────────────────────────────────── roles
      `CREATE TABLE roles (
         id              uuid PRIMARY KEY,
         key             text,
         name            text NOT NULL,
         description     text,
         scope           text NOT NULL,
         product_id      uuid,
         organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
         is_system       boolean NOT NULL DEFAULT false,
         is_assignable   boolean NOT NULL DEFAULT true,
         created_at      timestamptz NOT NULL DEFAULT now(),
         updated_at      timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT roles_scope_chk CHECK (scope IN ('platform','organization','product')),
         CONSTRAINT roles_scope_coherence_chk CHECK (
             (scope = 'platform'     AND product_id IS NULL AND organization_id IS NULL)
          OR (scope = 'product'      AND product_id IS NOT NULL)
          OR (scope = 'organization' AND product_id IS NULL)
         )
       )`,
      `CREATE UNIQUE INDEX roles_key_unique ON roles (key) WHERE key IS NOT NULL`,
      `CREATE UNIQUE INDEX roles_org_name_unique
         ON roles (organization_id, name) WHERE organization_id IS NOT NULL`,
      `CREATE INDEX roles_scope_idx ON roles (scope)`,

      // ──────────────────────────────────────────────── role_permissions
      // Grants only — no deny rows. The effective set is the union across roles,
      // so there is exactly one answer to "why could this user do that".
      `CREATE TABLE role_permissions (
         role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
         permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
         created_at    timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (role_id, permission_id)
       )`,

      // ──────────────────────────────────────────────── membership_roles
      `CREATE TABLE membership_roles (
         membership_id      uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
         role_id            uuid NOT NULL REFERENCES roles(id),
         granted_by_user_id uuid REFERENCES users(id),
         created_at         timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (membership_id, role_id)
       )`,

      // ─────────────────────────────── platform_role_assignments (ADR-005)
      // The most dangerous grant in the system: a separate table so it cannot be
      // created as a side effect of editing a membership. granted_by is NOT NULL —
      // every platform privilege traces to a person.
      `CREATE TABLE platform_role_assignments (
         id                 uuid PRIMARY KEY,
         user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         role_id            uuid NOT NULL REFERENCES roles(id),
         granted_by_user_id uuid NOT NULL REFERENCES users(id),
         expires_at         timestamptz,
         revoked_at         timestamptz,
         created_at         timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX platform_role_user_role_unique
         ON platform_role_assignments (user_id, role_id) WHERE revoked_at IS NULL`,
      `CREATE INDEX platform_role_user_idx
         ON platform_role_assignments (user_id) WHERE revoked_at IS NULL`,

      // ───────────────────────────────── customer_account_assignments
      `CREATE TABLE customer_account_assignments (
         id                 uuid PRIMARY KEY,
         organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         user_id            uuid NOT NULL REFERENCES users(id),
         relationship       text NOT NULL,
         assigned_by_user_id uuid NOT NULL REFERENCES users(id),
         is_primary         boolean NOT NULL DEFAULT true,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         ended_at           timestamptz,
         CONSTRAINT cust_acct_relationship_chk CHECK
           (relationship IN ('account_manager','success_manager','support_owner'))
       )`,
      `CREATE UNIQUE INDEX cust_acct_one_primary
         ON customer_account_assignments (organization_id, relationship)
         WHERE is_primary AND ended_at IS NULL`,
    ])
  },
}
