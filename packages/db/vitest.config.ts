import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Neon is in us-east-2; round trips dominate. Give integration tests room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Transaction-rollback tests share one connection pool; run serially to keep
    // the rolled-back transactions from contending.
    fileParallelism: false,
  },
})
