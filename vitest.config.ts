import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // e2e/ holds Playwright specs. They use the same `.spec.ts` suffix but a
    // different runner, and Vitest importing them throws on test.describe.
    exclude: [
      "**/node_modules/**",
      "**/.claude/**",
      "**/.next/**",
      "e2e/**",
    ],
  },
})
