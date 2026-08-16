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
  "20260726002558_private_document_access_lifecycle.sql"
)
const migrationSql = readFileSync(migrationPath, "utf8")
const sql = normalizeSql(migrationSql)

const grantTables = [
  "folder_access_grants",
  "document_access_grants",
] as const

const legacyPolicies = [
  ["folders", "folders_select_member"],
  ["documents", "documents_select_member"],
  ["document_versions", "document_versions_select_member"],
  ["document_comments", "document_comments_select_member"],
  ["document_activity_events", "document_activity_events_select_member"],
  ["document_answers", "document_answers_select_member"],
  [
    "document_signing_recipients",
    "document_signing_recipients_select_member",
  ],
  ["document_recent_accesses", "document_recent_accesses_select_own"],
  [
    "generated_document_finalizations",
    "generated_document_finalizations_select_member",
  ],
] as const

const replacementPolicies = [
  ["folders", "folders_select_acl"],
  ["documents", "documents_select_acl"],
  ["document_versions", "document_versions_select_parent_acl"],
  ["document_comments", "document_comments_select_parent_acl"],
  [
    "document_activity_events",
    "document_activity_events_select_parent_acl",
  ],
  ["document_answers", "document_answers_select_parent_acl"],
  [
    "document_signing_recipients",
    "document_signing_recipients_select_parent_acl",
  ],
  [
    "document_recent_accesses",
    "document_recent_accesses_select_own_acl",
  ],
  [
    "generated_document_finalizations",
    "generated_document_finalizations_select_parent_acl",
  ],
] as const

const lifecycleResources = ["folders", "documents"] as const
const lifecycleOperations = ["archive", "restore", "trash"] as const

