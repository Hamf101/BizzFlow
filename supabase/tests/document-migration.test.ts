import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  directWriteActions,
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const sprint4MigrationPath = getMigrationPath(
  "20260708190000_sprint_4_documents.sql"
)
const sprint4DocumentTables = ["folders", "documents", "document_versions"] as const

describe("Sprint 4 document migration", () => {
  it("creates document tables with tenant-scoped relational constraints", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")
    const foldersSql = getTableDefinition(sql, "folders")
    const documentVersionsSql = getTableDefinition(sql, "document_versions")

    expect(sql).toContain("create table public.folders")
    expect(sql).toContain("create table public.documents")
    expect(sql).toContain("create table public.document_versions")
    expect(foldersSql).toContain("archived_by uuid references public.profiles (id) on delete set null")
    expect(foldersSql).toContain("archived_at timestamptz")
    expect(documentVersionsSql).toContain("updated_at timestamptz not null default now()")
    expect(sql).toContain("unique (id, org_id)")
    expect(sql).toContain(
      "foreign key (parent_folder_id, org_id) references public.folders (id, org_id) on delete set null"
    )
    expect(sql).toContain(
      "foreign key (folder_id, org_id) references public.folders (id, org_id) on delete set null"
    )
    expect(sql).toContain(
      "foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade"
    )
    expect(sql).toContain(
      "foreign key (current_version_id, id) references public.document_versions (id, document_id) deferrable initially deferred"
    )
  })

  it("enforces document field checks and version status values", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")

    expect(sql).toContain("check (char_length(name) between 1 and 120)")
    expect(sql).toContain("check (parent_folder_id is null or parent_folder_id <> id)")
    expect(sql).toContain("check (char_length(title) between 1 and 180)")
    expect(sql).toContain("check (version_number > 0)")
    expect(sql).toContain("check (byte_size > 0)")
    expect(sql).toContain("check (char_length(original_filename) between 1 and 255)")
    expect(sql).toContain("check (status in ('upload_pending', 'available'))")
  })

  it("adds document indexes for hierarchy, active records, archive reads, and versions", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")

    expect(sql).toContain("create index folders_org_parent_name_idx")
    expect(sql).toContain("on public.folders (org_id, parent_folder_id, lower(name))")
    expect(sql).toContain("create unique index folders_root_name_unique_idx")
    expect(sql).toContain("where parent_folder_id is null")
    expect(sql).toContain("create unique index folders_child_name_unique_idx")
    expect(sql).toContain("where parent_folder_id is not null")
    expect(sql).toContain("create index documents_org_folder_active_idx")
    expect(sql).toContain("on public.documents (org_id, folder_id, created_at desc)")
    expect(sql).toContain("where archived_at is null")
    expect(sql).toContain("create index documents_org_archived_idx")
    expect(sql).toContain("on public.documents (org_id, archived_at desc)")
    expect(sql).toContain("where archived_at is not null")
    expect(sql).toContain("create index documents_created_by_idx")
    expect(sql).toContain("on public.documents (created_by)")
    expect(sql).toContain("create index document_versions_document_created_idx")
    expect(sql).toContain("on public.document_versions (document_id, created_at desc)")
    expect(sql).toContain("create index document_versions_org_created_idx")
    expect(sql).toContain("on public.document_versions (org_id, created_at desc)")
  })

  it("enables forced RLS and tenant member select policies for document tables", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")

    expect(sql).toContain("alter table public.folders enable row level security")
    expect(sql).toContain("alter table public.documents enable row level security")
    expect(sql).toContain("alter table public.document_versions enable row level security")
    expect(sql).toContain("alter table public.folders force row level security")
    expect(sql).toContain("alter table public.documents force row level security")
    expect(sql).toContain("alter table public.document_versions force row level security")
    expect(sql).toContain("create policy folders_select_member")
    expect(sql).toContain("create policy documents_select_member")
    expect(sql).toContain("create policy document_versions_select_member")
    expect(sql).toContain("using ((select public.is_organization_member(org_id)))")
  })

  it("grants authenticated reads only and service-role writes for document tables", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")

    expect(sql).toContain("grant usage on schema public to authenticated, service_role")
    expect(sql).toContain("grant select on table public.folders to authenticated")
    expect(sql).toContain("grant select on table public.documents to authenticated")
    expect(sql).toContain("grant select on table public.document_versions to authenticated")
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.folders to service_role"
    )
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.documents to service_role"
    )
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.document_versions to service_role"
    )
    expect(sql).toContain(
      "revoke insert, update, delete on table public.folders from authenticated"
    )
    expect(sql).toContain(
      "revoke insert, update, delete on table public.documents from authenticated"
    )
    expect(sql).toContain(
      "revoke insert, update, delete on table public.document_versions from authenticated"
    )
    expect(sql).not.toContain(
      "grant select, insert, update, delete on table public.folders to authenticated"
    )
    expect(sql).not.toContain(
      "grant select, insert, update, delete on table public.documents to authenticated"
    )
    expect(sql).not.toContain(
      "grant select, insert, update, delete on table public.document_versions to authenticated"
    )
  })

  it("omits authenticated direct write grants and write policies for document tables", () => {
    const migrationSql = readFileSync(sprint4MigrationPath, "utf8")
    const sql = normalizeSql(migrationSql)

    expect(
      getAuthenticatedWriteGrantStatements(
        "grant select, update on table public.documents to authenticated;",
        sprint4DocumentTables
      )
    ).toEqual(["grant select, update on table public.documents to authenticated"])
    expect(
      getAuthenticatedWriteGrantStatements(
        "grant select, update on table public.documents to authenticated, service_role;",
        sprint4DocumentTables
      )
    ).toEqual([
      "grant select, update on table public.documents to authenticated, service_role",
    ])
    expect(getAuthenticatedWriteGrantStatements(migrationSql, sprint4DocumentTables)).toEqual([])

    sprint4DocumentTables.forEach((tableName: (typeof sprint4DocumentTables)[number]) => {
      directWriteActions.forEach((action: (typeof directWriteActions)[number]) => {
        expect(sql).not.toMatch(
          new RegExp(`create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`)
        )
      })
    })
  })

  it("adds updated-at triggers and reloads the PostgREST schema cache", () => {
    const sql = readFileSync(sprint4MigrationPath, "utf8")

    expect(sql).toContain("create trigger folders_set_updated_at")
    expect(sql).toContain("before update on public.folders")
    expect(sql).toContain("create trigger documents_set_updated_at")
    expect(sql).toContain("before update on public.documents")
    expect(sql).toContain("create trigger document_versions_set_updated_at")
    expect(sql).toContain("before update on public.document_versions")
    expect(sql).toContain("for each row execute function public.set_updated_at()")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
