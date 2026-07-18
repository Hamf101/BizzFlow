import { existsSync, readFileSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"

const ENV_FILE = ".env.local"

const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWKS_URL",
]

const TABLE_CHECKS = [
  {
    name: "profiles",
    select: "id,email,full_name",
  },
  {
    name: "organizations",
    select: "id,name,slug,created_by,created_at,updated_at",
  },
  {
    name: "organization_memberships",
    select: "id,org_id,user_id,role,status,created_at,updated_at",
  },
  {
    name: "invites",
    select: "id,org_id,email,role,token,status,expires_at,created_at",
  },
  {
    name: "audit_logs",
    select: "id,org_id,actor_user_id,action,target_type,target_id,metadata,created_at",
  },
  {
    name: "folders",
    select: "id,org_id,parent_folder_id,name,archived_at,created_at,updated_at",
  },
  {
    name: "documents",
    select: "id,org_id,folder_id,title,current_version_id,source_kind,template_id,template_revision,archived_at,created_at,updated_at",
  },
  {
    name: "document_versions",
    select: "id,org_id,document_id,version_number,status,created_at,updated_at",
  },
  {
    name: "document_comments",
    select: "id,org_id,document_id,created_by,body,created_at",
  },
  {
    name: "document_activity_events",
    select: "id,org_id,document_id,actor_user_id,event_type,metadata,created_at",
  },
  {
    name: "document_templates",
    select: "id,org_id,title,status,revision,created_at,updated_at",
  },
  {
    name: "document_answers",
    select: "document_id,org_id,workflow_status,created_at,updated_at",
  },
  {
    name: "document_signing_recipients",
    select: "id,org_id,document_id,status,requires_signature,token_expires_at",
  },
  {
    name: "document_recent_accesses",
    select: "org_id,user_id,document_id,last_opened_at",
  },
]

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

async function checkJwks(jwksUrl) {
  const response = await fetch(jwksUrl)

  if (!response.ok) {
    throw new Error(`JWKS endpoint returned ${response.status} ${response.statusText}`)
  }

  console.log(`jwks: ${response.status} ${response.statusText}`)
}

async function checkTables(env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  for (const table of TABLE_CHECKS) {
    const { error, status, statusText } = await supabase
      .from(table.name)
      .select(table.select)
      .limit(1)

    if (error) {
      throw new Error(
        `${table.name}: ${status ?? "n/a"} ${statusText ?? ""} ${error.code ?? ""} ${error.message}`.trim()
      )
    }

    console.log(`${table.name}: ${status ?? "ok"} ${statusText ?? "OK"}`)
  }
}

async function main() {
  const env = loadEnv()
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !env[key])

  if (missingKeys.length > 0) {
    throw new Error(`Missing required Supabase env keys: ${missingKeys.join(", ")}`)
  }

  await checkJwks(env.SUPABASE_JWKS_URL)
  await checkTables(env)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown Supabase check failure")
  process.exitCode = 1
})
