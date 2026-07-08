import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const sprint2MigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260708170500_sprint_2_organizations_roles.sql"
)

const sprint3MigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260708174500_sprint_3_rls_permissions.sql"
)

const sprint4MigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260708190000_sprint_4_documents.sql"
)

const sprint4DocumentTables = ["folders", "documents", "document_versions"] as const
const directWriteActions = ["insert", "update", "delete"] as const

function getTableDefinition(sql: string, tableName: string): string {
  const pattern = new RegExp(`create table public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`)
  const match = sql.match(pattern)

  if (!match) {
    throw new Error(`Missing table definition for public.${tableName}.`)
  }

  return match[1]
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase()
}

function getSqlStatements(sql: string): readonly string[] {
  return normalizeSql(sql)
    .split(";")
    .map((statement: string): string => statement.trim())
    .filter((statement: string): boolean => statement.length > 0)
}

function getAuthenticatedWriteGrantStatements(
  sql: string,
  tableNames: readonly string[]
): readonly string[] {
  const targetedTables = tableNames.map((tableName: string): string => `public.${tableName}`)

  return getSqlStatements(sql).filter((statement: string): boolean => {
    const grantMatch = statement.match(
      /^grant\s+(.+?)\s+on\s+table\s+(.+?)\s+to\s+(.+?)$/
    )

    if (!grantMatch) {
      return false
    }

    const privileges = grantMatch[1]
      .split(",")
      .map((privilege: string): string => privilege.trim())
    const tableTargets = grantMatch[2]
      .split(",")
      .map((tableTarget: string): string => tableTarget.trim())
    const grantees = grantMatch[3]
      .split(",")
      .map((grantee: string): string => grantee.trim())
    const grantsAuthenticated = grantees.some(
      (grantee: string): boolean => grantee === "authenticated"
    )
    const targetsDocumentTable = tableTargets.some((tableTarget: string): boolean =>
      targetedTables.includes(tableTarget)
    )
    const includesWritePrivilege = privileges.some((privilege: string): boolean => {
      return (
        directWriteActions.includes(privilege as (typeof directWriteActions)[number]) ||
        privilege === "all" ||
        privilege === "all privileges"
      )
    })

    return grantsAuthenticated && targetsDocumentTable && includesWritePrivilege
  })
}

describe("Sprint 2 organization migration", () => {
  it("grants Data API access for organization tables and reloads PostgREST", () => {
    const sql = readFileSync(sprint2MigrationPath, "utf8")

    expect(sql).toContain("grant usage on schema public to authenticated, service_role")
    expect(sql).toContain("grant usage on type public.organization_role to authenticated, service_role")
    expect(sql).toContain("grant select, insert, update on table public.profiles to authenticated")
    expect(sql).toContain("grant select, insert on table public.organizations to authenticated")
    expect(sql).toContain(
      "grant select, insert, update on table public.organization_memberships to authenticated"
    )
    expect(sql).toContain("grant select, insert, update on table public.invites to authenticated")
    expect(sql).toContain("grant select, insert, update on table public.profiles to service_role")
    expect(sql).toContain("grant select, insert, delete on table public.organizations to service_role")
    expect(sql).toContain(
      "grant select, insert, update on table public.organization_memberships to service_role"
    )
    expect(sql).toContain("grant select, insert, update on table public.invites to service_role")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

describe("Sprint 3 RLS hardening migration", () => {
  it("adds audit logs with forced RLS and tenant-scoped manager reads", () => {
    const sql = readFileSync(sprint3MigrationPath, "utf8")

    expect(sql).toContain("create table if not exists public.audit_logs")
    expect(sql).toContain("alter table public.audit_logs enable row level security")
    expect(sql).toContain("alter table public.audit_logs force row level security")
    expect(sql).toContain("create policy audit_logs_select_manager")
    expect(sql).toContain("(select public.organization_role_for(org_id)) in ('owner_admin', 'manager')")
  })

  it("removes direct authenticated writes for tenant administration tables", () => {
    const sql = readFileSync(sprint3MigrationPath, "utf8")

    expect(sql).toContain("drop policy if exists organizations_insert_self")
    expect(sql).toContain("drop policy if exists organization_memberships_insert_owner")
    expect(sql).toContain("drop policy if exists organization_memberships_update_owner")
    expect(sql).toContain("drop policy if exists invites_insert_manager")
    expect(sql).toContain("drop policy if exists invites_update_manager")
    expect(sql).toContain("revoke insert, update, delete on table public.organizations from authenticated")
    expect(sql).toContain(
      "revoke insert, update, delete on table public.organization_memberships from authenticated"
    )
    expect(sql).toContain("revoke insert, update, delete on table public.invites from authenticated")
  })

  it("grants Data API access for authenticated reads and secret-key service writes", () => {
    const sql = readFileSync(sprint3MigrationPath, "utf8")

    expect(sql).toContain("grant usage on schema public to authenticated, service_role")
    expect(sql).toContain("grant usage on type public.organization_role to authenticated, service_role")
    expect(sql).toContain("grant select, insert, update on table public.profiles to authenticated")
    expect(sql).toContain("grant select on table public.organizations to authenticated")
    expect(sql).toContain(
      "grant select on table public.organization_memberships to authenticated"
    )
    expect(sql).toContain("grant select on table public.invites to authenticated")
    expect(sql).toContain("grant select on table public.audit_logs to authenticated")
    expect(sql).toContain("grant select, insert, update on table public.profiles to service_role")
    expect(sql).toContain("grant select, insert, delete on table public.organizations to service_role")
    expect(sql).toContain(
      "grant select, insert, update on table public.organization_memberships to service_role"
    )
    expect(sql).toContain("grant select, insert, update on table public.invites to service_role")
    expect(sql).toContain("grant select, insert on table public.audit_logs to service_role")
  })

  it("reloads the PostgREST schema cache after table and grant changes", () => {
    const sql = readFileSync(sprint3MigrationPath, "utf8")

    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

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
