import type { Kysely } from 'kysely'
import { run } from './helpers.js'

/**
 * 0013 — v_organization_products (ERD §8), the launcher's single source of access
 * state. Carries the review R-6 corrections: the `expired` state is reachable (a
 * LATERAL join selects the most relevant subscription, not only a live one), a
 * lapsed trial reports `expired` not `not_subscribed`, and product visibility is
 * honored.
 *
 * security_invoker = true is essential: without it the view would run with the
 * definer's rights and bypass the base tables' RLS (0015), silently undoing tenant
 * isolation for anything that queried through the view.
 */
export const m0013_views = {
  async up(db: Kysely<unknown>): Promise<void> {
    await run(db, [
      `CREATE VIEW v_organization_products
       WITH (security_invoker = true) AS
       SELECT
         o.id  AS organization_id,
         p.id  AS product_id,
         p.slug,
         s.id  AS subscription_id,
         s.plan_id,
         CASE
           WHEN o.status <> 'active'                 THEN 'org_inactive'
           WHEN s.id IS NULL                         THEN 'not_subscribed'
           WHEN s.status = 'suspended'               THEN 'suspended'
           WHEN s.status = 'trialing'
            AND s.trial_ends_at > now()              THEN 'trialing'
           WHEN s.status = 'trialing'                THEN 'expired'
           WHEN s.status IN ('active','past_due')    THEN 'active'
           WHEN s.status IN ('expired','cancelled')  THEN 'expired'
           ELSE 'not_subscribed'
         END AS access_state,
         (s.status = 'past_due') AS payment_attention_required,
         s.trial_ends_at,
         s.current_period_end
       FROM organizations o
       CROSS JOIN products p
       LEFT JOIN LATERAL (
         SELECT sub.*
         FROM subscriptions sub
         WHERE sub.organization_id = o.id
           AND sub.product_id = p.id
         ORDER BY
           (sub.status IN ('trialing','active','past_due','suspended')) DESC,
           sub.created_at DESC
         LIMIT 1
       ) s ON true
       WHERE o.deleted_at IS NULL
         AND p.deleted_at IS NULL
         AND p.status <> 'retired'
         AND (
               p.visibility = 'public'
            OR (p.visibility = 'private' AND s.id IS NOT NULL)
             )`,
    ])
  },
}
