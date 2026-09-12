import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getAuthenticatedWriteGrantStatements,
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260903115718_organization_roles_and_member_access.sql"),
  "utf8"
)
const sql = normalizeSql(migrationSql)

describe("organization roles and member access migration", () => {
  it("creates tenant-scoped roles with forced RLS and no authenticated writes", () => {
    expect(sql).toContain("create table public.organization_roles")
    expect(sql).toContain(
      "alter table public.organization_roles force row level security"
    )
    expect(sql).toContain("create policy organization_roles_select_member")
    expect(sql).toContain(
      "grant select on table public.organization_roles to authenticated"
    )
    expect(
      getAuthenticatedWriteGrantStatements(migrationSql, [
        "organization_roles",
      ])
    ).toEqual([])
  })

  it("seeds all four workspace roles while protecting only Owner", () => {
    for (const role of [
      "owner_admin",
      "manager",
      "staff",
      "external_reviewer",
    ]) {
      expect(sql).toContain(`'${role}'`)
    }

    expect(sql).toContain("old.system_key = 'owner_admin'")
    expect(sql).toContain("owner access is permanent")
  })

  it("protects direct Owner deletion while allowing organization cascades", () => {
    const triggerStart = sql.indexOf(
      "create or replace function public.protect_owner_organization_role()"
    )
    const triggerEnd = sql.indexOf(
      "create trigger organization_roles_protect_owner",
      triggerStart
    )
    const triggerSql = sql.slice(triggerStart, triggerEnd)

    expect(triggerSql).toContain(
      "and exists ( select 1 from public.organizations"
    )
    expect(triggerSql).toContain("organization.id = old.org_id")
    expect(triggerSql).toContain("raise exception 'owner access is permanent.'")
  })

  it("keeps member and invite role assignments tenant-consistent", () => {
    expect(sql).toContain(
      "foreign key (org_id, role_definition_id) references public.organization_roles (org_id, id)"
    )
    expect(sql).toContain("update_organization_member_access")
    expect(sql).toContain("target_workspace_display_name")
  })

  it("archives unused non-owner roles through a service-only function", () => {
    expect(sql).toContain("archive_organization_role")
    expect(sql).toContain("role is still assigned to a member")
    expect(sql).toContain("role is still assigned to an active invite")
    expect(sql).toContain(
      "grant execute on function public.archive_organization_role(uuid, uuid, uuid) to service_role"
    )
  })

  it("blocks archiving a role retained by a disabled member", () => {
    const memberGuardStart = sql.indexOf(
      "if exists ( select 1 from public.organization_memberships"
    )
    const inviteGuardStart = sql.indexOf(
      "if exists ( select 1 from public.invites",
      memberGuardStart
    )
    const memberGuard = sql.slice(memberGuardStart, inviteGuardStart)

    expect(memberGuard).toContain(
      "membership.role_definition_id = target_role_definition_id"
    )
    expect(memberGuard).not.toContain("membership.status = 'active'")
  })

  it("keeps role mutations inside the requested tenant", () => {
    const accessRpcStart = sql.indexOf(
      "create or replace function public.update_organization_member_access"
    )
    const archiveRpcStart = sql.indexOf(
      "create or replace function public.archive_organization_role",
      accessRpcStart
    )
    const acceptRpcStart = sql.indexOf(
      "create or replace function public.accept_organization_invite",
      archiveRpcStart
    )
    const accessRpc = sql.slice(accessRpcStart, archiveRpcStart)
    const archiveRpc = sql.slice(archiveRpcStart, acceptRpcStart)

    expect(accessRpc).toContain(
      "membership.org_id = target_org_id and membership.user_id = target_actor_user_id"
    )
    expect(accessRpc).toContain(
      "membership.id = target_membership_id and membership.org_id = target_org_id"
    )
    expect(accessRpc).toContain(
      "role_definition.id = target_role_definition_id and role_definition.org_id = target_org_id"
    )
    expect(archiveRpc).toContain(
      "membership.org_id = target_org_id and membership.role_definition_id = target_role_definition_id"
    )
    expect(archiveRpc).toContain(
      "invite.org_id = target_org_id and invite.role_definition_id = target_role_definition_id"
    )
    expect(archiveRpc).toContain(
      "role_definition.id = target_role_definition_id and role_definition.org_id = target_org_id"
    )
  })

  it("reloads the PostgREST schema cache", () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
