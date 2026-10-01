/**
 * Company console dashboard shell — docs/design/08-admin-console-ux.md §3.
 *
 * Phase 1 is the frame. The real dashboard leads with an ATTENTION LIST (§3.1)
 * because a dashboard nobody acts on is decoration; that needs subscriptions,
 * usage and the event pipeline, so it lands in Phase 14.
 */
export default function AdminDashboardPage(): React.JSX.Element {
  return (
    <div>
      <h1 className="text-[length:var(--text-h1)] leading-[var(--leading-h1)] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">
        Dashboard
      </h1>
      <p className="mt-[var(--space-1)] text-[var(--text-secondary)]">
        Platform health and commercial state.
      </p>
    </div>
  )
}
