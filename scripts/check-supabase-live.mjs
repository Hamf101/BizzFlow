import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const ENV_FILE = ".env.local"

const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWKS_URL",
]

export const TABLE_CHECKS = [
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
    select: "id,org_id,actor_user_id,action,target_type,target_id,metadata,seq,prev_hash,entry_hash,created_at",
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
  {
    name: "generated_document_finalizations",
    select:
      "id,org_id,document_id,status,storage_key,render_input_sha256,pdf_sha256,byte_size,document_version_id,created_at,finalized_at",
  },
  {
    name: "submissions",
    select:
      "id,org_id,title,template_id,template_revision,template_snapshot,values,status,revision,created_by,updated_by,submitted_by,assigned_to,assigned_by,created_at,updated_at,submitted_at,assigned_at",
  },
  {
    name: "submission_files",
    select:
      "id,org_id,submission_id,field_key,status,storage_key,original_filename,safe_filename,content_type,byte_size,expected_checksum_sha256,checksum_sha256,uploaded_by,superseded_by,created_at,updated_at,available_at,superseded_at,cleanup_after,storage_cleaned_at",
  },
  {
    name: "submission_comments",
    select: "id,org_id,submission_id,body,created_by,created_at",
  },
  {
    name: "submission_activity_events",
    select:
      "id,org_id,submission_id,actor_user_id,event_type,from_status,to_status,assignee_user_id,comment_id,submission_revision,created_at",
  },
  {
    name: "resource_purge_jobs",
    select:
      "id,org_id,root_resource_kind,root_resource_id,request_kind,status,attempt_count,max_attempts,available_at,last_error_code,requested_at,completed_at,failed_at",
  },
  {
    name: "resource_purge_members",
    select: "id,job_id,org_id,resource_kind,resource_id,depth",
  },
  {
    name: "resource_purge_objects",
    select:
      "id,job_id,org_id,object_kind,status,attempt_count,max_attempts,available_at,last_error_code,deleted_at,created_at,updated_at",
  },
  {
    name: "resource_purge_tombstones",
    select: "org_id,resource_kind,resource_id,root_job_id,purged_at",
  },
  {
    name: "resource_purge_receipts",
    select:
      "id,job_id,org_id,root_resource_kind,root_resource_id,request_kind,requested_by,object_count,document_count,folder_count,purged_at",
  },
]

export const RESOURCE_PURGE_SCHEMA_CONTRACT = {
  rpcName: "get_resource_purge_schema_contract",
  tableNames: [
    "resource_purge_jobs",
    "resource_purge_members",
    "resource_purge_objects",
    "resource_purge_tombstones",
    "resource_purge_receipts",
  ],
  functionNames: [
    "request_document_purge",
    "request_folder_purge",
    "enqueue_due_resource_purges",
    "lease_resource_purge_objects",
    "complete_resource_purge_object",
    "fail_resource_purge_object",
    "finalize_ready_resource_purges",
  ],
}

export const SERVICE_ROLE_RPC_CHECKS = [
  {
    name: "create_internal_submission_draft",
    args: {
      target_org_id: null,
      target_template_id: null,
      target_submission_id: null,
      target_title: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "save_internal_submission_draft",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "allocate_internal_submission_file",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_file_id: null,
      target_field_key: null,
      target_original_filename: null,
      target_safe_filename: null,
      target_content_type: null,
      target_byte_size: null,
      target_storage_key: null,
      target_expected_checksum_sha256: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "complete_internal_submission_file",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_storage_key: null,
      target_content_type: null,
      target_byte_size: null,
      target_checksum_sha256: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "supersede_internal_submission_file",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "record_internal_submission_file_upload_window",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_cleanup_after: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "mark_internal_submission_file_storage_cleaned",
    args: {
      target_file_id: null,
      target_storage_key: null,
    },
  },
  {
    name: "submit_internal_submission",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "assign_internal_submission",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_assignee_user_id: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "transition_internal_submission",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_transition: null,
      target_comment: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "create_internal_submission_comment",
    args: {
      target_org_id: null,
      target_submission_id: null,
      target_comment_id: null,
      target_body: null,
      target_actor_user_id: null,
    },
  },
  {
    name: "verify_audit_log_chain",
    args: {
      target_org_id: null,
    },
  },
]

const DRAWING_PROBE_DATA_URL = `data:image/png;base64,${"AAAA".repeat(5_000)}`

export const SERVICE_ROLE_READ_ONLY_RPC_CHECKS = [
  {
    name: "validate_internal_submission_values",
    args: {
      target_template_snapshot: {
        blocks: [{ fieldKey: "signature", type: "signature_field" }],
      },
      target_values: { signature: DRAWING_PROBE_DATA_URL },
    },
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

async function checkResourcePurgeSchema(env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { data, error, status, statusText } = await supabase.rpc(
    RESOURCE_PURGE_SCHEMA_CONTRACT.rpcName
  )

  if (error) {
    throw new Error(
      `${RESOURCE_PURGE_SCHEMA_CONTRACT.rpcName}: expected read-only schema contract success; received ${status ?? "n/a"} ${statusText ?? ""} ${error.code ?? "unknown"}`.trim()
    )
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `${RESOURCE_PURGE_SCHEMA_CONTRACT.rpcName}: expected an array response`
    )
  }

  const records = new Map(
    data.map((record) => [
      `${record.object_kind}:${record.object_name}`,
      record,
    ])
  )

  for (const tableName of RESOURCE_PURGE_SCHEMA_CONTRACT.tableNames) {
    const record = records.get(`table:${tableName}`)

    if (
      record?.present !== true ||
      record.rls_enabled !== true ||
      record.rls_forced !== true
    ) {
      throw new Error(
        `${tableName}: expected live table with enabled and forced RLS`
      )
    }
  }

  for (const functionName of RESOURCE_PURGE_SCHEMA_CONTRACT.functionNames) {
    const record = records.get(`function:${functionName}`)

    if (record?.present !== true) {
      throw new Error(`${functionName}: expected live purge function`)
    }
  }

  console.log("resource purge schema: tables, functions, and forced RLS OK")
}

async function checkServiceRoleRpcs(env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  for (const rpc of SERVICE_ROLE_RPC_CHECKS) {
    const { error, status, statusText } = await supabase.rpc(rpc.name, rpc.args)

    // Null arguments intentionally reach each function's validation guard without writing data.
    if (!error || error.code !== "22023") {
      throw new Error(
        `${rpc.name}: expected service-role validation code 22023; received ${status ?? "n/a"} ${statusText ?? ""} ${error?.code ?? "no-error"}`.trim()
      )
    }

    console.log(`${rpc.name}: service-role execute grant OK`)
  }

  for (const rpc of SERVICE_ROLE_READ_ONLY_RPC_CHECKS) {
    const { error, status, statusText } = await supabase.rpc(rpc.name, rpc.args)

    if (error) {
      throw new Error(
        `${rpc.name}: expected read-only contract success; received ${status ?? "n/a"} ${statusText ?? ""} ${error.code ?? "unknown"}`.trim()
      )
    }

    console.log(`${rpc.name}: service-role read-only contract OK`)
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
  await checkResourcePurgeSchema(env)
  await checkServiceRoleRpcs(env)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown Supabase check failure")
    process.exitCode = 1
  })
}
