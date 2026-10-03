import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Identity integration tests hash passwords (argon2) and hit Neon in us-east-2;
    // give them room. Pure-logic tests remain fast.
    testTimeout: 30_000,
    hookTimeout: 40_000,
    fileParallelism: false,
  },
})
