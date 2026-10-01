import localFont from 'next/font/local'

/**
 * Self-hosted fonts — ADR-030.
 *
 * Self-hosting is REQUIRED, not preferred: the CSP in
 * docs/architecture/15-security-architecture.md §7.1 declares `font-src 'self'`,
 * so a Google Fonts request would be blocked by the platform's own security
 * policy. It also removes a third-party request from the critical path and the
 * layout shift that comes with it.
 *
 * One variable file per family covers the whole weight range, so the three weights
 * the system uses (400/500/600) need no extra requests.
 */

export const inter = localFont({
  src: [
    { path: './fonts/InterVariable.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/InterVariable-Italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
})

export const jetbrainsMono = localFont({
  src: [{ path: './fonts/JetBrainsMono.woff2', weight: '100 800', style: 'normal' }],
  variable: '--font-jetbrains',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
})
