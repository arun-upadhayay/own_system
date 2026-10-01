/**
 * Company console shell — a SEPARATE ROUTE GROUP, which is how C7 is satisfied:
 * a customer session must never download cross-tenant administration code. Not as
 * a security control (authorization is server-side regardless), but because
 * shipping the admin surface to every customer invites probing.
 *
 * Route-group separation gives Next its own bundle boundary, replacing the
 * lazy-import approach HLD §8 originally described (ADR-019).
 */
export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-[var(--surface-page)]" data-density="compact">
      <header className="flex h-[var(--header-height)] items-center border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-4)]">
        <span className="font-semibold text-[var(--text-primary)]">
          Control Plane{' '}
          <span className="font-normal text-[var(--text-muted)]">· Internal</span>
        </span>
      </header>
      <main id="main" className="mx-auto max-w-[var(--container-max)] p-[var(--space-6)]">
        {children}
      </main>
    </div>
  )
}
