import { NextResponse, type NextRequest } from 'next/server'

/**
 * CSP middleware — docs/architecture/15-security-architecture.md §7.1.
 *
 * This file exists because of design-review finding D-2. The original policy was
 * `default-src 'self'; script-src 'self'`, which would have had two consequences:
 *
 *   1. `script-src 'self'` forbids inline scripts, but Next.js App Router ALWAYS
 *      emits inline bootstrap and streaming-payload scripts. The application
 *      would not have hydrated at all — not degraded, non-functional.
 *
 *   2. `img-src` was undeclared and inherited `'self'`, so every product icon
 *      would have been blocked: `products.icon_url` is an absolute URL on an
 *      asset host (ADR-013). The launcher — the platform's front door — would
 *      have rendered as a grid of broken images, failing silently server-side and
 *      visible only in the browser console.
 *
 * A per-request nonce fixes the first; an explicit `img-src` fixes the second.
 *
 * 'strict-dynamic' lets nonce-trusted scripts load their own chunks. That is
 * STRONGER than a host allowlist, not weaker: paths cannot be enumerated and
 * abused, and it makes the policy robust to bundle-name changes. There is no
 * 'unsafe-inline' and no 'unsafe-eval' anywhere.
 */

const isProd = process.env.NODE_ENV === 'production'

/** Asset host for product icons (registry data). Same-origin in development. */
const assetHost = process.env.NEXT_PUBLIC_ASSET_HOST ?? ''
/** OIDC issuer: reachable for redirects and the token endpoint. */
const issuerOrigin = process.env.NEXT_PUBLIC_ISSUER_URL ?? ''

function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // 'strict-dynamic' is what allows Next's own chunk loading under a nonce.
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
    // Next injects inline <style> for critical CSS in some configurations (D-3).
    'style-src': ["'self'", `'nonce-${nonce}'`],
    // Inline <style> ELEMENTS still require the nonce — strict.
    'style-src-elem': ["'self'", `'nonce-${nonce}'`],
    /**
     * Inline style ATTRIBUTES are permitted — finding D-9.
     *
     * A nonce cannot cover a style attribute; per CSP only 'unsafe-inline' (or
     * 'unsafe-hashes') does. Two things in the approved design require them:
     *
     *   1. Product accent colours. `products.accent_color` arrives at RUNTIME from
     *      the registry and is applied as `style={{ '--product-accent': colour }}`
     *      (docs/design/04-color-system.md §5). ADR-013 forbids compiling product
     *      colours into the stylesheet, so there is no static alternative.
     *   2. Radix positions popovers, dialogs and tooltips with inline styles
     *      (ADR-020). This is not configurable.
     *
     * Scoped to `style-src-attr` rather than blanket `'unsafe-inline'` on
     * `style-src`, so inline <style> elements stay nonce-gated. CSS injection is
     * also a materially lower risk than script injection, and `script-src` remains
     * strict with no 'unsafe-inline' anywhere.
     */
    'style-src-attr': ["'unsafe-inline'"],
    // Self-hosted fonts only. Declared explicitly so nobody later "simplifies"
    // by adding a font CDN — which this policy would block (C6, ADR-030).
    'font-src': ["'self'"],
    // D-1: product icons are registry data on an asset host.
    'img-src': ["'self'", 'data:', ...(assetHost ? [assetHost] : [])],
    'connect-src': ["'self'", ...(issuerOrigin ? [issuerOrigin] : [])],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", ...(issuerOrigin ? [issuerOrigin] : [])],
  }

  if (isProd) {
    directives['upgrade-insecure-requests'] = []
  } else {
    // Next's dev server uses eval for HMR. Development only — never in the
    // production policy, which is what the CI check asserts.
    directives['script-src'] = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-eval'"]
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(' ')}` : key))
    .join('; ')
}

export function middleware(request: NextRequest): NextResponse {
  // 128 bits of CSPRNG entropy, base64. A predictable nonce is no protection at
  // all, so this must never be a counter or a hash of the request.
  const nonce = Buffer.from(crypto.randomUUID() + crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  // Next reads `x-nonce` from the request and applies it to the scripts it emits.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  response.headers.set('content-security-policy', csp)
  response.headers.set('x-content-type-options', 'nosniff')
  response.headers.set('x-frame-options', 'DENY')
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('cross-origin-opener-policy', 'same-origin')
  if (isProd) {
    response.headers.set(
      'strict-transport-security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  return response
}

export const config = {
  // Static assets and the font files do not need a nonce, and excluding them
  // avoids per-asset middleware cost.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.woff2$).*)'],
}
