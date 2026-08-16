// Verifies every organization's audit-log hash chain against the live
// database. Exits non-zero when any chain fails, so ops/CI can alert.
//
// Usage: node scripts/verify-audit-chain.mjs  (reads .env.local like the
// other Supabase check scripts; requires SUPABASE_URL + SUPABASE_SECRET_KEY.)

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const ENV_FILE = ".env.local"
const REQUIRED_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]

function readEnvFile() {
  if (!existsSync(ENV_FILE)) {
    return {}
  }

  return Object.fromEntries(
    readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")])
  )
}

function loadEnv() {
  const fileEnv = readEnvFile()

  return {
    ...fileEnv,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined)
    ),
  }
}

async function main() {
  const env = loadEnv()
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !env[key])

  if (missingKeys.length > 0) {
    throw new Error(`Missing required Supabase env keys: ${missingKeys.join(", ")}`)
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: organizations, error: organizationsError } = await supabase
    .from("organizations")
    .select("id,name")
    .order("created_at", { ascending: true })

  if (organizationsError) {
    throw new Error(`organizations: ${organizationsError.message}`)
  }

  let invalidCount = 0

  for (const organization of organizations ?? []) {
    const { data, error } = await supabase.rpc("verify_audit_log_chain", {
      target_org_id: organization.id,
    })

    if (error) {
      throw new Error(`${organization.id}: ${error.code ?? ""} ${error.message}`.trim())
    }

    const verdict = data?.[0]

    if (!verdict) {
      throw new Error(`${organization.id}: verification returned no verdict`)
    }

    if (verdict.valid) {
      console.log(
        `${organization.name} (${organization.id}): chain OK, ${verdict.checked_count} entries`
      )
    } else {
      invalidCount += 1
      console.error(
        `${organization.name} (${organization.id}): CHAIN INVALID at seq ${verdict.first_invalid_seq} (${verdict.failure_reason})`
      )
    }
  }

  if (invalidCount > 0) {
    throw new Error(`${invalidCount} organization audit chain(s) failed verification.`)
  }

  console.log("All organization audit chains verified.")
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown audit chain check failure")
    process.exitCode = 1
  })
}
