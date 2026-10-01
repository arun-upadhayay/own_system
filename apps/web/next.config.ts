import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ['@cp/ui', '@cp/core'],
  experimental: {
    // Product icons are registry data on an asset host; the CSP img-src and this
    // list must agree (15 §7.1, D-1). Configured per environment.
    optimizePackageImports: ['lucide-react'],
  },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true }, // lint runs as its own CI gate

  /**
   * Workspace packages are authored as proper Node ESM: relative imports carry
   * `.js` specifiers, which is what `verbatimModuleSyntax` and Node's ESM resolver
   * require, and what lets @cp/core run compiled in the API tier.
   *
   * Webpack does not apply that mapping by default, so it looks for a literal
   * `./lib/cn.js` next to a `cn.ts` and fails. Teaching the bundler the mapping is
   * the right fix; dropping the extensions would make the source incorrect for the
   * API tier, which runs the same packages as real ESM.
   */
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default config
