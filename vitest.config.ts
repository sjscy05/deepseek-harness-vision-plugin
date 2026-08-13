import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: [fileURLToPath(new URL('../tsconfig.base.json', import.meta.url))] }),
  ],
  test: {
    include: ['tests/**/*.spec.ts'],
    // Forked workers match the repo-wide pool; Node 24 can abort in its CJS
    // lexer from worker threads.
    pool: 'forks',
  },
})
