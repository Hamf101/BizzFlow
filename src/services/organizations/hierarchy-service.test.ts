import { describe, expect, it, vi } from "vitest"

import { FakeSupabaseClient } from "@/services/document-service.test-support"
import { changeOrganizationStructure, getOrganizationStructure } from "@/services/organizations/hierarchy-service"

const ORG = "10000000-0000-4000-8000-000000000001"
const OWNER = "20000000-0000-4000-8000-000000000001"
const STAFF = "20000000-0000-4000-8000-000000000002"
const OPS = "30000000-0000-4000-8000-000000000001"
const STAFF_ROLE = "40000000-0000-4000-8000-000000000001"

function seed(): FakeSupabaseClient {
  return new FakeSupabaseClient({
    organization_memberships: [
      { org_id: ORG, user_id: OWNER, role: "owner_admin", status: "active", manager_user_id: null },
      { org_id: ORG, user_id: STAFF, role: "staff", status: "active", manager_user_id: null },
    ],
    org_units: [{ id: OPS, org_id: ORG, parent_id: null, name: "Ops" }],
    organization_roles: [
      { id: "owner-role", org_id: ORG, name: "Owner", system_key: "owner_admin", visibility_scope: null, archived_at: null },
      { id: STAFF_ROLE, org_id: ORG, name: "Staff", system_key: "staff", visibility_scope: null, archived_at: null },
    ],
  })
}

const owner = { actorUserId: OWNER, organizationId: ORG }
const deps = (client: FakeSupabaseClient) => ({ client: client as never, recordAuditLog: vi.fn(async () => undefined) })

describe("organization structure", () => {
  it("lets the owner place someone in a team as its lead, set who they report to, and narrow a role", async () => {
    const client = seed()

    await changeOrganizationStructure({ ...owner, change: { kind: "set_unit_member", unitId: OPS, userId: STAFF, place: "lead" } }, deps(client))
    await changeOrganizationStructure({ ...owner, change: { kind: "set_manager", userId: STAFF, managerUserId: OWNER } }, deps(client))
    await changeOrganizationStructure({ ...owner, change: { kind: "set_role_scope", roleId: STAFF_ROLE, scope: "everyone" } }, deps(client))

    const structure = await getOrganizationStructure(owner, deps(client))
    expect(structure.units).toEqual([{ id: OPS, name: "Ops", parentId: null, members: [{ isLead: true, userId: STAFF }] }])
    expect(structure.managers).toEqual({ [STAFF]: OWNER })
    expect(structure.roles.find((role) => role.id === STAFF_ROLE)).toMatchObject({ scope: "everyone", setByOwner: true })
    // An owner's reach is always everyone, whatever is asked.
    expect(structure.roles.find((role) => role.systemKey === "owner_admin")).toMatchObject({ scope: "everyone" })

    // Moving them to a plain member, then out, leaves the team empty.
    await changeOrganizationStructure({ ...owner, change: { kind: "set_unit_member", unitId: OPS, userId: STAFF, place: "member" } }, deps(client))
    expect(client.tables.org_unit_members).toEqual([expect.objectContaining({ is_lead: false, user_id: STAFF })])
    await changeOrganizationStructure({ ...owner, change: { kind: "set_unit_member", unitId: OPS, userId: STAFF, place: null } }, deps(client))
    expect(client.tables.org_unit_members).toEqual([])
  })

  it("shows a role's default reach until the owner sets one", async () => {
    const structure = await getOrganizationStructure(owner, deps(seed()))

    expect(structure.roles.find((role) => role.id === STAFF_ROLE)).toMatchObject({ scope: "branch", setByOwner: false })
  })

  it("refuses anyone but the owner, a nameless team, and a team or role that is not there", async () => {
    const client = seed()
    const before = JSON.stringify(client.tables)

    await expect(getOrganizationStructure({ actorUserId: STAFF, organizationId: ORG }, deps(client))).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      changeOrganizationStructure({ actorUserId: STAFF, organizationId: ORG, change: { kind: "save_unit", name: "Mine", parentId: null } }, deps(client))
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(changeOrganizationStructure({ ...owner, change: { kind: "save_unit", name: "   ", parentId: null } }, deps(client))).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      changeOrganizationStructure({ ...owner, change: { kind: "save_unit", unitId: "missing", name: "Ops", parentId: null } }, deps(client))
    ).rejects.toMatchObject({ statusCode: 404 })
    await expect(
      changeOrganizationStructure({ ...owner, change: { kind: "set_role_scope", roleId: "owner-role", scope: "inviter" } }, deps(client))
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(JSON.stringify(client.tables)).toBe(before)
  })
})
