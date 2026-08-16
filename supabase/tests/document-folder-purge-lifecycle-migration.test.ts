import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  directWriteActions,
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260729115742_document_folder_purge_lifecycle.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")
const sql = normalizeSql(migrationSql)

const serviceOnlyTables = [
  "resource_purge_objects",
  "resource_purge_members",
] as const
const ownerVisibleTables = [
  "resource_purge_jobs",
  "resource_purge_tombstones",
  "resource_purge_receipts",
] as const

describe("document and folder purge lifecycle migration", () => {
  it("creates a durable idempotent job, resource membership, and per-object outbox", () => {
    expect(sql).toContain("create table public.resource_purge_jobs")
    expect(sql).toContain("create table public.resource_purge_members")
    expect(sql).toContain("create table public.resource_purge_objects")
    expect(sql).toContain(
      "unique (org_id, root_resource_kind, root_resource_id)"
    )
    expect(sql).toContain(
      "unique (job_id, resource_kind, resource_id)"
    )
    expect(sql).toContain("unique (job_id, storage_key)")
    expect(sql).toContain(
      "root_resource_kind in ('document', 'folder')"
    )
    expect(sql).toContain(
      "request_kind in ('automatic', 'manual')"
    )
    expect(sql).toMatch(
      /status in \(\s*'queued',\s*'processing',\s*'retry_wait',\s*'completed',\s*'failed'\s*\)/
    )
    expect(sql).toMatch(
      /status in \(\s*'pending',\s*'processing',\s*'retry_wait',\s*'deleted',\s*'failed'\s*\)/
    )
    expect(sql).toContain("max_attempts smallint not null default 5")
    expect(sql).toContain("storage_key text not null")
  })

  it("keeps raw object keys service-role-only while exposing safe failure state to owners", () => {
    for (const tableName of [...serviceOnlyTables, ...ownerVisibleTables]) {
      expect(sql).toContain(
        `alter table public.${tableName} enable row level security`
      )
      expect(sql).toContain(
        `alter table public.${tableName} force row level security`
      )
      expect(sql).toContain(
        `grant select, insert, update, delete on table public.${tableName} to service_role`
      )
    }

    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, [
        ...serviceOnlyTables,
        ...ownerVisibleTables,
      ])
    ).toEqual([])

    for (const tableName of serviceOnlyTables) {
      expect(sql).not.toMatch(
        new RegExp(
          `grant select on table public\\.${tableName} to authenticated`
        )
      )
      expect(sql).not.toMatch(
        new RegExp(`create policy [^;]+ on public\\.${tableName}`)
      )
    }

    for (const tableName of ownerVisibleTables) {
      expect(sql).toContain(
        `grant select on table public.${tableName} to authenticated`
      )
      expect(sql).toMatch(
        new RegExp(
          `create policy ${tableName}_select_owner on public\\.${tableName} for select to authenticated`
        )
      )
      expect(sql).toContain(
        "(select public.organization_role_for(org_id)) = 'owner_admin'"
      )
    }

    for (const tableName of [
      ...serviceOnlyTables,
      ...ownerVisibleTables,
    ]) {
      for (const action of directWriteActions) {
        expect(sql).not.toMatch(
          new RegExp(
            `create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`
          )
        )
      }
    }
  })

  it("queues manual document purge only for the creator or owner with exact confirmation", () => {
    expect(sql).toContain(
      "create or replace function public.request_document_purge"
    )
    expect(sql).toContain("target_confirmation_title text")
    expect(sql).toContain(
      "target_confirmation_title is distinct from locked_document.title"
    )
    expect(sql).toContain(
      "locked_document.created_by is distinct from target_actor_user_id"
    )
    expect(sql).toContain("actor_role <> 'owner_admin'")
    expect(sql).toContain("private.document_requires_retention")
    expect(sql).toContain(
      "only an organization owner may purge a retention-protected document"
    )
    expect(sql).toContain("lifecycle_state = 'purge_pending'")
  })

  it("queues folder purge with exact name confirmation and a locked physical subtree", () => {
    expect(sql).toContain(
      "create or replace function public.request_folder_purge"
    )
    expect(sql).toContain("target_confirmation_name text")
    expect(sql).toContain(
      "target_confirmation_name is distinct from locked_folder.name"
    )
    expect(sql).toContain("with recursive physical_subtree")
    expect(sql).toContain("for update")
    expect(sql).toContain("folder_depth")
    expect(sql).toContain("resource_kind, resource_id, depth")
    expect(sql).toContain(
      "folder subtree contains a document that requires retention"
    )
  })

  it("automatically queues only due ordinary trash after rechecking retention", () => {
    expect(sql).toContain(
      "create or replace function public.enqueue_due_resource_purges"
    )
    expect(sql).toContain("document.purge_after <= now()")
    expect(sql).toContain("folder.purge_after <= now()")
    expect(sql).toContain("document.lifecycle_state = 'trashed'")
    expect(sql).toContain("folder.lifecycle_state = 'trashed'")
    expect(sql).toMatch(
      /not private\.document_requires_retention\(\s*document\.org_id,\s*document\.id\s*\)/
    )
    expect(sql).toContain("answer.workflow_status = 'completed'")
    expect(sql).toContain("recipient.status = 'signed'")
    expect(sql).toContain("finalization.status = 'finalized'")
    expect(sql).toContain("'automatic'")
    expect(sql).toContain("interval '30 days'")
  })

  it("leases bounded object batches with skip-locked retries and capped backoff", () => {
    expect(sql).toContain(
      "create or replace function public.lease_resource_purge_objects"
    )
    expect(sql).toContain("target_limit between 1 and 100")
    expect(sql).toContain("target_lease_seconds between 15 and 600")
    expect(sql).toContain("for update skip locked")
    expect(sql).toContain("lease_expires_at")
    expect(sql).toContain("attempt_count = object_row.attempt_count + 1")
    expect(sql).toContain(
      "create or replace function public.fail_resource_purge_object"
    )
    expect(sql).toMatch(/least\(\s*interval '6 hours'/)
    expect(sql).toMatch(/power\(\s*2::numeric/)
    expect(sql).toContain(
      "object_row.attempt_count >= object_row.max_attempts"
    )
    expect(sql).toContain("last_error_code")
  })

  it("deduplicates R2 keys and finalizes database rows only after every object is deleted", () => {
    expect(sql).toContain("select distinct")
    expect(sql).toContain("document_versions")
    expect(sql).toContain("generated_document_finalizations")
    expect(sql).toContain(
      "create or replace function public.complete_resource_purge_object"
    )
    expect(sql).toContain(
      "create or replace function public.finalize_ready_resource_purges"
    )
    expect(sql).toContain("object.status <> 'deleted'")
    expect(sql).toContain("delete from public.documents")
    expect(sql).toContain("order by member.depth desc")
    expect(sql).toContain("delete from public.folders")
  })

  it("writes content-free immutable tombstones and chained audit receipts after finalization", () => {
    expect(sql).toContain("create table public.resource_purge_tombstones")
    expect(sql).toContain("create table public.resource_purge_receipts")
    for (const tableName of [
      "resource_purge_tombstones",
      "resource_purge_receipts",
    ]) {
      expect(normalizeSql(getTableDefinition(migrationSql, tableName))).not.toMatch(
        /\b(title|name|storage_key|content|filename)\b/
      )
    }
    expect(sql).toContain(
      "create or replace function private.prevent_resource_purge_evidence_mutation"
    )
    expect(sql).toContain(
      "resource_purge_tombstones_immutable"
    )
    expect(sql).toContain("resource_purge_receipts_immutable")
    expect(sql).toContain("'document.purged'")
    expect(sql).toContain("'folder.purged'")
    expect(sql).toContain("insert into public.audit_logs")
    expect(sql).toContain("'receiptid'")
  })

  it("keeps failed resources purge-pending and grants only service-role execution", () => {
    expect(sql).toContain(
      "lifecycle_state = 'purge_pending'"
    )
    expect(sql).not.toMatch(
      /fail_resource_purge_object[\s\S]*?lifecycle_state\s*=\s*'trashed'/
    )

    for (const functionSignature of [
      "public.request_document_purge(uuid, uuid, uuid, text, uuid)",
      "public.request_folder_purge(uuid, uuid, uuid, text, uuid)",
      "public.enqueue_due_resource_purges(integer)",
      "public.lease_resource_purge_objects(integer, integer)",
      "public.complete_resource_purge_object(uuid, uuid)",
      "public.fail_resource_purge_object(uuid, uuid, text)",
      "public.finalize_ready_resource_purges(integer)",
    ]) {
      expect(sql).toContain(
        `revoke execute on function ${functionSignature} from public, anon, authenticated, service_role`
      )
      expect(sql).toContain(
        `grant execute on function ${functionSignature} to service_role`
      )
    }
  })

  it("exposes only a service-role read-only live schema contract", () => {
    expect(sql).toContain(
      "create or replace function public.get_resource_purge_schema_contract()"
    )
    expect(sql).toContain("relation.relrowsecurity")
    expect(sql).toContain("relation.relforcerowsecurity")
    expect(sql).toContain("pg_catalog.to_regprocedure")
    expect(sql).toContain(
      "revoke execute on function public.get_resource_purge_schema_contract() from public, anon, authenticated, service_role"
    )
    expect(sql).toContain(
      "grant execute on function public.get_resource_purge_schema_contract() to service_role"
    )
  })

  it("reloads the PostgREST schema cache", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
