// Sales demos: each e2e/demos/*.demo.ts walks one business job slowly, with
// captions, and is recorded to artifacts/demos/<test>/video.webm.
// Record:  PORT=3200 pnpm e2e:up && pnpm build:e2e && PORT=3200 pnpm demo:record --project=desktop
// Flow answers from e2e/demos/fixtures/ai-replay.json; record new answers from
// `pnpm dev` with AI_RECORD_FILE=<that file> and a real key.
import { resolve } from "node:path"

import { defineConfig, devices } from "@playwright/test"

import { findOutboundServices, loadE2eEnvFile } from "./e2e/support/env-file"

// Before the env file: a demo tenant, auth states of its own (e2e/support/paths.ts).
process.env.E2E_DEMO = "1"
loadE2eEnvFile()
const outboundRefusal = findOutboundServices()
const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3200}`
const size = { width: 1440, height: 900 }

export default defineConfig({
  testDir: "./e2e/demos",
  testMatch: /.*\.demo\.ts/,
  outputDir: "artifacts/demos",
  expect: { timeout: 15_000 },
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    launchOptions: { slowMo: 150 },
    video: { mode: "on", size },
  },
  projects: [
    // The suite's own setup, seeding "Northside Plumbing" because E2E_DEMO is set.
    { name: "setup", testDir: "./e2e", testMatch: /global\.setup\.ts/, use: { video: "off" } },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: size } },
    { name: "phone", dependencies: ["setup"], use: { ...devices["Pixel 7"], video: { mode: "on", size: devices["Pixel 7"].viewport } } },
  ],
  webServer: {
    command: outboundRefusal
      ? 'node -e "console.error(process.env.E2E_OUTBOUND_REFUSAL); process.exit(1)"'
      : "corepack pnpm start",
    env: outboundRefusal
      ? { E2E_OUTBOUND_REFUSAL: outboundRefusal }
      : { AI_PROVIDER: "replay", AI_REPLAY_FILE: resolve("e2e/demos/fixtures/ai-replay.json") },
    url: baseURL,
    // A server already running may not be answering from the replay file.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
