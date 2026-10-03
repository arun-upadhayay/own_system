import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0008 — per-product seats (ERD §4.7, ADR-018). membership_products grants a
 * member access to a specific product; invitation_products reserves those seats at
 * invitation time.
 *
 * This is what makes a seat a countable, lockable, auditable thing, and what
 * represents baseline §23's "can THIS user use this product" as data rather than
 * an inference from role permissions. granted_by is NOT NULL — every seat traces
 * to a person. Revocation is a timestamp, not a delete, so seat history survives.
 */
export const m0008_seats = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `CREATE TABLE membership_products (
         id                 uuid PRIMARY KEY,
         membership_id      uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
         organization_id    uuid NOT NULL,
         product_id         uuid NOT NULL REFERENCES products(id),
         granted_at         timestamptz NOT NULL DEFAULT now(),
         granted_by_user_id uuid NOT NULL REFERENCES users(id),
         revoked_at         timestamptz,
         revoked_by_user_id uuid REFERENCES users(id)
       )`,
      `CREATE UNIQUE INDEX membership_products_live_unique
         ON membership_products (membership_id, product_id) WHERE revoked_at IS NULL`,
      // Matches the seat-count predicate exactly; the count runs inside the
      // ADR-011 lock where its duration determines how long concurrent grants block.
      `CREATE INDEX membership_products_seat_count_idx
         ON membership_products (organization_id, product_id) WHERE revoked_at IS NULL`,
      `CREATE INDEX membership_products_membership_idx
         ON membership_products (membership_id) WHERE revoked_at IS NULL`,

      // invitation_products: which product seats an invitation promises. Accepting
      // converts each row into a membership_products grant in the same transaction
      // that creates the membership — no fresh limit check, because the seats were
      // reserved at invitation time.
      `CREATE TABLE invitation_products (
         invitation_id uuid NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
         product_id    uuid NOT NULL REFERENCES products(id),
         PRIMARY KEY (invitation_id, product_id)
       )`,
      `CREATE INDEX invitation_products_product_idx ON invitation_products (product_id)`,
    ])
  },
}
