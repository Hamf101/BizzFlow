import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // A test that makes no assertion fails instead of passing silently.
    expect: { requireAssertions: true },
    // e2e/ holds Playwright specs. They use the same `.spec.ts` suffix but a
    // different runner, and Vitest importing them throws on test.describe.
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/.next/**",
      // artifacts/ is local-only scratch: audits keep throwaway reproductions
      // there, and they go stale the moment the bug they reproduce is fixed.
      "artifacts/**",
      "e2e/**",
    ],
  },
})
