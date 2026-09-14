import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  getTableDefinition,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260914215806_saved_list_views.sql"),
  "utf8"
)
const sql = normalizeSql(migrationSql)

describe("saved list views migration", () => {
  it("keeps each view on its member's membership, gone when the membership goes", () => {
    const table = normalizeSql(getTableDefinition(migrationSql, "saved_list_views"))

    expect(table).toContain(
      "foreign key (org_id, user_id) references public.organization_memberships (org_id, user_id) on delete cascade"
    )
    expect(table).toContain(
      "check (list in ('documents', 'submissions', 'tasks', 'templates', 'audit-log'))"
    )
    expect(sql).toContain(
      "create unique index saved_list_views_member_list_name_idx on public.saved_list_views (org_id, user_id, list, lower(name))"
    )
  })

  it("closes the table to signed-in sessions and leaves it to the service role", () => {
    expect(sql).toContain("alter table public.saved_list_views enable row level security")
    expect(sql).toContain("alter table public.saved_list_views force row level security")
    expect(sql).toContain(
      "revoke all privileges on table public.saved_list_views from anon, authenticated"
    )
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.saved_list_views to service_role"
    )
    expect(sql).not.toContain("create policy")
    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, ["saved_list_views"])
    ).toEqual([])
  })
})
