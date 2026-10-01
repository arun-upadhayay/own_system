import { Skeleton } from '@cp/ui'

/**
 * Product launcher shell — the surface specified in
 * docs/design/07-product-launcher-ux.md.
 *
 * ADR-013 IS LOAD-BEARING HERE. This file contains no product name, slug, id,
 * icon or route, and it never will: the launcher fetches `GET /me/products` and
 * renders whatever the backend returns, with access state and `canOpen` computed
 * server-side (C5). Adding a product is a registration, not a release.
 *
 * Phase 1 therefore renders the grid frame with skeletons. The real tiles arrive
 * in Phase 11, once the registry (Phase 6) and entitlements (Phase 9) exist. The
 * Phase 11 acceptance test registers a FICTIONAL product and asserts it appears
 * here with no code change — which is the actual proof of ADR-013.
 */
export default function LauncherPage(): React.JSX.Element {
  return (
    <div>
      <h1 className="text-[length:var(--text-h1)] leading-[var(--leading-h1)] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
        Products
      </h1>
      <p className="mt-[var(--space-1)] text-[var(--text-secondary)]">
        Everything your organization can use.
      </p>

      {/* Grid frame. Skeletons match the final tile layout so there is no layout
          shift when real data arrives (05 §3.7). */}
      <section
        aria-label="Products"
        aria-busy="true"
        className="mt-[var(--space-6)] grid grid-cols-2 gap-[var(--space-4)] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[168px] w-full rounded-[var(--radius-lg)]" />
        ))}
      </section>
    </div>
  )
}