describe("private document access and lifecycle migration", () => {
  it("defines only the approved access and lifecycle enum values", () => {
    expect(getEnumValues("resource_access_level")).toEqual([
      "viewer",
      "contributor",
    ])
    expect(getEnumValues("resource_lifecycle_state")).toEqual([
      "active",
      "archived",
      "trashed",
      "purge_pending",
    ])
    expect(sql).not.toContain("'manager'::public.resource_access_level")
    expect(sql).not.toMatch(
      /create (materialized view|table) public\.(folder|document)_effective_access/
    )
  })

  it("creates tenant-scoped user-or-role grants with partial uniqueness", () => {
    const folderGrants = getTableDefinition(
      migrationSql,
      "folder_access_grants"
    )
    const documentGrants = getTableDefinition(
      migrationSql,
      "document_access_grants"
    )

    for (const tableSql of [folderGrants, documentGrants]) {
      const normalizedTableSql = normalizeSql(tableSql)

      expect(normalizedTableSql).toContain("org_id uuid not null")
      expect(normalizedTableSql).toContain("user_id uuid")
      expect(normalizedTableSql).toContain(
        "organization_role public.organization_role"
      )
      expect(normalizedTableSql).toContain(
        "num_nonnulls(user_id, organization_role) = 1"
      )
      expect(normalizedTableSql).toContain(
        "access_level public.resource_access_level not null"
      )
      expect(normalizedTableSql).toContain(
        "foreign key (org_id, user_id) references public.organization_memberships (org_id, user_id)"
      )
    }

    expect(normalizeSql(folderGrants)).toContain(
      "foreign key (folder_id, org_id) references public.folders (id, org_id) on delete cascade"
    )
    expect(normalizeSql(documentGrants)).toContain(
      "foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade"
    )

    for (const tableName of grantTables) {
      expect(sql).toMatch(
        new RegExp(
          `create unique index ${tableName}_user_unique_idx [^;]+ where user_id is not null`
        )
      )
      expect(sql).toMatch(
        new RegExp(
          `create unique index ${tableName}_role_unique_idx [^;]+ where organization_role is not null`
        )
      )
      expect(sql).toContain(
        `create index ${tableName}_org_resource_idx`
      )
    }
  })

  it("forces RLS and keeps access-grant tables service-role-only", () => {
    for (const tableName of grantTables) {
      expect(sql).toContain(
        `alter table public.${tableName} enable row level security`
      )
      expect(sql).toContain(
        `alter table public.${tableName} force row level security`
      )
      expect(sql).toMatch(
        new RegExp(
          `revoke (all|insert, update, delete) on table public\\.${tableName} from [^;]*authenticated`
        )
      )
      expect(sql).toContain(
        `grant select, insert, update, delete on table public.${tableName} to service_role`
      )
      expect(sql).not.toMatch(
        new RegExp(
          `grant [^;]+ on table public\\.${tableName} to authenticated`
        )
      )
      expect(sql).not.toMatch(
        new RegExp(
          `create policy [^;]+ on public\\.${tableName}`
        )
      )
    }

    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, grantTables)
    ).toEqual([])

    for (const tableName of grantTables) {
      for (const action of directWriteActions) {
        expect(sql).not.toMatch(
          new RegExp(
            `create policy [^;]+ on public\\.${tableName} [^;]+ for ${action}( |;)`
          )
        )
      }
    }
  })

  it("computes live recursive access from active membership and folder ancestry", () => {
    expect(sql).toContain(
      "create or replace function private.effective_folder_access_level"
    )
    expect(sql).toContain(
      "create or replace function private.effective_document_access_level"
    )
    expect(sql).toContain("with recursive")
    expect(sql).toContain("public.organization_memberships")
    expect(sql).toContain("membership.status = 'active'")
    expect(sql).toContain("actor_role = 'owner_admin'")
    expect(sql).toMatch(
      /(lineage\.created_by|document_creator_id) = target_actor_user_id/
    )
    expect(sql).toContain("actor_role = 'external_reviewer'")
    expect(sql).toContain("return 'viewer'")
    expect(sql).toContain("return 'contributor'")
    expect(sql).toContain("parent_folder_id")

    for (const functionName of [
      "private.effective_folder_access_level",
      "private.effective_document_access_level",
      "public.get_folder_access_level",
      "public.get_document_access_level",
    ]) {
      expectFunctionIsHardened(functionName)
    }
  })

  it("rejects cyclic folder ancestry before recursive access evaluation", () => {
    expect(sql).toContain(
      "create or replace function private.prevent_folder_cycle"
    )
    expect(sql).toContain("before insert or update of org_id, parent_folder_id")
    expect(sql).toContain("with recursive")
    expect(sql).toMatch(/raise exception '[^']*cycle[^']*'/)
    expect(sql).toContain("using errcode = '23514'")
    expect(sql).toContain(
      "if parent_lifecycle_state <> 'active'"
    )
    expect(sql).toContain(
      "folders may only be assigned to active parents"
    )
    expect(sql).toContain("pg_try_advisory_xact_lock")
    expect(sql).toContain("using errcode = '40001'")
    expect(sql).toContain(
      "create or replace function private.serialize_document_folder_assignment"
    )
    expect(sql).toContain(
      "before insert or update of org_id, folder_id on public.documents"
    )
  })

  it("removes every permissive legacy policy before installing parent-scoped reads", () => {
    for (const [tableName, policyName] of legacyPolicies) {
      expect(sql).toContain(
        `drop policy if exists ${policyName} on public.${tableName}`
      )
    }

    for (const [tableName, policyName] of replacementPolicies) {
      expect(sql).toContain(
        `create policy ${policyName} on public.${tableName} for select to authenticated`
      )
    }

    expect(sql).toContain("(select auth.uid())")
    expect(sql).toContain("private.effective_folder_access_level")
    expect(sql).toContain("private.effective_document_access_level")
    expect(sql).not.toMatch(
      /create policy (folders|documents|document_versions|document_comments|document_activity_events|document_answers|document_signing_recipients|generated_document_finalizations)_[^;]+using \(\(select public\.is_organization_member\(org_id\)\)\)/
    )
  })

  it("adds consistent lifecycle metadata and state-shape constraints", () => {
    for (const tableName of lifecycleResources) {
      expect(sql).toContain(`alter table public.${tableName}`)
      expect(sql).toContain(
        "add column if not exists lifecycle_state public.resource_lifecycle_state"
      )
      expect(sql).toContain(
        "add column if not exists pre_trash_lifecycle_state public.resource_lifecycle_state"
      )
      expect(sql).toContain("add column if not exists trashed_by uuid")
      expect(sql).toContain(
        "add column if not exists trashed_at timestamptz"
      )
      expect(sql).toContain(
        "add column if not exists purge_after timestamptz"
      )
      expect(sql).toContain(
        "add column if not exists trash_operation_id uuid"
      )
      expect(sql).toContain(
        `constraint ${tableName}_lifecycle_shape`
      )
    }

    expect(sql).toContain("when folder.archived_at is null then 'active'")
    expect(sql).toContain("when document.archived_at is null then 'active'")
    expect(sql).toContain("else 'archived'")
    expect(sql).toContain(
      "pre_trash_lifecycle_state in ('active', 'archived')"
    )
    expect(sql).toContain("new.folder_id is null")
    expect(sql).toContain("new.parent_folder_id is null")
    expect(sql).toContain(
      "new.lifecycle_state is not distinct from old.lifecycle_state"
    )
    expect(sql).toContain("not exists")
  })

  it("uses a 30-day purge deadline only for ordinary trashed documents", () => {
    expect(sql).toContain("interval '30 days'")
    expect(sql).toContain("workflow_status = 'completed'")
    expect(sql).toContain("recipient.status = 'signed'")
    expect(sql).toContain("finalization.status = 'finalized'")
    expect(sql).toContain("purge_after = null")
    expect(sql).toContain("lifecycle_state = 'purge_pending'")
    expect(sql).toContain(
      "create table private.resource_trash_operations"
    )
    expect(sql).toContain("primary key (org_id, operation_id)")
    expect(sql).toContain(
      "resource_trash_operations_actor_fk_idx"
    )
    expect(sql).toContain(
      "insert into private.resource_trash_operations"
    )
    expect(sql).toContain(
      "operation.root_resource_kind = 'folder'"
    )
    expect(sql).toContain("physical_folder_ids uuid[]")
    expect(sql).toContain(
      "document.folder_id = any(physical_folder_ids)"
    )
  })

  it("implements locked atomic document lifecycle RPCs", () => {
    for (const operation of lifecycleOperations) {
      const functionName = `public.${operation}_document`

      expect(sql).toContain(`create or replace function ${functionName}`)
      expectFunctionIsHardened(functionName)
    }

    expect(sql).toContain("from public.documents document")
    expect(sql).toContain("for update")
    expect(sql).toContain("target_trash_operation_id uuid")
    expect(sql).toContain(
      "trash_operation_id = target_trash_operation_id"
    )
    expect(sql).toContain("target_trash_operation_id is null")
    expect(sql).toMatch(/membership\.status = 'active' for update/)
    expect(sql).toContain(
      "from public.organizations organization where organization.id = target_org_id for key share"
    )
    expect(sql).toContain(
      "from public.profiles profile where profile.id = target_actor_user_id for key share"
    )
    expect(sql).toContain(
      "and document.org_id = parent_org_id for key share"
    )
    expect(sql).toContain(
      "create or replace function private.prevent_retention_evidence_deletion"
    )
    expect(sql).toContain(
      "create or replace function private.prevent_retention_evidence_mutation"
    )
    expect(sql).toContain(
      "completed, signed, and finalized evidence cannot be deleted"
    )
    expect(sql).toContain(
      "document retention evidence identity is immutable"
    )
    expect(sql).toContain("signed recipient evidence is immutable")
    expect(sql).toContain(
      "document_signing_recipients_prevent_retention_evidence_delete"
    )
    expect(sql).toContain(
      "generated_document_finalizations_prevent_retention_evidence_delete"
    )
    expect(
      sql.match(
        /hashtextextended\('folder-tree:' \|\| target_org_id::text, 0\)/g
      )?.length
    ).toBeGreaterThanOrEqual(6)
  })

  it("locks recursive folder transitions deterministically under one operation id", () => {
    for (const operation of lifecycleOperations) {
      const functionName = `public.${operation}_folder`

      expect(sql).toContain(`create or replace function ${functionName}`)
      expectFunctionIsHardened(functionName)
    }

    expect(sql).toContain("order by")
    expect(sql).toContain("for update")
    expect(sql).toContain("target_trash_operation_id uuid")
    expect(sql).toContain("trash_operation_id")
    expect(sql).toContain("with recursive")
  })

  it("extends immutable activity and audit evidence for lifecycle changes", () => {
    for (const eventType of [
      "document.restored",
      "document.trashed",
    ]) {
      expect(sql).toContain(`'${eventType}'`)
    }

    for (const action of [
      "folder.archived",
      "folder.restored",
      "folder.trashed",
    ]) {
      expect(sql).toContain(`'${action}'`)
    }

    expect(sql).toContain("insert into public.document_activity_events")
    expect(sql).toContain("insert into public.audit_logs")
  })

  it("reloads the PostgREST schema cache after all schema and policy changes", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})

function getEnumValues(typeName: string): string[] {
  const match = sql.match(
    new RegExp(
      `create type public\\.${typeName} as enum \\(([^)]+)\\)`
    )
  )

  if (!match?.[1]) {
    throw new Error(`Missing enum public.${typeName}.`)
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map(
    (value: RegExpMatchArray): string => value[1]
  )
}

function expectFunctionIsHardened(functionName: string): void {
  const escapedFunctionName = functionName.replace(".", "\\.")
  const functionStart = sql.search(
    new RegExp(`create or replace function ${escapedFunctionName}`)
  )

  expect(functionStart).toBeGreaterThanOrEqual(0)

  const functionTail = sql.slice(functionStart)
  const functionEnd = functionTail.indexOf("$$;")
  const functionSql =
    functionEnd >= 0 ? functionTail.slice(0, functionEnd) : functionTail

  expect(functionSql).toContain("set search_path = ''")
  expect(sql).toMatch(
    new RegExp(
      `revoke (all|execute) on function ${escapedFunctionName}\\([^;]+ from (public, anon, authenticated|public)`
    )
  )
  expect(sql).toMatch(
    new RegExp(
      `grant execute on function ${escapedFunctionName}\\([^;]+ to service_role`
    )
  )
}
