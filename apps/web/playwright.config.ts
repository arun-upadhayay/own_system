import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright — ADR-029.
 *
 * Chosen over Cypress specifically for multi-origin and multi-tab support, which
 * the OIDC redirect flows in docs/architecture/20-testing-strategy.md §9 require.
 * The direct-product-URL journey crosses origins, and Cypress cannot drive it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The breakpoints that carry the responsive behaviour (docs/design/09 §11).
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'pnpm run start',
    url: 'http://127.0.0.1:3001/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      API_INTERNAL_URL: 'http://127.0.0.1:3000',
      SESSION_COOKIE_SECRET: 'test-secret-at-least-32-characters-long!',
      NEXT_PUBLIC_ISSUER_URL: 'http://127.0.0.1:3000',
      NEXT_PUBLIC_ASSET_HOST: 'http://127.0.0.1:3001',
    },
  },
})
