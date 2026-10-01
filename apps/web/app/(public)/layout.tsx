/**
 * Public shell — no app chrome (docs/design/06-layout-and-navigation.md §8).
 *
 * This route group is SERVER-RENDERED and must stay that way: product discovery
 * pages are public, anonymous and SEO-relevant (baseline §14, §38), which is the
 * reason ADR-019 chose Next.js over a pure SPA. A 'use client' at this level would
 * defeat that, so a lint rule rejects one here.
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-[var(--surface-page)]">
      <header className="flex h-[var(--header-height)] items-center justify-between border-b border-[var(--border-default)] px-[var(--space-6)]">
        <span className="font-semibold text-[var(--text-primary)]">Control Plane</span>
      </header>
      <main id="main">{children}</main>
    </div>
  )
}
