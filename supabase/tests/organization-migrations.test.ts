import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath } from "./migration-contract-helpers"

const sprint2MigrationPath = getMigrationPath(
  "20260708170500_sprint_2_organizations_roles.sql"
)
const sprint3MigrationPath = getMigrationPath(
  "20260708174500_sprint_3_rls_permissions.sql"
)

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
