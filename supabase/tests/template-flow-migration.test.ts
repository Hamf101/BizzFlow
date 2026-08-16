import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260723172350_template_flow_messages.sql"
)

describe("Template Flow messages migration", () => {
  it("creates a template-scoped, attributed conversation ledger", () => {
    const migrationSql = readFileSync(migrationPath, "utf8")
    const tableSql = getTableDefinition(
      migrationSql,
      "template_flow_messages"
    )

    expect(tableSql).toContain("template_id uuid not null")
    expect(tableSql).toContain("author_user_id uuid")
    expect(tableSql).toContain("role in ('user', 'assistant')")
    expect(tableSql).toContain("change_set jsonb")
    expect(tableSql).toContain("jsonb_typeof(change_set) = 'object'")
    expect(tableSql).toContain(
      "references public.document_templates (id, org_id)"
    )
    expect(migrationSql).toContain(
      "on public.template_flow_messages (template_id, created_at, id)"
    )
  })

  it("allows manager reads while keeping browser writes revoked", () => {
    const migrationSql = readFileSync(migrationPath, "utf8")

    expect(migrationSql).toContain(
      "alter table public.template_flow_messages enable row level security"
    )
    expect(migrationSql).toContain(
      "alter table public.template_flow_messages force row level security"
    )
    expect(migrationSql).toContain(
      "create policy template_flow_messages_select_manager"
    )
    expect(migrationSql).toContain(
      "membership.user_id = (select auth.uid())"
    )
    expect(migrationSql).toContain(
      "membership.role in ('owner_admin', 'manager')"
    )
    expect(migrationSql).toContain(
      "revoke insert, update, delete on table public.template_flow_messages"
    )
    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, [
        "template_flow_messages",
      ])
    ).toEqual([])
    expect(migrationSql).toContain(
      "grant select, insert, update, delete"
    )
    expect(migrationSql).toContain("to service_role")
  })
})
