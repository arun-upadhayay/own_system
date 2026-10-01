import { ThemeToggle } from '@/components/theme-toggle'

/**
 * Authenticated app shell — docs/design/06-layout-and-navigation.md §1.
 *
 * Phase 1 renders the frame only. Navigation is generated from the caller's
 * resolved permissions (06 §3.1) and that arrives with RBAC in Phase 5; nothing
 * is hardcoded here in the meantime.
 *
 * `compact` density is the console/admin default, because scanning hundreds of
 * rows is the primary task (02 §2.1).
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-[var(--surface-page)]" data-density="compact">
      <header
        className="sticky top-0 flex h-[var(--header-height)] items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-4)]"
        style={{ zIndex: 'var(--z-header)' }}
      >
        <span className="font-semibold text-[var(--text-primary)]">Control Plane</span>
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto max-w-[var(--container-max)] p-[var(--space-6)]">
        {children}
      </main>
    </div>
  )
}
