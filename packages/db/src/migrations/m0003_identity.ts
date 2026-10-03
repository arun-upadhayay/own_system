import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0003 — identity (ERD §3). Users, credentials, sessions, refresh-token families
 * (ADR-017), MFA factors, OIDC clients, and the operational token tables.
 *
 * Every id column is `uuid` with NO default: ids are generated in the application
 * (ERD §1.0), so there is deliberately no `gen_random_uuid()` here.
 * Token tables store a HASH, never the token: a database dump must not be a set of
 * working credentials.
 */
export const m0003_identity = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      // ───────────────────────────────────────────────────────── users
      `CREATE TABLE users (
         id                  uuid PRIMARY KEY,
         email               citext NOT NULL,
         email_verified_at   timestamptz,
         full_name           text NOT NULL,
         phone               text,
         avatar_url          text,
         locale              text NOT NULL DEFAULT 'en',
         timezone            text NOT NULL DEFAULT 'UTC',
         status              text NOT NULL DEFAULT 'pending_verification',
         last_login_at       timestamptz,
         failed_login_count  int NOT NULL DEFAULT 0,
         locked_until        timestamptz,
         created_at          timestamptz NOT NULL DEFAULT now(),
         updated_at          timestamptz NOT NULL DEFAULT now(),
         deleted_at          timestamptz,
         CONSTRAINT users_status_chk CHECK
           (status IN ('pending_verification','active','suspended','deactivated'))
       )`,
      // Partial unique: a deleted user's email is released for re-registration.
      `CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL`,
      `CREATE INDEX users_status_idx ON users (status) WHERE deleted_at IS NULL`,

      // ──────────────────────────────────────────────── user_credentials
      // Separated from users so password material is never selected by an
      // ordinary user query.
      `CREATE TABLE user_credentials (
         id                    uuid PRIMARY KEY,
         user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         password_hash         text NOT NULL,
         algorithm             text NOT NULL,
         password_changed_at   timestamptz NOT NULL DEFAULT now(),
         must_change_password  boolean NOT NULL DEFAULT false,
         created_at            timestamptz NOT NULL DEFAULT now(),
         updated_at            timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX user_credentials_user_unique ON user_credentials (user_id)`,

      // ────────────────────────────────────────────────────── sessions
      `CREATE TABLE sessions (
         id              uuid PRIMARY KEY,
         user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         organization_id uuid,
         issued_at       timestamptz NOT NULL DEFAULT now(),
         expires_at      timestamptz NOT NULL,
         last_used_at    timestamptz NOT NULL DEFAULT now(),
         revoked_at      timestamptz,
         revoked_reason  text,
         ip_address      inet,
         user_agent      text,
         created_at      timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT sessions_revoked_reason_chk CHECK (revoked_reason IS NULL OR revoked_reason IN
           ('logout','rotation_reuse','org_suspended','password_changed','admin'))
       )`,
      `CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL`,
      `CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL`,

      // ────────────────────────────────── refresh_tokens (ADR-017)
      // Per-token family tracking: reuse of ANY consumed generation is detectable,
      // which the single previous-hash column could not deliver.
      `CREATE TABLE refresh_tokens (
         id             uuid PRIMARY KEY,
         session_id     uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         token_hash     text NOT NULL,
         generation     int NOT NULL,
         issued_at      timestamptz NOT NULL DEFAULT now(),
         expires_at     timestamptz NOT NULL,
         consumed_at    timestamptz,
         replaced_by_id uuid REFERENCES refresh_tokens(id)
       )`,
      `CREATE UNIQUE INDEX refresh_tokens_hash_idx ON refresh_tokens (token_hash)`,
      `CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id)`,
      // At most one live token per family: a double-refresh race resolves to one
      // winner; the other is correctly treated as reuse.
      `CREATE UNIQUE INDEX refresh_tokens_live_idx ON refresh_tokens (session_id) WHERE consumed_at IS NULL`,

      // ─────────────────────────────────────────────────── mfa_factors
      // Present from the first migration though MFA ships later (ADR-003 c.8):
      // adding auth tables to a live system with sessions in flight is harder.
      `CREATE TABLE mfa_factors (
         id                uuid PRIMARY KEY,
         user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         type              text NOT NULL,
         secret_encrypted  text,
         credential_id     text,
         public_key        text,
         label             text,
         confirmed_at      timestamptz,
         last_used_at      timestamptz,
         created_at        timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT mfa_factors_type_chk CHECK (type IN ('totp','webauthn','recovery_code'))
       )`,
      `CREATE INDEX mfa_factors_user_idx ON mfa_factors (user_id)`,

      // ─────────────────────────────────────────────────── oidc_clients
      `CREATE TABLE oidc_clients (
         id                         uuid PRIMARY KEY,
         product_id                 uuid,
         client_id                  text NOT NULL,
         client_secret_hash         text,
         name                       text NOT NULL,
         redirect_uris              text[] NOT NULL,
         post_logout_redirect_uris  text[] NOT NULL DEFAULT '{}',
         grant_types                text[] NOT NULL DEFAULT '{authorization_code,refresh_token}',
         require_pkce               boolean NOT NULL DEFAULT true,
         access_token_ttl_seconds   int NOT NULL DEFAULT 900,
         refresh_token_ttl_seconds  int NOT NULL DEFAULT 2592000,
         status                     text NOT NULL DEFAULT 'active',
         created_at                 timestamptz NOT NULL DEFAULT now(),
         updated_at                 timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT oidc_clients_status_chk CHECK (status IN ('active','disabled'))
       )`,
      `CREATE UNIQUE INDEX oidc_clients_client_id_unique ON oidc_clients (client_id)`,

      // ───────────────────────────── operational token tables (ERD §12.1)
      // Each stores a hash and carries used_at for single use.
      `CREATE TABLE password_reset_tokens (
         id          uuid PRIMARY KEY,
         user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         token_hash  text NOT NULL,
         expires_at  timestamptz NOT NULL,
         used_at     timestamptz,
         created_at  timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX password_reset_tokens_hash_idx ON password_reset_tokens (token_hash)`,

      `CREATE TABLE email_verification_tokens (
         id          uuid PRIMARY KEY,
         user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         email       citext NOT NULL,
         token_hash  text NOT NULL,
         expires_at  timestamptz NOT NULL,
         used_at     timestamptz,
         created_at  timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX email_verification_tokens_hash_idx ON email_verification_tokens (token_hash)`,

      `CREATE TABLE authorization_codes (
         id              uuid PRIMARY KEY,
         code_hash       text NOT NULL,
         client_id       text NOT NULL,
         user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         organization_id uuid,
         redirect_uri    text NOT NULL,
         code_challenge  text NOT NULL,
         scope           text,
         expires_at      timestamptz NOT NULL,
         used_at         timestamptz,
         created_at      timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX authorization_codes_hash_idx ON authorization_codes (code_hash)`,

      // ─────────────────────────────────────────── jwks_keys (ADR-004)
      `CREATE TABLE jwks_keys (
         kid                   text PRIMARY KEY,
         public_key            text NOT NULL,
         private_key_encrypted text NOT NULL,
         algorithm             text NOT NULL DEFAULT 'RS256',
         status                text NOT NULL DEFAULT 'active',
         activated_at          timestamptz NOT NULL DEFAULT now(),
         retires_at            timestamptz,
         CONSTRAINT jwks_keys_status_chk CHECK (status IN ('active','retiring','retired'))
       )`,
    ])
  },
}
