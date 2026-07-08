import { describe, expect, it } from "vitest"

import {
  canPerformOrganizationAction,
  canInviteMembers,
  canUpdateMemberRole,
  getAssignableOrganizationRoles,
  getOrganizationRolePermissions,
  isOrganizationRole,
  ORGANIZATION_PERMISSION_ACTIONS,
  ORGANIZATION_ROLES,
} from "./permissions"

describe("organization permissions", () => {
  it("allows only owner admins and managers to invite members", () => {
    expect(canInviteMembers("owner_admin")).toBe(true)
    expect(canInviteMembers("manager")).toBe(true)
    expect(canInviteMembers("staff")).toBe(false)
    expect(canInviteMembers("external_reviewer")).toBe(false)
  })

  it("allows only owner admins to update member roles", () => {
    expect(canUpdateMemberRole("owner_admin")).toBe(true)
    expect(canUpdateMemberRole("manager")).toBe(false)
    expect(canUpdateMemberRole("staff")).toBe(false)
    expect(canUpdateMemberRole("external_reviewer")).toBe(false)
  })

  it("does not allow assigning another owner admin through the people page", () => {
    expect(getAssignableOrganizationRoles()).toEqual([
      "manager",
      "staff",
      "external_reviewer",
    ])
  })

  it("recognizes the supported organization roles", () => {
    expect(ORGANIZATION_ROLES).toEqual([
      "owner_admin",
      "manager",
      "staff",
      "external_reviewer",
    ])
    expect(isOrganizationRole("manager")).toBe(true)
    expect(isOrganizationRole("unknown")).toBe(false)
  })

  it("defines the supported organization permission actions", () => {
    expect(ORGANIZATION_PERMISSION_ACTIONS).toEqual([
      "people:view",
      "members:invite",
      "members:update_role",
      "audit_logs:view",
    ])
  })

  it("blocks staff from manager and owner actions", () => {
    expect(canPerformOrganizationAction("staff", "people:view")).toBe(true)
    expect(canPerformOrganizationAction("staff", "members:invite")).toBe(false)
    expect(canPerformOrganizationAction("staff", "members:update_role")).toBe(false)
    expect(canPerformOrganizationAction("staff", "audit_logs:view")).toBe(false)
  })

  it("allows managers to invite members and view audit logs without role updates", () => {
    expect(canPerformOrganizationAction("manager", "people:view")).toBe(true)
    expect(canPerformOrganizationAction("manager", "members:invite")).toBe(true)
    expect(canPerformOrganizationAction("manager", "members:update_role")).toBe(false)
    expect(canPerformOrganizationAction("manager", "audit_logs:view")).toBe(true)
  })

  it("allows owner admins to perform every organization permission action", () => {
    expect(getOrganizationRolePermissions("owner_admin")).toEqual(
      ORGANIZATION_PERMISSION_ACTIONS
    )
  })
})
