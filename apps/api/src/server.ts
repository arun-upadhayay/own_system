/**
 * Entrypoint. Graceful shutdown is required by
 * docs/architecture/17-deployment-architecture.md §7.1: without it a rolling
 * deploy kills requests mid-transaction and customers see errors from a
 * successful deployment.
 */

import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const env = loadConfig() // exits non-zero on invalid config
const app = await buildApp(env)

const SHUTDOWN_TIMEOUT_MS = 30_000

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown requested')
  const timer = setTimeout(() => {
    app.log.error('graceful shutdown timed out; forcing exit')
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)
  timer.unref()

  try {
    await app.close() // stops accepting, drains in-flight requests
    app.log.info('shutdown complete')
    process.exit(0)
  } catch (err) {
    app.log.error({ err }, 'error during shutdown')
    process.exit(1)
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal))
}

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'unhandled rejection')
  process.exit(1)
})

try {
  await app.listen({ port: env.PORT, host: env.HOST })
} catch (err) {
  app.log.error({ err }, 'failed to start')
  process.exit(1)
}
