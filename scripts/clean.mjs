#!/usr/bin/env node
// Deletes the Next.js build cache (.next, several GB after a few weeks of dev).
// The target is fixed and resolved from this file, never from arguments or the
// working directory, so it cannot be pointed anywhere else. A running dev
// server is refused, and a symlink is never followed.
import { lstatSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const target = fileURLToPath(new URL("../.next", import.meta.url))

let stats
try {
  stats = lstatSync(target)
} catch {
  console.log("Nothing to clean.")
  process.exit(0)
}
if (!stats.isDirectory()) {
  throw new Error(`Refusing to remove ${target}: it is not a plain directory.`)
}

try {
  const { pid, port } = JSON.parse(readFileSync(`${target}/dev/lock`, "utf8"))
  process.kill(pid, 0) // throws when that process is gone (a stale lock)
  throw new Error(`A dev server (pid ${pid}, port ${port}) is using .next. Stop it first.`)
} catch (error) {
  // ENOENT: no lock. ESRCH: stale lock. Anything else must stop the clean.
  if (!["ENOENT", "ESRCH"].includes(error.code) && !(error instanceof SyntaxError)) {
    throw error
  }
}

rmSync(target, { recursive: true, force: true })
console.log("Removed .next.")
