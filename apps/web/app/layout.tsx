import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { inter, jetbrainsMono } from './fonts'
import { ThemeScript } from './theme-script'
import './globals.css'

/**
 * Root layout.
 *
 * Deliberately a Server Component with no 'use client' (docs/design/11 §2.1): a
 * client boundary here would make the entire tree client-rendered and silently
 * defeat the server rendering that justified choosing Next.js at all (ADR-019).
 * A lint rule enforces the same thing for (public) layouts and pages.
 *
 * The platform is named generically — "Control Plane", not any product and not
 * "Restaurant Management System" (baseline §41). The ecosystem's products are
 * registry data; the shell knows none of them.
 */

export const metadata: Metadata = {
  title: {
    default: 'Control Plane',
    template: '%s · Control Plane',
  },
  description:
    'Central identity, organizations, products and subscriptions for the company product ecosystem.',
  robots: { index: false, follow: false }, // relaxed per-route for (public) pages
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom is never disabled: WCAG 1.4.4 requires 200% zoom without loss.
  maximumScale: 5,
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  // The nonce is set per request by middleware.ts; the theme script needs it so
  // it is covered by script-src rather than requiring 'unsafe-inline'.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    // The font variable classes go on <html>, not <body>. `--font-sans` is defined
    // on :root as `var(--font-inter), system-ui, …`; if `--font-inter` were only
    // defined on <body> it would be UNDEFINED at :root scope, making the whole
    // font-family declaration invalid and silently falling back to the browser
    // default. The e2e font test exists to catch exactly that regression.
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="antialiased">
        {/* Skip link, first in tab order — WCAG 2.4.1 */}
        <a
          href="#main"
          className="sr-only rounded-[var(--radius-md)] bg-[var(--action-primary)] px-[var(--space-4)] py-[var(--space-2)] text-[var(--text-on-primary)] focus:not-sr-only focus:absolute focus:top-[var(--space-2)] focus:left-[var(--space-2)] focus:z-[var(--z-palette)]"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
