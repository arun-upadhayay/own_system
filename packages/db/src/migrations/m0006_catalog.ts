import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0006 — product registry (ERD §6). products, features, product_discovery_sections.
 *
 * This is the table set that makes ADR-013 real: a new product is rows here, not a
 * release. `accent_color` and `icon_url` live on the product so presentation is
 * data, never a frontend conditional.
 */
export const m0006_catalog = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ──────────────────────────────────────────────────────── products
      `CREATE TABLE products (
         id               uuid PRIMARY KEY,
         slug             text NOT NULL,
         name             text NOT NULL,
         tagline          text,
         description      text,
         icon_url         text,
         accent_color     text,
         category         text,
         app_url          text,
         marketing_url    text,
         status           text NOT NULL DEFAULT 'draft',
         visibility       text NOT NULL DEFAULT 'public',
         owner_team       text,
         version          text,
         sort_order       int NOT NULL DEFAULT 0,
         supports_sso     boolean NOT NULL DEFAULT true,
         health_check_url text,
         metadata         jsonb NOT NULL DEFAULT '{}',
         created_at       timestamptz NOT NULL DEFAULT now(),
         updated_at       timestamptz NOT NULL DEFAULT now(),
         deleted_at       timestamptz,
         CONSTRAINT products_status_chk CHECK
           (status IN ('draft','beta','active','deprecated','retired')),
         CONSTRAINT products_visibility_chk CHECK (visibility IN ('public','private','hidden'))
       )`,
      `CREATE UNIQUE INDEX products_slug_unique ON products (slug) WHERE deleted_at IS NULL`,
      `CREATE INDEX products_visible_idx
         ON products (status, visibility, sort_order) WHERE deleted_at IS NULL`,

      // ──────────────────────────────────────────────────────── features
      // enforced_by is the domain boundary (ADR-010 amendment): the Control Plane
      // enforces only its own resources; countable_resource is a closed enum.
      `CREATE TABLE features (
         id                 uuid PRIMARY KEY,
         product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
         key                text NOT NULL,
         name               text NOT NULL,
         description        text,
         type               text NOT NULL,
         enforced_by        text NOT NULL,
         countable_resource text,
         countable_scope    text,
         unit               text,
         is_public          boolean NOT NULL DEFAULT true,
         sort_order         int NOT NULL DEFAULT 0,
         created_at         timestamptz NOT NULL DEFAULT now(),
         updated_at         timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT features_type_chk CHECK (type IN ('boolean','limit','quota')),
         CONSTRAINT features_enforced_by_chk CHECK (enforced_by IN ('control_plane','product')),
         CONSTRAINT features_countable_resource_chk CHECK
           (countable_resource IS NULL OR countable_resource IN ('users','branches')),
         CONSTRAINT features_countable_scope_chk CHECK
           (countable_scope IS NULL OR countable_scope IN ('product','organization')),
         CONSTRAINT features_unit_chk CHECK ((type = 'boolean') OR (unit IS NOT NULL)),
         CONSTRAINT features_cp_countable_chk CHECK
           ((enforced_by = 'control_plane') = (countable_resource IS NOT NULL)),
         CONSTRAINT features_scope_pairing_chk CHECK
           ((countable_resource IS NOT NULL) = (countable_scope IS NOT NULL))
       )`,
      `CREATE UNIQUE INDEX features_product_key_unique ON features (product_id, key)`,

      // ───────────────────────────── product_discovery_sections (ERD §6.3)
      // Discovery copy is data, so marketing changes it without a deployment.
      `CREATE TABLE product_discovery_sections (
         id          uuid PRIMARY KEY,
         product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
         heading     text NOT NULL,
         body        text,
         bullets     text[],
         image_url   text,
         sort_order  int NOT NULL DEFAULT 0,
         created_at  timestamptz NOT NULL DEFAULT now(),
         updated_at  timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX product_discovery_product_idx ON product_discovery_sections (product_id)`,
    ])
  },
}
