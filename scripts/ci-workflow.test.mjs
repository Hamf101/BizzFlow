import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
const packageJson = JSON.parse(readFileSync("package.json", "utf8"))

describe("CI workflow", () => {
  it("runs every step of the local quality gate, in the same order", () => {
    const gate = packageJson.scripts.check
      .split("&&")
      .map((step) => step.trim())
    const commands = getRunCommands(getJob("quality")).filter(
      (command) => command !== "pnpm install --frozen-lockfile"
    )

    expect(commands).toEqual(gate)
  })

  it("gives the tests no ambient credentials, only the build its example values", () => {
    const quality = getJob("quality")
    const build = getStep(quality, "Build")

    expect(quality.slice(0, quality.indexOf("steps:"))).not.toMatch(/\benv:/)

    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]) {
      expect(quality.split(`${name}:`), name).toHaveLength(2)
      expect(build, name).toContain(`${name}:`)
    }
  })

  it("builds the end-to-end app with the launcher that loads .env.e2e", () => {
    const commands = getRunCommands(getJob("e2e"))

    expect(commands).toContain("pnpm build:e2e")
    expect(commands).not.toContain("pnpm build")
  })

  it("does not state a migration count that goes stale", () => {
    expect(workflow).not.toMatch(/\b\d+ migrations\b/)
  })
})

function getJob(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`)

  if (start < 0) {
    throw new Error(`Missing CI job ${name}.`)
  }

  const rest = workflow.slice(start + 1)
  const next = rest.search(/\n {2}[a-z0-9_-]+:\n/)

  return next < 0 ? rest : rest.slice(0, next)
}

function getRunCommands(job) {
  return [...job.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1].trim())
}

function getStep(job, name) {
  const start = job.indexOf(`- name: ${name}\n`)

  if (start < 0) {
    throw new Error(`Missing CI step ${name}.`)
  }

  const next = job.indexOf("\n      - name:", start + 1)

  return next < 0 ? job.slice(start) : job.slice(start, next)
}
