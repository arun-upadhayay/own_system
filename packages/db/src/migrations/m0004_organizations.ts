import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0004 — organizations, branches, memberships, invitations (ERD §4).
 *
 * Cross-tenant composite guards (e.g. a membership's default_branch_id must
 * belong to the same organization) are added in 0014, together with the
 * referenceable unique indexes they need. Single-column FKs here give basic
 * referential integrity.
 */
export const m0004_organizations = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ─────────────────────────────────────────────────── organizations
      `CREATE TABLE organizations (
         id                 uuid PRIMARY KEY,
         name               text NOT NULL,
         slug               text NOT NULL,
         legal_name         text,
         status             text NOT NULL DEFAULT 'pending',
         suspended_at       timestamptz,
         suspension_reason  text,
         industry           text,
         country            text,
         timezone           text NOT NULL DEFAULT 'UTC',
         currency           text NOT NULL DEFAULT 'USD',
         billing_email      citext,
         metadata           jsonb NOT NULL DEFAULT '{}',
         created_by_user_id uuid REFERENCES users(id),
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         deleted_at         timestamptz,
         CONSTRAINT organizations_status_chk CHECK
           (status IN ('pending','active','suspended','cancelled'))
       )`,
      `CREATE UNIQUE INDEX organizations_slug_unique ON organizations (slug) WHERE deleted_at IS NULL`,
      `CREATE INDEX organizations_status_idx ON organizations (status) WHERE deleted_at IS NULL`,

      // ────────────────────────────────────────────────────── branches
      `CREATE TABLE branches (
         id              uuid PRIMARY KEY,
         organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         name            text NOT NULL,
         code            text,
         address         jsonb,
         timezone        text,
         status          text NOT NULL DEFAULT 'active',
         is_primary      boolean NOT NULL DEFAULT false,
         created_at      timestamptz NOT NULL DEFAULT now(),
         updated_at      timestamptz NOT NULL DEFAULT now(),
         deleted_at      timestamptz,
         CONSTRAINT branches_status_chk CHECK (status IN ('active','inactive'))
       )`,
      `CREATE UNIQUE INDEX branches_org_code_unique
         ON branches (organization_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL`,
      // At most one primary branch per organization — enforced by the database,
      // because application-only enforcement of this fails under concurrency.
      `CREATE UNIQUE INDEX branches_one_primary
         ON branches (organization_id) WHERE is_primary AND deleted_at IS NULL`,
      `CREATE INDEX branches_org_idx ON branches (organization_id) WHERE deleted_at IS NULL`,

      // ───────────────────────────────────────────────────── memberships
      // No 'invited' status: an invitation is not a membership (review R-3).
      `CREATE TABLE memberships (
         id                 uuid PRIMARY KEY,
         user_id            uuid NOT NULL REFERENCES users(id),
         organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         status             text NOT NULL DEFAULT 'active',
         is_owner           boolean NOT NULL DEFAULT false,
         all_branches       boolean NOT NULL DEFAULT true,
         default_branch_id  uuid,
         invited_by_user_id uuid REFERENCES users(id),
         invited_at         timestamptz,
         joined_at          timestamptz,
         removed_at         timestamptz,
         last_active_at     timestamptz,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT memberships_status_chk CHECK (status IN ('active','suspended','removed'))
       )`,
      `CREATE UNIQUE INDEX memberships_user_org_unique
         ON memberships (user_id, organization_id) WHERE status <> 'removed'`,
      // Matches the seat-occupancy predicate (ERD §4.6): active + suspended both
      // hold seats. The count runs inside the ADR-011 lock, so it must be fast.
      `CREATE INDEX memberships_org_occupying_idx
         ON memberships (organization_id) WHERE status IN ('active','suspended')`,
      `CREATE INDEX memberships_user_idx ON memberships (user_id) WHERE status = 'active'`,

      // ─────────────────────────────────────────────── membership_branches
      // Composite FKs to both parents (id, organization_id) are added in 0014.
      `CREATE TABLE membership_branches (
         membership_id   uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
         branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
         organization_id uuid NOT NULL,
         created_at      timestamptz NOT NULL DEFAULT now(),
         PRIMARY KEY (membership_id, branch_id)
       )`,

      // ────────────────────────────────────────────────────── invitations
      `CREATE TABLE invitations (
         id                 uuid PRIMARY KEY,
         organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         email              citext NOT NULL,
         token_hash         text NOT NULL,
         invited_by_user_id uuid NOT NULL REFERENCES users(id),
         status             text NOT NULL DEFAULT 'pending',
         expires_at         timestamptz NOT NULL,
         accepted_at        timestamptz,
         accepted_user_id   uuid REFERENCES users(id),
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT invitations_status_chk CHECK
           (status IN ('pending','accepted','expired','revoked'))
       )`,
      `CREATE UNIQUE INDEX invitations_token_idx ON invitations (token_hash)`,
      `CREATE UNIQUE INDEX invitations_org_email_pending
         ON invitations (organization_id, email) WHERE status = 'pending'`,
      `CREATE INDEX invitations_org_pending_idx
         ON invitations (organization_id) WHERE status = 'pending'`,

      // ──────────────────────────── invitation_roles (review R-4)
      // A junction, not a uuid[], so a role cannot be deleted while an invitation
      // still promises it (RESTRICT). roles are created in 0005, so the FK to
      // roles is added in 0014 after that table exists.
      `CREATE TABLE invitation_roles (
         invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
         role_id       uuid NOT NULL,
         PRIMARY KEY (invitation_id, role_id)
       )`,
    ])
  },
}
