import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Sign in' }

/**
 * Sign-in placeholder. The real flow is Phase 3 (identity), and it must satisfy
 * docs/architecture/06-identity-and-sso.md §3: ONE GENERIC 401 for every failure
 * — wrong password, unknown email, unverified, suspended, locked — with timing
 * equalised, so the endpoint is not an account-existence oracle.
 *
 * No form is rendered yet rather than a non-functional one, because a login form
 * that appears to work and does not is worse than an honest placeholder.
 */
export default function LoginPage(): React.JSX.Element {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-6)]">
      <h1 className="text-[length:var(--text-h2)] leading-[var(--leading-h2)] font-semibold text-[var(--text-primary)]">
        Sign in
      </h1>
      <p className="mt-[var(--space-2)] text-[var(--text-secondary)]">
        Central authentication arrives in Phase 3.
      </p>
    </div>
  )
}
