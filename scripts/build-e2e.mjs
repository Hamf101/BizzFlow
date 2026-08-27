#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const environmentPath = resolve(process.cwd(), ".env.e2e")

if (!existsSync(environmentPath)) {
  throw new Error(
    "Missing .env.e2e. Start the local stack with `pnpm e2e:up` first."
  )
}

// Loading the file in this launcher keeps `--env-file` out of Next.js worker
// exec arguments while still making the local storage origin available when
// the production CSP is compiled.
process.loadEnvFile(environmentPath)

const nextBinary = resolve(process.cwd(), "node_modules/next/dist/bin/next")
const result = spawnSync(process.execPath, [nextBinary, "build"], {
  env: process.env,
  stdio: "inherit",
})

if (result.error) {
  throw new Error("Unable to start the E2E production build.", {
    cause: result.error,
  })
}

process.exitCode = result.status ?? 1
