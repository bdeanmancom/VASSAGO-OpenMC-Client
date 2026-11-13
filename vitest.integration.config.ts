import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 400000,
    fileParallelism: false,
    pool: 'forks',
    globalSetup: ['tests/integration/global-setup.ts']
  }
})
