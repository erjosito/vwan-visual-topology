import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts', 'api/tests/**/*.test.ts', 'platform/**/*.test.ts', 'functions/user-cloud/**/*.test.ts'] },
})
