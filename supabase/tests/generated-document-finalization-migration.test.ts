import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const finalizationMigrationPath = getMigrationPath(
  "20260718070000_generated_document_finalizations.sql"
)

describe("Generated document finalization migration", () => {
  it("creates one tenant-scoped immutable finalization record per document", () => {
    const migrationSql = readFileSync(finalizationMigrationPath, "utf8")
    const tableSql = getTableDefinition(
      migrationSql,
      "generated_document_finalizations"
    )
    const normalizedTableSql = normalizeSql(tableSql)

    expect(tableSql).toContain("id uuid primary key")
    expect(tableSql).toContain("unique (document_id)")
    expect(tableSql).toContain("storage_key text not null unique")
    expect(tableSql).toContain("document_version_id uuid unique")
    expect(tableSql).toContain("foreign key (document_id, org_id)")
    expect(tableSql).toContain("references public.documents (id, org_id)")
    expect(tableSql).toContain(
      "foreign key (document_version_id, document_id)"
    )
    expect(tableSql).toContain(
      "references public.document_versions (id, document_id)"
    )
    expect(tableSql).toContain("status in ('pending', 'finalized')")
    expect(tableSql).toContain(
      "render_input_sha256 ~ '^[0-9a-f]{64}$'"
    )
    expect(tableSql).toContain("pdf_sha256 ~ '^[0-9a-f]{64}$'")
    expect(tableSql).toContain("byte_size is null or byte_size > 0")
    expect(normalizedTableSql).toContain(
      "'/finalizations/' || id::text || '/final.pdf'"
    )
    expect(tableSql).toContain("status = 'pending'")
    expect(tableSql).toContain("status = 'finalized'")
  })

  it("protects identity and finalized evidence while extending activity types", () => {
    const sql = normalizeSql(readFileSync(finalizationMigrationPath, "utf8"))

    expect(sql).toContain(
      "create trigger generated_document_finalizations_enforce_update before update on public.generated_document_finalizations"
    )
    expect(sql).toContain("if old.status = 'finalized' then")
    expect(sql).toContain(
      "generated document finalization identity is immutable."
    )
    expect(sql).toContain(
      "old.created_by is not null and new.created_by is null"
    )
    expect(sql).toContain(
      "old.finalized_by is not null and new.finalized_by is null"
    )
    expect(sql).not.toContain("and finalized_by is not null")
    expect(sql).toContain(
      "drop constraint document_activity_events_type_check"
    )
    expect(sql).toContain("'document.finalized'")
  })

  it("forces tenant RLS and keeps all direct writes server-only", () => {
    const migrationSql = readFileSync(finalizationMigrationPath, "utf8")
    const sql = normalizeSql(migrationSql)

    expect(sql).toContain(
      "alter table public.generated_document_finalizations enable row level security"
    )
    expect(sql).toContain(
      "alter table public.generated_document_finalizations force row level security"
    )
    expect(sql).toContain(
      "create policy generated_document_finalizations_select_member on public.generated_document_finalizations for select to authenticated using ((select public.is_organization_member(org_id)))"
    )
    expect(sql).toContain(
      "revoke all on table public.generated_document_finalizations from anon, authenticated, service_role"
    )
    expect(sql).toContain(
      "grant select on table public.generated_document_finalizations to authenticated"
    )
    expect(sql).toContain(
      "grant select, insert, update on table public.generated_document_finalizations to service_role"
    )
    expect(sql).not.toContain(
      "grant select, insert, update, delete on table public.generated_document_finalizations"
    )
    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, [
        "generated_document_finalizations",
      ])
    ).toEqual([])
  })

  it("prepares only completed active generated documents and joins safe races", () => {
    const sql = normalizeSql(readFileSync(finalizationMigrationPath, "utf8"))
    const answerLock = sql.indexOf(
      "from public.document_answers answer where answer.document_id = target_document_id and answer.org_id = target_org_id for update"
    )
    const documentLock = sql.indexOf(
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update",
      answerLock
    )
    const insert = sql.indexOf(
      "insert into public.generated_document_finalizations",
      documentLock
    )

    expect(sql).toContain(
      "create or replace function public.prepare_generated_document_finalization( target_org_id uuid, target_document_id uuid, target_finalization_id uuid, target_storage_key text, target_render_input_sha256 text, target_created_by uuid ) returns table"
    )
    expect(answerLock).toBeGreaterThan(-1)
    expect(documentLock).toBeGreaterThan(answerLock)
    expect(insert).toBeGreaterThan(documentLock)
    expect(sql).toContain("if answer_status <> 'completed' then")
    expect(sql).toContain("document_source_kind <> 'generated'")
    expect(sql).toContain("if document_archived_at is not null then")
    expect(sql).toContain(
      "if target_storage_key is distinct from expected_storage_key then"
    )
    expect(sql).toContain("on conflict (document_id) do nothing")
    expect(sql).toContain(
      "if prepared_finalization.render_input_sha256 <> target_render_input_sha256 then"
    )
    expect(sql).not.toContain(
      "prepared_finalization.storage_key <> target_storage_key"
    )
  })

  it("promotes bytes, version history, current state, and audit atomically", () => {
    const sql = normalizeSql(readFileSync(finalizationMigrationPath, "utf8"))
    const promoteStart = sql.indexOf(
      "create or replace function public.promote_generated_document_finalization"
    )
    const promoteSql = sql.slice(promoteStart)
    const answerLock = promoteSql.indexOf(
      "from public.document_answers answer where answer.document_id = target_document_id and answer.org_id = target_org_id for update"
    )
    const documentLock = promoteSql.indexOf(
      "from public.documents document where document.id = target_document_id and document.org_id = target_org_id for update",
      answerLock
    )
    const finalizationLock = promoteSql.indexOf(
      "from public.generated_document_finalizations finalization where finalization.id = target_finalization_id and finalization.document_id = target_document_id and finalization.org_id = target_org_id for update",
      documentLock
    )
    const idempotentReturn = promoteSql.indexOf(
      "return locked_finalization.document_version_id"
    )
    const archivedRejection = promoteSql.indexOf(
      "if document_archived_at is not null then"
    )
    const activityInsert = promoteSql.indexOf(
      "insert into public.document_activity_events"
    )

    expect(answerLock).toBeGreaterThan(-1)
    expect(documentLock).toBeGreaterThan(answerLock)
    expect(finalizationLock).toBeGreaterThan(documentLock)
    expect(promoteSql).toContain(
      "if locked_finalization.status = 'finalized' then"
    )
    expect(idempotentReturn).toBeGreaterThan(finalizationLock)
    expect(archivedRejection).toBeGreaterThan(idempotentReturn)
    expect(idempotentReturn).toBeLessThan(activityInsert)
    expect(promoteSql).toContain("insert into public.document_versions")
    expect(promoteSql).toContain("'available'")
    expect(promoteSql).toContain("'application/pdf'")
    expect(promoteSql).toContain("checksum_sha256")
    expect(promoteSql).toContain("set current_version_id = created_version_id")
    expect(promoteSql).toContain("set status = 'finalized'")
    expect(promoteSql).toContain("'document.finalized'")
    expect(promoteSql).toContain("insert into public.audit_logs")
  })

  it("exposes finalization RPCs only to service role and reloads PostgREST", () => {
    const sql = normalizeSql(readFileSync(finalizationMigrationPath, "utf8"))

    expect(sql).not.toContain("security definer")
    expect(sql).toContain(
      "revoke all on function public.prepare_generated_document_finalization( uuid, uuid, uuid, text, text, uuid ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "revoke all on function public.promote_generated_document_finalization( uuid, uuid, uuid, text, bigint, text, uuid ) from public, anon, authenticated"
    )
    expect(sql).toContain(
      "grant execute on function public.prepare_generated_document_finalization( uuid, uuid, uuid, text, text, uuid ) to service_role"
    )
    expect(sql).toContain(
      "grant execute on function public.promote_generated_document_finalization( uuid, uuid, uuid, text, bigint, text, uuid ) to service_role"
    )
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
