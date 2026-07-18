import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  directWriteActions,
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const internalSubmissionsMigrationPath = getMigrationPath(
  "20260718171349_sprint_7_internal_submissions.sql"
)
const submissionTables = ["submissions", "submission_files"] as const
const mutationRpcNames = [
  "create_internal_submission_draft",
  "save_internal_submission_draft",
  "allocate_internal_submission_file",
  "complete_internal_submission_file",
  "submit_internal_submission",
] as const

/**
 * Isolates one normalized function body from the migration source.
 *
 * @param sql - Normalized migration SQL.
 * @param functionName - Public function name to locate.
 * @returns The function declaration and body up to the next declaration.
 * @throws Error when the function is absent.
 */
function getFunctionSection(sql: string, functionName: string): string {
  const start = sql.indexOf(
    `create or replace function public.${functionName}(`
  )

  if (start === -1) {
    throw new Error(`Missing function public.${functionName}.`)
  }

  const nextFunction = sql.indexOf(
    " create or replace function public.",
    start + 1
  )

  return nextFunction === -1 ? sql.slice(start) : sql.slice(start, nextFunction)
}

describe("Sprint 7 internal submissions migration", () => {
  it("creates tenant-scoped submissions with immutable template snapshots", () => {
    const migrationSql = readFileSync(internalSubmissionsMigrationPath, "utf8")
    const submissionsSql = getTableDefinition(migrationSql, "submissions")
    const normalizedTableSql = normalizeSql(submissionsSql)
    const sql = normalizeSql(migrationSql)

    expect(normalizedTableSql).toContain("id uuid primary key")
    expect(normalizedTableSql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(normalizedTableSql).toContain("template_id uuid not null")
    expect(normalizedTableSql).toContain("template_revision integer not null")
    expect(normalizedTableSql).toContain("template_snapshot jsonb not null")
    expect(normalizedTableSql).toContain("values jsonb not null default '{}'::jsonb")
    expect(normalizedTableSql).toContain("unique (id, org_id)")
    expect(normalizedTableSql).toContain(
      "foreign key (template_id, org_id) references public.document_templates (id, org_id)"
    )
    expect(normalizedTableSql).toContain("jsonb_typeof(template_snapshot) = 'object'")
    expect(normalizedTableSql).toContain("template_snapshot ->> 'schemaversion' = '1'")
    expect(normalizedTableSql).toContain("jsonb_typeof(values) = 'object'")
    expect(normalizedTableSql).toContain("status in ('draft', 'submitted')")
    expect(normalizedTableSql).toContain("revision integer not null default 1")
    expect(normalizedTableSql).toContain("revision > 0")

    expect(sql).toMatch(
      /create trigger submissions_[a-z0-9_]+ before update[^;]*on public\.submissions/
    )
    expect(sql).toContain("template snapshot identity is immutable")
    expect(sql).toContain("submitted submissions are immutable")
    expect(sql).toContain("new.template_id is distinct from old.template_id")
    expect(sql).toContain(
      "new.template_revision is distinct from old.template_revision"
    )
    expect(sql).toContain(
      "new.template_snapshot is distinct from old.template_snapshot"
    )
  })

  it("creates create-only tenant file rows with exact storage identities", () => {
    const migrationSql = readFileSync(internalSubmissionsMigrationPath, "utf8")
    const filesSql = getTableDefinition(migrationSql, "submission_files")
    const sql = normalizeSql(filesSql)

    expect(sql).toContain("id uuid primary key")
    expect(sql).toContain(
      "org_id uuid not null references public.organizations (id) on delete cascade"
    )
    expect(sql).toContain("submission_id uuid not null")
    expect(sql).toContain("field_key text not null")
    expect(sql).toContain("storage_key text not null unique")
    expect(sql).toContain("original_filename text not null")
    expect(sql).toContain("safe_filename text not null")
    expect(sql).toContain("content_type text not null")
    expect(sql).toContain("byte_size bigint not null")
    expect(sql).toContain("checksum_sha256 text")
    expect(sql).toContain("available_at timestamptz")
    expect(sql).toContain("unique (id, org_id)")
    expect(sql).toContain("unique (submission_id, field_key)")
    expect(sql).toContain(
      "foreign key (submission_id, org_id) references public.submissions (id, org_id) on delete cascade"
    )
    expect(sql).toContain("status in ('upload_pending', 'available')")
    expect(sql).toContain(
      "checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'"
    )
    expect(sql).toContain(
      "status = 'upload_pending' and checksum_sha256 is null and available_at is null"
    )
    expect(sql).toContain("status = 'available' and available_at is not null")
    expect(sql).toContain(
      "storage_key = 'organizations/' || org_id::text || '/submissions/' || submission_id::text || '/files/' || field_key || '/' || id::text || '/' || safe_filename"
    )
  })

  it("adds listing indexes and indexes every foreign-key leading column", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )

    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(org_id, created_by, updated_at desc, id\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(org_id, status, updated_at desc, id\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(template_id, org_id\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(created_by\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(updated_by\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submissions \(submitted_by\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submission_files \(submission_id, org_id\)/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submission_files \(org_id(?:,|\))/
    )
    expect(sql).toMatch(
      /create index [a-z0-9_]+ on public\.submission_files \(uploaded_by\)/
    )
  })

  it("forces RLS and limits staff reads to their own submissions", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )

    submissionTables.forEach(
      (tableName: (typeof submissionTables)[number]): void => {
        expect(sql).toContain(
          `alter table public.${tableName} enable row level security`
        )
        expect(sql).toContain(
          `alter table public.${tableName} force row level security`
        )
        expect(sql).toMatch(
          new RegExp(
            `create policy [a-z0-9_]+ on public\\.${tableName} for select to authenticated using`
          )
        )
      }
    )

    expect(sql).toContain(
      "(select public.organization_role_for(org_id)) in ('owner_admin', 'manager')"
    )
    expect(sql).toContain(
      "create policy submissions_select_internal_member on public.submissions"
    )
    expect(sql).toContain(
      "create policy submission_files_select_internal_member on public.submission_files"
    )
    expect(sql).toContain(
      "(select public.organization_role_for(org_id)) = 'staff'"
    )
    expect(sql).toContain("created_by = (select auth.uid())")
    expect(sql).toContain("from public.submissions submission")
    expect(sql).toContain("submission.created_by = (select auth.uid())")
    expect(sql).not.toContain("external_reviewer")
  })

  it("exposes authenticated reads but keeps every direct mutation server-only", () => {
    const migrationSql = readFileSync(internalSubmissionsMigrationPath, "utf8")
    const sql = normalizeSql(migrationSql)

    submissionTables.forEach(
      (tableName: (typeof submissionTables)[number]): void => {
        expect(sql).toContain(
          `revoke all on table public.${tableName} from anon, authenticated, service_role`
        )
        expect(sql).toContain(
          `grant select on table public.${tableName} to authenticated`
        )
        expect(sql).toContain(
          `grant select, insert, update on table public.${tableName} to service_role`
        )

        directWriteActions.forEach(
          (action: (typeof directWriteActions)[number]): void => {
            expect(sql).not.toMatch(
              new RegExp(
                `create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`
              )
            )
          }
        )
      }
    )

    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, submissionTables)
    ).toEqual([])
    expect(sql).not.toMatch(
      /grant [^;]*delete[^;]* on table public\.(submissions|submission_files) to service_role/
    )
  })

  it("creates and saves creator-owned drafts from locked published templates", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )
    const createSql = getFunctionSection(
      sql,
      "create_internal_submission_draft"
    )
    const saveSql = getFunctionSection(sql, "save_internal_submission_draft")

    expect(createSql).toContain("from public.document_templates template")
    expect(createSql).toMatch(/for (share|update)/)
    expect(createSql).toContain("template.status = 'published'")
    expect(createSql).toContain("template.content")
    expect(createSql).toContain("insert into public.submissions")
    expect(createSql).toContain("template_snapshot")
    expect(createSql).toContain("'submission.created'")
    expect(createSql).toContain("insert into public.audit_logs")

    expect(saveSql).toContain("target_expected_revision integer")
    expect(saveSql).toContain("target_values jsonb")
    expect(saveSql).toContain("from public.submissions submission")
    expect(saveSql).toContain("for update")
    expect(saveSql).toContain("submission.created_by <> target_actor_user_id")
    expect(saveSql).toContain("submission.status <> 'draft'")
    expect(saveSql).toContain(
      "submission.revision <> target_expected_revision"
    )
    expect(saveSql).toContain("jsonb_typeof(target_values) <> 'object'")
    expect(saveSql).toContain("revision = submission.revision + 1")
  })

  it("allocates exact file fields and completes only locked pending uploads", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )
    const allocateSql = getFunctionSection(
      sql,
      "allocate_internal_submission_file"
    )
    const completeSql = getFunctionSection(
      sql,
      "complete_internal_submission_file"
    )

    expect(allocateSql).toContain("target_expected_revision integer")
    expect(allocateSql).toContain("from public.submissions submission")
    expect(allocateSql).toContain("for update")
    expect(allocateSql).toContain("submission.status <> 'draft'")
    expect(allocateSql).toContain("submission.created_by <> target_actor_user_id")
    expect(allocateSql).toContain("block ->> 'type' = 'file_field'")
    expect(allocateSql).toContain("block ->> 'fieldkey' = target_field_key")
    expect(allocateSql).toContain("if target_storage_key is distinct from expected_storage_key")
    expect(allocateSql).toContain("insert into public.submission_files")
    expect(allocateSql).toContain("'upload_pending'")

    const submissionLock = completeSql.indexOf(
      "from public.submissions submission"
    )
    const fileLock = completeSql.indexOf(
      "from public.submission_files submission_file",
      submissionLock
    )
    const availableReturn = completeSql.indexOf(
      "if submission_file_status = 'available' then"
    )
    const availableUpdate = completeSql.indexOf("set status = 'available'")

    expect(submissionLock).toBeGreaterThan(-1)
    expect(fileLock).toBeGreaterThan(submissionLock)
    expect(completeSql.slice(submissionLock, fileLock)).toContain("for update")
    expect(completeSql.slice(fileLock)).toContain("for update")
    expect(completeSql).toContain("submission.status <> 'draft'")
    expect(completeSql).toContain("submission.created_by <> target_actor_user_id")
    expect(availableReturn).toBeGreaterThan(fileLock)
    expect(availableUpdate).toBeGreaterThan(availableReturn)
  })

  it("submits atomically after optimistic scalar, drawing, and file checks", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )
    const submitSql = getFunctionSection(sql, "submit_internal_submission")
    const submissionLock = submitSql.indexOf(
      "from public.submissions submission"
    )
    const idempotentReturn = submitSql.indexOf(
      "if locked_submission.status = 'submitted' then"
    )
    const revisionCheck = submitSql.indexOf(
      "locked_submission.revision <> target_expected_revision"
    )
    const submissionUpdate = submitSql.indexOf(
      "update public.submissions submission"
    )
    const auditInsert = submitSql.indexOf("insert into public.audit_logs")

    expect(submitSql).toContain("target_expected_revision integer")
    expect(submitSql).toContain("target_values jsonb")
    expect(submissionLock).toBeGreaterThan(-1)
    expect(submitSql.slice(submissionLock)).toContain("for update")
    expect(submitSql).toContain("submission.created_by <> target_actor_user_id")
    expect(idempotentReturn).toBeGreaterThan(submissionLock)
    expect(revisionCheck).toBeGreaterThan(idempotentReturn)
    expect(submitSql).toContain("jsonb_typeof(target_values) <> 'object'")
    expect(submitSql).toContain("where coalesce((block ->> 'required')::boolean, false)")
    expect(submitSql).toContain("block ->> 'type' = 'checkbox_field'")
    expect(submitSql).toContain("block ->> 'type' = 'file_field'")
    expect(submitSql).toContain("from public.submission_files submission_file")
    expect(submitSql).toContain("submission_file.status = 'available'")
    expect(submissionUpdate).toBeGreaterThan(revisionCheck)
    expect(submitSql.slice(submissionUpdate)).toContain("status = 'submitted'")
    expect(submitSql.slice(submissionUpdate)).toContain(
      "revision = submission.revision + 1"
    )
    expect(auditInsert).toBeGreaterThan(submissionUpdate)
    expect(submitSql.slice(auditInsert)).toContain("'submission.submitted'")
    expect(submitSql.slice(auditInsert)).toContain("'submission'")
  })

  it("allows only the service role to execute mutation RPCs and reloads PostgREST", () => {
    const sql = normalizeSql(
      readFileSync(internalSubmissionsMigrationPath, "utf8")
    )

    mutationRpcNames.forEach(
      (functionName: (typeof mutationRpcNames)[number]): void => {
        expect(sql).toMatch(
          new RegExp(
            `revoke (all|execute) on function public\\.${functionName}\\([^;]+\\) from public, anon, authenticated`
          )
        )
        expect(sql).toMatch(
          new RegExp(
            `grant execute on function public\\.${functionName}\\([^;]+\\) to service_role`
          )
        )
      }
    )

    expect(sql).not.toContain("security definer")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
