import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0012 — operational tables (ERD §12). outbox_events (ADR-009) and
 * rate_limit_counters (ADR-008).
 *
 * The outbox is written in the SAME transaction as the state change it describes,
 * so the event exists if and only if the change happened. `dead` is a terminal
 * state after exhausting retries — a non-empty dead set must alert, which the
 * partial index makes cheap to detect.
 */
export const m0012_operational = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `CREATE TABLE outbox_events (
         id              uuid PRIMARY KEY,
         event_type      text NOT NULL,
         event_version   int NOT NULL DEFAULT 1,
         organization_id uuid,
         aggregate_type  text NOT NULL,
         aggregate_id    uuid NOT NULL,
         payload         jsonb NOT NULL,
         status          text NOT NULL DEFAULT 'pending',
         attempts        int NOT NULL DEFAULT 0,
         next_attempt_at timestamptz NOT NULL DEFAULT now(),
         last_error      text,
         dispatched_at   timestamptz,
         correlation_id  uuid,
         created_at      timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT outbox_status_chk CHECK (status IN ('pending','dispatched','failed','dead'))
       )`,
      `CREATE INDEX outbox_pending_idx
         ON outbox_events (next_attempt_at) WHERE status IN ('pending','failed')`,
      `CREATE INDEX outbox_dead_idx ON outbox_events (created_at) WHERE status = 'dead'`,

      // Rate limiting in Postgres initially (ADR-008), behind an interface so it
      // can move to Redis without touching call sites.
      `CREATE TABLE rate_limit_counters (
         key          text NOT NULL,
         window_start timestamptz NOT NULL,
         count        int NOT NULL DEFAULT 0,
         PRIMARY KEY (key, window_start)
       )`,
    ])
  },
}
