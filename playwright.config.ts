import { defineConfig, devices } from "@playwright/test"

import { loadE2eEnvFile } from "./e2e/support/env-file"

loadE2eEnvFile()

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./e2e",
  // A pilot journey crosses several server actions and an R2 round trip; the
  // stock 30s expect timeout is tight enough to flake on a cold route.
  expect: { timeout: 15_000 },
  timeout: 90_000,
  // Specs share one seeded tenant, so a spec that leaves a document archived
  // would otherwise corrupt its neighbours. Each spec creates its own records
  // and asserts only on those, which is what makes parallel execution safe.
  fullyParallel: true,
  // Never let a `test.only` slip into main.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    // Traces are the only way to debug a CI-only failure after the fact, and
    // retaining on first retry keeps the artifact small on green runs.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
      testMatch: /.*\.spec\.ts/,
    },
    {
      // The product is mobile-first, and the pilots work from phones. Running
      // the same specs at 390px is what stops a desktop-only regression from
      // shipping — a tap target that vanishes under a collapsed sidebar fails
      // here and nowhere else.
      name: "mobile-chrome",
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"] },
      testMatch: /.*\.spec\.ts/,
    },
  ],
  webServer: {
    // `next start`, not `next dev`: dev compiles each route on first request,
    // which reads as a 20s hang and times specs out on a cold cache.
    command: "corepack pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
