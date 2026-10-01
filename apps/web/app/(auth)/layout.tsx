/** Unauthenticated identity flows — centred card, no app chrome. */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--surface-page)] p-[var(--space-4)]">
      <main id="main" className="w-full max-w-[400px]">
        {children}
      </main>
    </div>
  )
}
