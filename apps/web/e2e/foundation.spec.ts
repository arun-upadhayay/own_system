import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * Phase 1 acceptance, verified end to end against a production build.
 *
 * Every assertion here maps to a checkbox in
 * docs/architecture/19-implementation-plan.md Phase 1.
 */

test.describe('CSP (verifies design finding D-2)', () => {
  test('serves a nonce-based policy with no unsafe-inline', async ({ page }) => {
    const response = await page.goto('/')
    const csp = response?.headers()['content-security-policy'] ?? ''

    const directive = (name: string) =>
      csp
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `) || d === name) ?? ''

    expect(csp).toContain("script-src 'self' 'nonce-")
    expect(csp).toContain("'strict-dynamic'")

    // script-src must be strict: no unsafe-inline, no unsafe-eval in production.
    // This is where XSS lives, so it is asserted per directive rather than by a
    // blanket search over the whole policy.
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
    expect(directive('script-src')).not.toContain("'unsafe-eval'")

    // Inline <style> ELEMENTS stay nonce-gated.
    expect(directive('style-src')).not.toContain("'unsafe-inline'")
    expect(directive('style-src-elem')).not.toContain("'unsafe-inline'")

    // Inline style ATTRIBUTES are permitted, and only here — finding D-9. Required
    // by runtime product accent colours (ADR-013, which forbids compiling product
    // colours in) and by Radix overlay positioning (ADR-020).
    expect(directive('style-src-attr')).toBe("style-src-attr 'unsafe-inline'")

    // D-1: product icons are registry data on an asset host. Without an explicit
    // img-src the launcher would render as a grid of broken images.
    expect(csp).toContain('img-src')
    expect(csp).toContain('data:')

    // D-3: declared explicitly so nobody later adds a font CDN, which this
    // policy would block.
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain('style-src')

    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  test('the application hydrates under that policy — no CSP violations', async ({ page }) => {
    // This is the whole point of D-2: the original policy would have blocked
    // Next.js's inline bootstrap scripts and the app would never have hydrated.
    const violations: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      if (/content security policy|refused to (execute|load|apply)/i.test(text)) {
        violations.push(text)
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // A client component responding to input proves hydration actually happened.
    const toggle = page.getByTestId('theme-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)

    expect(violations, `CSP violations:\n${violations.join('\n')}`).toHaveLength(0)
  })

  test('issues a different nonce per request', async ({ page }) => {
    const first = (await page.goto('/'))?.headers()['content-security-policy'] ?? ''
    const second = (await page.goto('/welcome'))?.headers()['content-security-policy'] ?? ''
    const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1]

    expect(nonceOf(first)).toBeTruthy()
    expect(nonceOf(first)).not.toBe(nonceOf(second))
  })
})

test.describe('self-hosted fonts (ADR-030)', () => {
  test('loads woff2 from our own origin, never a third party', async ({ page }) => {
    const fontRequests: string[] = []
    page.on('request', (req) => {
      if (req.resourceType() === 'font') fontRequests.push(req.url())
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    expect(fontRequests.length).toBeGreaterThan(0)
    for (const url of fontRequests) {
      expect(url).toContain('127.0.0.1:3001')
      expect(url).not.toContain('fonts.googleapis.com')
      expect(url).not.toContain('fonts.gstatic.com')
    }
  })

  test('applies the Inter variable to the document', async ({ page }) => {
    await page.goto('/')
    const family = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue('font-family'),
    )
    expect(family.toLowerCase()).toContain('inter')
  })
})

test.describe('light/dark tokens', () => {
  test('surface colour actually changes between themes', async ({ page }) => {
    await page.goto('/')
    const bg = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor)

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    const light = await bg()

    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    const dark = await bg()

    expect(light).not.toBe(dark)
    // The dark page token is #0B0D12.
    expect(dark).toBe('rgb(11, 13, 18)')
  })

  test('an explicit light choice beats OS dark', async ({ browser }) => {
    // The :not([data-theme="light"]) guard in the media query exists for this.
    const context = await browser.newContext({ colorScheme: 'dark' })
    const page = await context.newPage()
    await page.goto('/')
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).toBe('rgb(247, 248, 250)') // light page token
    await context.close()
  })
})

test.describe('no hardcoded products (ADR-013)', () => {
  test('the launcher shell names no product', async ({ page }) => {
    await page.goto('/')
    const html = (await page.content()).toLowerCase()

    // Products are rows in the `products` table. The shell must contain none of
    // them — adding a product is a registration, not a release.
    for (const slug of ['pos', 'inventory', 'kds', 'crm', 'analytics']) {
      expect(html).not.toContain(`>${slug}<`)
      expect(html).not.toContain(`"/${slug}"`)
      expect(html).not.toContain(`product-${slug}`)
    }

    // The grid frame exists and is marked busy; tiles arrive from the backend.
    await expect(page.getByRole('region', { name: 'Products' })).toBeVisible()
  })
})

test.describe('accessibility (WCAG 2.1 AA)', () => {
  for (const path of ['/', '/welcome', '/login', '/admin']) {
    test(`no axe violations: ${path}`, async ({ page }) => {
      await page.goto(path)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })

    test(`no axe violations in dark mode: ${path}`, async ({ page }) => {
      await page.goto(path)
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'dark'
      })
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }

  test('a skip link is the first focusable element (WCAG 2.4.1)', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  })

  test('focus is visible via outline, which survives High Contrast', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('theme-toggle').focus()
    const outline = await page
      .getByTestId('theme-toggle')
      .evaluate((el) => getComputedStyle(el).outlineWidth)
    expect(outline).not.toBe('0px')
  })
})

test.describe('responsive (docs/design/09)', () => {
  test('no horizontal page scroll at 320px (WCAG 1.4.10 reflow)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/')
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows).toBe(false)
  })
})

test.describe('security headers (15 §7)', () => {
  test('sets the hardening headers', async ({ page }) => {
    const headers = (await page.goto('/'))?.headers() ?? {}
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
  })
})

test.describe('web tier health', () => {
  test('/api/health responds without touching the API', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', tier: 'web' })
  })
})
