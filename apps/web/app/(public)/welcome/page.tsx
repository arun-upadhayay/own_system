import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Products',
  robots: { index: true, follow: true },
}

/**
 * Public landing page at /welcome. Server-rendered.
 *
 * NOTE on routing: the launcher owns `/` (docs/design/07-product-launcher-ux.md),
 * so public content lives at its own paths. Two route groups cannot both own `/`.
 * The SEO-critical public surface is /products/[slug] — the discovery pages that
 * justified server rendering in ADR-019 — not this landing page.
 *
 * Phase 1 is foundation only: there is no product catalogue here because products
 * are rows in the `products` table (ADR-013) and the registry arrives in Phase 6.
 * Hardcoding even a placeholder product name would be the exact violation the
 * lint rule and the Phase 11 test exist to prevent.
 */
export default function WelcomePage(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-[var(--container-prose)] px-[var(--space-6)] py-[var(--space-16)]">
      <h1 className="text-[length:var(--text-display)] leading-[var(--leading-display)] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
        One account for every product
      </h1>
      <p className="mt-[var(--space-4)] text-[length:var(--text-body-lg)] leading-[var(--leading-body-lg)] text-[var(--text-secondary)]">
        Central identity, organizations and subscriptions for the whole product
        ecosystem. Sign in once and reach everything your organization uses.
      </p>
    </div>
  )
}
